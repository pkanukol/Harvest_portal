import { useEffect, useState } from "react";
import { api } from "../api";
import { SPA_CRITERIA, SPA_MAX_SCORE } from "../constants/spaRubrics";
import { formatDateStr } from "../utils/helpers";

function findOption(critKey, score) {
  const crit = SPA_CRITERIA.find((c) => c.key === critKey);
  if (!crit) return null;
  return crit.options.find((o) => o.score === score) || null;
}

function escHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

function handleSpaPrint(obs) {
  const dateStr = obs.date_time ? new Date(obs.date_time).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" }) : "";
  const rowsHtml = SPA_CRITERIA.map((crit, idx) => {
    const entry = obs.criteria_scores[crit.key] || {};
    const opt = findOption(crit.key, entry.score);
    return `<tr>
      <td>${idx + 1}. ${escHtml(crit.label)}</td>
      <td style="text-align:center">${entry.score ?? "-"} ${opt ? `– ${escHtml(opt.label)}` : ""}</td>
      <td>${escHtml(entry.comment)}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>SPA Observation Report — ${escHtml(obs.teacher.name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1a1a1a; background: #fff; padding: 28px 36px; }
  .report-header { border-bottom: 2.5px solid #2d6a2d; padding-bottom: 16px; margin-bottom: 20px; }
  .school-name { font-size: 18px; font-weight: 700; color: #2d6a2d; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; background: #f6f8f6; border: 1px solid #d0e4d0; border-radius: 6px; padding: 12px 16px; margin-bottom: 18px; }
  .meta-item { display: flex; gap: 6px; }
  .meta-key { color: #555; min-width: 90px; }
  .meta-val { font-weight: 600; }
  .score-banner { background: #f6f8f6; border: 1px solid #d0e4d0; border-radius: 6px; padding: 12px 18px; margin-bottom: 20px; font-size: 20px; font-weight: 800; color: #2d6a2d; }
  section { margin-bottom: 20px; }
  h3 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #2d6a2d; border-bottom: 1px solid #cce0cc; padding-bottom: 4px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; border: 1px solid #cce0cc; }
  th { background: #f0f7f0; padding: 6px 10px; text-align: left; font-size: 11px; font-weight: 600; color: #555; border-bottom: 1px solid #cce0cc; }
  td { padding: 6px 10px; border-bottom: 1px solid #e8f0e8; font-size: 11px; }
  .box { background: #f6f8f6; border: 1px solid #cce0cc; border-radius: 4px; padding: 10px 14px; font-size: 12px; line-height: 1.6; white-space: pre-wrap; }
  .signoff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; }
  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 10px; color: #999; }
  @media print { body { padding: 16px 20px; } }
</style></head>
<body>
<div class="report-header"><div class="school-name">Harvest International School</div><div>SPA / Performing Arts Observation Report · Ref: ${escHtml(obs.unique_id)}</div></div>
<div class="meta-grid">
  <div class="meta-item"><span class="meta-key">Coach:</span><span class="meta-val">${escHtml(obs.teacher.name)}</span></div>
  <div class="meta-item"><span class="meta-key">Date:</span><span class="meta-val">${dateStr}</span></div>
  <div class="meta-item"><span class="meta-key">Activity:</span><span class="meta-val">${escHtml(obs.activity)}</span></div>
  <div class="meta-item"><span class="meta-key">Campus:</span><span class="meta-val">${escHtml(obs.school)}</span></div>
  <div class="meta-item"><span class="meta-key">Timing:</span><span class="meta-val">${escHtml(obs.timing)}</span></div>
  <div class="meta-item"><span class="meta-key">Grade & Section:</span><span class="meta-val">${escHtml(obs.grade_section)}</span></div>
  <div class="meta-item"><span class="meta-key">Observer:</span><span class="meta-val">${escHtml(obs.auditor.name)}</span></div>
</div>
<div class="score-banner">Score Achieved: ${obs.overall_score} / ${SPA_MAX_SCORE}</div>
<section><h3>Observation Criteria</h3><table><thead><tr><th>Criteria</th><th style="text-align:center">Rating</th><th>Comments</th></tr></thead><tbody>${rowsHtml}</tbody></table></section>
<section><h3>Strengths Observed</h3><div class="box">${escHtml(obs.strengths_observed) || "<em>None recorded.</em>"}</div></section>
<section><h3>Areas of Improvement / Feedback</h3><div class="box">${escHtml(obs.areas_of_improvement) || "<em>None recorded.</em>"}</div></section>
<section><h3>Sign-off</h3><div class="signoff-grid">
  <div><strong>Observer Name:</strong> ${escHtml(obs.auditor.name)}</div>
  <div><strong>Date:</strong> ${dateStr}</div>
  <div><strong>Feedback Shared with Coach:</strong> ${obs.feedback_shared_with_coach === true ? "Yes" : obs.feedback_shared_with_coach === false ? "No" : "-"}</div>
  <div></div>
  <div><strong>Coach Name:</strong> ${escHtml(obs.coach_name)}</div>
  <div><strong>Date:</strong> ${escHtml(obs.coach_date)}</div>
  <div><strong>SPA HOD Name:</strong> ${escHtml(obs.spa_hod_name)}</div>
  <div><strong>Date:</strong> ${escHtml(obs.spa_hod_date)}</div>
  <div><strong>CH Name:</strong> ${escHtml(obs.ch_name)}</div>
  <div><strong>Date:</strong> ${escHtml(obs.ch_date)}</div>
</div></section>
<div class="footer">Harvest International School — Confidential Audit Report · Printed on ${new Date().toLocaleDateString("en-IN", { dateStyle: "long" })}</div>
</body></html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
  win.onload = () => win.print();
}

export default function SpaDetailDrawer({ open, token, user, obsId, onClose, onUpdated }) {
  const [obs, setObs] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [editedCriteria, setEditedCriteria] = useState({});
  const [editedActivity, setEditedActivity] = useState("");
  const [editedTiming, setEditedTiming] = useState("");
  const [editedGradeSection, setEditedGradeSection] = useState("");
  const [editedStrengths, setEditedStrengths] = useState("");
  const [editedAreas, setEditedAreas] = useState("");

  const [feedbackShared, setFeedbackShared] = useState(null);
  const [coachName, setCoachName] = useState("");
  const [coachDate, setCoachDate] = useState("");
  const [spaHodName, setSpaHodName] = useState("");
  const [spaHodDate, setSpaHodDate] = useState("");
  const [chName, setChName] = useState("");
  const [chDate, setChDate] = useState("");

  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    if (!open || !obsId) return;
    setLoading(true);
    setLoadError("");
    setObs(null);
    api
      .getSpaObservation(token, obsId)
      .then((data) => {
        setObs(data);
        setEditedCriteria(data.criteria_scores || {});
        setEditedActivity(data.activity || "");
        setEditedTiming(data.timing || "");
        setEditedGradeSection(data.grade_section || "");
        setEditedStrengths(data.strengths_observed || "");
        setEditedAreas(data.areas_of_improvement || "");
        setFeedbackShared(data.feedback_shared_with_coach ?? null);
        setCoachName(data.coach_name || "");
        setCoachDate(data.coach_date || "");
        setSpaHodName(data.spa_hod_name || "");
        setSpaHodDate(data.spa_hod_date || "");
        setChName(data.ch_name || "");
        setChDate(data.ch_date || "");
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [open, obsId, token]);

  const isCreator = obs && user && obs.auditor_id === user.id;
  const isDraftEditable = obs?.is_draft && isCreator;
  const isTeacher = user?.role === "teacher";

  const setCriterionScore = (key, score) => {
    setEditedCriteria((prev) => ({ ...prev, [key]: { ...prev[key], score } }));
  };
  const setCriterionComment = (key, comment) => {
    setEditedCriteria((prev) => ({ ...prev, [key]: { ...prev[key], comment } }));
  };

  const liveTotal = Object.values(editedCriteria).reduce((sum, c) => sum + (c?.score || 0), 0);

  const chComplete = chName.trim() && chDate;
  const finalizeDisabled = actionLoading || !chComplete;

  const draftPayload = () => ({
    activity: editedActivity,
    timing: editedTiming,
    grade_section: editedGradeSection,
    criteria_scores: editedCriteria,
    strengths_observed: editedStrengths,
    areas_of_improvement: editedAreas,
  });

  const handleSaveDraft = async () => {
    if (!obs) return;
    setActionError("");
    setSavedMsg("");
    setActionLoading(true);
    try {
      await api.updateSpaDraft(token, obs.id, draftPayload());
      setSavedMsg("Draft saved successfully.");
      setTimeout(() => setSavedMsg(""), 4000);
      onUpdated();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleFinalise = async () => {
    if (!obs) return;
    setActionError("");
    setSavedMsg("");
    setActionLoading(true);
    try {
      await api.updateSpaDraft(token, obs.id, draftPayload());
      await api.finaliseSpaObservation(token, obs.id, {
        feedback_shared_with_coach: feedbackShared,
        coach_name: coachName.trim() || null,
        coach_date: coachDate || null,
        spa_hod_name: spaHodName.trim() || null,
        spa_hod_date: spaHodDate || null,
        ch_name: chName.trim(),
        ch_date: chDate,
      });
      onClose();
      onUpdated();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const title = obs ? obs.teacher.name : "SPA Observation Detail";
  const subtitle = obs
    ? `${obs.school} Campus · ${obs.activity}${obs.grade_section ? ` · ${obs.grade_section}` : ""}`
    : loading ? "Loading..." : "";

  return (
    <>
      <div className={`drawer-overlay${open ? " open" : ""}`} onClick={onClose} />
      <div className={`drawer${open ? " open" : ""}`}>
        <div className="drawer-header">
          <div>
            <h2 className="drawer-title">{title}</h2>
            <div className="drawer-subtitle">{subtitle}</div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {obs && !obs.is_draft && (
              <button className="btn-print" onClick={() => handleSpaPrint(obs)} title="Print / Save as PDF">
                &#128438; Print / PDF
              </button>
            )}
            <button className="btn-close-drawer flex-center" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="drawer-body">
          {loading && <div className="msg"><span className="spinner" />Loading observation...</div>}
          {loadError && <div className="error-banner">{loadError}</div>}

          {obs && (
            <>
              <div className="drawer-score-row">
                <div className="drawer-score-big">{isDraftEditable ? liveTotal : obs.overall_score}/{SPA_MAX_SCORE}</div>
                <div className="drawer-score-meta">
                  <div className="drawer-score-lbl">
                    {formatDateStr(obs.date_time)} · Observer: {obs.auditor.name}
                  </div>
                  {obs.is_draft && (
                    <div style={{ marginTop: "4px" }}>
                      <span className="tc-status-badge draft">DRAFT</span>
                    </div>
                  )}
                </div>
              </div>

              {!isTeacher && (
                <>
                  <div className="drawer-section-label">Session Details</div>
                  <div className="hc-params-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div className="hc-param-item"><span>Activity</span><span className="hc-param-val">{isDraftEditable ? "" : obs.activity}</span></div>
                    <div className="hc-param-item"><span>Timing</span><span className="hc-param-val">{isDraftEditable ? "" : (obs.timing || "-")}</span></div>
                  </div>
                  {isDraftEditable && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="field-label">Activity</label>
                        <input type="text" className="input-text" value={editedActivity} onChange={(e) => setEditedActivity(e.target.value)} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="field-label">Timing</label>
                        <input type="text" className="input-text" value={editedTiming} onChange={(e) => setEditedTiming(e.target.value)} />
                      </div>
                      <div className="form-group" style={{ margin: 0, gridColumn: "1 / -1" }}>
                        <label className="field-label">Grade & Section</label>
                        <input type="text" className="input-text" value={editedGradeSection} onChange={(e) => setEditedGradeSection(e.target.value)} />
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="drawer-section-label">Observation Criteria</div>
              <div className="drawer-params-box">
                <div className="spa-criteria-table-wrap">
                  <table className="spa-criteria-table">
                    <thead>
                      <tr>
                        <th style={{ width: "30%" }}>Criteria</th>
                        <th>Rating</th>
                        <th style={{ width: "26%" }}>Comment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SPA_CRITERIA.map((crit, idx) => {
                        const entry = editedCriteria[crit.key] || {};
                        const opt = findOption(crit.key, entry.score);
                        return (
                          <tr key={crit.key}>
                            <td className="spa-criteria-label">{idx + 1}. {crit.label}</td>
                            <td>
                              {isDraftEditable ? (
                                <div className="spa-option-row">
                                  {crit.options.map((o) => (
                                    <button
                                      type="button"
                                      key={o.score}
                                      className={`spa-option-pill${entry.score === o.score ? " selected" : ""}`}
                                      onClick={() => setCriterionScore(crit.key, o.score)}
                                    >
                                      {o.score} – {o.label}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <span>{entry.score ?? "-"}{opt ? ` – ${opt.label}` : ""}</span>
                              )}
                            </td>
                            <td>
                              {isDraftEditable ? (
                                <input
                                  type="text"
                                  className="input-text spa-comment-input"
                                  value={entry.comment || ""}
                                  onChange={(e) => setCriterionComment(crit.key, e.target.value)}
                                />
                              ) : (
                                <span style={{ fontSize: "12px", color: "var(--text-gray)" }}>{entry.comment || ""}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="info-card">
                <div className="hc-lbl">Strengths Observed</div>
                {isDraftEditable ? (
                  <textarea className="input-text" style={{ minHeight: "80px", fontSize: "13px" }} value={editedStrengths} onChange={(e) => setEditedStrengths(e.target.value)} />
                ) : (
                  <div className="hc-val" style={{ fontSize: "13px" }}>{obs.strengths_observed || <em style={{ color: "var(--text-muted)" }}>None recorded.</em>}</div>
                )}
              </div>

              <div className="info-card">
                <div className="hc-lbl">Areas of Improvement / Feedback</div>
                {isDraftEditable ? (
                  <textarea className="input-text" style={{ minHeight: "80px", fontSize: "13px" }} value={editedAreas} onChange={(e) => setEditedAreas(e.target.value)} />
                ) : (
                  <div className="hc-val" style={{ fontSize: "13px" }}>{obs.areas_of_improvement || <em style={{ color: "var(--text-muted)" }}>None recorded.</em>}</div>
                )}
              </div>

              <div className="info-card">
                <div className="hc-lbl" style={{ marginBottom: "10px" }}>Sign-off</div>
                <div className="spa-signoff-grid">
                  <div className="spa-signoff-block">
                    <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Observer Name</div>
                    <div style={{ fontWeight: 700 }}>{obs.auditor.name}</div>
                  </div>
                  <div className="spa-signoff-block">
                    <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Date</div>
                    <div style={{ fontWeight: 700 }}>{formatDateStr(obs.date_time)}</div>
                  </div>

                  <div className="spa-signoff-block" style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" }}>Feedback Shared with the Coach</div>
                    {isDraftEditable ? (
                      <div style={{ display: "flex", gap: "16px" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                          <input type="radio" name="feedbackShared" checked={feedbackShared === true} onChange={() => setFeedbackShared(true)} /> Yes
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                          <input type="radio" name="feedbackShared" checked={feedbackShared === false} onChange={() => setFeedbackShared(false)} /> No
                        </label>
                      </div>
                    ) : (
                      <div style={{ fontWeight: 700 }}>{obs.feedback_shared_with_coach === true ? "Yes" : obs.feedback_shared_with_coach === false ? "No" : "-"}</div>
                    )}
                  </div>

                  <div className="spa-signoff-block">
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Coach Name</div>
                    {isDraftEditable ? (
                      <input type="text" className="input-text" value={coachName} onChange={(e) => setCoachName(e.target.value)} />
                    ) : (
                      <div style={{ fontWeight: 700 }}>{obs.coach_name || "-"}</div>
                    )}
                  </div>
                  <div className="spa-signoff-block">
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Date</div>
                    {isDraftEditable ? (
                      <input type="date" className="input-text" value={coachDate || ""} onChange={(e) => setCoachDate(e.target.value)} />
                    ) : (
                      <div style={{ fontWeight: 700 }}>{obs.coach_date || "-"}</div>
                    )}
                  </div>

                  <div className="spa-signoff-block">
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>SPA HOD Name</div>
                    {isDraftEditable ? (
                      <input type="text" className="input-text" value={spaHodName} onChange={(e) => setSpaHodName(e.target.value)} />
                    ) : (
                      <div style={{ fontWeight: 700 }}>{obs.spa_hod_name || "-"}</div>
                    )}
                  </div>
                  <div className="spa-signoff-block">
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Date</div>
                    {isDraftEditable ? (
                      <input type="date" className="input-text" value={spaHodDate || ""} onChange={(e) => setSpaHodDate(e.target.value)} />
                    ) : (
                      <div style={{ fontWeight: 700 }}>{obs.spa_hod_date || "-"}</div>
                    )}
                  </div>

                  <div className="spa-signoff-block">
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>
                      CH Name <span style={{ color: "var(--harvest-red)" }}>*</span>
                    </div>
                    {isDraftEditable ? (
                      <input type="text" className="input-text" value={chName} onChange={(e) => setChName(e.target.value)} />
                    ) : (
                      <div style={{ fontWeight: 700 }}>{obs.ch_name || "-"}</div>
                    )}
                  </div>
                  <div className="spa-signoff-block">
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>
                      Date <span style={{ color: "var(--harvest-red)" }}>*</span>
                    </div>
                    {isDraftEditable ? (
                      <input type="date" className="input-text" value={chDate || ""} onChange={(e) => setChDate(e.target.value)} />
                    ) : (
                      <div style={{ fontWeight: 700 }}>{obs.ch_date || "-"}</div>
                    )}
                  </div>
                </div>
                {isDraftEditable && !chComplete && (
                  <div style={{ fontSize: "11px", color: "var(--harvest-amber)", marginTop: "8px" }}>
                    CH Name and Date are required to finalise.
                  </div>
                )}
              </div>

              {isDraftEditable && (
                <div className="drawer-draft-actions">
                  {actionError && <div className="error-banner" style={{ marginBottom: "12px" }}>{actionError}</div>}
                  {savedMsg && (
                    <div style={{ marginBottom: "12px", padding: "8px 14px", borderRadius: "8px", background: "rgba(45,106,45,0.1)", border: "1px solid rgba(45,106,45,0.3)", color: "var(--harvest-green)", fontSize: "13px", textAlign: "center" }}>
                      {savedMsg}
                    </div>
                  )}
                  <button className="btn-save-draft-lg" disabled={actionLoading} onClick={handleSaveDraft} style={{ width: "100%", marginBottom: "10px" }}>
                    {actionLoading ? <><span className="spinner" />Saving...</> : "Save as Draft"}
                  </button>
                  <button className="btn-submit-large" style={{ width: "100%", opacity: finalizeDisabled ? 0.5 : 1 }} disabled={finalizeDisabled} onClick={handleFinalise}>
                    {actionLoading ? <><span className="spinner" />Processing...</> : "Finalise & Send to Coach"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
