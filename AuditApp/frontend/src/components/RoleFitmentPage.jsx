import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  ROLE_FITMENT_PERIODS, OBSERVER_LABEL, defaultPeriodDate,
  currentAcademicYearStart, joinedThisYear,
} from "../constants/roleFitment";
import { formatDateStr } from "../utils/helpers";

const findEval = (report, period, observer) =>
  (report?.evaluations || []).find((e) => e.period === period && e.observer_type === observer);

function latestRemarkText(ev) {
  const list = (ev?.remarks || []).slice().sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
  return list.length ? (list[list.length - 1].remark_text || "") : "";
}

function ayStartFromReport(report) {
  if (report?.academic_year) {
    const m = /(\d{4})/.exec(report.academic_year);
    if (m) return parseInt(m[1], 10);
  }
  return currentAcademicYearStart(report?.created_at ? new Date(report.created_at) : new Date());
}

function avgOf(scoresObj) {
  const vals = Object.values(scoresObj).map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

// State keyed "period:observer" -> { date, scores{param:val}, remarkText }
function buildBlocks(report) {
  const ayStart = ayStartFromReport(report);
  const out = {};
  for (const p of ROLE_FITMENT_PERIODS) {
    for (const obs of p.observers) {
      const ev = findEval(report, p.key, obs);
      const scores = {};
      p.parameters.forEach((pm) => {
        const s = ev?.scores?.find((x) => x.parameter_key === pm.key);
        scores[pm.key] = s && s.score != null ? String(s.score) : "";
      });
      out[`${p.key}:${obs}`] = {
        date: ev?.evaluation_date || defaultPeriodDate(p.key, ayStart),
        scores, remarkText: latestRemarkText(ev),
      };
    }
  }
  return out;
}

function overallAverage(blocks) {
  const avgs = [];
  Object.values(blocks).forEach((b) => { const a = avgOf(b.scores); if (a != null) avgs.push(a); });
  if (!avgs.length) return null;
  return Math.round((avgs.reduce((x, y) => x + y, 0) / avgs.length) * 100) / 100;
}

function printRoleFitment(report) {
  const esc = (s) => (s == null ? "" : String(s)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

  const meta = [
    ["Employee Name", report.employee_name], ["Employee ID", report.employee_code],
    ["Designation", report.designation], ["Department", report.department],
    ["Date of Joining", fmt(report.date_of_joining)], ["Branch", report.branch],
    ["Principal Name", report.principal_name], ["Academic Year", report.academic_year],
  ].map(([k, v]) => `<div class="mi"><span class="mk">${esc(k)}:</span><span class="mv">${esc(v) || "—"}</span></div>`).join("");

  const periodsHTML = ROLE_FITMENT_PERIODS.map((p) => {
    const blocks = p.observers.map((obs) => {
      const ev = findEval(report, p.key, obs);
      const rows = p.parameters.map((pm) => {
        const sc = ev?.scores?.find((s) => s.parameter_key === pm.key);
        return `<tr><td>${esc(pm.label)}</td><td class="score">${sc && sc.score != null ? `${sc.score} / 5` : "—"}</td></tr>`;
      }).join("");
      const avg = ev && ev.average_score != null ? `${ev.average_score} / 5` : "—";
      const remark = latestRemarkText(ev);
      return `<div class="oblock">
        <div class="ohead"><span>${esc(OBSERVER_LABEL[obs] || obs)}</span><span>${fmt(ev?.evaluation_date)} · Avg ${avg}</span></div>
        <table class="ptable"><tbody>${rows}</tbody></table>
        <div class="oremark"><strong>Remarks:</strong> ${remark ? esc(remark) : "<em>—</em>"}</div>
      </div>`;
    }).join("");
    return `<section class="period"><div class="phead">${esc(p.label)}</div>${blocks}</section>`;
  }).join("");

  const finalHTML = (report.final_remarks || []).length
    ? `<section class="period"><div class="phead">Final Recommendation for next Academic Year</div>`
      + report.final_remarks.map((fr) =>
          `<div class="oremark"><strong>${esc(fr.author_name)}${fr.author_designation ? ` (${esc(fr.author_designation)})` : ""}${fr.remark_date ? ` · ${fmt(fr.remark_date)}` : ""}:</strong> ${esc(fr.remark_text)}</div>`
        ).join("")
      + `</section>`
    : "";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Role Fitment Report — ${esc(report.employee_name)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;} body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#1a1a1a;padding:26px 34px;}
  .rh{display:flex;align-items:center;gap:16px;border-bottom:2.5px solid #4BA3D3;padding-bottom:12px;margin-bottom:16px;}
  .rh img{height:50px;} .sn{font-size:17px;font-weight:700;color:#4BA3D3;} .st{font-size:11px;color:#555;}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 22px;background:#EBF5FB;border:1px solid #CFE7F6;border-radius:6px;padding:11px 15px;margin-bottom:14px;}
  .mi{display:flex;gap:6px;} .mk{color:#555;min-width:108px;} .mv{font-weight:600;}
  .period{margin-bottom:14px;page-break-inside:avoid;}
  .phead{font-weight:700;font-size:13px;color:#2a6b8c;margin-bottom:6px;border-bottom:1px solid #CFE7F6;padding-bottom:3px;}
  .oblock{border:1px solid #CFE7F6;border-radius:6px;margin-bottom:8px;}
  .ohead{display:flex;justify-content:space-between;font-weight:700;font-size:11px;background:#f4f9fd;padding:5px 10px;color:#2a6b8c;}
  .ptable{width:100%;border-collapse:collapse;} .ptable td{padding:4px 10px;border-top:1px solid #eef3f8;font-size:11px;}
  .score{text-align:right;font-weight:700;color:#2a6b8c;width:70px;}
  .oremark{padding:5px 10px;font-size:11px;background:#fbfdff;border-top:1px solid #eef3f8;}
  .footer{margin-top:20px;font-size:10px;color:#999;text-align:center;}
  @media print{body{padding:14px 18px;}}
</style></head><body>
<div class="rh"><img src="/logo.png" alt="Harvest"/><div><div class="sn">Harvest International School</div><div class="st">Role Fitment Report · Probation Evaluation</div></div></div>
<div class="meta">${meta}</div>
${periodsHTML}
${finalHTML}
<div class="footer">Harvest International School — Confidential · Printed on ${new Date().toLocaleDateString("en-IN", { dateStyle: "long" })}</div>
</body></html>`;
  const win = window.open("", "_blank");
  win.document.write(html); win.document.close(); win.onload = () => win.print();
}

const CATEGORIES = [
  { key: "all", label: "All" }, { key: "teacher", label: "Teachers" },
  { key: "sme", label: "SME" }, { key: "others", label: "Others" },
];
const catOfRole = (role) => (role === "teacher" ? "teacher" : role === "sme" ? "sme" : "others");

function ScoreSelect({ value, onChange }) {
  return (
    <select className="input-text" style={{ width: "100%", padding: "4px 6px", fontSize: "13px" }}
      value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
    </select>
  );
}

export default function RoleFitmentPage({ token, user }) {
  const [mode, setMode] = useState("list");
  const [reports, setReports] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState("");
  const [coverage, setCoverage] = useState(null);
  const [expandedCat, setExpandedCat] = useState("");

  const [staff, setStaff] = useState([]);
  const [staffQuery, setStaffQuery] = useState("");
  const [category, setCategory] = useState("teacher");
  const [branchFilter, setBranchFilter] = useState("all");
  const [selectedStaffId, setSelectedStaffId] = useState("");

  const [report, setReport] = useState(null);
  const [header, setHeader] = useState({});
  const [blocks, setBlocks] = useState({});
  const [savingBlock, setSavingBlock] = useState("");
  const [savingHeader, setSavingHeader] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [finalDate, setFinalDate] = useState(new Date().toISOString().slice(0, 10));
  const [finalClose, setFinalClose] = useState(false);
  const [savingFinal, setSavingFinal] = useState(false);
  const [msg, setMsg] = useState("");

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const loadList = async () => {
    setListLoading(true); setError("");
    try {
      const [reps, cov] = await Promise.all([
        api.listRoleFitmentReports(token),
        api.getRoleFitmentCoverage(token).catch(() => null),
      ]);
      setReports(reps); setCoverage(cov);
    } catch (e) { setError(e.message); }
    finally { setListLoading(false); }
  };
  useEffect(() => { loadList(); /* eslint-disable-next-line */ }, []);

  const openNew = async () => {
    setError(""); setMode("new"); setSelectedStaffId(""); setStaffQuery("");
    if (staff.length === 0) {
      try { setStaff(await api.getRoleFitmentStaff(token)); } catch (e) { setError(e.message); }
    }
  };

  const branches = useMemo(() => [...new Set(staff.map((s) => s.branch).filter(Boolean))].sort(), [staff]);
  const filteredStaff = useMemo(() => {
    const q = staffQuery.trim().toLowerCase();
    return staff.filter((s) => {
      if (category !== "all" && catOfRole(s.role) !== category) return false;
      if (branchFilter !== "all" && (s.branch || "").toLowerCase() !== branchFilter.toLowerCase()) return false;
      if (q && !(s.name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [staff, category, branchFilter, staffQuery]);
  const selectedStaff = useMemo(() => staff.find((s) => String(s.user_id) === String(selectedStaffId)), [staff, selectedStaffId]);

  const openEditor = async (id) => {
    setError(""); setMsg("");
    try {
      const r = await api.getRoleFitmentReport(token, id);
      setReport(r);
      setHeader({
        principal_name: r.principal_name || "", date_of_joining: r.date_of_joining || "",
        academic_year: r.academic_year || "", status: r.status || "in_progress",
      });
      setBlocks(buildBlocks(r));
      setMode("editor");
    } catch (e) { setError(e.message); }
  };

  const createReport = async () => {
    if (!selectedStaff) { setError("Please select an employee."); return; }
    setError("");
    try {
      const r = await api.createRoleFitmentReport(token, {
        employee_user_id: selectedStaff.user_id, employee_name: selectedStaff.name,
        employee_code: selectedStaff.employee_code, designation: selectedStaff.designation,
        department: selectedStaff.department, branch: selectedStaff.branch,
        date_of_joining: selectedStaff.date_of_joining, principal_name: selectedStaff.principal_name,
      });
      openEditor(r.id);
    } catch (e) { setError(e.message); }
  };

  const saveHeader = async () => {
    setSavingHeader(true); setError("");
    try {
      const r = await api.updateRoleFitmentHeader(token, report.id, {
        principal_name: header.principal_name, date_of_joining: header.date_of_joining || null,
        academic_year: header.academic_year, status: header.status,
      });
      setReport(r); flash("Details saved.");
    } catch (e) { setError(e.message); }
    finally { setSavingHeader(false); }
  };

  const saveBlock = async (periodKey, observer) => {
    const key = `${periodKey}:${observer}`;
    const b = blocks[key];
    const p = ROLE_FITMENT_PERIODS.find((x) => x.key === periodKey);
    setSavingBlock(key); setError("");
    try {
      const r = await api.saveRoleFitmentBlock(token, report.id, {
        period: periodKey, observer_type: observer, evaluation_date: b.date || null,
        scores: p.parameters.map((pm) => ({
          parameter_key: pm.key, score: b.scores[pm.key] === "" ? null : parseInt(b.scores[pm.key], 10),
        })),
        remark_text: b.remarkText || "",
      });
      setReport(r); flash(`${OBSERVER_LABEL[observer]} — ${p.label.split(" ")[0]} month saved.`);
    } catch (e) { setError(e.message); }
    finally { setSavingBlock(""); }
  };

  const saveFinalRemark = async () => {
    if (!finalText.trim()) { setError("Enter a remark first."); return; }
    setSavingFinal(true); setError("");
    try {
      const r = await api.addRoleFitmentFinalRemark(token, report.id, {
        remark_text: finalText, remark_date: finalDate || null, close: finalClose,
      });
      setReport(r);
      setHeader((h) => ({ ...h, status: r.status }));
      setFinalText(""); setFinalClose(false);
      flash(finalClose ? "Final remark added · report closed." : "Final remark added.");
    } catch (e) { setError(e.message); }
    finally { setSavingFinal(false); }
  };

  const deleteReport = async () => {
    if (!report || !window.confirm(`Delete the Role Fitment report for ${report.employee_name}?`)) return;
    try { await api.deleteRoleFitmentReport(token, report.id); setReport(null); setMode("list"); loadList(); }
    catch (e) { setError(e.message); }
  };

  const setBlockField = (key, updater) => setBlocks((prev) => ({ ...prev, [key]: updater(prev[key]) }));
  const overall = overallAverage(blocks);

  // ---------- LIST + COVERAGE ----------
  if (mode === "list") {
    return (
      <div style={{ paddingTop: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
          <div>
            <h1 style={{ fontSize: "26px" }}>Role Fitment Reports</h1>
            <p style={{ color: "var(--text-gray)", fontSize: "14px", marginTop: "4px" }}>Probation evaluations · May–April year</p>
          </div>
          <button className="btn-submit-audit" onClick={openNew}>+ New Report</button>
        </div>

        {coverage && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "8px" }}>
              {[["teacher", "Teachers"], ["sme", "SME"], ["others", "Others"]].map(([key, label]) => (
                <div key={key} className="card" style={{ cursor: "pointer", textAlign: "center", padding: "16px", borderColor: expandedCat === key ? "var(--harvest-blue)" : undefined }}
                  onClick={() => setExpandedCat(expandedCat === key ? "" : key)}>
                  <div style={{ fontSize: "30px", fontWeight: 800, color: "var(--harvest-amber)" }}>{coverage[key].count}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>{label} — report not filled</div>
                  <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>{expandedCat === key ? "click to hide" : "click to list names"}</div>
                </div>
              ))}
            </div>
            {expandedCat && (
              <div className="card" style={{ marginBottom: "18px" }}>
                <div className="hc-lbl" style={{ marginBottom: "8px" }}>
                  {CATEGORIES.find((c) => c.key === expandedCat)?.label} without a report ({coverage[expandedCat].people.length}) · <span style={{ color: "var(--harvest-green)" }}>green = joined this year</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "6px", maxHeight: "300px", overflowY: "auto" }}>
                  {coverage[expandedCat].people.map((p) => (
                    <div key={p.user_id} style={{
                      fontSize: "13px", padding: "6px 9px", borderRadius: "6px",
                      background: p.joined_this_year ? "rgba(75,163,211,0.16)" : "rgba(255,255,255,0.03)",
                      border: p.joined_this_year ? "1px solid var(--harvest-green)" : "1px solid transparent",
                    }}>
                      {p.joined_this_year && <span title="Joined this year" style={{ marginRight: "4px" }}>🟢</span>}
                      {p.name}
                      <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>{p.subject ? ` — ${p.subject}` : (p.designation ? ` — ${p.designation}` : "")}</span>
                      {p.date_of_joining && <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>DOJ {p.date_of_joining}{p.branch ? ` · ${p.branch}` : ""}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {error && <div className="error-banner" style={{ marginBottom: "12px" }}>{error}</div>}
        {listLoading && <div className="msg"><span className="spinner" />Loading...</div>}
        <div className="drawer-section-label" style={{ marginTop: "8px" }}>Existing Reports</div>
        {!listLoading && reports.length === 0 && (
          <div className="card text-center" style={{ padding: "30px" }}>
            <p style={{ fontSize: "14px", color: "var(--text-gray)" }}>No reports yet — click "New Report".</p>
          </div>
        )}
        <div className="audit-grid">
          {reports.map((r) => (
            <div key={r.id} className="teacher-card" onClick={() => openEditor(r.id)}>
              <div className="card-left">
                <div className="tc-name">{r.employee_name}</div>
                <div className="tc-meta">
                  {r.designation && <span className="meta-tag subj">{r.designation}</span>}
                  {r.department && <span className="meta-tag obs">{r.department}</span>}
                  {r.branch && <span className="meta-tag obs">{r.branch}</span>}
                </div>
                <div className="tc-obs-meta"><span className="tc-obs-auditor">By {r.creator_name} · {formatDateStr(r.created_at)}</span></div>
              </div>
              <div className="tc-score-block">
                <div className="tc-score-val sc-prof">{r.periods_done}/4</div>
                <div className="tc-score-lbl">periods</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---------- NEW ----------
  if (mode === "new") {
    return (
      <div style={{ paddingTop: "24px", maxWidth: "640px" }}>
        <button className="btn btn-dashboard" onClick={() => setMode("list")} style={{ marginBottom: "16px" }}>← Back</button>
        <h2 style={{ marginBottom: "16px" }}>New Role Fitment Report</h2>
        {error && <div className="error-banner" style={{ marginBottom: "12px" }}>{error}</div>}
        <div className="card">
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
            {CATEGORIES.map((c) => (
              <button key={c.key} type="button" onClick={() => { setCategory(c.key); setSelectedStaffId(""); }}
                className={`form-type-btn${category === c.key ? " active" : ""}`} style={{ padding: "6px 14px", fontSize: "13px" }}>{c.label}</button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "10px" }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="field-label">Branch</label>
              <select className="input-text" value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setSelectedStaffId(""); }}>
                <option value="all">All branches</option>
                {branches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="field-label">Search</label>
              <input className="input-text" placeholder="Type a name..." value={staffQuery} onChange={(e) => setStaffQuery(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="field-label">Employee <span style={{ color: "var(--harvest-red)" }}>*</span> <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({filteredStaff.length}, newest joiners first · 🟢 joined this year)</span></label>
            <select className="input-text" value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)} size={8} style={{ height: "auto" }}>
              {filteredStaff.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {s.joined_this_year ? "🟢 " : ""}{s.name}{s.department ? ` · ${s.department}` : ""}{s.date_of_joining ? ` · DOJ ${s.date_of_joining}` : ""}
                </option>
              ))}
            </select>
          </div>
          {selectedStaff && (
            <div style={{ background: "rgba(75,163,211,0.06)", borderRadius: "8px", padding: "12px 14px", fontSize: "13px", lineHeight: 1.9 }}>
              <div><strong>Employee ID:</strong> {selectedStaff.employee_code || "—"} · <strong>Designation:</strong> {selectedStaff.designation || "—"}</div>
              <div><strong>Department:</strong> {selectedStaff.department || "—"} · <strong>Branch:</strong> {selectedStaff.branch || "—"}</div>
              <div><strong>Date of Joining:</strong> {selectedStaff.date_of_joining || "— (fill in report)"}{selectedStaff.joined_this_year ? " · 🟢 joined this year" : ""}</div>
              <div><strong>Principal:</strong> {selectedStaff.principal_name || "—"}</div>
            </div>
          )}
          <button className="btn-submit-audit" style={{ width: "100%", marginTop: "16px" }} disabled={!selectedStaff} onClick={createReport}>Create Report</button>
        </div>
      </div>
    );
  }

  // ---------- EDITOR ----------
  if (!report) return null;
  return (
    <div style={{ paddingTop: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <button className="btn btn-dashboard" onClick={() => { setMode("list"); loadList(); }}>← All Reports</button>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" className="btn-print" onClick={() => printRoleFitment(report)} title="Print / Save as PDF">&#128438; Print / PDF</button>
          <button type="button" onClick={deleteReport}
            style={{ background: "transparent", color: "var(--harvest-red)", border: "1px solid var(--harvest-red)", borderRadius: "8px", padding: "7px 14px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>🗑 Delete</button>
        </div>
      </div>

      {/* Title + overall average */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "10px", marginBottom: "14px" }}>
        <div>
          <h1 style={{ fontSize: "23px" }}>{report.employee_name}</h1>
          <p style={{ color: "var(--text-gray)", fontSize: "12px" }}>
            {report.employee_code || "—"} · {report.designation || "—"} · {report.department || "—"} · {report.branch || "—"}
          </p>
        </div>
        <div style={{ textAlign: "center", background: "rgba(75,163,211,0.1)", border: "1px solid rgba(75,163,211,0.3)", borderRadius: "10px", padding: "8px 18px" }}>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--harvest-blue)" }}>{overall == null ? "—" : `${overall} / 5`}</div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>Overall Average</div>
        </div>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: "12px" }}>{error}</div>}
      {msg && <div style={{ position: "sticky", top: "8px", zIndex: 5, marginBottom: "12px", padding: "8px 14px", borderRadius: "8px", background: "rgba(75,163,211,0.12)", border: "1px solid rgba(75,163,211,0.35)", color: "var(--harvest-green)", fontSize: "13px" }}>{msg}</div>}

      {/* Sleeker header */}
      <div className="card" style={{ marginBottom: "18px", padding: "14px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr) auto", gap: "12px", alignItems: "end" }}>
          <div className="form-group" style={{ margin: 0 }}><label className="field-label">Date of Joining</label>
            <input type="date" className="input-text" value={header.date_of_joining || ""} onChange={(e) => setHeader((h) => ({ ...h, date_of_joining: e.target.value }))} /></div>
          <div className="form-group" style={{ margin: 0 }}><label className="field-label">Academic Year</label>
            <input className="input-text" placeholder="2026-27" value={header.academic_year || ""} onChange={(e) => setHeader((h) => ({ ...h, academic_year: e.target.value }))} /></div>
          <div className="form-group" style={{ margin: 0 }}><label className="field-label">Principal</label>
            <input className="input-text" value={header.principal_name || ""} onChange={(e) => setHeader((h) => ({ ...h, principal_name: e.target.value }))} /></div>
          <div className="form-group" style={{ margin: 0 }}><label className="field-label">Status</label>
            <select className="input-text" value={header.status} onChange={(e) => setHeader((h) => ({ ...h, status: e.target.value }))}>
              <option value="in_progress">In Progress</option><option value="completed">Completed</option>
            </select></div>
          <button className="btn-save-draft-lg" style={{ padding: "9px 16px" }} disabled={savingHeader} onClick={saveHeader}>
            {savingHeader ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Periods -> observer blocks */}
      {ROLE_FITMENT_PERIODS.map((p) => (
        <div key={p.key} style={{ marginBottom: "20px" }}>
          <h3 style={{ color: "var(--harvest-blue)", fontSize: "16px", marginBottom: "10px" }}>{p.label}</h3>
          {p.observers.map((obs) => {
            const key = `${p.key}:${obs}`;
            const b = blocks[key];
            const live = avgOf(b.scores);
            const busy = savingBlock === key;
            return (
              <div className="card" key={key} style={{ marginBottom: "12px", padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-white)" }}>{OBSERVER_LABEL[obs]}</span>
                    <input type="date" className="input-text" style={{ padding: "4px 8px", fontSize: "12px", width: "148px" }}
                      value={b.date || ""} onChange={(e) => setBlockField(key, (s) => ({ ...s, date: e.target.value }))} />
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--harvest-blue)" }}>Avg: {live == null ? "—" : `${live} / 5`}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "10px" }}>
                  {p.parameters.map((pm) => (
                    <div key={pm.key} style={{ background: "rgba(75,163,211,0.04)", borderRadius: "8px", padding: "8px 10px" }}>
                      <div style={{ fontSize: "12.5px", fontWeight: 600, marginBottom: "2px" }}>{pm.label}</div>
                      <div style={{ fontSize: "10.5px", color: "var(--text-muted)", marginBottom: "6px", minHeight: "26px" }}>{pm.hints.join(" · ")}</div>
                      <ScoreSelect value={b.scores[pm.key]} onChange={(v) => setBlockField(key, (s) => ({ ...s, scores: { ...s.scores, [pm.key]: v } }))} />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "10px", alignItems: "stretch" }}>
                  <textarea className="input-text" style={{ flex: 1, minHeight: "52px", fontSize: "13px" }} placeholder={`${OBSERVER_LABEL[obs]}'s remarks & recommendations...`}
                    value={b.remarkText} onChange={(e) => setBlockField(key, (s) => ({ ...s, remarkText: e.target.value }))} />
                  <button className="btn-submit-audit" style={{ padding: "8px 18px", fontSize: "13px", alignSelf: "stretch" }} disabled={busy} onClick={() => saveBlock(p.key, obs)}>
                    {busy ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* Final Recommendation — report-level append-only thread */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <div className="section-title-wrap" style={{ marginTop: 0 }}><h2 style={{ fontSize: "16px" }}>Final Recommendation for next Academic Year</h2></div>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "-6px", marginBottom: "12px" }}>
          Any observer / management / HR can add here. HR can close the report with their remark.
        </p>
        {(report.final_remarks || []).length === 0 ? (
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "12px" }}>No final remarks yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
            {report.final_remarks.map((fr) => (
              <div key={fr.id} style={{ background: "rgba(75,163,211,0.05)", borderRadius: "8px", padding: "8px 12px" }}>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "3px" }}>
                  {fr.author_name}{fr.author_designation ? ` (${fr.author_designation})` : ""}{fr.remark_date ? ` · ${fr.remark_date}` : ""}
                </div>
                <div style={{ fontSize: "13px", whiteSpace: "pre-wrap" }}>{fr.remark_text}</div>
              </div>
            ))}
          </div>
        )}
        <textarea className="input-text" style={{ minHeight: "68px", fontSize: "13px" }} placeholder="Add your final recommendation / remark..."
          value={finalText} onChange={(e) => setFinalText(e.target.value)} />
        <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap", marginTop: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Date</span>
            <input type="date" className="input-text" style={{ padding: "5px 8px", fontSize: "12px", width: "148px" }}
              value={finalDate} onChange={(e) => setFinalDate(e.target.value)} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", cursor: "pointer" }}>
            <input type="checkbox" checked={finalClose} onChange={(e) => setFinalClose(e.target.checked)} />
            Close report (mark completed)
          </label>
          <button className="btn-submit-audit" style={{ padding: "8px 18px", fontSize: "13px", marginLeft: "auto" }} disabled={savingFinal} onClick={saveFinalRemark}>
            {savingFinal ? "Saving..." : (finalClose ? "Add & Close" : "Add Remark")}
          </button>
        </div>
      </div>
    </div>
  );
}
