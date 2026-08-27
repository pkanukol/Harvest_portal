import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { fmtDate } from "../dateUtils";
import { GRADES } from "../grades";

// The pop-out window has no stylesheet, so the table takes its styling with
// it. Kept deliberately small and self-contained: only what this one table
// needs, in the same colours as the app, and set up to print.
const TABLE_WINDOW_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  /* The page itself stays white; the table carries the app's light blue, so
     the report reads as a block on the page rather than filling it. */
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1E293B;
         background: #fff; padding: 16px 18px; }
  h1 { font-size: 15px; color: #2A7BAD; margin-bottom: 2px; }
  p.sub { font-size: 11px; color: #5B6472; margin-bottom: 12px; }
  .overview-scroll { border: 1px solid #E2E5EC; border-radius: 8px; overflow: hidden;
                     background: #F5F6FA; }

  /* Every column visible at once, no sideways scrolling: a fixed layout shares
     the window's width equally between the columns, so 19 of them fit as
     readily as 13. Content that does not fit is clamped, and one click on a
     cell opens it. */
  table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 11px; }
  th, td { border-bottom: 1px solid #ECEEF3; border-right: 1px solid #ECEEF3;
           padding: 5px 6px; text-align: left; vertical-align: top; }
  /* A shade deeper than the table so the header band still separates from it. */
  th { background: #E4EBF3; font-weight: 700; color: #2A7BAD; font-size: 10px;
       line-height: 1.25; word-break: break-word; }
  th, td { border-color: #E2E5EC; }
  /* The week and its teacher need more room than the rest; the remaining
     columns divide what is left. */
  th:first-child, td:first-child { width: 118px; }

  .cellbox { max-height: 3.9em; overflow: hidden; line-height: 1.3;
             white-space: pre-wrap; word-break: break-word; cursor: pointer; }
  .cellbox.open { max-height: none; }
  /* Only cells that are actually cut off advertise it. */
  .cellbox.clipped { position: relative; }
  .cellbox.clipped::after { content: "…"; position: absolute; right: 0; bottom: 0;
                            background: #F5F6FA; padding-left: 3px; color: #2A7BAD; font-weight: 700; }
  .cellbox.open.clipped::after { content: ""; }
  td:hover .cellbox.clipped { color: #0F172A; }

  .overview-week { font-weight: 600; }
  .overview-empty { color: #93A0B4; }
  .overview-impl-text { color: #5B6472; margin-top: 2px; }
  .hint-text { color: #5B6472; font-size: 10px; }
  .overview-more { display: none; }

  @media print {
    body { padding: 0; }
    .overview-scroll { border: 0; background: #fff; }
    th { background: #E4EBF3 !important; }
    /* Nothing hidden on paper. */
    .cellbox { max-height: none; }
    .cellbox.clipped::after { content: ""; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

// Runs inside the pop-out window. Wrapping each cell's contents in one box is
// what makes clamping possible at all - a table cell ignores max-height, a div
// inside it does not. The box is marked `clipped` only when its content really
// is taller than the clamp, so the "…" and the pointer appear on the cells that
// have something more to show.
const TABLE_WINDOW_SCRIPT = `
  document.querySelectorAll("td").forEach(function (td) {
    var box = document.createElement("div");
    box.className = "cellbox";
    while (td.firstChild) box.appendChild(td.firstChild);
    td.appendChild(box);
    if (box.scrollHeight > box.clientHeight + 1) box.classList.add("clipped");
    td.addEventListener("click", function () { box.classList.toggle("open"); });
  });
`;


// Long free-text cells (Class Work, Activity, Instructions...) would otherwise
// stretch a row taller than the screen. They clamp, and clicking one opens it.
function Cell({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return <td className="overview-cell overview-empty">—</td>;
  const long = text.length > 90;
  return (
    <td className="overview-cell" onClick={() => long && setOpen(!open)} title={long && !open ? "Click to expand" : ""}>
      <div className={long && !open ? "overview-clamp" : "overview-full"}>{text}</div>
      {long && <span className="overview-more">{open ? "less" : "more"}</span>}
    </td>
  );
}

// One line per session ("S8: ...", "S9: ..."), so a week's several sessions
// read in one cell without needing a column each. POWs filed before sessions
// existed fall back to the single week-level box they carry.
// A section's dates for this row, one line per session ("S8 · 03 Sep"). A
// section this row does not cover gets an empty cell - the other row for the
// same week carries it.
function implDates(row, section, field) {
  const rec = (row.section_impl || {})[section];
  if (!(row.sections || []).includes(section) || !rec) {
    return <span className="overview-empty">—</span>;
  }
  const lines = (rec.entries || []).filter((e) => e[field]);
  if (lines.length === 0) return <span className="overview-empty">—</span>;
  return lines.map((e) => (
    <div key={`${e.session_no}-${field}`}>
      {(row.sessions || []).length > 1 && <span className="hint-text">S{e.session_no} </span>}
      {fmtDate(e[field])}
    </div>
  ));
}

function sessionLines(row, field) {
  const sessions = row.sessions || [];
  if (sessions.length === 0) return row[field] || "";
  return sessions
    .map((s) => {
      const text = (s[field] || "").trim();
      if (!text) return "";
      return `S${s.session_no || "?"}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

export default function CurriculumOverview({ token, user, branch = "", onBack }) {
  const [teachersList, setTeachersList] = useState([]);
  const [subjectGroups, setSubjectGroups] = useState({ curriculum: [], other: [] });
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [downloading, setDownloading] = useState(false);
  // The rendered table, so the pop-out window can carry the real markup rather
  // than rebuilding it from the data a second time.
  const tableRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getTeachers(token, branch)
      .then((res) => {
        setTeachersList(res.teachers || []);
        if (res.subjects) setSubjectGroups(res.subjects);
      })
      .catch((err) => setError(err.message));
  }, [token, branch]);

  const subjectOptions = useMemo(() => {
    const grouped = [...(subjectGroups.curriculum || []), ...(subjectGroups.other || [])];
    if (grouped.length) return grouped;
    const seen = new Set();
    return teachersList.filter((t) => t.subject && !seen.has(t.subject) && seen.add(t.subject)).map((t) => t.subject);
  }, [teachersList, subjectGroups]);

  useEffect(() => {
    if (!subject && subjectOptions.length) setSubject(subjectOptions[0]);
  }, [subject, subjectOptions]);

  // 15 columns for a two-section grade, 19 for six — wider than any browser
  // table reads comfortably, so the same rows go out as a workbook.
  async function downloadExcel() {
    setDownloading(true);
    setError("");
    try {
      const { blob, filename } = await api.downloadCurriculumOverview(token, subject, grade, branch);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  // Just the table in its own window — no dashboard, no filters, nothing but
  // the report, so all 15-19 columns get the full width of the screen and
  // Ctrl+P prints the table alone. The markup is copied from what is already
  // on screen, with the handful of styles it needs inlined, because the new
  // window loads no stylesheet of its own.
  function openInNewWindow() {
    if (!tableRef.current) return;
    const win = window.open("", "_blank", "width=1500,height=850");
    if (!win) {
      setError("Your browser blocked the pop-up. Allow pop-ups for this site and try again.");
      return;
    }
    const title = `Curriculum Overview — ${subject} Grade ${grade}`;
    win.document.write(
      "<!doctype html><html><head><meta charset='utf-8'><title>" + title + "</title><style>" +
      TABLE_WINDOW_CSS +
      "</style></head><body><h1>" + title + "</h1>" +
      "<p class='sub'>" + data.rows.length + " POW" + (data.rows.length === 1 ? "" : "s") +
      " · click any cell to read it in full · Ctrl+P prints the table complete</p>" +
      tableRef.current.outerHTML +
      "<script>" + TABLE_WINDOW_SCRIPT + "<\/script>" +
      "</body></html>",
    );
    win.document.close();
  }

  // Nothing loads until both filters are set — the same rule the dashboard
  // follows, so an SME never waits on a whole-subject query they didn't ask for.
  useEffect(() => {
    if (!subject || !grade) { setData(null); return; }
    setLoading(true);
    setError("");
    api.getCurriculumOverview(token, subject, grade, branch)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, subject, grade, branch]);

  const sections = data?.sections || [];

  return (
    <div>
      <button className="back-link" onClick={onBack}>← Back</button>
      <div className="section-title">Curriculum Overview</div>
      <p className="hint-text">
        Every POW filed for the subject and grade below, week by week. Implementation shows one
        column per section that has been filled in.
      </p>

      <div className="filter-bar">
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Subject</label>
          <select className="form-control" value={subject} onChange={(e) => { setSubject(e.target.value); setData(null); }}>
            {subjectOptions.length === 0 && <option value="">No subjects available</option>}
            {(subjectGroups.curriculum || []).length > 0 ? (
              <>
                <optgroup label="Curriculum subjects">
                  {subjectGroups.curriculum.map((s) => <option key={s} value={s}>{s}</option>)}
                </optgroup>
                {(subjectGroups.other || []).length > 0 && (
                  <optgroup label="Other subjects">
                    {subjectGroups.other.map((s) => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
                )}
              </>
            ) : (
              subjectOptions.map((s) => <option key={s} value={s}>{s}</option>)
            )}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Grade</label>
          <select className="form-control" value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">Select a grade…</option>
            {GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}
          </select>
        </div>
      </div>
      </div>

      {subject && grade && (
        <div className="overview-actions">
          <button className="btn btn-primary btn-sm" onClick={downloadExcel} disabled={downloading}>
            {downloading ? "Preparing…" : "⬇ Download Excel"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={openInNewWindow}>⤢ Open the table in a new window</button>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}
      {loading && <div className="hint-text">Loading POWs…</div>}

      {!loading && data && data.rows.length === 0 && (
        <div className="empty-msg">No POWs have been filed for {subject} Grade {grade} yet.</div>
      )}

      {!loading && data && data.rows.length > 0 && (
        <div className="overview-scroll" ref={tableRef}>
          <table className="overview-table">
            <thead>
              <tr>
                <th>Week with Dates</th>
                <th>Sections</th>
                <th>LP Sessions Number</th>
                <th>Topic / Sub Topic</th>
                <th>Class work / Binder / Textbook</th>
                <th>Activity</th>
                <th>Home work</th>
                <th>Lesson plan</th>
                <th>Learning outcomes</th>
                <th>CCQ / Class test</th>
                {/* The topic is stated once for the row - every section on the
                    row is doing the same thing - so only the dates are per
                    section, and only for the sections this row covers. */}
                {sections.map((s) => (
                  <th key={s}>Implementation Date - {data.grade} {s}</th>
                ))}
                {sections.map((s) => (
                  <th key={`corr-${s}`}>Correction Done - {data.grade} {s}</th>
                ))}
                <th>Events / Holidays</th>
                <th>TBS MOM</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr
                  key={`${r.id}-${r.row_index}`}
                  /* Several rows can belong to one POW - one per plan. Banded
                     together so the repeated dates read as the same week. */
                  className={r.row_index > 0 ? "overview-row-cont" : ""}
                >
                  <td className="overview-week">
                    {fmtDate(r.week_start)} – {fmtDate(r.week_end)}
                    <div className="hint-text">{r.teacher_name}{r.branch ? ` · ${r.branch}` : ""}</div>
                  </td>
                  <td className="overview-sections">
                    {(r.sections || []).map((x) => `${data.grade}${x}`).join(", ") || "—"}
                  </td>
                  <td>{r.lp_session_num || "—"}</td>
                  <Cell text={[r.topic, r.subtopic].filter(Boolean).join(" — ")} />
                  {/* Already prefixed per session by the API. */}
                  <Cell text={r.classwork} />
                  <Cell text={r.activity} />
                  <Cell text={r.homework} />
                  <Cell text={sessionLines(r, "lp_link")} />
                  <Cell text={sessionLines(r, "learning_outcomes")} />
                  <Cell text={r.cct} />
                  {sections.map((s) => (
                    <td key={s} className="overview-cell">{implDates(r, s, "completed_on")}</td>
                  ))}
                  {sections.map((s) => (
                    <td key={`corr-${s}`} className="overview-cell">{implDates(r, s, "correction_on")}</td>
                  ))}
                  <Cell text={r.instructions} />
                  <Cell text={r.tbs_mom} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
