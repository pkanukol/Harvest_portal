import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { esc, formatDateStr, ratingClass, scoreColorClass } from "../utils/helpers";

export default function Dashboard({
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

  // Subject compare modal
  const [subjectModal, setSubjectModal] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [subjectData, setSubjectData] = useState([]);
  const [subjectLoading, setSubjectLoading] = useState(false);
  const [subjectError, setSubjectError] = useState("");
  const [expandedTeacher, setExpandedTeacher] = useState(null);

  // Teacher audit compare modal
  const [teacherModal, setTeacherModal] = useState(false);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [teacherAnalysis, setTeacherAnalysis] = useState("");
  const [teacherAnalysisLoading, setTeacherAnalysisLoading] = useState(false);
  const [teacherAnalysisError, setTeacherAnalysisError] = useState("");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError("");
    api
      .getAuditList(token, location)
      .then(setAuditList)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, location, refreshKey]);

  const subjectOptions = [...new Set(auditList.map((a) => a.subject).filter(Boolean))];

  // Teachers with 1+ finalized audits
  const multiAuditTeachers = useMemo(() => {
    const map = {};
    auditList.filter((a) => !a.is_draft).forEach((a) => {
      if (!map[a.teacher_id]) map[a.teacher_id] = { id: a.teacher_id, name: a.teacher_name, audits: [] };
      map[a.teacher_id].audits.push(a);
    });
    return Object.values(map).filter((t) => t.audits.length >= 1);
  }, [auditList]);

  const teacherAudits = useMemo(() => {
    if (!selectedTeacherId) return [];
    return auditList
      .filter((a) => String(a.teacher_id) === String(selectedTeacherId) && !a.is_draft)
      .sort((a, b) => new Date(b.date_time) - new Date(a.date_time));
  }, [auditList, selectedTeacherId]);

  const teacherAverages = useMemo(() => {
    if (!teacherAudits.length) return null;
    const avg = (key) =>
      (teacherAudits.reduce((s, a) => s + (a[key] || 0), 0) / teacherAudits.length).toFixed(1);
    return {
      d1: avg("domain1_score"),
      d2: avg("domain2_score"),
      d3: avg("domain3_score"),
      total: avg("overall_score"),
    };
  }, [teacherAudits]);

  const openSubjectModal = () => {
    setSubjectModal(true);
    setSubjectData([]);
    setSubjectError("");
    setExpandedTeacher(null);
    const first = subjectOptions[0] || "";
    setSelectedSubject(first);
    if (first) loadSubjectSummary(first);
  };

  const loadSubjectSummary = (subject) => {
    if (!subject || !token) return;
    setSubjectLoading(true);
    setSubjectError("");
    setSubjectData([]);
    setExpandedTeacher(null);
    api
      .getSubjectSummary(token, location, subject)
      .then(setSubjectData)
      .catch((err) => setSubjectError(err.message))
      .finally(() => setSubjectLoading(false));
  };

  const openTeacherModal = () => {
    const first = multiAuditTeachers[0];
    setSelectedTeacherId(first ? String(first.id) : "");
    setTeacherAnalysis("");
    setTeacherAnalysisError("");
    setTeacherModal(true);
    if (first && first.audits.length >= 2) loadTeacherAnalysis(first.id);
  };

  const loadTeacherAnalysis = async (teacherId) => {
    if (!teacherId || !token) return;
    setTeacherAnalysisLoading(true);
    setTeacherAnalysis("");
    setTeacherAnalysisError("");
    try {
      const data = await api.compareProgress(token, teacherId);
      setTeacherAnalysis(data.comparison || "");
    } catch (err) {
      setTeacherAnalysisError(err.message);
    } finally {
      setTeacherAnalysisLoading(false);
    }
  };

  return (
    <div style={{ paddingTop: "24px" }}>
      {user?.name && (
        <div style={{ marginBottom: "20px" }}>
          <h1 style={{ fontSize: "28px" }}>Hello, {user.name}!</h1>
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
          <button className="btn btn-subject-compare" onClick={openSubjectModal}>
            Subject Compare
          </button>
          {multiAuditTeachers.length > 0 && (
            <button className="btn btn-teacher-compare" onClick={openTeacherModal}>
              Teacher Audit Compare
            </button>
          )}
          <button className="btn btn-add-audit" onClick={onNewObservation}>
            + New Observation
          </button>
        </div>
      </div>

      {loading && <div className="msg">Loading audit records...</div>}
      {error && <div className="error-banner">{error}</div>}

      {!loading && !error && auditList.length === 0 && (
        <div className="card text-center" style={{ padding: "40px" }}>
          <h3 style={{ color: "var(--text-muted)", marginBottom: "8px" }}>No Audit Records Found</h3>
          <p style={{ fontSize: "14px", color: "var(--text-gray)" }}>
            Observations for the {location} campus will appear here.
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
              <span className="meta-tag subj">{esc(obs.subject)}</span>
              <span className="meta-tag obs">Gr {esc(obs.grade)} · {esc(obs.section)}</span>
            </div>
            <div className="audit-card-sub">
              <span>&#128100; {esc(obs.auditor_name)}</span>
              <span>&#128197; {formatDateStr(obs.date_time)}</span>
            </div>
            <div className="audit-card-footer">
              <span className={`audit-score ${scoreColorClass(obs.rating)}`}>{obs.overall_score}<span className="audit-score-denom">/28</span></span>
              <span className={`meta-rating ${ratingClass(obs.rating)}`}>{esc(obs.rating)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Subject comparison modal */}
      {subjectModal && (
        <div className="modal-overlay" onClick={() => setSubjectModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Teacher Comparison by Subject</div>
                <div className="modal-subtitle">{location} Campus</div>
              </div>
              <button className="btn-close-drawer flex-center" onClick={() => setSubjectModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="field-label">Select Subject</label>
                {subjectOptions.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>No subjects found.</div>
                ) : (
                  <select
                    className="input-text"
                    value={selectedSubject}
                    onChange={(e) => { setSelectedSubject(e.target.value); loadSubjectSummary(e.target.value); }}
                  >
                    {subjectOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
              {subjectLoading && <div className="msg"><span className="spinner"></span>Loading...</div>}
              {subjectError && <div className="error-banner">{subjectError}</div>}
              {!subjectLoading && !subjectError && subjectData.length === 0 && selectedSubject && (
                <div style={{ color: "var(--text-muted)", fontSize: "13px", textAlign: "center", padding: "20px" }}>
                  No finalized observations found for {selectedSubject}.
                </div>
              )}
              {subjectData.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {subjectData.map((t, idx) => {
                    const pct = (t.avg_score / 28) * 100;
                    const isExpanded = expandedTeacher === t.teacher_id;
                    return (
                      <div key={t.teacher_id} className="subject-compare-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div className="subject-compare-rank">#{idx + 1}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                              <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--text-white)" }}>{esc(t.teacher_name)}</span>
                              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--harvest-green)" }}>{t.avg_score}/28</span>
                            </div>
                            <div className="timeline-bar-track">
                              <div className="timeline-bar-fill tbar-green" style={{ width: `${pct}%` }}></div>
                            </div>
                            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "3px" }}>
                              {t.obs_count} audit{t.obs_count !== 1 ? "s" : ""} · {esc(t.latest_rating)}
                            </div>
                          </div>
                          <button
                            onClick={() => setExpandedTeacher(isExpanded ? null : t.teacher_id)}
                            style={{ background: "none", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-muted)", cursor: "pointer", padding: "4px 8px", fontSize: "11px", whiteSpace: "nowrap" }}
                          >
                            {isExpanded ? "▲ Hide" : "▼ Domains"}
                          </button>
                        </div>
                        {isExpanded && (
                          <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                            {[
                              { label: "Domain 1", value: t.domain1_avg, max: 8 },
                              { label: "Domain 2", value: t.domain2_avg, max: 4 },
                              { label: "Domain 3", value: t.domain3_avg, max: 16 },
                            ].map((d) => (
                              <div key={d.label} style={{ background: "var(--bg-card)", borderRadius: "8px", padding: "10px", textAlign: "center" }}>
                                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>{d.label}</div>
                                <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--harvest-green)" }}>{d.value}</div>
                                <div style={{ fontSize: "10px", color: "var(--text-gray)" }}>/ {d.max}</div>
                                <div className="timeline-bar-track" style={{ marginTop: "6px" }}>
                                  <div className="timeline-bar-fill tbar-green" style={{ width: `${(d.value / d.max) * 100}%` }}></div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Teacher audit compare modal */}
      {teacherModal && (
        <div className="modal-overlay" onClick={() => setTeacherModal(false)}>
          <div className="modal-card modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Teacher Audit Comparison</div>
                <div className="modal-subtitle">Domain-wise progress across audits</div>
              </div>
              <button className="btn-close-drawer flex-center" onClick={() => setTeacherModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="field-label">Select Teacher</label>
                <select
                  className="input-text"
                  value={selectedTeacherId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedTeacherId(id);
                    setTeacherAnalysis("");
                    setTeacherAnalysisError("");
                    const t = multiAuditTeachers.find((t) => String(t.id) === id);
                    if (t && t.audits.length >= 2) loadTeacherAnalysis(id);
                  }}
                >
                  {multiAuditTeachers.map((t) => (
                    <option key={t.id} value={String(t.id)}>{t.name}</option>
                  ))}
                </select>
              </div>

              {teacherAudits.length === 1 && (
                <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "12px", background: "var(--bg-card)", borderRadius: "8px", marginBottom: "12px" }}>
                  Only 1 audit recorded for this teacher. Comparison and AI analysis require at least 2 audits.
                </div>
              )}

              {teacherAudits.length > 0 && (
                <>
                  <div className="ctable-wrap">
                    <table className="ctable">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Grade &amp; Section</th>
                          <th>Subject</th>
                          <th>D1 /8</th>
                          <th>D2 /4</th>
                          <th>D3 /16</th>
                          <th>Total /28</th>
                          <th>Rating</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teacherAudits.map((a, idx) => (
                          <tr key={a.id} className={idx === 0 ? "ctable-latest" : ""}>
                            <td>{formatDateStr(a.date_time)}</td>
                            <td>{esc(a.grade)} {esc(a.section)}</td>
                            <td>{esc(a.subject)}</td>
                            <td className="ctable-score">{a.domain1_score}</td>
                            <td className="ctable-score">{a.domain2_score}</td>
                            <td className="ctable-score">{a.domain3_score}</td>
                            <td className="ctable-score ctable-total">{a.overall_score}</td>
                            <td>
                              <span className={`meta-rating ${ratingClass(a.rating)}`}>{esc(a.rating)}</span>
                            </td>
                          </tr>
                        ))}
                        {teacherAverages && teacherAudits.length >= 2 && (
                          <tr className="ctable-avg-row">
                            <td colSpan={3} style={{ fontWeight: 700 }}>Average</td>
                            <td className="ctable-score">{teacherAverages.d1}</td>
                            <td className="ctable-score">{teacherAverages.d2}</td>
                            <td className="ctable-score">{teacherAverages.d3}</td>
                            <td className="ctable-score ctable-total">{teacherAverages.total}</td>
                            <td></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {teacherAudits.length >= 2 && (
                    <div style={{ marginTop: "16px" }}>
                      <div className="drawer-section-label">Improvement Analysis</div>
                      {teacherAnalysisLoading && <div className="msg"><span className="spinner" />Generating analysis...</div>}
                      {teacherAnalysisError && <div className="error-banner">{teacherAnalysisError}</div>}
                      {!teacherAnalysisLoading && teacherAnalysis && (
                        <div className="hc-val ai-box" style={{ marginTop: "8px" }}>{teacherAnalysis}</div>
                      )}
                      {!teacherAnalysisLoading && !teacherAnalysis && !teacherAnalysisError && (
                        <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>No analysis available.</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
