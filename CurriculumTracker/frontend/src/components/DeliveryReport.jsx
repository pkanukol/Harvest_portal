import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { BRANCHES } from "../grades";

/**
 * The management report: grade × subject delivery for one campus.
 *
 * Each cell says how far ahead or behind the plan a class is — measured
 * against the sessions the mapping expects to have been covered BY NOW, not
 * against the whole year, which would read hopelessly low every September.
 *
 * A grade's figure is the average of its sections; clicking the grade opens
 * those sections so a single class that has fallen behind is not hidden inside
 * a healthy-looking average.
 *
 * Subjects taught as separate streams (Science, Social Science) get a column
 * per stream, grouped under the subject. Mathematics has strands too, but one
 * teacher teaches all of them, so it stays a single column.
 */
export default function DeliveryReport({ token, initialBranch = "", embed = false }) {
  const [branch, setBranch] = useState(initialBranch || BRANCHES[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState({});

  useEffect(() => {
    setLoading(true);
    setError("");
    api.deliveryReport(token, branch)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, branch]);

  const header = (
    <>
      <div className="section-title">
        Curriculum delivery — {branch}
        {data?.month ? <span className="hint-text"> · as at {data.month}</span> : null}
      </div>
      {/* Shown even when embedded: the campus is what the report is ABOUT,
          not app chrome, and a reader looking at Kodathi needs to flip to
          Attibele without going back to the portal. The URL's branch= just
          sets where it opens. */}
      {(
        <div className="filter-bar">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Campus</label>
              <select className="form-control" value={branch} onChange={(e) => setBranch(e.target.value)}>
                {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (error) return <div>{header}<div className="form-error">{error}</div></div>;
  if (loading) return <div>{header}<div className="hint-text">Building the report…</div></div>;
  if (!data) return <div>{header}</div>;

  // Columns grouped by subject, so Science can span its streams.
  const groups = [];
  data.columns.forEach((c) => {
    const last = groups[groups.length - 1];
    if (last && last.subject === c.subject) last.columns.push(c);
    else groups.push({ subject: c.subject, columns: [c] });
  });

  return (
    <div className="report-page">
      {header}

      <div className="report-scroll">
        <table className="report-table">
          <thead>
            <tr>
              <th className="report-rowhead" rowSpan={2}>Grade</th>
              {groups.map((g) => (
                <th key={g.subject} colSpan={g.columns.length} className="report-subject">
                  {g.subject}
                </th>
              ))}
            </tr>
            <tr>
              {data.columns.map((c) => (
                <th key={c.key} className="report-stream">
                  {c.discipline || <span className="report-stream-same">{c.subject}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.grades.map((g) => {
              const isOpen = !!open[g.grade];
              return (
                <Fragment key={g.grade}>
                  <tr
                    className="report-grade-row"
                    onClick={() => setOpen((p) => ({ ...p, [g.grade]: !p[g.grade] }))}
                  >
                    <th className="report-rowhead report-grade">
                      <span className="annual-caret">{isOpen ? "▾" : "▸"}</span>
                      Grade {g.grade}
                    </th>
                    {data.columns.map((c) => <Cell key={c.key} cell={g.cells[c.key]} />)}
                  </tr>

                  {isOpen && g.sections.map((sec) => (
                    <tr key={`${g.grade}-${sec.section}`} className="report-section-row">
                      <th className="report-rowhead report-section">Section {sec.section}</th>
                      {data.columns.map((c) => <Cell key={c.key} cell={sec.cells[c.key]} />)}
                    </tr>
                  ))}

                  {isOpen && g.sections.length === 0 && (
                    <tr className="report-section-row">
                      <th className="report-rowhead report-section">—</th>
                      <td colSpan={data.columns.length} className="hint-text">
                        No sections are recorded for this grade on {branch}.
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="hint-text report-legend">
        Ahead of or behind the sessions planned up to {data.month}. A blank cell means nothing is
        planned for that subject and grade yet. Click a grade to see its sections.
      </p>
    </div>
  );
}

function Cell({ cell }) {
  if (!cell || cell.variance === null || cell.variance === undefined) {
    return <td className="report-cell report-blank" />;
  }
  const v = cell.variance;
  const onTarget = Math.abs(v) <= 2;
  const title = cell.expected !== undefined
    ? `${cell.done ?? "—"} of ${cell.expected} sessions expected by now`
    : "";
  return (
    <td
      className={`report-cell ${onTarget ? "report-ok" : v > 0 ? "report-ahead" : "report-behind"}`}
      title={title}
    >
      {onTarget ? "On target" : `${v > 0 ? "+" : ""}${v}%`}
    </td>
  );
}
