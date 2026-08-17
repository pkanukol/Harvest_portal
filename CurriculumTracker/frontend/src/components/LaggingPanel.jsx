import { useEffect, useState } from "react";
import { api } from "../api";
import { fmtDate } from "../dateUtils";

/**
 * Curriculum-lag overview on the dashboard, for SMEs/HODs and leadership.
 *
 * "Behind" means the planner schedules more sessions up to and including this
 * month than the teacher's POWs have reached. Scoped to whoever the viewer
 * already oversees: an SME sees their mapped teachers, leadership the school.
 */
export default function LaggingPanel({ token, onOpenTeacher }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showMissing, setShowMissing] = useState(false);

  useEffect(() => {
    api.getLagging(token).then(setData).catch((err) => setError(err.message));
  }, [token]);

  if (error) return <div className="form-error">{error}</div>;
  if (!data) return <div className="loading-spinner">Checking curriculum progress…</div>;

  const behind = data.rows.filter((r) => r.status === "behind");
  const visible = showAll ? data.rows : behind;

  return (
    <div className="lag-panel">
      <div className="lag-header">
        <div className="section-title lag-title">
          📉 Curriculum lag — {data.generated_month}
        </div>
        <div className="lag-actions">
          {data.rows.length > behind.length && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Only lagging" : `Show all ${data.rows.length}`}
            </button>
          )}
        </div>
      </div>

      {!data.directory_available && (
        <div className="upload-note lag-coverage">
          Class assignments couldn't be read from staff_roles, so this covers only classes that already have a
          POW — a teacher who has submitted nothing for a class they teach won't appear here.
        </div>
      )}

      {data.rows.length === 0 ? (
        <div className="empty-msg">
          Nothing to compare yet — a lag shows up once curriculum sheets are uploaded and teachers submit POWs.
        </div>
      ) : behind.length === 0 && !showAll ? (
        <div className="lag-clear">✅ Every teacher is on track or ahead this month.</div>
      ) : (
        <div className="card upload-preview-table">
          <table>
            <thead>
              <tr>
                <th>Teacher</th><th>Subject</th><th>Grade</th>
                <th>Behind by</th><th>Progress</th><th>Last POW</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={`${r.teacher_email}-${r.subject}-${r.grade}`}
                  className={r.status === "behind" ? "lag-row-behind" : ""}
                  onClick={() => onOpenTeacher && onOpenTeacher(r)}
                >
                  <td>{r.teacher_name}</td>
                  <td>{r.subject}</td>
                  <td>{r.grade}</td>
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
                    {r.no_pow_yet ? <span className="lag-stale">nothing submitted</span> : r.last_week ? (
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
                  • {t.teacher_name}{t.subject ? ` · ${t.subject}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
