import { Fragment, useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { api } from "../api";

// Straight from the palette in index.css (--green / --warn / --red): a chart
// drawn in near-miss colours reads as a different design.
const DONE = "#5A9E47";
const LEFT = "#E5A11E";
const BEHIND = "#B8272C";

// One doughnut, drawn from a done/left pair. Clicking anywhere on it opens the
// chapter breakdown below — the chart is the control, as asked.
function Donut({ title, done, left, total, unit, behind, onClick, active }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "doughnut",
      data: {
        labels: ["Done", "Left"],
        datasets: [{
          data: [done, left],
          backgroundColor: [DONE, behind ? BEHIND : LEFT],
          borderWidth: 0,
        }],
      },
      options: {
        cutout: "62%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${ctx.parsed} of ${total} ${unit}`,
            },
          },
        },
      },
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [done, left, total, unit, behind]);

  const pctDone = total ? Math.round((done * 100) / total) : 0;

  return (
    <div className={`annual-donut${active ? " annual-donut-active" : ""}`} onClick={onClick} title="Click for the chapter breakdown">
      <div className="annual-donut-title">{title}</div>
      <div className="annual-donut-canvas">
        <canvas ref={canvasRef} />
        <div className="annual-donut-centre">
          <strong>{pctDone}%</strong>
          <span>done</span>
        </div>
      </div>
      <div className="annual-donut-figures">
        <span><strong>{done}</strong> done</span>
        <span className={behind ? "annual-behind-text" : ""}><strong>{left}</strong> left</span>
        <span className="hint-text">of {total} {unit}</span>
      </div>
    </div>
  );
}

// Cumulative sessions planned against covered, month by month. Same totals as
// the donuts above it — both come from /api/progress/annual's engine, so the
// end of the planned line is the donut's total and the end of the covered line
// is the donut's "done".
function YearLine({ chart }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !chart?.labels?.length) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: chart.labels,
        datasets: [
          {
            label: "Planned (cumulative)", data: chart.planned,
            borderColor: DONE, backgroundColor: "rgba(90,158,71,.10)",
            borderWidth: 2, pointRadius: 3, tension: 0.3, fill: true,
          },
          {
            label: "Covered (cumulative)", data: chart.actual,
            borderColor: LEFT, backgroundColor: "rgba(229,161,30,.10)",
            borderWidth: 2, pointRadius: 3, tension: 0.3, fill: true,
            // The covered line stops at the current month rather than dropping
            // to zero across months not yet taught.
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "top", labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "Sessions (cumulative)" } },
          x: { title: { display: true, text: "Month" } },
        },
      },
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [chart]);

  if (!chart?.labels?.length) return null;
  return (
    <div className="card annual-year-line">
      <div className="annual-table-head">
        The year so far — {chart.current_actual} of {chart.total_planned} sessions covered.
      </div>
      <div style={{ padding: 14 }}>
        <canvas ref={canvasRef} height="90" />
      </div>
    </div>
  );
}

/**
 * The whole year as one bar, in sessions and nothing else - the picture for
 * someone who wants the shape of the year rather than a chapter list. The
 * marker sits where the plan says the class should be by the end of last
 * month, so "covered" reads against it at a glance.
 */
function YearBar({ t }) {
  if (!t.sessions) return null;
  const pct = (n) => Math.max(0, Math.min(100, (n * 100) / t.sessions));
  const covered = pct(t.sessions_done);
  const dueMark = pct(t.sessions_due);
  return (
    <div className="card annual-yearbar">
      <div className="annual-table-head">
        The year in sessions — {t.sessions_done} of {t.sessions} covered
        <span className="hint-text"> · {Math.round(covered)}% of the year</span>
      </div>
      <div className="annual-bar-track" role="img"
           aria-label={`${t.sessions_done} of ${t.sessions} sessions covered`}>
        <div className={`annual-bar-fill${t.behind ? " annual-bar-behind" : ""}`}
             style={{ width: `${covered}%` }} />
        {t.sessions_due > 0 && (
          <div className="annual-bar-mark" style={{ left: `${dueMark}%` }} />
        )}
      </div>
      {t.sessions_due > 0 && (
        <div className="annual-bar-caption">
          The marker is the {t.sessions_due} sessions planned up to the end of{" "}
          {t.prev_month || "last month"}.
        </div>
      )}
      <div className="annual-bar-legend">
        <span><strong>{t.sessions_done}</strong> covered</span>
        <span><strong>{t.sessions_left}</strong> still to teach</span>
        <span>{t.sessions} planned for the year</span>
      </div>
    </div>
  );
}

function Ticks({ sections, done }) {
  return (
    <>
      {sections.map((s) => (
        <td key={s} className="annual-tick-cell">
          {done.includes(s) ? <span className="annual-tick">✓</span> : <span className="annual-untick">—</span>}
        </td>
      ))}
    </>
  );
}

export default function AnnualProgress({ token, subject, grade, discipline, branch = "", onDisciplineChange }) {
  const [data, setData] = useState(null);
  const [chart, setChart] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showTable, setShowTable] = useState(true);
  const [openChapters, setOpenChapters] = useState({});
  const [openTopics, setOpenTopics] = useState({});

  useEffect(() => {
    if (!subject || !grade) { setData(null); return; }
    setLoading(true);
    setError("");
    api.getAnnualProgress(token, subject, grade, discipline, branch)
      .then((res) => {
        setData(res);
        if (onDisciplineChange && res.discipline_default && !discipline) {
          onDisciplineChange(res.discipline_default);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    api.getProgressChart(token, subject, grade, discipline, branch)
      .then(setChart)
      .catch(() => setChart(null));   // the chart is a bonus, not the page
  }, [token, subject, grade, discipline, branch]);

  if (!subject || !grade) {
    return <div className="hint-text">Pick a subject and grade to see the year at a glance.</div>;
  }
  if (loading) return <div className="hint-text">Loading the year…</div>;
  if (error) return <div className="form-error">{error}</div>;
  if (!data) return null;

  const t = data.totals;
  const sections = data.sections;
  // Column headings come from the API: "6A"/"6B" per section, or a single
  // "Whole class" when no section has written implementation yet but the class
  // has covered ground an SME marked or a POW records.
  const labelFor = (section) => {
    const i = sections.indexOf(section);
    return (data.section_labels || [])[i] || `${grade}${section}`;
  };

  return (
    <div>
      {/* Measured against the plan up to the end of last month, never against
          the whole year: half the year outstanding in September is not a fault
          when the other half is not due until March. */}
      {t.behind ? (
        <div className="annual-alert">
          <strong>Behind schedule.</strong> {t.behind_reason} planned up to the end of{" "}
          {t.prev_month || "last month"} are still to cover.
        </div>
      ) : t.sessions_due > 0 ? (
        <div className="annual-ontrack">
          <strong>On track.</strong> Everything planned up to the end of {t.prev_month || "last month"}{" "}
          is covered — {t.sessions_done_to_date} of {t.sessions_due} sessions.
        </div>
      ) : null}

      {t.chapters_done === 0 && data.chapters.length > 0 && (
        <div className="hint-text">
          Nothing has been recorded as covered yet for {subject} Grade {grade} — the plan below is the
          year as uploaded.
        </div>
      )}

      <div className="annual-donuts">
        <Donut
          title="Chapters"
          done={t.chapters_done}
          left={t.chapters_left}
          total={t.chapters}
          unit="chapters"
          behind={t.chapters_pct_left > 50 && t.behind}
          active={showTable}
          onClick={() => setShowTable(!showTable)}
        />
        <Donut
          title="Sessions"
          done={t.sessions_done}
          left={t.sessions_left}
          total={t.sessions}
          unit="sessions"
          behind={t.sessions_pct_left > 50 && t.behind}
          active={showTable}
          onClick={() => setShowTable(!showTable)}
        />
        {/* The question leadership actually asks: are we where the plan says
            we should be BY NOW. The two dials beside it are the year. */}
        {t.sessions_due > 0 && (
          <Donut
            title={`Due by end of ${t.prev_month || "last month"}`}
            done={t.sessions_done_to_date}
            left={t.sessions_owed}
            total={t.sessions_due}
            unit="sessions due"
            behind={t.behind}
            active={showTable}
            onClick={() => setShowTable(!showTable)}
          />
        )}
      </div>

      {sections.length > 1 && (
        <div className="annual-section-note hint-text">
          Chapters averaged across {sections.length} sections:{" "}
          {data.per_section.map((p) => `${labelFor(p.section)} ${p.chapters_done}/${t.chapters}`).join(" · ")}.
          {" "}Sessions are recorded once for the class on each POW, so that figure is not split by section.
        </div>
      )}

      <YearBar t={t} />
      <YearLine chart={chart} />

      <div className="annual-toggle">
        <button className="btn btn-ghost btn-sm" onClick={() => setShowTable(!showTable)}>
          {showTable ? "Hide the curriculum list" : "Show the curriculum list"}
        </button>
      </div>

      {showTable && (
        <div className="card upload-preview-table annual-table">
          <div className="annual-table-head">
            The year's plan for {data.discipline || subject} Grade {grade} — {data.chapters.length}{" "}
            {data.chapters.length === 1 ? "chapter" : "chapters"}, {t.sessions} sessions.
            Click a chapter for its topics, a topic for its sub-topics.
          </div>
          <table>
            <thead>
              <tr>
                <th>Chapter / Topic / Sub Topic</th>
                <th>Months</th>
                <th>Sessions</th>
                {sections.map((s) => <th key={s} className="annual-tick-cell">{labelFor(s)}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.chapters.map((c) => (
                <Fragment key={c.chapter}>
                  <tr
                    className="annual-chapter-row"
                    onClick={() => setOpenChapters((p) => ({ ...p, [c.chapter]: !p[c.chapter] }))}
                  >
                    <td>
                      <span className="annual-caret">{openChapters[c.chapter] ? "▾" : "▸"}</span>
                      <strong>{c.chapter}</strong>
                      {c.discipline && <span className="badge badge-created annual-disc">{c.discipline}</span>}
                      {/* The sheet states different session counts for this
                          chapter in different months, so the larger one is
                          used. Flagged rather than silently picked. */}
                      {c.session_conflict && (
                        <span
                          className="annual-conflict"
                          title={`The mapping states different session counts for this chapter: ${
                            Object.entries(c.stated_sessions || {}).map(([m, v]) => `${m} ${v}`).join(", ")
                          }. The largest is used.`}
                        >
                          !
                        </span>
                      )}
                    </td>
                    <td className="hint-text">{(c.months || []).join(", ")}</td>
                    <td>
                      {c.sessions_done ? `${c.sessions_done} / ${c.sessions}` : c.sessions}
                    </td>
                    <Ticks sections={sections} done={c.done_sections} />
                  </tr>

                  {openChapters[c.chapter] && c.topics.map((tp) => {
                    const key = `${c.chapter}|${tp.topic}`;
                    return (
                      <Fragment key={key}>
                        <tr
                          className="annual-topic-row"
                          onClick={() => setOpenTopics((p) => ({ ...p, [key]: !p[key] }))}
                        >
                          <td className="annual-indent-1">
                            {tp.subtopic_rows.length > 0 && (
                              <span className="annual-caret">{openTopics[key] ? "▾" : "▸"}</span>
                            )}
                            {tp.topic || <em className="hint-text">(no topic named)</em>}
                          </td>
                          <td />
                          <td />
                          <Ticks sections={sections} done={tp.done_sections} />
                        </tr>

                        {openTopics[key] && tp.subtopic_rows.map((st) => (
                          <tr key={st.subtopic} className="annual-sub-row">
                            <td className="annual-indent-2">{st.subtopic}</td>
                            <td />
                            <td />
                            <Ticks sections={sections} done={st.done_sections} />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
              {data.chapters.length === 0 && (
                <tr>
                  <td colSpan={3 + sections.length} className="empty-msg">
                    No curriculum has been uploaded for {subject} Grade {grade}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
