import { useEffect, useState } from "react";
import { api } from "../api";
import { esc, formatDateStr } from "../utils/helpers";
import { SPA_MAX_SCORE } from "../constants/spaRubrics";

export default function SpaDashboard({
  token,
  user,
  location,
  onLocationChange,
  onNewObservation,
  onOpenObs,
  refreshKey,
}) {
  const [auditList, setAuditList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError("");
    api
      .getSpaAuditList(token, location)
      .then(setAuditList)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, location, refreshKey]);

  return (
    <div style={{ paddingTop: "24px" }}>
      {user?.name && (
        <div style={{ marginBottom: "20px" }}>
          <h1 style={{ fontSize: "28px" }}>SPA / Performing Arts Observations</h1>
          <p style={{ color: "var(--text-gray)", fontSize: "14px", marginTop: "4px" }}>
            {user.designation} &mdash; {location} Campus
          </p>
        </div>
      )}
      <div className="loc-toggle-row">
        <div className="loc-tabs">
          <button
            className={`loc-tab-btn${location === "Kodathi" ? " active" : ""}`}
            onClick={() => onLocationChange("Kodathi")}
          >
            Kodathi Campus
          </button>
          <button
            className={`loc-tab-btn${location === "Attibele" ? " active" : ""}`}
            onClick={() => onLocationChange("Attibele")}
          >
            Attibele Campus
          </button>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button className="btn btn-add-audit" onClick={onNewObservation}>
            + New SPA Observation
          </button>
        </div>
      </div>

      {loading && <div className="msg">Loading SPA observation records...</div>}
      {error && <div className="error-banner">{error}</div>}

      {!loading && !error && auditList.length === 0 && (
        <div className="card text-center" style={{ padding: "40px" }}>
          <h3 style={{ color: "var(--text-muted)", marginBottom: "8px" }}>No SPA Observation Records Found</h3>
          <p style={{ fontSize: "14px", color: "var(--text-gray)" }}>
            SPA / Performing Arts observations for the {location} campus will appear here.
          </p>
        </div>
      )}

      <div className="audit-grid">
        {auditList.map((obs) => (
          <div key={obs.id} className="audit-card" onClick={() => onOpenObs(obs.id)}>
            <div className="audit-card-top">
              <span className="audit-teacher-name">{esc(obs.teacher_name)}</span>
              <span className={`tc-status-badge ${obs.is_draft ? "draft" : "saved"}`}>
                {obs.is_draft ? "DRAFT" : "SAVED"}
              </span>
            </div>
            <div className="audit-card-meta">
              <span className="meta-tag subj">{esc(obs.activity)}</span>
              {obs.grade_section && <span className="meta-tag obs">{esc(obs.grade_section)}</span>}
            </div>
            <div className="audit-card-sub">
              <span>&#128100; {esc(obs.auditor_name)}</span>
              <span>&#128197; {formatDateStr(obs.date_time)}</span>
            </div>
            <div className="audit-card-footer">
              <span className="audit-score sc-prof">{obs.overall_score}<span className="audit-score-denom">/{SPA_MAX_SCORE}</span></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
