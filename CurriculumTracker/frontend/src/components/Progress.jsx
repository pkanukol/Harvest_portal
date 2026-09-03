import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { api } from "../api";
import { fmtDate } from "../dateUtils";
import BackfillPanel from "./BackfillPanel";
import { Donut } from "./AnnualProgress";
import AnnualProgress from "./AnnualProgress";
import { GRADES } from "../grades";

export default function Progress({ token, user, isReadOnlyViewer, isLeadership = false, branch = "", onBack }) {
  const [teachersList, setTeachersList] = useState([]);
  // Distinguishes "still loading" from "genuinely none" — the dropdown used to
  // read "No subjects available" during the fetch, which looks like a failure,
  // and a real failure was swallowed silently by an empty catch.
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [subjectsError, setSubjectsError] = useState("");
  // Same curriculum/other split as the dashboard and the upload picker.
  const [subjectGroups, setSubjectGroups] = useState({ curriculum: [], other: [] });
  // Which chapters have their POW detail expanded.
  const [openChapters, setOpenChapters] = useState({});
  // Science splits into Biology/Chemistry/Physics from Grade 5 up, and each has
  // its own SME — so progress is read one discipline at a time.
  const [discipline, setDiscipline] = useState("");
  // Leadership reads the year; an SME works a month at a time. Both views stay
  // reachable from either role - this only decides which one opens first.
  const [range, setRange] = useState(isLeadership ? "annual" : "month");

  function toggleChapter(name) {
    setOpenChapters((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  // Self-sufficient — fetches its own subject options rather than relying on
  // the Dashboard having been visited first (mirrors Dashboard.jsx's own
  // /api/teachers call for its Subject filter).
  useEffect(() => {
    if (!isReadOnlyViewer) return;
    setSubjectsLoading(true);
    setSubjectsError("");
    api.getTeachers(token, branch)
      .then((res) => {
        setTeachersList(res.teachers || []);
        if (res.subjects) setSubjectGroups(res.subjects);
      })
      .catch((err) => setSubjectsError(err.message))
      .finally(() => setSubjectsLoading(false));
  }, [token, isReadOnlyViewer, branch]);

  const subjects = useMemo(() => {
    if (!isReadOnlyViewer) return [user.subject];
    const grouped = [...(subjectGroups.curriculum || []), ...(subjectGroups.other || [])];
    if (grouped.length) return grouped;
    const seen = new Set();
    const list = [];
    teachersList.forEach((t) => {
      if (t.subject && !seen.has(t.subject)) { seen.add(t.subject); list.push(t.subject); }
    });
    return list;
  }, [isReadOnlyViewer, teachersList, user.subject, subjectGroups]);

  const [subject, setSubject] = useState(isReadOnlyViewer ? "" : user.subject);
  const [grade, setGrade] = useState("");
  // "" means the month now running. Any earlier month of this academic year
  // can be asked for - August read back in September, which is the whole
  // point of a month view once the month has ended.
  const [month, setMonth] = useState("");
  const [summary, setSummary] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [error, setError] = useState("");
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (isReadOnlyViewer && !subject && subjects.length > 0) setSubject(subjects[0]);
  }, [isReadOnlyViewer, subject, subjects]);

  useEffect(() => {
    if (!subject || !grade || range !== "month") { setChartData(null); setSummary(null); return; }
    setError("");

    api.getProgressSummary(token, subject, grade, isReadOnlyViewer ? "" : user.email, discipline, branch, month)
      .then((res) => {
        setSummary(res);
        // Name the month in the picker rather than leaving it on a vague
        // "This month" - it reads as a filter that has not been set.
        if (!month && res.month) setMonth(res.month);
      })
      .catch((err) => setError(err.message));

    // The month tab gets the month's own week-by-week pace; the cumulative
    // year-to-date chart belongs to the Full year tab and is drawn there.
    api.getMonthChart(token, subject, grade, discipline, branch, month)
      .then(setChartData)
      .catch((err) => setError(err.message));
  }, [token, subject, grade, isReadOnlyViewer, user.email, discipline, range, branch, month]);

  useEffect(() => {
    if (!chartData || !chartData.labels?.length || !canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels: chartData.labels,
        datasets: [
          { label: `Planned pace (${chartData.month || "month"})`, data: chartData.planned, borderColor: "#5A9E47", backgroundColor: "rgba(90,158,71,.10)", borderWidth: 2, pointRadius: 4, tension: 0.3, fill: true },
          { label: "Sessions covered", data: chartData.actual, borderColor: "#E5A11E", backgroundColor: "rgba(229,161,30,.08)", borderWidth: 2, pointRadius: 4, tension: 0.3, fill: true },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "top" }, tooltip: { mode: "index", intersect: false } },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "Sessions this month" } },
          x: { title: { display: true, text: "Week beginning" } },
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

      <div className="range-tabs">
        <button
          className={`range-tab${range === "annual" ? " range-tab-active" : ""}`}
          onClick={() => setRange("annual")}
        >
          Full year
        </button>
        <button
          className={`range-tab${range === "month" ? " range-tab-active" : ""}`}
          onClick={() => setRange("month")}
        >
          This month
        </button>
      </div>

      <div className="filter-bar">
      <div className={`form-row${range === "month" ? " form-row-3" : ""}`}>
        <div className="form-group">
          <label className="form-label">Subject</label>
          {isReadOnlyViewer ? (
            <select className="form-control" value={subject} onChange={(e) => setSubject(e.target.value)}>
              {subjects.length === 0 && (
                <option value="">
                  {subjectsLoading ? "Loading subjects…" : subjectsError ? "Couldn't load subjects" : "No subjects available"}
                </option>
              )}
              {(subjectGroups.curriculum || []).length > 0 ? (
                <>
                  <optgroup label="Curriculum subjects">
                    {subjectGroups.curriculum.map((s) => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
                  {(subjectGroups.other || []).length > 0 && (
                    <optgroup label="Other staff subjects">
                      {subjectGroups.other.map((s) => <option key={s} value={s}>{s}</option>)}
                    </optgroup>
                  )}
                </>
              ) : (
                subjects.map((s) => <option key={s} value={s}>{s}</option>)
              )}
            </select>
          ) : (
            <input className="form-control readonly-field" value={subject} readOnly />
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Grade</label>
          <select className="form-control" value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">Select a grade…</option>
            {GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}
          </select>
        </div>
        {/* Only on the month tab: the year tab is the whole year by definition.
            The list comes back with the summary, so no extra request. */}
        {range === "month" && (
          <div className="form-group">
            <label className="form-label">Month</label>
            <select className="form-control" value={month} onChange={(e) => setMonth(e.target.value)}>
              {!month && <option value="">Loading…</option>}
              {(summary?.months_available || []).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      </div>


      {range === "annual" && (
        <AnnualProgress
          token={token}
          subject={subject}
          grade={grade}
          discipline={discipline}
          branch={branch}
          onDisciplineChange={setDiscipline}
        />
      )}

      {/* Coverage marking is open to HODs too, who have no upload rights. */}
      {range === "month" && (user.can_mark_coverage ?? user.can_upload_curriculum) && (
        <BackfillPanel
          token={token}
          subject={subject}
          grade={grade}
          branch={branch}
          teachers={teachersList.filter((t) => (t.subject || "").toLowerCase() === (subject || "").toLowerCase())}
        />
      )}


      {error && <div className="form-error">{error}</div>}

      {summary && (
        <>
          <div className="section-title">{summary.month} — Grade {summary.grade} Progress</div>
          {/* One line rather than a tile per number: the chapter table below
              carries the same planned/done/left figures per chapter, so a tile
              grid above it just said everything twice. What is kept here is the
              month total and the pacing, neither of which the table shows. */}
          <div className="progress-headline">
            <span>
              <strong>{summary.topics_covered}</strong> of <strong>{summary.topics_planned}</strong>{" "}
              {summary.topics_planned === 1 ? "chapter" : "chapters"} covered
            </span>
            <span>
              <strong>{summary.sessions_done}</strong> of <strong>{summary.total_sessions_planned}</strong>{" "}
              sessions done, <strong>{summary.sessions_left}</strong> left
            </span>
            <span className="hint-text">
              {summary.sessions_left > 0
                ? `${summary.sess_per_week_needed}/week to finish in the ${summary.days_left} days remaining`
                : `${summary.days_left} days remaining in the month`}
            </span>
          </div>

          {(summary.disciplines || []).length > 1 && (
            <div className="form-group discipline-filter">
              <label className="form-label">Discipline</label>
              <select className="form-control" value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
                <option value="">All disciplines</option>
                {summary.disciplines.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}

          <div className="card upload-preview-table">
            <table>
              <thead>
                <tr>
                  <th>Chapter</th>
                  {(summary.disciplines || []).length > 1 && <th>Discipline</th>}
                  <th>Sessions</th><th>Done</th><th>Left</th><th>Progress</th><th>Status</th><th>Counted from</th><th />
                </tr>
              </thead>
              <tbody>
                {summary.chapter_rows.map((c) => (
                  <Fragment key={c.chapter}>
                    <tr>
                      <td>{c.chapter}</td>
                      {(summary.disciplines || []).length > 1 && <td>{c.discipline || "—"}</td>}
                      <td>{c.sessions_planned}</td>
                      <td>{c.sessions_done}</td>
                      <td>{c.sessions_left}</td>
                      <td>
                        <div className="progress-bar-track">
                          <div
                            className="progress-bar-fill"
                            style={{ width: `${c.pct}%`, background: c.status === "done" ? "var(--green)" : "var(--warn)" }}
                          />
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${c.status === "done" ? "badge-approved" : c.status === "in_progress" ? "badge-pending" : "badge-created"}`}>
                          {c.status === "in_progress" ? "in progress" : c.status}
                        </span>
                      </td>
                      <td className="hint-text">{c.counted_from || "—"}</td>
                      <td>
                        {c.entries.length > 0 && (
                          <button className="btn btn-ghost btn-sm" onClick={() => toggleChapter(c.chapter)}>
                            {openChapters[c.chapter] ? "Hide" : `${c.entries.length} POW${c.entries.length === 1 ? "" : "s"}`}
                          </button>
                        )}
                      </td>
                    </tr>
                    {openChapters[c.chapter] && c.entries.map((e) => (
                      <tr key={e.pow_id}>
                        <td colSpan={(summary.disciplines || []).length > 1 ? 9 : 8} className="grade-detail-cell">
                          <div className="pow-detail-head">
                            Week of {e.week_start ? fmtDate(e.week_start) : "—"} · sessions {e.sessions_marked || "—"}
                            {" "}({e.sessions_completed} done) · {e.status}
                            {e.subtopic ? ` · ${e.subtopic}` : ""}
                          </div>
                          {e.sections.length === 0 ? (
                            <div className="hint-text">No section implementation filled in yet.</div>
                          ) : (
                            e.sections.map((sec) => (
                              <div className="impl-detail" key={sec.section}>
                                <strong>Section {sec.section}</strong>
                                {sec.completed_on ? ` · completed ${fmtDate(sec.completed_on)}` : " · no completion date"}
                                {sec.remark ? <div className="impl-detail-remark">{sec.remark}</div> : null}
                              </div>
                            ))
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {summary.chapter_rows.length === 0 && (
                  <tr><td colSpan={9} className="empty-msg">No chapters planned for {summary.month} here.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {summary.extra_topics?.length > 0 && (
            <div className="hint-text" style={{ marginTop: 12 }}>
              Extra topics covered (not in this month's plan): {summary.extra_topics.join(", ")}
            </div>
          )}
        </>
      )}

      {/* The Full year tab answers "how far through the plan to date"; this is
          the same question asked of the month now running, so it is drawn the
          same way rather than left to the line chart alone. */}
      {range === "month" && chartData && (
        <div className="annual-donuts annual-donuts-single" style={{ marginTop: 24 }}>
          <Donut
            title={`${chartData.month} so far`}
            done={chartData.done_total}
            left={Math.max(0, chartData.planned_total - chartData.done_total)}
            total={chartData.planned_total}
            unit={`sessions planned for ${chartData.month}`}
            behind={chartData.verdict === "Behind plan"}
            empty={!chartData.planned_total}
            active
          />
        </div>
      )}

      {range === "month" && chartData && chartData.labels?.length > 0 && (
        <div className="chart-card" style={{ marginTop: 24 }}>
          <span className={`verdict-badge ${verdictClass}`}>{chartData.verdict}</span>
          <div className="section-title" style={{ marginTop: 0 }}>
            {chartData.month} — pace through the month
          </div>
          <canvas ref={canvasRef} height="100" />
          <p className="hint-text" style={{ marginTop: 8 }}>
            {chartData.done_total} of {chartData.planned_total} sessions covered.{" "}
            {chartData.note}
          </p>
        </div>
      )}
    </div>
  );
}
