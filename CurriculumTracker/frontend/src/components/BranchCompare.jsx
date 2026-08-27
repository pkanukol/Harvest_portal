import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * Kodathi against Attibele, grade by grade, for one subject.
 *
 * An SME, Curriculum Head or the leadership team oversees both campuses
 * separately — every other screen is scoped to one of them by the header
 * selector. This is the one place they sit side by side, so a grade that has
 * drifted apart is visible without switching back and forth.
 *
 * Section counts differ by campus (Attibele runs two where Kodathi runs five
 * or six), so each campus shows its own — the same plan taught to a different
 * number of classes.
 */
export default function BranchCompare({ token, onBack, initialSubject = "", embed = false }) {
  const [subjectGroups, setSubjectGroups] = useState({ curriculum: [], other: [] });
  const [subjectsLoaded, setSubjectsLoaded] = useState(false);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [subject, setSubject] = useState(initialSubject);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetched when the picker is first touched, like the other screens - nothing
  // heavy runs just because the page opened.
  function loadSubjects() {
    if (subjectsLoaded || subjectsLoading) return;
    setSubjectsLoading(true);
    api.getTeachers(token, "")
      .then((res) => {
        if (res.subjects) setSubjectGroups(res.subjects);
        setSubjectsLoaded(true);
      })
      .catch((err) => setError(err.message))
      .finally(() => setSubjectsLoading(false));
  }

  const subjectOptions = [...(subjectGroups.curriculum || []), ...(subjectGroups.other || [])];

  useEffect(() => {
    if (subjectsLoaded && !subject && subjectOptions.length) setSubject(subjectOptions[0]);
  }, [subjectsLoaded, subject, subjectOptions]);

  useEffect(() => {
    if (!subject) { setData(null); return; }
    setLoading(true);
    setError("");
    api.compareBranches(token, subject)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, subject]);

  // The page's own header and subject picker, shown in every state so the
  // subject can be changed while a slow comparison is still running.
  // Embedded in someone else's page: no back link, and no subject picker when
  // the link already names the subject - the host page chose it.
  const showPicker = !embed || !initialSubject;
  const header = (
    <>
      {!embed && <button className="back-link" onClick={onBack}>← Back</button>}
      <div className="section-title">
        Compare campuses{embed && subject ? ` — ${subject}` : ""}
      </div>
      {!embed && (
        <p className="hint-text">
          Kodathi against Attibele, grade by grade, for one subject. Every other screen follows the
          campus selector at the top; this one deliberately shows both.
        </p>
      )}
      <div className="filter-bar" style={{ display: showPicker ? undefined : "none" }}>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Subject</label>
            <select
              className="form-control"
              value={subject}
              onFocus={loadSubjects}
              onMouseDown={loadSubjects}
              onChange={(e) => setSubject(e.target.value)}
            >
              {subjectOptions.length === 0 && (
                <option value="">
                  {subjectsLoading
                    ? "Loading subjects…"
                    : subjectsLoaded ? "No subjects available" : "Select a subject…"}
                </option>
              )}
              {(subjectGroups.curriculum || []).length > 0 ? (
                <>
                  <optgroup label="Curriculum subjects">
                    {subjectGroups.curriculum.map((x) => <option key={x} value={x}>{x}</option>)}
                  </optgroup>
                  {(subjectGroups.other || []).length > 0 && (
                    <optgroup label="Other subjects">
                      {subjectGroups.other.map((x) => <option key={x} value={x}>{x}</option>)}
                    </optgroup>
                  )}
                </>
              ) : (
                subjectOptions.map((x) => <option key={x} value={x}>{x}</option>)
              )}
            </select>
          </div>
        </div>
      </div>
    </>
  );

  if (error) return <div>{header}<div className="form-error">{error}</div></div>;
  if (!subject) return <div>{header}<div className="hint-text">Pick a subject to compare the campuses.</div></div>;
  if (loading) return <div>{header}<div className="hint-text">Comparing both campuses…</div></div>;
  if (!data) return <div>{header}</div>;

  const branches = data.branches || [];
  const taught = data.grades.filter((g) =>
    branches.some((b) => (g.branches[b]?.sessions_done || 0) > 0));

  return (
    <div>
      {header}
      <div className="hint-text compare-note">
        {data.discipline ? `${data.discipline} · ` : ""}
        Sessions covered out of the year&rsquo;s plan, per campus. The plan is the same for both;
        the number of sections is not.
      </div>

      {taught.length === 0 && (
        <div className="hint-text">
          Nothing has been recorded on either campus for {subject} yet, so there is nothing to
          compare. The grades and their plans are listed below.
        </div>
      )}

      <div className="card upload-preview-table">
        <table className="compare-table">
          <thead>
            <tr>
              <th rowSpan={2}>Grade</th>
              <th rowSpan={2}>Plan</th>
              {branches.map((b) => <th key={b} colSpan={3}>{b}</th>)}
              <th rowSpan={2}>Gap</th>
            </tr>
            <tr>
              {branches.map((b) => (
                <Fragmentish key={b}>
                  <th>Sections</th>
                  <th>Chapters</th>
                  <th>Sessions</th>
                </Fragmentish>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.grades.map((g) => {
              const idle = branches.every((b) => (g.branches[b]?.sessions_done || 0) === 0);
              return (
                <tr key={g.grade} className={idle ? "compare-idle" : ""}>
                  <th className="compare-grade">Grade {g.grade}</th>
                  <td className="hint-text">{g.chapters} ch · {g.sessions} sess</td>
                  {branches.map((b) => {
                    const v = g.branches[b] || {};
                    return (
                      <Fragmentish key={b}>
                        <td className="compare-sections">
                          {(v.sections || []).length
                            ? (v.sections || []).map((x) => `${g.grade}${x}`).join(" ")
                            : <span className="overview-empty">—</span>}
                        </td>
                        <td>{v.chapters_done || 0}<span className="hint-text">/{g.chapters}</span></td>
                        <td>
                          <div className="compare-bar">
                            <div className="compare-bar-fill" style={{ width: `${v.pct || 0}%` }} />
                          </div>
                          <span className="compare-figure">
                            {v.sessions_done || 0}<span className="hint-text">/{g.sessions} · {v.pct || 0}%</span>
                          </span>
                        </td>
                      </Fragmentish>
                    );
                  })}
                  <td className={`compare-gap ${g.gap_pct > 0 ? "gap-k" : g.gap_pct < 0 ? "gap-a" : ""}`}>
                    {g.gap_pct === 0 ? "—" : `${g.gap_pct > 0 ? "+" : ""}${g.gap_pct}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="hint-text compare-legend">
        Gap is Kodathi minus Attibele, as a share of the year&rsquo;s sessions. A positive number
        means Kodathi is further along.
      </div>
    </div>
  );
}

// A fragment that can carry a key, for the paired columns above.
function Fragmentish({ children }) {
  return <>{children}</>;
}
