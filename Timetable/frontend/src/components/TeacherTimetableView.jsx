import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Spinner } from "./TimetableGrid";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function scheduleColumns(timing, periodsPerDay) {
  if (timing?.schedule?.length) return timing.schedule;
  return Array.from({ length: periodsPerDay }, (_, i) => ({ type: "period", number: i + 1 }));
}

function occupantSignature(occupants) {
  if (!occupants.length) return null;
  return occupants
    .map((o) => `${o.grade_name}|${o.section_name}|${o.component_label || o.subject}`)
    .sort()
    .join(",");
}

// Walks one day's columns and merges consecutive period columns that hold the
// exact same (grade, section, subject) into a single cell with colSpan > 1 -
// this is what a block period (e.g. two periods of Dance back-to-back) looks
// like. Two periods with a break column between them are never adjacent in
// `columns`, so they naturally never merge - only a true back-to-back block
// does.
function buildDayCells(dayIdx, columns, byCell) {
  const cells = [];
  for (const col of columns) {
    if (col.type === "break") {
      cells.push({ kind: "break", col });
      continue;
    }
    const occupants = byCell[`${dayIdx}-${col.number}`] || [];
    const sig = occupantSignature(occupants);
    const prev = cells[cells.length - 1];
    if (sig !== null && prev && prev.kind === "period" && prev.sig === sig) {
      prev.colSpan += 1;
      continue;
    }
    cells.push({ kind: "period", period: col.number, occupants, sig, colSpan: 1 });
  }
  return cells;
}

export default function TeacherTimetableView({ token, academicYearId, location, timing }) {
  const [teachers, setTeachers] = useState(null);
  const [teachersError, setTeachersError] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const periodsPerDay = timing?.periods_per_day || 8;
  const columns = scheduleColumns(timing, periodsPerDay);

  useEffect(() => {
    api.listTeachers(token, location)
      .then((list) => {
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
        setTeachers(sorted);
        setTeacherId(sorted[0]?.id ? String(sorted[0].id) : "");
      })
      .catch((err) => setTeachersError(err.message));
  }, [token, location]);

  useEffect(() => {
    if (!teacherId || !academicYearId) return;
    setLoading(true);
    setError("");
    api.getTeacherWeek(token, academicYearId, teacherId)
      .then(setEntries)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, academicYearId, teacherId]);

  const byCell = useMemo(() => {
    const map = {};
    (entries || []).forEach((e) => {
      const key = `${e.day_of_week}-${e.period_number}`;
      map[key] = map[key] || [];
      map[key].push(e);
    });
    return map;
  }, [entries]);

  const subjectSummary = useMemo(() => {
    const counts = {};
    (entries || []).forEach((e) => {
      const label = e.component_label || e.subject || "—";
      counts[label] = (counts[label] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  if (teachersError) return <div className="status-banner error">{teachersError}</div>;
  if (!teachers) return <p><Spinner /> Loading teachers…</p>;

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Teacher{" "}
          <select className="select" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        {subjectSummary.map(([label, count]) => (
          <span key={label} style={{ fontSize: 13, color: "var(--muted)" }}>
            <strong style={{ color: "inherit" }}>{label}</strong> — {count} period{count === 1 ? "" : "s"}/week
          </span>
        ))}
      </div>

      {error && <div className="status-banner error" style={{ marginTop: 12 }}>{error}</div>}
      {loading && <p style={{ marginTop: 12 }}><Spinner /> Loading timetable…</p>}

      {!loading && entries && (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Day</th>
                {columns.map((col, colIdx) => (
                  col.type === "break" ? (
                    <th key={`break-${colIdx}`} className="break-col">
                      {col.label || "Break"}<br />
                      <span className="period-time">{col.start}–{col.end}</span>
                    </th>
                  ) : (
                    <th key={`period-${col.number}`}>
                      Period {col.number}<br />
                      <span className="period-time">{col.start}–{col.end}</span>
                    </th>
                  )
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((dayName, dayIdx) => {
                const cells = buildDayCells(dayIdx, columns, byCell);
                return (
                  <tr key={dayName}>
                    <td className="day-label">{dayName}</td>
                    {cells.map((cell, idx) => {
                      if (cell.kind === "break") {
                        return <td key={`break-${idx}`} className="break-col">{cell.col.label || "Break"}</td>;
                      }
                      const occupants = cell.occupants;
                      return (
                        <td
                          key={`period-${cell.period}`}
                          colSpan={cell.colSpan}
                          className={`slot-cell readonly ${occupants.length === 0 ? "empty" : ""}`}
                        >
                          {occupants.length === 0 ? "—" : occupants.map((o, i) => (
                            <div className="slot-occupant" key={i}>
                              <div className="subj">{o.grade_name} {o.section_name}</div>
                            </div>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && entries && entries.length === 0 && (
        <p style={{ marginTop: 12, color: "var(--muted)" }}>No periods placed for this teacher yet.</p>
      )}
    </div>
  );
}
