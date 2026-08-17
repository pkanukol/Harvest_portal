import { useCallback, useEffect, useState } from "react";
import { monthGridCells, MONTH_NAMES, toIsoDate } from "../lib/dateUtils";
import { fetchMonthStatus, fetchRegularisationReasonsForRange } from "../lib/attendanceApi";
import { fetchLeaveRequestsOverlapping } from "../lib/leaveApi";
import { fetchFestivalNamesForRange } from "../lib/festivalHolidayImport";
import { computeLop, fiscalYearOf } from "../lib/lopApi";
import { fetchOverrideLabelsForRange } from "../lib/calendarOverrideApi";
import { canWfh } from "../lib/wfhApi";
import DayDetailModal from "./DayDetailModal";
import ApplyLeaveModal from "./ApplyLeaveModal";
import HourPermissionModal from "./HourPermissionModal";
import WfhManager from "./WfhManager";
import LopListPopover from "./LopListPopover";

// 'late' and 'short' share one dot/label ("Short") - see DayDetailModal for
// the same merge on the detail-popup side.
const STATUS_DOT_COLOR = {
  ok: "#2e7d32",
  late: "#d68910",
  short: "#d68910",
  absent: "#c0392b",
  regularised: "#3893C4",
  wfh: "#0e9aa7",
};
const LEAVE_COLOR = "#8e44ad";
// A bus-travel regularisation isn't the person's fault, so it shows the
// same green as "on time" - the blue "regularised" color is reserved for a
// manually-reviewed/approved regularisation.
const BUS_TRAVEL_COLOR = STATUS_DOT_COLOR.ok;
const LEGEND_ITEMS = [
  { key: "ok", label: "ok", color: STATUS_DOT_COLOR.ok },
  { key: "short", label: "short", color: STATUS_DOT_COLOR.short },
  { key: "absent", label: "absent", color: STATUS_DOT_COLOR.absent },
  { key: "regularised", label: "regularised", color: STATUS_DOT_COLOR.regularised },
  { key: "wfh", label: "wfh", color: STATUS_DOT_COLOR.wfh },
  { key: "leave", label: "leave", color: LEAVE_COLOR },
];

const WEEKDAY_HEADER = ["S", "M", "T", "W", "T", "F", "S"];

export default function MonthCalendar({ client, currentUserEmail, staffId, staffName, staffEmail, staffCategory, isSelf }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [statusByDate, setStatusByDate] = useState({});
  const [leaveByDate, setLeaveByDate] = useState({}); // iso -> 'pending' | 'approved'
  const [regularisationReasonByDate, setRegularisationReasonByDate] = useState({}); // iso -> reason_category
  const [festivalNameByDate, setFestivalNameByDate] = useState({}); // iso -> festival name(s)
  const [loading, setLoading] = useState(true);
  const [selectedIso, setSelectedIso] = useState(null);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [hourModalOpen, setHourModalOpen] = useState(false);
  const [wfhModalOpen, setWfhModalOpen] = useState(false);
  const [lopInfo, setLopInfo] = useState({ total: 0, entries: [], lopDates: new Set(), shortDates: new Set() });
  const [lopOpen, setLopOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const from = toIsoDate(new Date(year, month, 1));
    const to = toIsoDate(new Date(year, month + 1, 0));
    const [statusData, leaveRequests, regularisationReasons, festivalNames, lop, overrideLabels] = await Promise.all([
      fetchMonthStatus(client, staffId, year, month),
      fetchLeaveRequestsOverlapping(client, staffId, from, to),
      fetchRegularisationReasonsForRange(client, staffId, from, to),
      fetchFestivalNamesForRange(client, from, to),
      computeLop(client, staffId, fiscalYearOf(year, month)),
      fetchOverrideLabelsForRange(client, from, to, staffId, staffCategory),
    ]);
    setStatusByDate(statusData);
    setRegularisationReasonByDate(regularisationReasons);
    // A calendar-override holiday reason takes precedence over a festival label.
    setFestivalNameByDate({ ...festivalNames, ...overrideLabels });
    setLopInfo(lop);

    const leaveMap = {};
    leaveRequests.forEach((req) => {
      let d = new Date(Math.max(new Date(req.from_date), new Date(from)));
      const end = new Date(Math.min(new Date(req.to_date), new Date(to)));
      while (d <= end) {
        leaveMap[toIsoDate(d)] = req.status;
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      }
    });
    setLeaveByDate(leaveMap);
    setLoading(false);
  }, [client, staffId, staffCategory, year, month]);

  useEffect(() => {
    load();
  }, [load]);

  function goMonth(delta) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  const cells = monthGridCells(year, month);
  const ymPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const shortDaysThisMonth = [...lopInfo.shortDates].filter((d) => d.startsWith(ymPrefix)).sort();
  const selectedStatus = selectedIso ? statusByDate[selectedIso] : null;
  const selectedLeave = selectedIso ? leaveByDate[selectedIso] : null;
  const selectedFestivalName = selectedIso ? festivalNameByDate[selectedIso] : null;

  return (
    <div className="calendar-wrapper">
      <div className="calendar-header">
        <button className="calendar-arrow" onClick={() => goMonth(-1)}>‹</button>
        <span className="calendar-month-label">
          {MONTH_NAMES[month]} {year}
        </span>
        <button className="calendar-arrow" onClick={() => goMonth(1)}>›</button>
      </div>

      <div className="calendar-grid">
        {WEEKDAY_HEADER.map((w, i) => (
          <div key={i} className={i === 0 ? "calendar-weekday calendar-weekday-sunday" : "calendar-weekday"}>
            {w}
          </div>
        ))}
        {loading
          ? null
          : cells.map((cell, idx) => {
              const isSunday = idx % 7 === 0; // grid always starts on a Sunday column
              const cellClass = isSunday ? "calendar-cell calendar-cell-sunday" : "calendar-cell";
              if (!cell) return <div key={idx} className={cellClass} />;

              const festivalName = festivalNameByDate[cell.iso];

              if (isSunday) {
                return (
                  <div key={idx} className={cellClass}>
                    <span className="day-number day-number-sunday">
                      {cell.day}
                      {festivalName ? <span className="event-label" title={festivalName}>{festivalName}</span> : null}
                    </span>
                  </div>
                );
              }

              const status = statusByDate[cell.iso];
              const onLeave = leaveByDate[cell.iso];

              const isLop = lopInfo.lopDates.has(cell.iso);

              if (status?.status === "holiday") {
                return (
                  <div key={idx} className="calendar-cell calendar-cell-holiday">
                    <button className="day-number day-number-holiday" onClick={() => setSelectedIso(cell.iso)}>
                      {cell.day}
                      {isLop ? <span className="event-label" style={{ color: "#ffd76b", fontWeight: 700 }}>LOP</span> : festivalName ? <span className="event-label" title={festivalName}>{festivalName}</span> : null}
                    </button>
                  </div>
                );
              }

              const isBusTravelRegularised = status?.status === "regularised" && regularisationReasonByDate[cell.iso] === "bus_travel";
              const dotColor = onLeave
                ? LEAVE_COLOR
                : isBusTravelRegularised
                ? BUS_TRAVEL_COLOR
                : status
                ? STATUS_DOT_COLOR[status.status]
                : null;

              return (
                <div key={idx} className="calendar-cell">
                  <button className="day-number" onClick={() => setSelectedIso(cell.iso)}>
                    {cell.day}
                    {isLop ? (
                      <span className="event-label" style={{ color: "#c0392b", fontWeight: 700 }}>LOP</span>
                    ) : dotColor ? (
                      <span className="status-dot" style={{ background: dotColor }} />
                    ) : null}
                  </button>
                </div>
              );
            })}
      </div>

      <div className="calendar-legend">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.key} className="legend-item">
            <span className="legend-dot" style={{ background: item.color }} />
            {item.label}
          </div>
        ))}
        <div className="legend-item">
          <span className="legend-square" />
          sunday / holiday
        </div>
      </div>

      {shortDaysThisMonth.length > 0 ? (
        <div className="warning-banner" style={{ fontSize: 12 }}>
          Short day{shortDaysThisMonth.length > 1 ? "s" : ""} this month: {shortDaysThisMonth.map((d) => d.slice(8)).join(", ")}.
          Every 3 short days = 1 LOP.
        </div>
      ) : null}

      {lopInfo.total > 0 ? (
        <p className="hint" style={{ textAlign: "center", color: "var(--red)", fontWeight: 600, marginBottom: 10 }}>
          Loss of Pay this year: {lopInfo.total} day{lopInfo.total > 1 ? "s" : ""} ·{" "}
          <button className="btn-link" style={{ color: "var(--red)" }} onClick={() => setLopOpen(true)}>
            view dates
          </button>
        </p>
      ) : null}

      {isSelf ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setLeaveModalOpen(true)}>
            Apply leave
          </button>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setHourModalOpen(true)}>
            1-hr permission
          </button>
          {canWfh(staffCategory) ? (
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setWfhModalOpen(true)}>
              WFH days
            </button>
          ) : null}
        </div>
      ) : null}

      <DayDetailModal
        client={client}
        visible={!!selectedIso}
        onClose={() => setSelectedIso(null)}
        dayStatus={selectedStatus}
        leaveInfo={selectedLeave}
        festivalName={selectedFestivalName}
        iso={selectedIso}
        staffId={staffId}
        staffEmail={staffEmail}
        requestedBy={currentUserEmail}
        onSubmitted={load}
      />

      <ApplyLeaveModal
        client={client}
        visible={leaveModalOpen}
        onClose={() => setLeaveModalOpen(false)}
        staffRow={{ id: staffId, name: staffName, email: staffEmail }}
        onSubmitted={load}
      />

      <HourPermissionModal
        client={client}
        visible={hourModalOpen}
        onClose={() => setHourModalOpen(false)}
        staffRow={{ id: staffId, name: staffName, email: staffEmail }}
        onSubmitted={load}
      />

      {wfhModalOpen ? (
        <div className="modal-overlay" onClick={() => setWfhModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <strong style={{ fontSize: 16 }}>Work from home</strong>
            <div style={{ marginTop: 10 }}>
              <WfhManager
                client={client}
                staffRow={{ id: staffId, name: staffName, email: staffEmail, category: staffCategory }}
                currentUserEmail={currentUserEmail}
                onChange={load}
              />
            </div>
            <div className="modal-close-row">
              <button className="btn-link" onClick={() => setWfhModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      <LopListPopover visible={lopOpen} onClose={() => setLopOpen(false)} entries={lopInfo.entries} total={lopInfo.total} />
    </div>
  );
}
