import { useEffect, useState } from "react";
import { formatTime } from "../lib/dateUtils";
import { fetchRegularisationForDate, fetchRegularisationCountThisMonth, submitRegularisation } from "../lib/attendanceApi";

// 'late' and 'short' are merged into one "Short" label/color in the UI -
// they're still stored distinctly in the DB (genuinely different behaviors),
// this is a display-only merge.
const STATUS_META = {
  ok: { label: "On time", color: "#2e7d32" },
  late: { label: "Short", color: "#b7791f" },
  short: { label: "Short", color: "#b7791f" },
  absent: { label: "Absent", color: "#c0392b" },
  holiday: { label: "Day off / holiday", color: "#888" },
  regularised: { label: "Regularised", color: "#3893C4" },
};

export default function DayDetailModal({ client, visible, onClose, dayStatus, iso, staffId, staffEmail, requestedBy, leaveInfo, festivalName, onSubmitted }) {
  const [existingRequest, setExistingRequest] = useState(null);
  const [showReasonForm, setShowReasonForm] = useState(false);
  const [reasonText, setReasonText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [capCount, setCapCount] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible || !iso) return;
    setShowReasonForm(false);
    setReasonText("");
    setError(null);
    fetchRegularisationForDate(client, staffId, iso).then(setExistingRequest);
    fetchRegularisationCountThisMonth(client, staffId, iso).then(setCapCount);
  }, [visible, iso, staffId, client]);

  if (!visible) return null;

  if (leaveInfo) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <strong style={{ fontSize: 16 }}>{iso}</strong>
          <p style={{ color: "#8e44ad", fontWeight: 600, marginTop: 6 }}>
            On leave ({leaveInfo === "pending" ? "pending approval" : "approved"})
          </p>
          <div className="modal-close-row">
            <button className="btn-link" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (!dayStatus) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <strong>{iso}</strong>
          <p className="hint">No attendance record for this date.</p>
          <div className="modal-close-row">
            <button className="btn-link" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  const meta = STATUS_META[dayStatus.status] ?? { label: dayStatus.status, color: "#666" };
  // Regularise/Bus-late are only offered for "Short" days (merged late+short) -
  // not for absent, per explicit product decision. A cancelled or rejected
  // existingRequest doesn't block re-use of the date - only a live
  // pending/approved/auto_approved one does (submitRegularisation upserts,
  // so resubmitting after cancel/reject correctly overwrites the dead row
  // instead of hitting the unique(staff_id, attendance_date) constraint).
  const blockingRequest = existingRequest && !["cancelled", "rejected"].includes(existingRequest.status);
  const needsAction = ["late", "short"].includes(dayStatus.status) && !blockingRequest;
  const capReached = capCount >= 1;

  async function submit(reasonCategory) {
    setError(null);
    if (reasonCategory !== "bus_travel" && capReached) {
      setError("1 regularisation already used this calendar month (bus-travel doesn't count toward this).");
      return;
    }
    setSubmitting(true);
    try {
      await submitRegularisation(client, {
        staffId,
        staffEmail,
        attendanceDate: iso,
        reasonCategory,
        reasonText: reasonCategory === "bus_travel" ? "Bus arrived late" : reasonText,
        requestedBy,
      });
      onSubmitted?.();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <strong style={{ fontSize: 16 }}>{iso}</strong>
        <div style={{ color: meta.color, fontWeight: 600, fontSize: 13, marginTop: 4 }}>{meta.label}</div>
        {dayStatus.status === "holiday" && festivalName ? (
          <p className="hint" style={{ marginTop: 2 }}>{festivalName}</p>
        ) : null}

        <div className="times-row">
          <div className="time-box">
            <div className="time-label">Entry</div>
            <div className="time-value">{formatTime(dayStatus.actual_check_in)}</div>
          </div>
          <div className="time-box">
            <div className="time-label">Exit</div>
            <div className="time-value">{formatTime(dayStatus.actual_check_out)}</div>
          </div>
        </div>

        {dayStatus.late_minutes > 0 ? <p className="hint">Late by {dayStatus.late_minutes} min</p> : null}
        {dayStatus.short_minutes > 0 ? <p className="hint">Short by {dayStatus.short_minutes} min</p> : null}

        {existingRequest ? (
          <p className="hint" style={{ color: "var(--brand-600)", fontStyle: "italic" }}>
            Regularisation: {existingRequest.status} ({existingRequest.reason_category})
          </p>
        ) : null}

        {needsAction && !showReasonForm ? (
          <div style={{ display: "flex", gap: 20, marginTop: 14, alignItems: "center" }}>
            {/* Bus late is never blocked by the monthly cap - it doesn't count
                toward it (see default_bus_travel_status in phase1_schema.sql).
                Only Regularise gets disabled once the cap is used. */}
            <button className="btn-link" disabled={submitting} onClick={() => submit("bus_travel")}>Bus late</button>
            {capReached ? (
              <span className="hint" style={{ margin: 0, fontStyle: "italic" }}>Regularise (1/1 used this month)</span>
            ) : (
              <button className="btn-link" disabled={submitting} onClick={() => setShowReasonForm(true)}>Regularise</button>
            )}
          </div>
        ) : null}

        {needsAction && showReasonForm ? (
          <div style={{ marginTop: 12 }}>
            <p className="hint">{capCount}/1 regularisation used this month</p>
            <textarea
              placeholder="Reason (e.g. traffic, personal, medical)"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
            />
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 10 }} disabled={submitting || capReached} onClick={() => submit("other")}>
              Submit request
            </button>
          </div>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}

        <div className="modal-close-row">
          <button className="btn-link" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
