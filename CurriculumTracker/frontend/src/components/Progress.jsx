import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { api } from "../api";

export default function Progress({ token, user, isReadOnlyViewer, mappedTeachers, onBack }) {
  const subjects = useMemo(() => {
    if (!isReadOnlyViewer) return [user.subject];
    const seen = new Set();
    const list = [];
    (mappedTeachers || []).forEach((t) => {
      if (t.subject && !seen.has(t.subject)) { seen.add(t.subject); list.push(t.subject); }
    });
    return list;
  }, [isReadOnlyViewer, mappedTeachers, user.subject]);

  const [subject, setSubject] = useState(subjects[0] || "");
  const [grade, setGrade] = useState("");
  const [summary, setSummary] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [error, setError] = useState("");
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!subject || !grade) { setChartData(null); setSummary(null); return; }
    setError("");

    api.getProgressSummary(token, subject, grade, isReadOnlyViewer ? "" : user.email)
      .then(setSummary)
      .catch((err) => setError(err.message));

    api.getProgressChart(token, subject, grade)
      .then(setChartData)
      .catch((err) => setError(err.message));
  }, [token, subject, grade, isReadOnlyViewer, user.email]);

  useEffect(() => {
    if (!chartData || !chartData.labels?.length || !canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels: chartData.labels,
        datasets: [
          { label: "Planned (cumulative)", data: chartData.planned, borderColor: "#2e7d52", backgroundColor: "rgba(46,125,82,.1)", borderWidth: 2, pointRadius: 4, tension: 0.3, fill: true },
          { label: "Actual (cumulative)", data: chartData.actual, borderColor: "#f0a500", backgroundColor: "rgba(240,165,0,.08)", borderWidth: 2, pointRadius: 4, tension: 0.3, fill: true },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "top" }, tooltip: { mode: "index", intersect: false } },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "Cumulative Sessions" } },
          x: { title: { display: true, text: "Week" } },
        },
      },
    });
    return () => chartRef.current?.destroy();
  }, [chartData]);

  const verdictClass = chartData?.verdict?.includes("Ahead") ? "verdict-ahead" : chartData?.verdict?.includes("Behind") ? "verdict-behind" : "verdict-ontrack";

  return (
    <div>
      <button className="back-link" onClick={onBack}>← Back</button>
      <div className="section-title">Progress Check</div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Subject</label>
          {isReadOnlyViewer ? (
            <select className="form-control" value={subject} onChange={(e) => setSubject(e.target.value)}>
              {subjects.length === 0 && <option value="">No subjects available</option>}
              {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input className="form-control readonly-field" value={subject} readOnly />
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Grade</label>
          <input className="form-control" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="e.g. 6" />
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {summary && (
        <>
          <div className="section-title">{summary.month} — Grade {summary.grade} Progress</div>
          <div className="stat-grid">
            {[
              ["Chapters Planned", summary.topics_planned],
              ["Chapters Covered", summary.topics_covered],
              ["Sessions Planned", summary.total_sessions_planned],
              ["Sessions Done", summary.sessions_done],
              ["Sessions Left", summary.sessions_left],
              ["Sessions/Week Needed", summary.sess_per_week_needed],
              ["Days Left", summary.days_left],
            ].map(([label, value]) => (
              <div className="stat-tile" key={label}>
                <div className="stat-label">{label}</div>
                <div className="stat-value">{value}</div>
              </div>
            ))}
          </div>

          <table>
            <thead>
              <tr><th>Chapter</th><th>Topic/Sub Topic</th><th>Sessions / Chapter</th><th>Done</th><th>Left</th><th>Progress</th><th>Status</th></tr>
            </thead>
            <tbody>
              {summary.topic_rows.map((t, i) => (
                <tr key={i}>
                  <td>{t.topic}</td>
                  <td>{t.subtopic || "—"}</td>
                  <td>{t.sessions_planned}</td>
                  <td>{t.sessions_done}</td>
                  <td>{t.sessions_left}</td>
                  <td>
                    <div className="progress-bar-track"><div className="progress-bar-fill" style={{ width: `${t.pct}%` }} /></div>
                  </td>
                  <td>{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {summary.extra_topics?.length > 0 && (
            <div className="hint-text" style={{ marginTop: 12 }}>
              Extra topics covered (not in this month's plan): {summary.extra_topics.join(", ")}
            </div>
          )}
        </>
      )}

      {chartData && chartData.labels?.length > 0 && (
        <div className="chart-card" style={{ marginTop: 24 }}>
          <span className={`verdict-badge ${verdictClass}`}>{chartData.verdict}</span>
          <canvas ref={canvasRef} height="100" />

          <table style={{ marginTop: 16 }}>
            <thead>
              <tr><th>Week</th><th>Topic</th><th>Actual Month</th><th>Planned Month</th><th>Session</th><th>Status</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {chartData.analysis.map((a, i) => (
                <tr key={i}>
                  <td>{a.week}</td>
                  <td>{a.topic}</td>
                  <td>{a.pow_month}</td>
                  <td>{a.planner_month}</td>
                  <td>{a.lp_session} / {a.planner_sessions}</td>
                  <td>{a.status}</td>
                  <td>{a.status_detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
