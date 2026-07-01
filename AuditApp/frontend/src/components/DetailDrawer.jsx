import { useEffect, useState } from "react";
import { api } from "../api";
import { DRAWER_PARAM_LABELS } from "../constants/rubrics";
import { esc, formatDateStr, ratingClass } from "../utils/helpers";

function normaliseFeedback(text) {
  if (!text) return text;
  return text
    .replace(/STRENGTHS OBSERVED:/g, "GLOWS (What went well):")
    .replace(/AREAS FOR DEVELOPMENT:/g, "GROWS (What could have been better):");
}

const PARAM_MAX = { p11: 4, p12: 4, p21: 4, p31: 4, p32: 4, p33: 4, p34: 4 };

function ScoreSelect({ paramKey, value, onChange }) {
  return (
    <select
      className="input-text"
      style={{ padding: "4px 8px", fontSize: "13px", width: "80px" }}
      value={value}
      onChange={(e) => onChange(paramKey, parseInt(e.target.value, 10))}
    >
      {[1, 2, 3, 4].map((v) => (
        <option key={v} value={v}>{v}/4</option>
      ))}
    </select>
  );
}

function handlePrint(obs, isTeacher) {
  const ratingColor = { DISTINGUISHED: "#1a7f37", PROFICIENT: "#0969da", DEVELOPING: "#9a6700", BEGINNING: "#cf222e" };
  const color = ratingColor[obs.rating] || "#333";

  const paramLabels = [
    ["p11", "1.1 Content Knowledge"], ["p12", "1.2 Learning Outcomes"],
    ["p21", "2.1 Managing Procedures"],
    ["p31", "3.1 Questioning & Discussion"], ["p32", "3.2 Student Engagement"],
    ["p33", "3.3 Process Implementation"], ["p34", "3.4 Effective Technology Use"],
  ];

  const domainRows = [
    { label: "Domain 1 — Instructional Preparation", params: ["p11","p12"], score: obs.domain1_score, max: 8, remarks: obs.domain1_remarks },
    { label: "Domain 2 — Classroom Management", params: ["p21"], score: obs.domain2_score, max: 4, remarks: obs.domain2_remarks },
    { label: "Domain 3 — Instructional Delivery", params: ["p31","p32","p33","p34"], score: obs.domain3_score, max: 16, remarks: obs.domain3_remarks },
  ];

  const escHtml = (s) => (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>");

  const domainHTML = domainRows.map((d) => `
    <div class="domain-block">
      <div class="domain-header">
        <span>${d.label}</span>
        <span class="domain-score">${d.score}/${d.max}</span>
      </div>
      <table class="param-table">
        <thead><tr><th>Parameter</th><th style="width:60px;text-align:center">Score</th></tr></thead>
        <tbody>
          ${d.params.map((k) => `<tr><td>${paramLabels.find(([pk])=>pk===k)?.[1] || k}</td><td style="text-align:center">${obs[k]}/4</td></tr>`).join("")}
        </tbody>
      </table>
      ${d.remarks ? `<div class="remarks-box"><span class="remarks-label">Remarks:</span> ${escHtml(d.remarks)}</div>` : ""}
    </div>
  `).join("");

  const obsNotesHTML = !isTeacher && obs.objective_observations ? `
    <section>
      <h3>Objective Observations &amp; Timestamps</h3>
      <div class="notes-box">${obs.objective_observations.split("\n").map((l)=>{
        const parts = l.split(" ");
        return `<div><span class="ts">${escHtml(parts[0])}</span> ${escHtml(parts.slice(1).join(" "))}</div>`;
      }).join("")}</div>
    </section>` : "";

  const issuesHTML = !isTeacher ? [
    obs.infrastructure_issues && `<div><strong>Infrastructure Issues:</strong><br>${escHtml(obs.infrastructure_issues)}</div>`,
    obs.other_issues && `<div style="margin-top:8px"><strong>Other Issues:</strong><br>${escHtml(obs.other_issues)}</div>`,
  ].filter(Boolean).join("") : "";

  const dateStr = obs.date_time ? new Date(obs.date_time).toLocaleString("en-IN", { dateStyle:"long", timeStyle:"short" }) : "";

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Observation Report — ${obs.teacher.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1a1a1a; background: #fff; padding: 28px 36px; }
  .report-header { display: flex; align-items: center; gap: 20px; border-bottom: 2.5px solid #2d6a2d; padding-bottom: 16px; margin-bottom: 20px; }
  .logo { height: 56px; }
  .school-name { font-size: 18px; font-weight: 700; color: #2d6a2d; }
  .report-title { font-size: 13px; color: #555; margin-top: 2px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; background: #f6f8f6; border: 1px solid #d0e4d0; border-radius: 6px; padding: 12px 16px; margin-bottom: 18px; }
  .meta-item { display: flex; gap: 6px; }
  .meta-key { color: #555; min-width: 80px; }
  .meta-val { font-weight: 600; }
  .score-banner { display: flex; align-items: center; gap: 20px; background: #f6f8f6; border: 1px solid #d0e4d0; border-radius: 6px; padding: 12px 18px; margin-bottom: 20px; }
  .score-big { font-size: 36px; font-weight: 800; color: ${color}; line-height: 1; }
  .score-denom { font-size: 16px; color: #888; }
  .rating-badge { font-size: 13px; font-weight: 700; color: ${color}; border: 2px solid ${color}; border-radius: 4px; padding: 3px 10px; }
  .domain-pills { display: flex; gap: 10px; margin-left: auto; }
  .dpill { background: #fff; border: 1px solid #ccc; border-radius: 4px; padding: 4px 10px; font-size: 11px; font-weight: 600; }
  section { margin-bottom: 20px; }
  h3 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #2d6a2d; border-bottom: 1px solid #cce0cc; padding-bottom: 4px; margin-bottom: 10px; }
  .domain-block { margin-bottom: 14px; }
  .domain-header { display: flex; justify-content: space-between; font-weight: 700; font-size: 12px; background: #eaf4ea; padding: 6px 10px; border-radius: 4px 4px 0 0; border: 1px solid #cce0cc; border-bottom: none; }
  .domain-score { color: #2d6a2d; }
  .param-table { width: 100%; border-collapse: collapse; border: 1px solid #cce0cc; }
  .param-table th { background: #f0f7f0; padding: 5px 10px; text-align: left; font-size: 11px; font-weight: 600; color: #555; border-bottom: 1px solid #cce0cc; }
  .param-table td { padding: 5px 10px; border-bottom: 1px solid #e8f0e8; font-size: 12px; }
  .param-table tr:last-child td { border-bottom: none; }
  .remarks-box { background: #fffbf0; border: 1px solid #f0d070; border-top: none; padding: 6px 10px; border-radius: 0 0 4px 4px; font-size: 11px; color: #555; }
  .remarks-label { font-weight: 700; color: #9a6700; }
  .notes-box { background: #f8f8f8; border: 1px solid #ddd; border-radius: 4px; padding: 10px 14px; font-size: 11px; line-height: 1.8; }
  .ts { color: #888; font-style: italic; margin-right: 6px; }
  .feedback-box { background: #f0f7ff; border: 1px solid #c0d8f0; border-radius: 4px; padding: 10px 14px; font-size: 12px; line-height: 1.7; white-space: pre-wrap; }
  .teacher-box { background: #f6f8f6; border: 1px solid #cce0cc; border-radius: 4px; padding: 10px 14px; font-size: 12px; line-height: 1.7; }
  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 10px; color: #999; display: flex; justify-content: space-between; }
  @media print { body { padding: 16px 20px; } }
</style>
</head>
<body>
<div class="report-header">
  <img src="/logo.png" class="logo" alt="Harvest Logo"/>
  <div>
    <div class="school-name">Harvest International School</div>
    <div class="report-title">Classroom Observation Report · Ref: ${obs.unique_id}</div>
  </div>
</div>

<div class="meta-grid">
  <div class="meta-item"><span class="meta-key">Teacher:</span><span class="meta-val">${escHtml(obs.teacher.name)}</span></div>
  <div class="meta-item"><span class="meta-key">Date:</span><span class="meta-val">${dateStr}</span></div>
  <div class="meta-item"><span class="meta-key">Subject:</span><span class="meta-val">${escHtml(obs.subject)}</span></div>
  <div class="meta-item"><span class="meta-key">Campus:</span><span class="meta-val">${escHtml(obs.school)}</span></div>
  <div class="meta-item"><span class="meta-key">Grade:</span><span class="meta-val">${escHtml(obs.grade)} — ${escHtml(obs.section)}</span></div>
  <div class="meta-item"><span class="meta-key">Auditor:</span><span class="meta-val">${escHtml(obs.auditor.name)}</span></div>
</div>

<div class="score-banner">
  <div><span class="score-big">${obs.overall_score}</span><span class="score-denom">/28</span></div>
  <div class="rating-badge">${obs.rating}</div>
  <div class="domain-pills">
    <span class="dpill">D1: ${obs.domain1_score}/8</span>
    <span class="dpill">D2: ${obs.domain2_score}/4</span>
    <span class="dpill">D3: ${obs.domain3_score}/16</span>
  </div>
</div>

<section>
  <h3>Domain Parameters &amp; Scores</h3>
  ${domainHTML}
</section>

${obsNotesHTML}
${issuesHTML ? `<section><h3>Challenges &amp; Issues</h3><div class="notes-box">${issuesHTML}</div></section>` : ""}

<section>
  <h3>AI-Generated Feedback for Teacher</h3>
  <div class="feedback-box">${escHtml(normaliseFeedback(obs.ai_feedback)) || "<em>No AI feedback recorded.</em>"}</div>
</section>

<section>
  <h3>Teacher's Remarks</h3>
  <div class="teacher-box">${escHtml(obs.teacher_remarks) || "<em>No remarks submitted yet.</em>"}</div>
</section>

<div class="footer">
  <span>Harvest International School — Confidential Audit Report</span>
  <span>Printed on ${new Date().toLocaleDateString("en-IN", { dateStyle: "long" })}</span>
</div>
</body>
</html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
  win.onload = () => win.print();
}

export default function DetailDrawer({ open, token, user, obsId, onClose, onUpdated }) {
  const [obs, setObs] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [editedFeedback, setEditedFeedback] = useState("");
  const [editedObjectiveObs, setEditedObjectiveObs] = useState("");
  const [editedRemarks, setEditedRemarks] = useState("");
  const [editedDomain1Remarks, setEditedDomain1Remarks] = useState("");
  const [editedDomain2Remarks, setEditedDomain2Remarks] = useState("");
  const [editedDomain3Remarks, setEditedDomain3Remarks] = useState("");
  const [editedScores, setEditedScores] = useState({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [witnessName, setWitnessName] = useState("");
  const [witnessDesignation, setWitnessDesignation] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!open || !obsId) return;
    setLoading(true);
    setLoadError("");
    setObs(null);
    setAcknowledged(false);
    api
      .getObservation(token, obsId)
      .then((data) => {
        setObs(data);
        setEditedFeedback(normaliseFeedback(data.ai_feedback) || "");
        setEditedObjectiveObs(data.objective_observations || "");
        setEditedRemarks(data.teacher_remarks || "");
        setEditedDomain1Remarks(data.domain1_remarks || "");
        setEditedDomain2Remarks(data.domain2_remarks || "");
        setEditedDomain3Remarks(data.domain3_remarks || "");
        setEditedScores({
          p11: data.p11, p12: data.p12, p21: data.p21,
          p31: data.p31, p32: data.p32, p33: data.p33, p34: data.p34,
        });
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [open, obsId, token]);

  const isCreator = obs && user && obs.auditor_id === user.id;
  const isDraftEditable = obs?.is_draft && isCreator;
  const isSME = user?.role === "sme";
  const isTeacher = user?.role === "teacher";
  const isTeacherRemarking = obs && isTeacher && !obs.is_draft && !obs.remarks_saved;

  const showActionPanel = isDraftEditable || isTeacherRemarking;
  const actionLabel = isDraftEditable ? "Finalise Audit & Send Notification" : "Save My Remarks";

  // Finalize disabled for SME until acknowledged with name + designation filled
  const smeAckComplete = acknowledged && witnessName.trim() && witnessDesignation.trim();
  const finalizeDisabled = actionLoading || (isDraftEditable && isSME && !smeAckComplete);

  const handleScoreChange = (key, val) => {
    setEditedScores((prev) => ({ ...prev, [key]: val }));
  };

  // Live recalculate scores for display
  const liveD1 = (editedScores.p11 || 0) + (editedScores.p12 || 0);
  const liveD2 = editedScores.p21 || 0;
  const liveD3 = (editedScores.p31 || 0) + (editedScores.p32 || 0) + (editedScores.p33 || 0) + (editedScores.p34 || 0);
  const liveTotal = liveD1 + liveD2 + liveD3;

  const handleAction = async () => {
    if (!obs) return;
    setActionError("");
    setActionLoading(true);
    try {
      if (isDraftEditable) {
        await api.updateDraft(token, obs.id, {
          objective_observations: editedObjectiveObs,
          ai_feedback: editedFeedback,
          domain1_remarks: editedDomain1Remarks,
          domain2_remarks: editedDomain2Remarks,
          domain3_remarks: editedDomain3Remarks,
          ...editedScores,
        });
        await api.finaliseObservation(token, obs.id);
        onClose();
        onUpdated();
      } else if (isTeacherRemarking) {
        if (!editedRemarks.trim()) {
          setActionError("Remarks cannot be empty.");
          setActionLoading(false);
          return;
        }
        await api.saveRemarks(token, obs.id, editedRemarks.trim());
        onClose();
        onUpdated();
      }
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const title = obs ? obs.teacher.name : "Observation Detail";
  const subtitle = obs
    ? `${obs.school} Campus · ${obs.subject} · ${obs.grade} ${obs.section}`
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
              <button
                className="btn-print"
                onClick={() => handlePrint(obs, isTeacher)}
                title="Print / Save as PDF"
              >
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
              {/* Score + status header */}
              <div className="drawer-score-row">
                <div className="drawer-score-big">
                  {isDraftEditable ? liveTotal : obs.overall_score}/28
                </div>
                <div className="drawer-score-meta">
                  <div className={`drawer-rating-tag ${ratingClass(obs.rating)}`}>{obs.rating}</div>
                  <div className="drawer-score-lbl">
                    {formatDateStr(obs.date_time)} · Auditor: {obs.auditor.name}
                  </div>
                  {obs.is_draft && (
                    <div style={{ marginTop: "4px" }}>
                      <span className="tc-status-badge draft">DRAFT</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Domain parameter scores */}
              <div className="drawer-section-label">Domain Parameters Rating</div>
              <div className="drawer-params-box">
                {isDraftEditable ? (
                  // Editable score selectors
                  <div className="hc-params-grid">
                    {DRAWER_PARAM_LABELS.map(([key, label]) => (
                      <div className="hc-param-item" key={key} style={{ justifyContent: "space-between" }}>
                        <span>{label}</span>
                        <ScoreSelect paramKey={key} value={editedScores[key] || 1} onChange={handleScoreChange} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="hc-params-grid">
                    {DRAWER_PARAM_LABELS.map(([key, label]) => (
                      <div className="hc-param-item" key={key}>
                        <span>{label}</span>
                        <span className="hc-param-val">{obs[key]}/4</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Domain totals */}
                <div className="domain-totals-row">
                  <span className="domain-total-pill">D1: {isDraftEditable ? liveD1 : obs.domain1_score}/8</span>
                  <span className="domain-total-pill">D2: {isDraftEditable ? liveD2 : obs.domain2_score}/4</span>
                  <span className="domain-total-pill">D3: {isDraftEditable ? liveD3 : obs.domain3_score}/16</span>
                  <span className="domain-total-pill total">Total: {isDraftEditable ? liveTotal : obs.overall_score}/28</span>
                </div>

                {/* Domain remarks — shown to all, editable by draft creator */}
                {[
                  { label: "Domain 1 Remarks", val: editedDomain1Remarks, set: setEditedDomain1Remarks, stored: obs.domain1_remarks },
                  { label: "Domain 2 Remarks", val: editedDomain2Remarks, set: setEditedDomain2Remarks, stored: obs.domain2_remarks },
                  { label: "Domain 3 Remarks", val: editedDomain3Remarks, set: setEditedDomain3Remarks, stored: obs.domain3_remarks },
                ].map((d) => (
                  (isDraftEditable || d.stored) && (
                    <div key={d.label} style={{ marginTop: "12px" }}>
                      <div className="hc-lbl" style={{ marginBottom: "6px", fontSize: "12px" }}>{d.label}</div>
                      {isDraftEditable ? (
                        <textarea
                          className="input-text"
                          style={{ minHeight: "68px", fontSize: "13px" }}
                          placeholder={`Remarks for ${d.label.toLowerCase()}...`}
                          value={d.val}
                          onChange={(e) => d.set(e.target.value)}
                        />
                      ) : (
                        <div className="hc-val" style={{ fontSize: "13px" }}>
                          {d.stored || <em style={{ color: "var(--text-muted)" }}>No remarks recorded.</em>}
                        </div>
                      )}
                    </div>
                  )
                ))}
              </div>

              {/* Observation Details — hidden from teacher */}
              {!isTeacher && (
                <>
                  <div className="drawer-section-label">Observation Details</div>

                  <div className="info-card">
                    <div className="hc-lbl">Objective Observations &amp; Timestamps</div>
                    {isDraftEditable ? (
                      <textarea
                        className="input-text"
                        style={{ minHeight: "140px", fontSize: "13px", lineHeight: 1.6 }}
                        value={editedObjectiveObs}
                        onChange={(e) => setEditedObjectiveObs(e.target.value)}
                        placeholder="Add timestamped observation notes..."
                      />
                    ) : (
                      <div className="hc-val" style={{ fontSize: "13px" }}>
                        {obs.objective_observations ? (
                          obs.objective_observations.split("\n").map((n, idx) => {
                            const parts = n.split(" ");
                            return (
                              <div key={idx} style={{ marginBottom: "4px" }}>
                                <span className="remark-time">{parts[0]}</span>
                                {esc(parts.slice(1).join(" "))}
                              </div>
                            );
                          })
                        ) : (
                          <em style={{ color: "var(--text-muted)" }}>No observation notes recorded.</em>
                        )}
                      </div>
                    )}
                  </div>

                  {obs.infrastructure_issues && (
                    <div className="info-card">
                      <div className="hc-lbl">Infrastructure Issues</div>
                      <div className="hc-val" style={{ fontSize: "13px" }}>{obs.infrastructure_issues}</div>
                    </div>
                  )}

                  {obs.other_issues && (
                    <div className="info-card">
                      <div className="hc-lbl">Other Issues</div>
                      <div className="hc-val" style={{ fontSize: "13px" }}>{obs.other_issues}</div>
                    </div>
                  )}

                  {obs.images?.length > 0 && (
                    <div className="info-card">
                      <div className="hc-lbl">Observation Images</div>
                      <div className="hc-images-grid">
                        {obs.images.map((img) => (
                          <div className="hc-img-item" key={img.id}>
                            <img
                              src={img.image_path}
                              alt="Observation"
                              onClick={() => window.open(img.image_path, "_blank")}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* AI feedback */}
              <div className="info-card">
                <div className="hc-lbl">AI-Generated Feedback for Teacher</div>
                {isDraftEditable ? (
                  <textarea
                    className="input-text"
                    style={{ minHeight: "160px", fontSize: "13px", lineHeight: 1.6 }}
                    value={editedFeedback}
                    onChange={(e) => setEditedFeedback(e.target.value)}
                  />
                ) : (
                  <div className="hc-val ai-box">
                    {normaliseFeedback(obs.ai_feedback) || "No AI feedback generated yet."}
                  </div>
                )}
              </div>

              {/* Neutral person acknowledgment — only for SME drafts */}
              {isDraftEditable && isSME && (
                <div className="info-card" style={{ border: smeAckComplete ? "1px solid var(--harvest-green)" : "1px solid var(--border)" }}>
                  <div className="hc-lbl" style={{ marginBottom: "10px" }}>Mutual Agreement Acknowledgment</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="field-label">Witness Name</label>
                      <input
                        type="text"
                        className="input-text"
                        placeholder="Full name"
                        value={witnessName}
                        onChange={(e) => setWitnessName(e.target.value)}
                      />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="field-label">Designation</label>
                      <input
                        type="text"
                        className="input-text"
                        placeholder="e.g. Vice Principal"
                        value={witnessDesignation}
                        onChange={(e) => setWitnessDesignation(e.target.value)}
                      />
                    </div>
                  </div>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                      style={{ marginTop: "3px", width: "16px", height: "16px", cursor: "pointer" }}
                    />
                    <span style={{ fontSize: "13px", color: "var(--text-white)", lineHeight: 1.6 }}>
                      I confirm that this observation report has been reviewed and mutually agreed upon by the SME and the teacher in my presence. Both parties have acknowledged the feedback and domain scores.
                    </span>
                  </label>
                  {!smeAckComplete && (
                    <div style={{ fontSize: "11px", color: "var(--harvest-amber)", marginTop: "8px" }}>
                      Please fill in your name, designation and check the box to enable finalisation.
                    </div>
                  )}
                </div>
              )}

              {/* Teacher remarks */}
              <div className="info-card">
                <div className="hc-lbl">Teacher&apos;s Remarks</div>
                {isTeacherRemarking ? (
                  <textarea
                    className="input-text"
                    placeholder="Write your remarks or reflections..."
                    style={{ minHeight: "80px", fontSize: "13px" }}
                    value={editedRemarks}
                    onChange={(e) => setEditedRemarks(e.target.value)}
                  />
                ) : (
                  <div className="hc-val teacher-box">
                    {obs.teacher_remarks || "No teacher response submitted yet."}
                  </div>
                )}
              </div>

              {/* Action panel */}
              {showActionPanel && (
                <div className="drawer-draft-actions">
                  {actionError && (
                    <div className="error-banner" style={{ marginBottom: "12px" }}>{actionError}</div>
                  )}
                  <button
                    className="btn-submit-large"
                    style={{ width: "100%", opacity: finalizeDisabled ? 0.5 : 1 }}
                    disabled={finalizeDisabled}
                    onClick={handleAction}
                  >
                    {actionLoading
                      ? <><span className="spinner" />Processing...</>
                      : actionLabel}
                  </button>
                  {isDraftEditable && isSME && !smeAckComplete && (
                    <div style={{ textAlign: "center", fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>
                      Complete the acknowledgment section above to enable this button.
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
