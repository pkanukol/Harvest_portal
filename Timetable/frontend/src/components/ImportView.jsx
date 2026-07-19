import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Spinner } from "./TimetableGrid";

export default function ImportView({ token, location, activeYear, onCommitted, onNext }) {
  const [mode, setMode] = useState("allocation"); // "allocation" | "export"
  const [workbookFile, setWorkbookFile] = useState(null);
  const [timingText, setTimingText] = useState("");
  const [exportFile, setExportFile] = useState(null);
  const [teacherDetailsFile, setTeacherDetailsFile] = useState(null);
  const [teacherDetailsResult, setTeacherDetailsResult] = useState(null); // { details, warnings }
  const [rulesText, setRulesText] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { parsed, committed }

  const handleTimingFile = async (file) => {
    if (!file) return;
    setTimingText(await file.text());
  };

  const handleRulesFile = async (file) => {
    if (!file) { setRulesText(""); return; }
    setRulesText(await file.text());
  };

  const handleTeacherDetailsFile = async (file) => {
    if (!file) { setTeacherDetailsFile(null); setTeacherDetailsResult(null); return; }
    setTeacherDetailsFile(file);
    setError("");
    try {
      setTeacherDetailsResult(await api.importPreviewTeacherDetails(token, file));
    } catch (err) {
      setError(err.message);
      setTeacherDetailsFile(null);
    }
  };

  const runImport = async () => {
    if (mode === "allocation" && (!workbookFile || !timingText.trim())) {
      setError("Both the workbook (.xlsx) and the timing schedule are required.");
      return;
    }
    if (mode === "export" && !exportFile) {
      setError("Upload the generated timetable export (.xlsx).");
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
      const parsed = mode === "allocation"
        ? await api.importPreview(token, workbookFile, timingText)
        : await api.importPreviewTimetableExport(token, exportFile);
      const committed = await api.importCommit(
        token, label.trim(), location, parsed, mode === "export" ? null : (rulesText.trim() || null),
        mode === "export" ? parsed.lessons : null,
        mode === "export" ? teacherDetailsResult?.details : null,
      );
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
        <h2>Import — {location}</h2>
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button className={`tab-btn ${mode === "allocation" ? "active" : ""}`} onClick={() => setMode("allocation")}>
            New Timetable (from scratch)
          </button>
          <button className={`tab-btn ${mode === "export" ? "active" : ""}`} onClick={() => setMode("export")}>
            Upload existing timetable
          </button>
        </div>

        {mode === "allocation" ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            Upload the WORK ALLOTMENT.xlsx and the period-timing schedule for the <strong>{location}</strong> branch,
            give it a label, and click Import — it parses the allocation and commits as the new active academic
            year; Generate then places it into an actual day/period grid.
          </p>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            Upload an already-generated/finalized timetable export for <strong>{location}</strong> — one Excel
            sheet with each class+section's grid one after another (section header, then a period+timings row,
            then a row per day with subject and teacher in each cell). The day/period placement, the work
            allocation, and every teacher record are all derived from this one file — nothing else needs
            uploading. It's saved exactly as given (locked so a later Generate never reshuffles it).
          </p>
        )}
        {mode === "allocation" && (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            The rules file is optional and defines school-specific scheduling constraints — which subjects need a
            block period, which are pinned to a fixed day, which teachers should be scheduled first. Leave it out to
            use the existing rules for this school. Plain English sentences, one rule per line, e.g.:
            <br /><code>Assembly is fixed on Monday period 1 for grades 1 to 5.</code>
            <br /><code>Computer Science is a block period for grades 1 to 10.</code>
            <br /><code>Yoga is shared across grades, schedule first.</code>
          </p>
        )}
        {mode === "export" && (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            The teacher details sheet is optional and only needed for two things the timetable itself can't show:
            each teacher's email (for portal login) and which section they're the class teacher of. It needs a
            header row with a <strong>Name</strong> column, plus optional <strong>Email</strong> and{" "}
            <strong>Class Teacher</strong> (e.g. "6A") columns — any Allocation/Subject columns are ignored, since
            that's already derived from the timetable. Leave it out and every teacher is still created correctly,
            just without an email or class-teacher assignment (you can set those later in the Teachers tab).
          </p>
        )}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, alignItems: "flex-end" }}>
          {mode === "allocation" ? (
            <>
              <label>
                Workbook (.xlsx)<br />
                <input type="file" accept=".xlsx" onChange={(e) => setWorkbookFile(e.target.files[0])} />
              </label>
              <label>
                Timing file (.txt)<br />
                <input type="file" accept=".txt" onChange={(e) => handleTimingFile(e.target.files[0])} />
              </label>
              <label>
                Rules file (.txt) — optional<br />
                <input type="file" accept=".txt" onChange={(e) => handleRulesFile(e.target.files[0])} />
              </label>
            </>
          ) : (
            <>
              <label>
                Timetable export (.xlsx)<br />
                <input type="file" accept=".xlsx" onChange={(e) => setExportFile(e.target.files[0])} />
              </label>
              <label>
                Teacher details (.xlsx) — optional<br />
                <input type="file" accept=".xlsx" onChange={(e) => handleTeacherDetailsFile(e.target.files[0])} />
              </label>
            </>
          )}
          <label>
            Label<br />
            <input
              className="input" placeholder="e.g. 2026-27"
              value={label} onChange={(e) => setLabel(e.target.value)}
            />
          </label>
        </div>
        {teacherDetailsResult && (
          <p style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}>
            {teacherDetailsResult.details.length} teacher(s) read from {teacherDetailsFile.name}
            {teacherDetailsResult.warnings.length > 0 && ` (${teacherDetailsResult.warnings.length} warning(s) — shown after import)`}.
          </p>
        )}
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

          {result.committed.teacher_details_warnings?.length > 0 && (
            <>
              <h4>Teacher details warnings ({result.committed.teacher_details_warnings.length})</h4>
              <ul className="warning-list">
                {result.committed.teacher_details_warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      <SavedTimetables token={token} location={location} onActivated={onCommitted} />
    </div>
  );
}

function SavedTimetables({ token, location, onActivated }) {
  const [years, setYears] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setYears(await api.listAcademicYears(token, location));
    } catch (err) {
      setError(err.message);
    }
  }, [token, location]);

  useEffect(() => { load(); }, [load]);

  const activate = async (id) => {
    setBusyId(id);
    setError("");
    try {
      await api.activateAcademicYear(token, id, location);
      await load();
      onActivated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const deactivate = async (id) => {
    setBusyId(id);
    setError("");
    try {
      await api.deactivateAcademicYear(token, id, location);
      await load();
      onActivated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id, label, isActive) => {
    const message = isActive
      ? `"${label}" is the active timetable for ${location} - deleting it leaves nothing active here until you `
        + `switch to another or import a new one. Permanently delete it anyway?`
      : `Permanently delete the "${label}" timetable? This can't be undone.`;
    if (!window.confirm(message)) return;
    setBusyId(id);
    setError("");
    try {
      await api.deleteAcademicYear(token, id, location);
      await load();
      if (isActive) onActivated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card">
      <h3>Saved timetables — {location}</h3>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Every import is kept, not overwritten — switch back to an earlier one any time (e.g. if you imported a
        temporary timetable and want to return to the one you were actually using).
      </p>
      {error && <div className="status-banner error">{error}</div>}
      {!years ? (
        <p><Spinner /> Loading…</p>
      ) : years.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No timetables imported yet for this location.</p>
      ) : (
        <table className="teacher-table">
          <thead><tr><th>Label</th><th>Saved</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.id}>
                <td>{y.label}</td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>
                  {y.created_at ? new Date(y.created_at).toLocaleString() : "—"}
                </td>
                <td>{y.is_active ? <strong style={{ color: "green" }}>Active</strong> : "—"}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  {y.is_active ? (
                    <button className="btn secondary" onClick={() => deactivate(y.id)} disabled={busyId === y.id}>
                      {busyId === y.id ? <Spinner /> : "Deactivate"}
                    </button>
                  ) : (
                    <button className="btn secondary" onClick={() => activate(y.id)} disabled={busyId === y.id}>
                      {busyId === y.id ? <Spinner /> : "Set Active"}
                    </button>
                  )}
                  <button className="btn danger" onClick={() => remove(y.id, y.label, y.is_active)} disabled={busyId === y.id}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
