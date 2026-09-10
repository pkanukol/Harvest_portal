import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { fmtDate } from "../dateUtils";

/**
 * Curriculum-lag overview on the dashboard, for SMEs/HODs and leadership.
 *
 * One row per CLASS - subject, grade, campus - with the teachers assigned to it
 * named alongside. The curriculum belongs to the class, not to whoever happens
 * to file the POW, so a grade that is eight sessions behind says so once rather
 * than once per teacher.
 *
 * "Behind" means the planner schedules more sessions up to and including this
 * month than any POW for that class has reached. Scoped to whoever the viewer
 * already oversees: an SME sees their mapped teachers, leadership the school.
 */
export default function LaggingPanel({ token, branch = "", onOpenTeacher }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  // Narrowing 109 classes down to the one being discussed. No campus filter
  // here on purpose - the header's campus selector already scopes the fetch,
  // and a second one in the panel could only disagree with it.
  const [subjectFilter, setSubjectFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  // Starts collapsed on every page load, whatever it was left as. This report
  // is the heaviest read in the app — it compares every teacher's POWs against
  // the whole planner — and an expanded panel used to fire it during the
  // initial mount, which was most of the dashboard's load time. One click
  // fetches it. The remembered preference still decides whether the panel is
  const [open, setOpen] = useState(false);

  function toggleOpen() {
    setOpen((prev) => !prev);
  }

  // Only fetched when expanded — this report compares every teacher's POWs
  // against the whole planner, so a collapsed panel shouldn't pay for it.
  // Refetched when the campus filter changes, so the panel and the dashboard
  // below it always describe the same set of teachers.
  useEffect(() => { setData(null); }, [branch]);

  // A subject that vanished with the campus shouldn't stay selected and hide
  // every row.
  useEffect(() => { setSubjectFilter(""); setGradeFilter(""); }, [branch]);

  useEffect(() => {
    if (!open || data) return;
    api.getLagging(token, branch).then(setData).catch((err) => setError(err.message));
  }, [token, open, data, branch]);

  // Declared before any early return - hooks can't be called conditionally.
  const subjects = useMemo(
    () => [...new Set((data?.rows || []).map((r) => r.subject))].sort(),
    [data],
  );
  const grades = useMemo(
    () => [...new Set((data?.rows || []).map((r) => String(r.grade)))]
      .sort((a, b) => Number(a) - Number(b)),
    [data],
  );

  if (error) return <div className="form-error">{error}</div>;

  if (!open) {
    return (
      <div className="lag-panel">
        <div className="lag-header">
          <button className="lag-toggle" onClick={toggleOpen} aria-expanded={false}>
            <span className="lag-caret">▸</span>
            <span className="section-title lag-title">📉 Curriculum lag</span>
            <span className="lag-summary">show</span>
          </button>
        </div>
      </div>
    );
  }

  if (!data) return <div className="loading-spinner">Checking curriculum progress…</div>;

  const behind = data.rows.filter((r) => r.status === "behind");
  // Every subject+grade is expected to carry at least one POW, so a class with
  // none is counted separately - it is a different problem from running late.
  const noPow = data.rows.filter((r) => r.no_pow_yet);
  const matches = (r) =>
    (!subjectFilter || r.subject === subjectFilter)
    && (!gradeFilter || String(r.grade) === gradeFilter);
  const visible = (showAll ? data.rows : behind).filter(matches);
  const filtered = Boolean(subjectFilter || gradeFilter);

  return (
    <div className="lag-panel">
      <div className="lag-header">
        <button className="lag-toggle" onClick={toggleOpen} aria-expanded={open}>
          <span className={`lag-caret ${open ? "lag-caret-open" : ""}`}>▸</span>
          <span className="section-title lag-title">
            📉 Curriculum lag — {data.generated_month}
          </span>
          {/* Collapsed, the headline number still has to be visible — the point
              of the panel is noticing a lag without opening anything. */}
          <span className="lag-summary">
            {behind.length === 0
              ? "all on track"
              : `${behind.length} ${behind.length === 1 ? "class" : "classes"} behind`
                + (noPow.length ? ` · ${noPow.length} with no POW` : "")}
          </span>
        </button>
        {open && (
          <div className="lag-actions">
            {filtered && (
              <button className="btn btn-ghost btn-sm"
                      onClick={() => { setSubjectFilter(""); setGradeFilter(""); }}>
                Clear filter
              </button>
            )}
            {data.rows.length > behind.length && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Only lagging" : `Show all ${data.rows.length}`}
              </button>
            )}
          </div>
        )}
      </div>

      {open && (
      <>

      {!data.directory_available && (
        <div className="upload-note lag-coverage">
          Class assignments couldn't be read from staff_roles, so this covers only classes that already
          have a POW, and the teacher column will be thin — a class nobody has filed for won't appear here
          at all.
        </div>
      )}

      {data.rows.length === 0 ? (
        <div className="empty-msg">
          Nothing to compare yet — a lag shows up once curriculum sheets are uploaded and teachers submit POWs.
        </div>
      ) : visible.length === 0 ? (
        <div className="lag-clear">
          {filtered
            ? "No class matches that filter."
            : "✅ Every class is on track or ahead this month."}
        </div>
      ) : (
        <div className="card upload-preview-table">
          <table>
            <thead>
              {/* The two filters ARE the column headings - a subject column
                  that filters by subject needs no separate label, and no row of
                  its own above the table. Options come from the rows
                  themselves, so a choice can never return nothing. */}
              <tr>
                <th>
                  <select className="lag-th-filter" value={subjectFilter}
                          onChange={(e) => setSubjectFilter(e.target.value)}>
                    <option value="">Subject — all</option>
                    {subjects.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </th>
                <th>
                  <select className="lag-th-filter" value={gradeFilter}
                          onChange={(e) => setGradeFilter(e.target.value)}>
                    <option value="">Grade — all</option>
                    {grades.map((x) => <option key={x} value={x}>Grade {x}</option>)}
                  </select>
                </th>
                <th>Teachers</th>
                <th>Behind by</th><th>Progress</th><th>Last POW</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={`${r.subject}-${r.grade}-${r.branch}`}
                  className={r.status === "behind" ? "lag-row-behind" : ""}
                  onClick={() => onOpenTeacher && onOpenTeacher(r)}
                >
                  <td>
                    {r.subject}
                    {/* No campus column - the header picks the campus. But when
                        it is on ALL campuses, Kodathi's Grade 6 Kannada and
                        Attibele's are two different classes with two different
                        lags, and without this they render as identical rows. */}
                    {!branch && r.branch && <div className="lag-branch-tag">{r.branch}</div>}
                  </td>
                  <td>{r.grade}</td>
                  {/* Who to speak to. Everyone staff_roles assigns to the class,
                      plus anyone who has actually filed a POW for it. */}
                  <td className={(r.teachers || []).length ? "lag-teachers" : "hint-text"}>
                    {(r.teachers || []).length ? r.teachers.join(", ") : "nobody assigned"}
                  </td>
                  <td>
                    {r.sessions_behind > 0 ? (
                      <span className={`badge ${r.no_pow_yet ? "badge-nopow" : "badge-pending"}`}>
                        {r.sessions_behind} session{r.sessions_behind === 1 ? "" : "s"}
                        {r.no_pow_yet ? " · no POW yet" : ""}
                      </span>
                    ) : (
                      <span className="badge badge-approved">{r.status === "ahead" ? "ahead" : "on track"}</span>
                    )}
                  </td>
                  <td>
                    <div className="lag-progress">
                      <div className="progress-bar-track">
                        <div
                          className="progress-bar-fill"
                          style={{
                            width: `${Math.min(100, r.percent_done)}%`,
                            background: r.status === "behind" ? "var(--warn)" : "var(--green)",
                          }}
                        />
                      </div>
                      <span className="lag-progress-text">
                        {r.done_sessions}/{r.expected_sessions} sessions
                      </span>
                    </div>
                  </td>
                  <td className="lag-last">
                    {r.no_pow_yet ? <span className="lag-stale">no POW yet</span> : r.last_week ? (
                      <>
                        {fmtDate(r.last_week)}
                        {r.weeks_since_last_pow > 1 && (
                          <span className="lag-stale"> · {r.weeks_since_last_pow} wks ago</span>
                        )}
                        <div className="lag-topic">{r.last_topic || "—"}</div>
                      </>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.teachers_without_pows.length > 0 && (
        <div className="lag-missing">
          <button className="btn btn-ghost btn-sm" onClick={() => setShowMissing(!showMissing)}>
            {data.teachers_without_pows.length} teacher{data.teachers_without_pows.length === 1 ? " has" : "s have"} submitted no POW at all
            {showMissing ? " ▲" : " ▼"}
          </button>
          {showMissing && (
            <div className="lag-missing-list">
              {data.teachers_without_pows.map((t) => (
                <div key={t.teacher_email} className="pow-card-meta">
                  • {t.teacher_name}{t.subject ? ` · ${t.subject}` : ""}{t.branch ? ` · ${t.branch}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
