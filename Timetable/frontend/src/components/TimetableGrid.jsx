import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function periodTimeLabel(timing, period) {
  if (!timing) return "";
  const entry = timing.schedule.find((s) => s.type === "period" && s.number === period);
  return entry ? `${entry.start}–${entry.end}` : "";
}

function scheduleColumns(timing, periodsPerDay) {
  if (timing?.schedule?.length) return timing.schedule;
  return Array.from({ length: periodsPerDay }, (_, i) => ({ type: "period", number: i + 1 }));
}

export default function TimetableGrid({ token, academicYearId, sectionId, timing, readOnly }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // { day, period }
  const [statusMsg, setStatusMsg] = useState("");
  const [undoStack, setUndoStack] = useState([]); // { day, period, previousSstIds }[]
  const [undoing, setUndoing] = useState(false);

  const periodsPerDay = timing?.periods_per_day || 8;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.getSectionTimetable(token, academicYearId, sectionId);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, academicYearId, sectionId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setUndoStack([]); }, [sectionId]);

  if (error) return <div className="status-banner error">{error}</div>;
  if (loading && !data) return <div className="card"><Spinner /> Loading timetable…</div>;
  if (!data) return null;

  const cellFor = (day, period) => data.grid[`${day}-${period}`] || [];
  const columns = scheduleColumns(timing, periodsPerDay);

  const handleUndo = async () => {
    if (!undoStack.length || readOnly) return;
    const last = undoStack[undoStack.length - 1];
    setUndoing(true);
    setError("");
    try {
      await api.patchSlot(
        token,
        { academicYearId, sectionId, dayOfWeek: last.day, periodNumber: last.period, force: true },
        last.previousSstIds
      );
      setUndoStack((prev) => prev.slice(0, -1));
      setStatusMsg(`Reverted ${DAYS[last.day]} Period ${last.period} to its previous value.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div className="card" style={{ position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h2>
          {data.grade_name} {data.section_name}
          {loading && <span style={{ marginLeft: 10 }}><Spinner /></span>}
        </h2>
        {!readOnly && (
          <button className="btn secondary" onClick={handleUndo} disabled={!undoStack.length || undoing}>
            {undoing ? <><Spinner /> Undoing…</> : `Undo last change${undoStack.length ? ` (${undoStack.length})` : ""}`}
          </button>
        )}
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>Class teacher: {data.class_teacher_name || "—"}</p>
      {statusMsg && <div className="status-banner ok">{statusMsg}</div>}

      <div style={{ overflowX: "auto" }}>
        <table className="grid-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>
                Class Teacher<br />
                <span className="period-time">{timing?.class_teacher_start}–{timing?.class_teacher_end}</span>
              </th>
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
            {DAYS.map((dayName, dayIdx) => (
              <tr key={dayName}>
                <td className="day-label">{dayName}</td>
                <td className="class-teacher-cell">{data.class_teacher_name || "—"}</td>
                {columns.map((col, colIdx) => {
                  if (col.type === "break") {
                    return <td key={`break-${colIdx}`} className="break-col">{col.label || "Break"}</td>;
                  }
                  const period = col.number;
                  const occupants = cellFor(dayIdx, period);
                  const manual = occupants.some((o) => o.is_manual_override);
                  return (
                    <td
                      key={`period-${period}`}
                      className={`slot-cell ${occupants.length === 0 ? "empty" : ""} ${manual ? "manual" : ""} ${readOnly ? "readonly" : ""}`}
                      onClick={readOnly ? undefined : () => setEditing({ day: dayIdx, period })}
                    >
                      {occupants.length === 0 ? "—" : occupants.map((o, idx) => (
                        <div className="slot-occupant" key={idx}>
                          <div className="subj">{o.component_label || o.subject}</div>
                          <div className="teacher">{o.teacher_name || "unassigned"}</div>
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditSlotModal
          token={token}
          academicYearId={academicYearId}
          sectionId={sectionId}
          day={editing.day}
          period={editing.period}
          periodTime={periodTimeLabel(timing, editing.period)}
          availableSubjects={data.available_subjects}
          currentOccupants={cellFor(editing.day, editing.period)}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            const previousSstIds = cellFor(editing.day, editing.period).map((o) => o.section_subject_teacher_id);
            setUndoStack((prev) => [...prev, { day: editing.day, period: editing.period, previousSstIds }]);
            setStatusMsg(msg);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

function EditSlotModal({ token, academicYearId, sectionId, day, period, periodTime, availableSubjects, currentOccupants, onClose, onSaved }) {
  const currentGspId = currentOccupants[0]?.grade_subject_period_id;
  const [selectedGspId, setSelectedGspId] = useState(currentGspId || "");
  const [selectedSstIds, setSelectedSstIds] = useState(currentOccupants.map((o) => o.section_subject_teacher_id));
  const [conflicts, setConflicts] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const subject = availableSubjects.find((s) => String(s.grade_subject_period_id) === String(selectedGspId));
  const isClearing = selectedGspId === "";
  const emptySelectionWarning = !isClearing && selectedSstIds.length === 0;
  const isSubjectChange = String(selectedGspId) !== String(currentGspId || "");
  const oldSubject = isSubjectChange
    ? availableSubjects.find((s) => String(s.grade_subject_period_id) === String(currentGspId))
    : null;
  // subject.placed_count doesn't include this slot yet (it currently belongs
  // to a different subject or is empty), so >= periods_per_week means it's
  // already full before this addition would push it over.
  const overAllocationWarning = isSubjectChange && subject && subject.placed_count >= subject.periods_per_week;
  // oldSubject.placed_count DOES include this slot (it's what's here now), so
  // === periods_per_week means removing it drops it one short.
  const underAllocationWarning = isSubjectChange && oldSubject && oldSubject.placed_count === oldSubject.periods_per_week;

  const toggleOption = (sstId) => {
    setSelectedSstIds((prev) =>
      prev.includes(sstId) ? prev.filter((id) => id !== sstId) : [...prev, sstId]
    );
  };

  const changeSubject = (gspId) => {
    setSelectedGspId(gspId);
    const newSubject = availableSubjects.find((s) => String(s.grade_subject_period_id) === String(gspId));
    // Default to every option selected (the common case - a single teacher,
    // or all components of a parallel group) rather than leaving it empty,
    // which previously let a save silently clear the slot.
    setSelectedSstIds(newSubject ? newSubject.options.map((o) => o.section_subject_teacher_id) : []);
  };

  const save = async (force = false) => {
    if (emptySelectionWarning) return;
    setSaving(true);
    setError("");
    setConflicts(null);
    setSuggestion(null);
    try {
      const result = await api.patchSlot(
        token,
        { academicYearId, sectionId, dayOfWeek: day, periodNumber: period, force },
        selectedSstIds
      );
      if (!result.ok) {
        setConflicts(result.conflicts);
        setSuggestion(result.suggestion);
      } else {
        onSaved(force && result.conflicts.length ? "Saved — clash kept as flagged." : "Saved, no clash.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>Edit slot</h3>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri"][day]}, Period {period} {periodTime && `(${periodTime})`}
        </p>

        <label>
          Subject<br />
          <select
            className="select" style={{ width: "100%" }}
            value={selectedGspId}
            onChange={(e) => changeSubject(e.target.value)}
          >
            <option value="">— clear this slot —</option>
            {availableSubjects.map((s) => (
              <option key={s.grade_subject_period_id} value={s.grade_subject_period_id}>
                {s.subject} ({s.placed_count}/{s.periods_per_week} periods this week)
              </option>
            ))}
          </select>
        </label>

        {subject && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              Select all teachers who should be in this slot (more than one means a parallel group, e.g. two language teachers).
            </p>
            {subject.options.map((opt) => (
              <label className="option-row" key={opt.section_subject_teacher_id}>
                <span>{opt.component_label} — {opt.teacher_name || "unassigned"}</span>
                <input
                  type="checkbox"
                  checked={selectedSstIds.includes(opt.section_subject_teacher_id)}
                  onChange={() => toggleOption(opt.section_subject_teacher_id)}
                />
              </label>
            ))}
          </div>
        )}

        {emptySelectionWarning && (
          <div className="status-banner error" style={{ marginTop: 12 }}>
            No teacher/component is checked, so there's nothing to save. Check at least one above,
            or pick "— clear this slot —" if you actually want to empty it.
          </div>
        )}

        {overAllocationWarning && (
          <div className="status-banner warning" style={{ marginTop: 12 }}>
            {subject.subject} already has all {subject.periods_per_week} required periods this week for this
            section. Saving here will put it at {subject.placed_count + 1}/{subject.periods_per_week} - one over quota.
          </div>
        )}

        {underAllocationWarning && (
          <div className="status-banner warning" style={{ marginTop: 12 }}>
            {oldSubject.subject} will drop to {oldSubject.placed_count - 1}/{oldSubject.periods_per_week} periods
            this week after this change - one short. Check the Generate tab's gap list once you save.
          </div>
        )}

        {conflicts && conflicts.length > 0 && (
          <div className="status-banner error" style={{ marginTop: 12 }}>
            Clash: {conflicts.map((c) => `${c.teacher_name} is already in ${c.grade_name} ${c.section_name} at this time`).join("; ")}
            {suggestion && <div style={{ marginTop: 6 }}>Suggestion: {suggestion}</div>}
            <div style={{ marginTop: 8 }}>
              <button className="btn danger" onClick={() => save(true)} disabled={saving}>Save anyway (keep flagged)</button>
            </div>
          </div>
        )}
        {error && <div className="status-banner error" style={{ marginTop: 12 }}>{error}</div>}

        <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn" onClick={() => save(false)} disabled={saving || emptySelectionWarning}>
            {saving ? <><Spinner /> Saving…</> : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
