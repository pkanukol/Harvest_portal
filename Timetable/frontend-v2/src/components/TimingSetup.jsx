import { useEffect, useRef, useState } from "react";

// Structured replacement for the old timing.txt upload (confirmed by the
// user 2026-08-03): pick how many periods/breaks the day has (plus an
// optional Class Teacher / Zero Period), then fill in a start/end time for
// each - breaks are inserted wherever the user wants among the periods, up
// to the count they specified. Produces the same {periodsPerDay, schedule}
// shape timing_configs.schedule already uses everywhere else, so nothing
// downstream (TimetableViewer, TimetableGrid, the scheduler) needs to know
// timing came from this form instead of a parsed file.
//
// Pure/controlled: this component only manages the row-editing UI and calls
// onChange with the current {periodsPerDay, schedule} (or null while the
// form is incomplete) - it never talks to Supabase itself. Callers decide
// whether/when to persist (e.g. UploadTimetable.jsx has a real academic
// year to save against; BuildNewTimetable.jsx just uses the value locally
// for its read-only preview).
function rowsFromSchedule(schedule) {
  return schedule.map((s) => {
    if (s.type === "break") return { kind: "break", label: s.label || "Break", start: s.start, end: s.end };
    if (s.number === 0) return { kind: "classTeacher", start: s.start, end: s.end };
    return { kind: "period", start: s.start, end: s.end };
  });
}

function scheduleFromRows(rows) {
  const schedule = [];
  let n = 0;
  let hasClassTeacher = false;
  for (const r of rows) {
    if (r.kind === "classTeacher") {
      schedule.push({ type: "period", number: 0, start: r.start, end: r.end });
      hasClassTeacher = true;
    } else if (r.kind === "break") {
      schedule.push({ type: "break", label: r.label || "Break", start: r.start, end: r.end });
    } else {
      n += 1;
      schedule.push({ type: "period", number: n, start: r.start, end: r.end });
    }
  }
  return { schedule, periodsPerDay: n, hasClassTeacher };
}

function periodNumberAt(rows, idx) {
  let n = 0;
  for (let i = 0; i <= idx; i++) if (rows[i].kind === "period") n += 1;
  return n;
}

export default function TimingSetup({ initialConfig, onChange, collapseSignal }) {
  const [phase, setPhase] = useState("counts");
  const [numPeriods, setNumPeriods] = useState(8);
  const [numBreaks, setNumBreaks] = useState(2);
  const [hasClassTeacher, setHasClassTeacher] = useState(true);
  const [rows, setRows] = useState([]);
  const nextId = useRef(0);
  const [rowIds, setRowIds] = useState([]);
  // Collapsed to a one-line summary once already-saved timing loads, or
  // right after a caller-driven save (collapseSignal changing) - editing a
  // school's timing is rare once set up, so the full row editor shouldn't
  // stay open by default.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (initialConfig?.schedule?.length) {
      const loaded = rowsFromSchedule(initialConfig.schedule);
      setRows(loaded);
      setRowIds(loaded.map(() => nextId.current++));
      setNumPeriods(loaded.filter((r) => r.kind === "period").length || 1);
      setNumBreaks(loaded.filter((r) => r.kind === "break").length);
      setHasClassTeacher(loaded.some((r) => r.kind === "classTeacher"));
      setPhase("rows");
      setCollapsed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConfig]);

  useEffect(() => {
    if (collapseSignal) setCollapsed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseSignal]);

  useEffect(() => {
    if (phase !== "rows" || !rows.length) {
      onChange(null);
      return;
    }
    const allFilled = rows.every((r) => r.start && r.end && (r.kind !== "break" || r.label.trim()));
    onChange(allFilled ? scheduleFromRows(rows) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, phase]);

  function generateRows() {
    const n = Math.max(1, parseInt(numPeriods, 10) || 1);
    const next = [];
    const ids = [];
    if (hasClassTeacher) {
      next.push({ kind: "classTeacher", start: "", end: "" });
      ids.push(nextId.current++);
    }
    for (let i = 0; i < n; i++) {
      next.push({ kind: "period", start: "", end: "" });
      ids.push(nextId.current++);
    }
    setRows(next);
    setRowIds(ids);
    setPhase("rows");
  }

  const breaksBudget = Math.max(0, parseInt(numBreaks, 10) || 0);
  const breaksPlaced = rows.filter((r) => r.kind === "break").length;
  const breaksRemaining = breaksBudget - breaksPlaced;

  function updateRow(idx, patch) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function insertBreakAt(pos) {
    setRows((prev) => {
      const next = [...prev];
      next.splice(pos, 0, { kind: "break", label: "Break", start: "", end: "" });
      return next;
    });
    setRowIds((prev) => {
      const next = [...prev];
      next.splice(pos, 0, nextId.current++);
      return next;
    });
  }

  function removeRow(idx) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setRowIds((prev) => prev.filter((_, i) => i !== idx));
  }

  function BreakGap({ pos }) {
    if (breaksRemaining <= 0) return null;
    return (
      <button type="button" className="link-btn" onClick={() => insertBreakAt(pos)}>
        + Add break here
      </button>
    );
  }

  if (phase === "rows" && collapsed) {
    const periodCount = rows.filter((r) => r.kind === "period").length;
    const breakCount = rows.filter((r) => r.kind === "break").length;
    const hasCT = rows.some((r) => r.kind === "classTeacher");
    return (
      <p>
        {periodCount} period(s){hasCT ? " + Class Teacher/Period 0" : ""}, {breakCount} break(s) configured.{" "}
        <button type="button" className="link-btn" onClick={() => setCollapsed(false)}>
          Edit timing
        </button>
      </p>
    );
  }

  if (phase === "counts") {
    return (
      <div>
        <label>
          Number of periods:{" "}
          <input
            type="number"
            min="1"
            value={numPeriods}
            onChange={(e) => setNumPeriods(e.target.value)}
            style={{ width: "4rem" }}
          />
        </label>{" "}
        <label>
          Number of breaks:{" "}
          <input
            type="number"
            min="0"
            value={numBreaks}
            onChange={(e) => setNumBreaks(e.target.value)}
            style={{ width: "4rem" }}
          />
        </label>{" "}
        <label>
          <input type="checkbox" checked={hasClassTeacher} onChange={(e) => setHasClassTeacher(e.target.checked)} />{" "}
          Include a Class Teacher / Zero Period
        </label>{" "}
        <button type="button" onClick={generateRows}>
          Generate
        </button>
      </div>
    );
  }

  return (
    <div>
      <p>
        <small>
          {breaksRemaining > 0
            ? `${breaksRemaining} break(s) left to place - click "+ Add break here" where you want one.`
            : "All breaks placed."}
        </small>
      </p>
      <BreakGap pos={0} />
      {rows.map((r, idx) => (
        <div key={rowIds[idx]} className="cell-pair">
          <strong>
            {r.kind === "classTeacher" ? "Class Teacher / Period 0" : r.kind === "period" ? `Period ${periodNumberAt(rows, idx)}` : null}
          </strong>
          {r.kind === "break" && (
            <input
              type="text"
              value={r.label}
              placeholder="Break label (e.g. Lunch)"
              onChange={(e) => updateRow(idx, { label: e.target.value })}
            />
          )}{" "}
          <input type="time" value={r.start} onChange={(e) => updateRow(idx, { start: e.target.value })} />{" "}
          &ndash;{" "}
          <input type="time" value={r.end} onChange={(e) => updateRow(idx, { end: e.target.value })} />
          {r.kind === "break" && (
            <>
              {" "}
              <button type="button" className="link-btn danger" onClick={() => removeRow(idx)}>
                Remove
              </button>
            </>
          )}
          <BreakGap pos={idx + 1} />
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => setPhase("counts")}>
        Start over with different counts
      </button>
    </div>
  );
}
