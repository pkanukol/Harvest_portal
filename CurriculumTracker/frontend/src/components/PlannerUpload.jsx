import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api";

const OTHER = "__other__";
const ALL_GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Curriculum upload — for SMEs and the curriculum administrators.
 *
 * One workbook per subject, every grade in it imported at once: the grades
 * come from the tab names ("Grade 3", "Gr 3", "3"), so there is no grade to
 * pick. Each grade in the file replaces only its own (subject, grade); grades
 * the file doesn't cover are left untouched, which is what makes it safe to
 * re-upload a workbook that has only some of the grades filled in.
 *
 * Always previewed first — the backend parses without writing, and Confirm
 * re-sends the same file with commit=true (hence the File object is kept in
 * state rather than cleared after the preview).
 */
export default function PlannerUpload({ token, onBack }) {
  const [inventory, setInventory] = useState([]);
  const [subjects, setSubjects] = useState({ curriculum: [], other: [] });
  const [subjectChoice, setSubjectChoice] = useState("");
  const [customSubject, setCustomSubject] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [openGrade, setOpenGrade] = useState(null);
  const [openStored, setOpenStored] = useState(null);
  // Bumped after an import and on subject change: clearing `file` state does
  // NOT clear what the file input displays, so the old filename would sit
  // there next to a disabled Preview button.
  const [fileInputKey, setFileInputKey] = useState(0);

  const subject = subjectChoice === OTHER ? customSubject.trim() : subjectChoice;

  function loadInventory() {
    api.getPlannerInventory(token)
      .then((res) => {
        setInventory(res.inventory || []);
        setSubjects(res.subjects || { curriculum: [], other: [] });
      })
      .catch((err) => setError(err.message));
  }

  useEffect(loadInventory, [token]);

  // What's already stored for this subject, so the uploader can see at a
  // glance which grades exist before replacing anything.
  const loadedGrades = useMemo(() => {
    const map = {};
    inventory.forEach((i) => {
      if (i.subject.toLowerCase() === subject.toLowerCase()) map[i.grade] = i.rows;
    });
    return map;
  }, [inventory, subject]);

  function resetPreview() { setPreview(null); setResult(null); setError(""); setOpenGrade(null); }

  // Subject change starts over completely — a file picked for another subject
  // is never what you want to upload next.
  function onSubjectChange(value) {
    setSubjectChoice(value);
    setFile(null);
    setFileInputKey((k) => k + 1);
    resetPreview();
  }

  async function runPreview() {
    if (!subject || !file) {
      setError("Please choose a subject and an Excel file first.");
      return;
    }
    setBusy("preview"); setError(""); setResult(null);
    try {
      setPreview(await api.importPlanner(token, { file, subject, commit: false }));
    } catch (err) {
      setPreview(null);
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function confirmImport() {
    setBusy("commit"); setError("");
    try {
      setResult(await api.importPlanner(token, { file, subject, commit: true }));
      setPreview(null);
      setFile(null);
      setFileInputKey((k) => k + 1);
      loadInventory();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const shown = preview || result;

  // Everything below the picker is about ONE subject, so it waits for a
  // subject to be chosen rather than dumping every subject's state on screen.
  const subjectInventory = useMemo(
    () => (subject ? inventory.filter((i) => i.subject.toLowerCase() === subject.toLowerCase()) : []),
    [inventory, subject],
  );

  // Warnings recorded at import time, still outstanding because nobody has
  // re-uploaded a corrected sheet for that grade yet.
  const unresolved = subjectInventory.filter((i) => (i.warnings || []).length > 0);
  const unresolvedCount = unresolved.reduce((n, i) => n + i.warnings.length, 0);

  return (
    <div>
      <button className="back-link" onClick={onBack}>← Back to dashboard</button>

      <div className="section-title">Curriculum Upload</div>
      <div className="hint-text">
        Pick the subject and upload its curriculum mapping workbook — every grade tab in the file is imported
        at once. Only Month, No of sessions, Discipline, Chapter Name, Topic and Sub Topics are read (plus
        Skill of Development and Strands of Language on the language sheets); other columns and blank rows are
        ignored. Each grade in the file replaces that grade only.
      </div>

      {error && <div className="form-error">{error}</div>}

      {result && (
        <div className="upload-success">
          <strong>{result.subject} updated.</strong> {result.total_rows} rows imported across{" "}
          {result.grades.length} grade{result.grades.length === 1 ? "" : "s"} (
          {result.grades.map((g) => `Grade ${g.grade}`).join(", ")}). Teachers of this subject will now see
          these chapters on the POW form.
        </div>
      )}

      <div className="card upload-card">
        <div className="form-group">
          <label className="form-label">Subject</label>
          <select
            className="form-control"
            value={subjectChoice}
            onChange={(e) => onSubjectChange(e.target.value)}
          >
            <option value="">— select subject —</option>
            <optgroup label="Curriculum subjects">
              {subjects.curriculum.map((s) => <option key={s} value={s}>{s}</option>)}
            </optgroup>
            {subjects.other.length > 0 && (
              <optgroup label="Other staff subjects">
                {subjects.other.map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            )}
            <option value={OTHER}>Other (type a new subject)…</option>
          </select>
          {subjectChoice === OTHER && (
            <input
              className="form-control upload-custom-subject"
              value={customSubject}
              placeholder="Subject name, exactly as on teacher profiles"
              onChange={(e) => { setCustomSubject(e.target.value); resetPreview(); }}
            />
          )}
        </div>

        <div className="form-group">
          <label className="form-label">Curriculum file (.xlsx)</label>
          <input
            key={fileInputKey}
            className="form-control"
            type="file"
            accept=".xlsx,.xlsm"
            onChange={(e) => { setFile(e.target.files?.[0] || null); resetPreview(); }}
          />
          <div className="hint-text upload-file-hint">
            {file
              ? `Selected: ${file.name}`
              : "One tab per grade, named “Grade 3” or “Gr 3”. Tabs for grades outside 1–10, or without a grade in the name, are skipped."}
          </div>
        </div>

        {subject && !file && Object.keys(loadedGrades).length > 0 && !shown && (
          <div className="upload-note">
            {subject} already has {Object.keys(loadedGrades).sort((a, b) => a - b).map((g) => `Grade ${g}`).join(", ")} loaded.
            Only the grades present in the file you upload will be replaced.
          </div>
        )}

        <div className="form-actions">
          <span />
          <button className="btn btn-primary" disabled={!!busy || !subject || !file} onClick={runPreview}>
            {busy === "preview" ? "Reading file…" : "Preview"}
          </button>
        </div>
      </div>

      {shown && (
        <>
          <div className="section-title">
            {preview ? "Preview — nothing saved yet" : "Imported"}
          </div>

          {shown.warnings.length > 0 && (
            <div className="upload-warnings">
              <strong>{shown.warnings.length} thing{shown.warnings.length === 1 ? "" : "s"} to check:</strong>
              <ul>{shown.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}

          <div className="grade-chip-row">
            {ALL_GRADES.map((g) => {
              const found = shown.grades.find((x) => x.grade === g);
              const loaded = loadedGrades[g];
              return (
                <div
                  key={g}
                  className={`grade-chip ${found ? "grade-chip-found" : loaded ? "grade-chip-kept" : "grade-chip-missing"}`}
                  title={
                    found ? `Tab “${found.tab}” — ${found.row_count} rows`
                      : loaded ? `Not in this file — the ${loaded} rows already stored stay as they are`
                      : "No tab in this file, and nothing stored yet"
                  }
                >
                  <div className="grade-chip-label">Grade {g}</div>
                  <div className="grade-chip-value">
                    {found ? `${found.chapter_count} chapters` : loaded ? "kept" : "— missing —"}
                  </div>
                </div>
              );
            })}
          </div>

          {shown.missing_grades.length > 0 && (
            <div className="hint-text">
              No tab for {shown.missing_grades.map((g) => `Grade ${g}`).join(", ")} in this workbook.
              That's fine if this subject isn't taught in those grades — anything already stored for them is left alone.
            </div>
          )}

          {shown.skipped_tabs.length > 0 && (
            <div className="upload-note upload-skipped">
              <strong>Tabs skipped:</strong>
              <ul>{shown.skipped_tabs.map((t, i) => <li key={i}>“{t.name}” — {t.why}</li>)}</ul>
            </div>
          )}

          <div className="card upload-preview-table">
            <table>
              <thead>
                <tr>
                  <th>Grade</th><th>Tab</th><th>Chapters</th><th>Rows</th>
                  <th>{preview ? "Replaces" : "Replaced"}</th><th>Columns</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.grades.map((g) => (
                  <Fragment key={g.grade}>
                    <tr>
                      <td>Grade {g.grade}</td>
                      <td>{g.tab}</td>
                      <td>{g.chapter_count}</td>
                      <td>{preview ? g.row_count : g.imported}</td>
                      <td>{preview ? g.existing_rows : g.replaced}</td>
                      <td className="upload-col-flags">
                        {g.has_strands && <span className="badge badge-reviewed">Strands</span>}
                        {g.has_skill && <span className="badge badge-reviewed">Skill</span>}
                        {g.warnings.length > 0 && <span className="badge badge-pending">{g.warnings.length} warning{g.warnings.length === 1 ? "" : "s"}</span>}
                      </td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setOpenGrade(openGrade === g.grade ? null : g.grade)}
                        >
                          {openGrade === g.grade ? "Hide" : "View"}
                        </button>
                      </td>
                    </tr>
                    {openGrade === g.grade && (
                      <tr>
                        <td colSpan={7} className="grade-detail-cell">
                          {g.warnings.length > 0 && (
                            <ul className="grade-detail-warnings">{g.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                          )}
                          <table>
                            <thead>
                              <tr><th>Chapter</th><th>Month</th><th>Discipline / Strand</th><th>Sessions</th><th>Topics</th><th>Sub topics</th></tr>
                            </thead>
                            <tbody>
                              {g.chapters.map((c, i) => (
                                <tr key={`${c.chapter_name}-${c.month}-${i}`}>
                                  <td>{c.chapter_name}</td>
                                  <td>{c.month || "—"}</td>
                                  <td>{c.discipline || "—"}</td>
                                  <td>{c.sessions}</td>
                                  <td>{c.topics}</td>
                                  <td>{c.subtopics}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {preview && (
            <div className="form-actions">
              <button className="btn btn-ghost" disabled={!!busy} onClick={resetPreview}>Cancel</button>
              <button className="btn btn-primary" disabled={!!busy} onClick={confirmImport}>
                {busy === "commit"
                  ? "Importing…"
                  : `Confirm — import ${preview.grades.length} grade${preview.grades.length === 1 ? "" : "s"} of ${preview.subject}`}
              </button>
            </div>
          )}
        </>
      )}

      <div className="section-title">
        {subject ? `${subject} — curriculum data currently loaded` : "Curriculum data currently loaded"}
      </div>
      {unresolved.length > 0 && (
        <div className="upload-warnings">
          <strong>
            {unresolvedCount} unresolved warning{unresolvedCount === 1 ? "" : "s"} across{" "}
            {unresolved.length} sheet{unresolved.length === 1 ? "" : "s"}
          </strong>
          <div className="hint-text upload-warnings-hint">
            These describe problems in the uploaded sheets themselves, so they stay listed until a corrected
            file is uploaded for that grade. Click a row below to read them.
          </div>
        </div>
      )}
      {!subject ? (
        <div className="empty-msg">Select a subject above to see what's loaded for it.</div>
      ) : subjectInventory.length === 0 ? (
        <div className="empty-msg">Nothing imported for {subject} yet.</div>
      ) : (
        <div className="card upload-preview-table">
          <table>
            <thead>
              <tr><th>Subject</th><th>Grade</th><th>Chapters</th><th>Rows</th><th>Warnings</th><th>Uploaded</th></tr>
            </thead>
            <tbody>
              {subjectInventory.map((i) => {
                const key = `${i.subject}-${i.grade}`;
                const count = (i.warnings || []).length;
                return (
                  <Fragment key={key}>
                    <tr
                      className={count > 0 ? "lag-row-behind" : ""}
                      onClick={() => count > 0 && setOpenStored(openStored === key ? null : key)}
                    >
                      <td>{i.subject}</td>
                      <td>Grade {i.grade}</td>
                      <td>{i.chapters}</td>
                      <td>{i.rows}</td>
                      <td>
                        {/* No import log at all (uploaded before warnings were
                            recorded) is "not recorded", NOT "clean" — claiming a
                            sheet is clean when nothing was ever checked is worse
                            than admitting we don't know. */}
                        {count > 0 ? (
                          <span className="badge badge-pending">{count} warning{count === 1 ? "" : "s"}</span>
                        ) : i.imported_at ? (
                          <span className="badge badge-approved">clean</span>
                        ) : (
                          <span className="badge badge-created">not recorded</span>
                        )}
                      </td>
                      <td className="lag-last">{i.imported_at ? i.imported_at.slice(0, 10) : "—"}</td>
                    </tr>
                    {openStored === key && count > 0 && (
                      <tr>
                        <td colSpan={6} className="grade-detail-cell">
                          <ul className="grade-detail-warnings">
                            {i.warnings.map((w, n) => <li key={n}>{w}</li>)}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
