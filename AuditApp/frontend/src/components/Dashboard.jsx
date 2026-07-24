import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { esc, formatDateStr, ratingClass, scoreColorClass } from "../utils/helpers";

// Leadership/oversight designations that get the SME Activity Report button —
// mirrors auth.LEADERSHIP_DESIGNATIONS on the backend, which actually enforces this.
const LEADERSHIP_DESIGNATIONS = new Set(["chairman", "managing director", "apm", "principal", "curriculum head"]);

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
  const [hasSearched, setHasSearched] = useState(false);

  // Filter-first controls — nothing is fetched until "All Observations" is clicked
  // or at least one filter is set, since the list only grows over the school year.
  const [filterOptions, setFilterOptions] = useState({ teachers: [], observers: [], subjects: [], grades: [] });
  const [filterSubject, setFilterSubject] = useState("");
  const [filterGrade, setFilterGrade] = useState("");
  const [filterObserverId, setFilterObserverId] = useState("");
  const [filterTeacherId, setFilterTeacherId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // Subject compare modal
  const [subjectModal, setSubjectModal] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [subjectData, setSubjectData] = useState([]);
  const [subjectLoading, setSubjectLoading] = useState(false);
  const [subjectError, setSubjectError] = useState("");
  const [expandedTeacher, setExpandedTeacher] = useState(null);

  // Teacher audit compare modal — fetches its own data on open, independent of the
  // (possibly not-yet-fetched) main filtered list.
  const [teacherModal, setTeacherModal] = useState(false);
  const [teacherSummaries, setTeacherSummaries] = useState([]);
  const [teacherSummariesLoading, setTeacherSummariesLoading] = useState(false);
  const [teacherSummariesError, setTeacherSummariesError] = useState("");
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [teacherAudits, setTeacherAudits] = useState([]);
  const [teacherAuditsLoading, setTeacherAuditsLoading] = useState(false);
  const [teacherAnalysis, setTeacherAnalysis] = useState("");
  const [teacherAnalysisLoading, setTeacherAnalysisLoading] = useState(false);
  const [teacherAnalysisError, setTeacherAnalysisError] = useState("");

  // SME activity report modal (leadership-only)
  const isLeadership = LEADERSHIP_DESIGNATIONS.has((user?.designation || "").trim().toLowerCase());
  const [smeModal, setSmeModal] = useState(false);
  const [smeData, setSmeData] = useState(null);
  const [smeLoading, setSmeLoading] = useState(false);
  const [smeError, setSmeError] = useState("");
  const [expandedSme, setExpandedSme] = useState(null);
  const [smeView, setSmeView] = useState("observed"); // "observed" | "notObserved"

  // Observation Coverage report modal (leadership-only)
  const [coverageModal, setCoverageModal] = useState(false);
  const [coverageData, setCoverageData] = useState(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState("");

  // Filter options (teachers/observers/subjects/grades) load immediately — they're
  // cheap lookups, unlike the observation list itself which can grow large over a term.
  useEffect(() => {
    if (!token) return;
    api
      .getDashboardFilterOptions(token, location)
      .then(setFilterOptions)
      .catch(() => {});
  }, [token, location]);

  const hasActiveFilter = !!(filterSubject || filterGrade || filterObserverId || filterTeacherId || filterStatus);

  const runSearch = () => {
    if (!token) return;
    setHasSearched(true);
    setLoading(true);
    setError("");
    api
      .getAuditList(token, location, {
        subject: filterSubject,
        grade: filterGrade,
        auditorId: filterObserverId,
        teacherId: filterTeacherId,
        status: filterStatus,
      })
      .then(setAuditList)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  const showAllObservations = () => {
    setFilterSubject(""); setFilterGrade(""); setFilterObserverId(""); setFilterTeacherId(""); setFilterStatus("");
    setHasSearched(true);
    setLoading(true);
    setError("");
    api
      .getAuditList(token, location, {})
      .then(setAuditList)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  // Re-run the current search automatically whenever a filter changes (only once a
  // search has actually been started this session) or when the campus toggle / an
  // update elsewhere (refreshKey) changes.
  useEffect(() => {
    if (!hasSearched && !hasActiveFilter) return;
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSubject, filterGrade, filterObserverId, filterTeacherId, filterStatus, location, refreshKey]);

  const resetSearch = () => {
    setFilterSubject(""); setFilterGrade(""); setFilterObserverId(""); setFilterTeacherId(""); setFilterStatus("");
    setHasSearched(false);
    setAuditList([]);
    setError("");
  };

  const openTeacherModal = () => {
    setTeacherModal(true);
    setTeacherSummariesError("");
    setTeacherSummariesLoading(true);
    setTeacherAnalysis("");
    setTeacherAnalysisError("");
    api
      .getDashboard(token, location)
      .then((summaries) => {
        const withAudits = summaries.filter((t) => t.obs_count >= 1);
        setTeacherSummaries(withAudits);
        const first = withAudits[0];
        if (first) {
          setSelectedTeacherId(String(first.teacher_id));
          loadSelectedTeacherAudits(first.teacher_id, first.obs_count);
        } else {
          setSelectedTeacherId("");
          setTeacherAudits([]);
        }
      })
      .catch((err) => setTeacherSummariesError(err.message))
      .finally(() => setTeacherSummariesLoading(false));
  };

  const loadSelectedTeacherAudits = async (teacherId, obsCount) => {
    setTeacherAuditsLoading(true);
    setTeacherAudits([]);
    try {
      const audits = await api.getTeacherObservations(token, teacherId);
      const finalised = audits.filter((a) => !a.is_draft).sort((a, b) => new Date(b.date_time) - new Date(a.date_time));
      setTeacherAudits(finalised);
      if ((obsCount ?? finalised.length) >= 2) loadTeacherAnalysis(teacherId);
    } catch (err) {
      setTeacherAnalysisError(err.message);
    } finally {
      setTeacherAuditsLoading(false);
    }
  };

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
    const first = filterOptions.subjects[0] || "";
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

  const loadSmeStats = () => {
    if (!token) return;
    setSmeLoading(true);
    setSmeError("");
    api
      .getSmeActivity(token, location)
      .then(setSmeData)
      .catch((err) => setSmeError(err.message))
      .finally(() => setSmeLoading(false));
  };

  const openSmeModal = () => {
    setExpandedSme(null);
    setSmeView("observed");
    setSmeModal(true);
    loadSmeStats();
  };

  const loadCoverageStats = () => {
    if (!token) return;
    setCoverageLoading(true);
    setCoverageError("");
    api
      .getObservationCoverage(token, location)
      .then(setCoverageData)
      .catch((err) => setCoverageError(err.message))
      .finally(() => setCoverageLoading(false));
  };

  const openCoverageModal = () => {
    setCoverageModal(true);
    loadCoverageStats();
  };

  // Reload if the campus toggle changes while a report modal is open
  useEffect(() => {
    if (smeModal) loadSmeStats();
    if (coverageModal) loadCoverageStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // The drawer renders above modal overlays (z-index), so we can leave this modal open
  // underneath — closing the report drawer naturally returns to the SME Activity Report.
  const openReportFromSmeModal = (obsId) => {
    onOpenObs(obsId);
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
          {isLeadership && (
            <button className="btn btn-subject-compare" onClick={openSmeModal}>
              SME Activity Report
            </button>
          )}
          {isLeadership && (
            <button className="btn btn-subject-compare" onClick={openCoverageModal}>
              Observation Coverage
            </button>
          )}
          <button className="btn btn-subject-compare" onClick={openSubjectModal}>
            Subject Compare
          </button>
          <button className="btn btn-teacher-compare" onClick={openTeacherModal}>
            Teacher Audit Compare
          </button>
          <button className="btn btn-add-audit" onClick={onNewObservation}>
            + New Observation
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", gap: "10px", marginBottom: hasSearched ? "16px" : 0, flexWrap: "wrap" }}>
          <button
            className="btn btn-add-audit"
            style={{ background: !hasSearched || hasActiveFilter ? "var(--bg-card)" : undefined, color: !hasSearched || hasActiveFilter ? "var(--text-white)" : undefined }}
            onClick={showAllObservations}
          >
            All Observations
          </button>
          {hasSearched && (
            <button
              className="btn btn-subject-compare"
              onClick={resetSearch}
            >
              Reset
            </button>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="field-label">Subject</label>
            <select className="filter-select" value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)}>
              <option value="">-- Any Subject --</option>
              {filterOptions.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="field-label">Grade</label>
            <select className="filter-select" value={filterGrade} onChange={(e) => setFilterGrade(e.target.value)}>
              <option value="">-- Any Grade --</option>
              {filterOptions.grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="field-label">Observed By</label>
            <select className="filter-select" value={filterObserverId} onChange={(e) => setFilterObserverId(e.target.value)}>
              <option value="">-- Anyone --</option>
              {filterOptions.observers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="field-label">Teacher</label>
            <select className="filter-select" value={filterTeacherId} onChange={(e) => setFilterTeacherId(e.target.value)}>
              <option value="">-- Any Teacher --</option>
              {filterOptions.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="field-label">Status</label>
            <select className="filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">-- All --</option>
              <option value="draft">Draft</option>
              <option value="saved">Saved</option>
            </select>
          </div>
        </div>
      </div>

      {!hasSearched && (
        <div className="card text-center" style={{ padding: "40px" }}>
          <h3 style={{ color: "var(--text-muted)", marginBottom: "8px" }}>Choose a Filter, or Click "All Observations"</h3>
          <p style={{ fontSize: "14px", color: "var(--text-gray)" }}>
            Nothing is loaded until you pick at least one filter above or click "All Observations" — keeps this page fast.
          </p>
        </div>
      )}

      {loading && <div className="msg">Loading audit records...</div>}
      {error && <div className="error-banner">{error}</div>}

      {hasSearched && !loading && !error && auditList.length === 0 && (
        <div className="card text-center" style={{ padding: "40px" }}>
          <h3 style={{ color: "var(--text-muted)", marginBottom: "8px" }}>No Audit Records Found</h3>
          <p style={{ fontSize: "14px", color: "var(--text-gray)" }}>
            No observations match the current filters for the {location} campus.
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
              <span className="meta-tag">{esc(obs.observation_type || "Unannounced")}</span>
            </div>
            <div className="audit-card-sub">
              <span>&#128100; {esc(obs.auditor_name)}</span>
              <span>&#128197; {formatDateStr(obs.date_time)}</span>
            </div>
            <div className="audit-card-footer">
              <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                <span className={`audit-score ${scoreColorClass(obs.rating)}`}>{obs.overall_score}<span className="audit-score-denom">/24</span></span>
                {obs.p34 > 0 && (
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--harvest-amber)" }}>+ {obs.p34}/4 (Technology)</span>
                )}
              </div>
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
                {filterOptions.subjects.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>No subjects found.</div>
                ) : (
                  <select
                    className="input-text"
                    value={selectedSubject}
                    onChange={(e) => { setSelectedSubject(e.target.value); loadSubjectSummary(e.target.value); }}
                  >
                    {filterOptions.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
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
                    const pct = (t.avg_score / 24) * 100;
                    const isExpanded = expandedTeacher === t.teacher_id;
                    return (
                      <div key={t.teacher_id} className="subject-compare-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div className="subject-compare-rank">#{idx + 1}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                              <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--text-white)" }}>{esc(t.teacher_name)}</span>
                              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--harvest-green)" }}>{t.avg_score}/24</span>
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
                              { label: "Domain 3", value: t.domain3_avg, max: 12 },
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
              {teacherSummariesLoading && <div className="msg"><span className="spinner"></span>Loading...</div>}
              {teacherSummariesError && <div className="error-banner">{teacherSummariesError}</div>}

              {!teacherSummariesLoading && !teacherSummariesError && teacherSummaries.length === 0 && (
                <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "12px", background: "var(--bg-card)", borderRadius: "8px" }}>
                  No finalised or draft audits recorded yet for the {location} campus.
                </div>
              )}

              {teacherSummaries.length > 0 && (
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
                      const t = teacherSummaries.find((t) => String(t.teacher_id) === id);
                      loadSelectedTeacherAudits(id, t?.obs_count);
                    }}
                  >
                    {teacherSummaries.map((t) => (
                      <option key={t.teacher_id} value={String(t.teacher_id)}>{t.teacher_name}</option>
                    ))}
                  </select>
                </div>
              )}

              {teacherAuditsLoading && <div className="msg"><span className="spinner"></span>Loading audit history...</div>}

              {!teacherAuditsLoading && teacherAudits.length === 1 && (
                <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "12px", background: "var(--bg-card)", borderRadius: "8px", marginBottom: "12px" }}>
                  Only 1 audit recorded for this teacher. Comparison and AI analysis require at least 2 audits.
                </div>
              )}

              {!teacherAuditsLoading && teacherAudits.length > 0 && (
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
                          <th>D3 /12</th>
                          <th>Total /24</th>
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

      {/* SME Activity Report modal (leadership-only) */}
      {smeModal && (
        <div className="modal-overlay" onClick={() => setSmeModal(false)}>
          <div className="modal-card modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">SME Activity Report</div>
                <div className="modal-subtitle">{location} Campus · This academic year</div>
              </div>
              <button className="btn-close-drawer flex-center" onClick={() => setSmeModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {smeLoading && <div className="msg"><span className="spinner"></span>Loading...</div>}
              {smeError && <div className="error-banner">{smeError}</div>}

              {!smeLoading && !smeError && smeData && (() => {
                const observedSmes = smeData.smes.filter((s) => s.observation_count > 0);
                const notObservedSmes = smeData.smes
                  .filter((s) => s.teachers_not_observed.length > 0)
                  .sort((a, b) => b.teachers_not_observed.length - a.teachers_not_observed.length);

                return (
                  <>
                    <div style={{ display: "flex", gap: "12px", marginBottom: "20px" }}>
                      <button
                        onClick={() => setSmeView("observed")}
                        style={{
                          flex: 1, textAlign: "center", padding: "14px", borderRadius: "10px", cursor: "pointer",
                          background: smeView === "observed" ? "rgba(75, 163, 211,0.08)" : "var(--bg-card)",
                          border: smeView === "observed" ? "1.5px solid var(--harvest-green)" : "1.5px solid var(--border)",
                        }}
                      >
                        <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--harvest-green)" }}>{smeData.total_observations}</div>
                        <div style={{ fontSize: "12px", color: "var(--text-gray)", marginTop: "2px" }}>Observations Done</div>
                      </button>
                      <button
                        onClick={() => setSmeView("notObserved")}
                        style={{
                          flex: 1, textAlign: "center", padding: "14px", borderRadius: "10px", cursor: "pointer",
                          background: smeView === "notObserved" ? "rgba(184, 39, 44,0.08)" : "var(--bg-card)",
                          border: smeView === "notObserved" ? "1.5px solid var(--harvest-red)" : "1.5px solid var(--border)",
                        }}
                      >
                        <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--harvest-red)" }}>{smeData.teachers_not_observed_overall.length}</div>
                        <div style={{ fontSize: "12px", color: "var(--text-gray)", marginTop: "2px" }}>Teachers Not Observed</div>
                      </button>
                    </div>

                    {smeView === "observed" && (
                      observedSmes.length === 0 ? (
                        <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "12px", background: "var(--bg-card)", borderRadius: "8px" }}>
                          No SME observations recorded yet for {location}.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {observedSmes.map((s) => {
                            const isExpanded = expandedSme === s.sme_id;
                            return (
                              <div key={s.sme_id} className="subject-compare-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 0 }}>
                                <div
                                  style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}
                                  onClick={() => setExpandedSme(isExpanded ? null : s.sme_id)}
                                >
                                  <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--text-white)" }}>{esc(s.sme_name)}</span>
                                    <div style={{ display: "flex", gap: "18px" }}>
                                      <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--harvest-green)" }}>
                                        {s.observation_count} observation{s.observation_count !== 1 ? "s" : ""}
                                      </span>
                                      <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--harvest-green)" }}>Avg {s.avg_score}/24</span>
                                    </div>
                                  </div>
                                  <button
                                    style={{ background: "none", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-muted)", cursor: "pointer", padding: "3px 7px", fontSize: "10px", whiteSpace: "nowrap" }}
                                  >
                                    {isExpanded ? "▲" : "▼"}
                                  </button>
                                </div>
                                {isExpanded && (
                                  <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--border)" }}>
                                    <div className="ctable-wrap">
                                      <table className="ctable">
                                        <thead>
                                          <tr>
                                            <th>Teacher</th>
                                            <th>Score</th>
                                            <th>Rating</th>
                                            <th>Date</th>
                                            <th></th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {s.observations.map((o) => (
                                            <tr key={o.obs_id}>
                                              <td>{esc(o.teacher_name)}</td>
                                              <td className="ctable-score">{o.overall_score}/24</td>
                                              <td><span className={`meta-rating ${ratingClass(o.rating)}`}>{esc(o.rating)}</span></td>
                                              <td>{formatDateStr(o.date_time)}</td>
                                              <td>
                                                <button
                                                  onClick={() => openReportFromSmeModal(o.obs_id)}
                                                  style={{ background: "none", border: "none", color: "var(--harvest-blue)", cursor: "pointer", fontSize: "12px", fontWeight: 600, textDecoration: "underline", padding: 0 }}
                                                >
                                                  View Report
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )
                    )}

                    {smeView === "notObserved" && (
                      notObservedSmes.length === 0 ? (
                        <div style={{ fontSize: "13px", color: "var(--harvest-green)", padding: "12px", background: "var(--bg-card)", borderRadius: "8px" }}>
                          Every SME has observed all of their assigned teachers.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          {notObservedSmes.map((s) => (
                            <div key={s.sme_id} className="subject-compare-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 0 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--text-white)" }}>
                                  {esc(s.sme_name)}
                                  {s.subject && <span style={{ fontWeight: 500, color: "var(--text-muted)" }}> — {esc(s.subject)}</span>}
                                </span>
                                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--harvest-red)" }}>
                                  {s.teachers_not_observed.length} not observed
                                </span>
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                {s.teachers_not_observed.map((t) => (
                                  <span key={t.teacher_id} className="meta-tag" style={{ fontSize: "11px" }}>{esc(t.name)}</span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Observation Coverage report modal (leadership-only) */}
      {coverageModal && (
        <div className="modal-overlay" onClick={() => setCoverageModal(false)}>
          <div className="modal-card modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Observation Coverage</div>
                <div className="modal-subtitle">{location} Campus · Unannounced vs Invited, by term (target: 3 per term)</div>
              </div>
              <button className="btn-close-drawer flex-center" onClick={() => setCoverageModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {coverageLoading && <div className="msg"><span className="spinner"></span>Loading...</div>}
              {coverageError && <div className="error-banner">{coverageError}</div>}

              {!coverageLoading && !coverageError && coverageData && (
                <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                  {["term1", "term2"].map((termKey) => {
                    const term = coverageData[termKey];
                    if (!term) return null;
                    return (
                      <div key={termKey}>
                        <div className="drawer-section-label">{term.label}</div>
                        <div className="ctable-wrap">
                          <table className="ctable">
                            <thead>
                              <tr>
                                <th>Teacher</th>
                                <th>Unannounced</th>
                                <th>Invited</th>
                                <th>Total</th>
                                <th>Auditors</th>
                              </tr>
                            </thead>
                            <tbody>
                              {term.rows.map((r) => (
                                <tr
                                  key={r.teacher_id}
                                  style={r.never_observed ? { background: "rgba(184, 39, 44,0.10)" } : undefined}
                                >
                                  <td style={r.never_observed ? { fontWeight: 700, color: "var(--harvest-red)" } : undefined}>
                                    {esc(r.teacher_name)}
                                    {r.subject && (
                                      <span style={{ fontSize: "11px", color: "var(--text-gray)", fontWeight: 400, marginLeft: "6px" }}>
                                        ({esc(r.subject)})
                                      </span>
                                    )}
                                  </td>
                                  <td className="ctable-score">{r.unannounced_count}</td>
                                  <td className="ctable-score">{r.invited_count}</td>
                                  <td className="ctable-score ctable-total">{r.total}</td>
                                  <td style={{ fontSize: "12px", color: "var(--text-gray)" }}>
                                    {r.never_observed ? (
                                      <span style={{ color: "var(--harvest-red)", fontWeight: 700 }}>Never observed</span>
                                    ) : (
                                      esc(r.auditors)
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
