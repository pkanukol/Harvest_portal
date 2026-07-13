import { useState } from "react";
import { api } from "../api";
import { Spinner } from "./TimetableGrid";

export default function ImportView({ token, location, activeYear, onCommitted, onNext }) {
  const [workbookFile, setWorkbookFile] = useState(null);
  const [timingText, setTimingText] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { parsed, committed }

  const handleTimingFile = async (file) => {
    if (!file) return;
    setTimingText(await file.text());
  };

  const runImport = async () => {
    if (!workbookFile || !timingText.trim()) {
      setError("Both the workbook (.xlsx) and the timing schedule are required.");
      return;
    }
    if (!label.trim()) {
      setError("Give this academic year a label, e.g. \"2026-27\".");
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const parsed = await api.importPreview(token, workbookFile, timingText);
      const committed = await api.importCommit(token, label.trim(), location, parsed);
      setResult({ parsed, committed });
      onCommitted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const totalPeriods = (grade) => grade.subjects.reduce((sum, s) => sum + s.periods_per_week, 0);

  return (
    <div>
      {activeYear && (
        <div className="status-banner ok">
          Currently active: <strong>{activeYear.label}</strong>. You only need to import again if the
          allocation or timings have changed — otherwise go straight to <strong>Generate</strong> or{" "}
          <strong>Timetable</strong>.
        </div>
      )}

      <div className="card">
        <h2>Import allocation workbook — {location}</h2>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Upload the WORK ALLOTMENT.xlsx and the period-timing schedule for the <strong>{location}</strong> branch,
          give it a label, and click Import — it parses and commits as the new active academic year in one step.
          A summary and any warnings show below afterward.
        </p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, alignItems: "flex-end" }}>
          <label>
            Workbook (.xlsx)<br />
            <input type="file" accept=".xlsx" onChange={(e) => setWorkbookFile(e.target.files[0])} />
          </label>
          <label>
            Timing file (.txt)<br />
            <input type="file" accept=".txt" onChange={(e) => handleTimingFile(e.target.files[0])} />
          </label>
          <label>
            Label<br />
            <input
              className="input" placeholder="e.g. 2026-27"
              value={label} onChange={(e) => setLabel(e.target.value)}
            />
          </label>
        </div>
        <button className="btn" style={{ marginTop: 16 }} onClick={runImport} disabled={loading}>
          {loading ? <><Spinner /> Importing…</> : "Import"}
        </button>
        {error && <div className="status-banner error" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {result && (
        <div className="card">
          <div className="status-banner ok" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Committed as academic year "{result.committed.label}" and set active.</span>
            <button className="btn" onClick={onNext}>Next: Generate →</button>
          </div>

          <h3>Summary</h3>
          <table className="teacher-table">
            <thead>
              <tr><th>Grade</th><th>Sections</th><th>Subjects</th><th>Total periods/week</th></tr>
            </thead>
            <tbody>
              {result.parsed.grades.map((g) => (
                <tr key={g.name}>
                  <td>{g.name}</td>
                  <td>{Object.keys(g.sections).join(", ")}</td>
                  <td>{g.subjects.length}</td>
                  <td>{totalPeriods(g)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p style={{ marginTop: 12, fontSize: 13 }}>
            Timing: class teacher {result.parsed.timing.class_teacher_start}–{result.parsed.timing.class_teacher_end},{" "}
            {result.parsed.timing.periods_per_day} periods/day,{" "}
            {result.parsed.timing.schedule.filter((s) => s.type === "break").length} break(s).
          </p>

          {result.parsed.warnings.length > 0 && (
            <>
              <h4>Warnings / needs manual review ({result.parsed.warnings.length})</h4>
              <ul className="warning-list">
                {result.parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
