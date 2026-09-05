import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api";

/**
 * One subject, class by class: teacher, section, subject and campus together -
 * the unique combination the school actually works in.
 *
 * The delivery report answers "how is Grade 8 doing". This answers "how is 8C
 * doing, who teaches it, and why is it where it is". Grades group their own
 * sections so a grade reads as a block rather than a flat list of forty rows.
 *
 * The SME's note sits in the row it explains, because a figure on its own
 * invites the wrong conclusion: a fortnight lost to exams and a class quietly
 * falling behind look identical in a percentage.
 */
export default function TeacherProgress({ token, user, branch = "", onBack }) {
  const [subject, setSubject] = useState("");
  const [subjectGroups, setSubjectGroups] = useState({ curriculum: [], other: [] });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);     // the class being annotated
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getTeachers(token, branch)
      .then((res) => {
        const groups = res.subjects || { curriculum: [], other: [] };
        setSubjectGroups(groups);
        const first = (groups.curriculum || [])[0] || (groups.other || [])[0] || "";
        setSubject((s) => s || first);
      })
      .catch((err) => setError(err.message));
  }, [token, branch]);

  function load() {
    if (!subject) { setData(null); return; }
    setLoading(true);
    setError("");
    api.getSectionProgress(token, subject, branch)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token, subject, branch]);

  async function saveNote(row) {
    setSaving(true);
    setError("");
    try {
      await api.saveTeacherNote(token, {
        subject: data.subject,
        grade: String(row.grade),
        section: row.section,
        teacher_email: "",
        branch,
        note: draft,
      });
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Rows arrive flat; the table shows one block per grade.
  const grades = useMemo(() => {
    const out = [];
    (data?.rows || []).forEach((r) => {
      const last = out[out.length - 1];
      if (last && last.grade === r.grade) last.rows.push(r);
      else out.push({ grade: r.grade, rows: [r] });
    });
    return out;
  }, [data]);

  return (
    <div>
      <button className="back-link" onClick={onBack}>← Back</button>
      <div className="section-title">Teacher Progress</div>
      <div className="hint-text">
        Every class of one subject — teacher, section and campus — against the sessions planned
        up to the end of {data?.prev_month || "last month"}.
        {!branch && " Choose a campus at the top of the page to narrow this to one."}
      </div>

      <div className="filter-bar">
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Subject</label>
            <select className="form-control" value={subject} onChange={(e) => setSubject(e.target.value)}>
              {(subjectGroups.curriculum || []).length > 0 && (
                <optgroup label="Curriculum subjects">
                  {subjectGroups.curriculum.map((s) => <option key={s} value={s}>{s}</option>)}
                </optgroup>
              )}
              {(subjectGroups.other || []).length > 0 && (
                <optgroup label="Other staff subjects">
                  {subjectGroups.other.map((s) => <option key={s} value={s}>{s}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Campus</label>
            <input className="form-control readonly-field" value={branch || "All branches"} readOnly />
          </div>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      {loading && <div className="hint-text">Reading every section…</div>}

      {data && !loading && (
        grades.length === 0 ? (
          <div className="empty-msg">
            No curriculum has been uploaded for {subject}{branch ? ` on ${branch}` : ""} yet.
          </div>
        ) : (
          <div className="card upload-preview-table section-progress">
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Teacher</th>
                  <th>Chapters</th>
                  <th>Sessions</th>
                  <th>Against plan to date</th>
                  <th>SME note</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => (
                  <Fragment key={g.grade}>
                    <tr className="section-grade-row">
                      <td colSpan={6}>
                        <strong>Grade {g.grade}</strong>
                        <span className="hint-text">
                          {" "}· {g.rows[0].sessions} sessions planned for the year,{" "}
                          {g.rows[0].sessions_due} due by the end of {data.prev_month}
                        </span>
                      </td>
                    </tr>
                    {g.rows.map((r) => (
                      <tr key={r.label} className={r.behind > 0 ? "annual-pace-behind" : "annual-pace-done"}>
                        <td><strong>{r.label}</strong></td>
                        <td className={r.teachers.length ? "" : "hint-text"}>
                          {r.teachers.length ? r.teachers.join(", ") : "nobody assigned"}
                        </td>
                        <td>{r.chapters_done} / {r.chapters}</td>
                        <td>{r.sessions_done} / {r.sessions}</td>
                        <td>
                          <Bar pct={r.pct_to_date} behind={r.behind} />
                        </td>
                        <td className="teacher-note-cell">
                          {editing === r.label ? (
                            <div className="teacher-note-edit">
                              <textarea
                                className="form-control"
                                value={draft}
                                placeholder="Why is this class where it is?"
                                onChange={(e) => setDraft(e.target.value)}
                              />
                              <div className="teacher-note-actions">
                                <button className="btn btn-primary btn-sm" disabled={saving}
                                        onClick={() => saveNote(r)}>Save</button>
                                <button className="btn btn-ghost btn-sm" disabled={saving}
                                        onClick={() => setEditing(null)}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="teacher-note-read"
                                 onClick={() => { setEditing(r.label); setDraft(r.note || ""); }}>
                              {r.note ? (
                                <>
                                  <div>{r.note}</div>
                                  {r.note_author && <div className="hint-text">— {r.note_author}</div>}
                                </>
                              ) : (
                                <span className="hint-text">add a note</span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      <p className="hint-text section-progress-note">
        A class is measured on what it has recorded: its own implementation on a POW, or the
        coverage an SME marked for the class. Classes read alike until their POWs differ — and
        where one is ahead or behind, the note is where the reason belongs.
      </p>
    </div>
  );
}

function Bar({ pct, behind }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className="section-bar-wrap">
      <div className="section-bar">
        <div className={`section-bar-fill${behind > 0 ? " section-bar-behind" : ""}`}
             style={{ width: `${width}%` }} />
      </div>
      <span className={behind > 0 ? "annual-behind-text" : ""}>
        {behind > 0 ? `${behind} behind` : "on track"}
      </span>
    </div>
  );
}
