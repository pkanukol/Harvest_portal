import { useState } from "react";
import { SPA_CRITERIA, SPA_MAX_SCORE, EMPTY_SPA_CRITERIA_SCORES } from "../constants/spaRubrics";
import { formatDateStr } from "../utils/helpers";

const today = () => new Date().toISOString().slice(0, 10);

export default function SpaObservationForm({
  user,
  coaches,
  onSaveDraft,
  onFinalise,
  submitting,
  submitError,
  onSchoolChange,
}) {
  const [school, setSchool] = useState("Kodathi");
  const [teacherId, setTeacherId] = useState("");
  const [activity, setActivity] = useState("");
  const [timing, setTiming] = useState("");
  const [gradeSection, setGradeSection] = useState("");
  const [criteriaScores, setCriteriaScores] = useState({ ...EMPTY_SPA_CRITERIA_SCORES });
  const [strengthsObserved, setStrengthsObserved] = useState("");
  const [areasOfImprovement, setAreasOfImprovement] = useState("");

  const [feedbackShared, setFeedbackShared] = useState(null);
  const [coachName, setCoachName] = useState("");
  const [coachDate, setCoachDate] = useState("");
  const [spaHodName, setSpaHodName] = useState("");
  const [spaHodDate, setSpaHodDate] = useState("");
  const [chName, setChName] = useState("");
  const [chDate, setChDate] = useState("");

  const [savedId, setSavedId] = useState(null);
  const [savedMsg, setSavedMsg] = useState("");

  const setCriterionScore = (key, score) => {
    setCriteriaScores((prev) => ({ ...prev, [key]: { ...prev[key], score } }));
  };
  const setCriterionComment = (key, comment) => {
    setCriteriaScores((prev) => ({ ...prev, [key]: { ...prev[key], comment } }));
  };

  const totalScore = Object.values(criteriaScores).reduce((sum, c) => sum + (c.score || 0), 0);
  const chComplete = chName.trim() && chDate;

  const draftPayload = () => ({
    school,
    teacher_id: parseInt(teacherId, 10),
    activity: activity.trim(),
    timing: timing.trim(),
    grade_section: gradeSection.trim(),
    criteria_scores: criteriaScores,
    strengths_observed: strengthsObserved.trim(),
    areas_of_improvement: areasOfImprovement.trim(),
  });

  const handleSaveDraft = async () => {
    setSavedMsg("");
    const obs = await onSaveDraft(draftPayload(), savedId);
    if (obs) {
      setSavedId(obs.id);
      setSavedMsg("Draft saved successfully.");
      setTimeout(() => setSavedMsg(""), 4000);
    }
  };

  const handleFinaliseNow = async () => {
    setSavedMsg("");
    const obs = await onSaveDraft(draftPayload(), savedId);
    if (!obs) return;
    setSavedId(obs.id);
    await onFinalise(obs.id, {
      feedback_shared_with_coach: feedbackShared,
      coach_name: coachName.trim() || null,
      coach_date: coachDate || null,
      spa_hod_name: spaHodName.trim() || null,
      spa_hod_date: spaHodDate || null,
      ch_name: chName.trim(),
      ch_date: chDate,
    });
  };

  return (
    <>
      <div className="form-layout">
        <div>
          <div className="section-title-wrap">
            <div className="section-icon flex-center">&#127942;</div>
            <h2>Session Details</h2>
          </div>
          <div className="card">
            <div className="form-group">
              <label className="field-label">Location / School</label>
              <select
                value={school}
                onChange={(e) => {
                  setSchool(e.target.value);
                  setTeacherId("");
                  onSchoolChange(e.target.value);
                }}
              >
                <option value="Kodathi">Kodathi</option>
                <option value="Attibele">Attibele</option>
              </select>
            </div>
            <div className="form-group">
              <label className="field-label">
                Name of the Coach <span style={{ color: "var(--harvest-red)" }}>*</span>
              </label>
              <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                <option value="">-- Choose Coach --</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.location})</option>
                ))}
              </select>
              {coaches.length === 0 && (
                <div style={{ fontSize: "11px", color: "var(--harvest-amber)", marginTop: "4px" }}>
                  No SPA coaches found for this campus. Add a teacher user with subject "SPA" first.
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="field-label">
                Activity <span style={{ color: "var(--harvest-red)" }}>*</span>
              </label>
              <input
                type="text"
                className="input-text"
                placeholder="e.g. Basketball, Dance, Karate..."
                value={activity}
                onChange={(e) => setActivity(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="field-label">Timing</label>
              <input
                type="text"
                className="input-text"
                placeholder="e.g. 10:00 - 10:40"
                value={timing}
                onChange={(e) => setTiming(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="field-label">Grade & Section</label>
              <input
                type="text"
                className="input-text"
                placeholder="e.g. Grade 5 - Section A"
                value={gradeSection}
                onChange={(e) => setGradeSection(e.target.value)}
              />
            </div>
          </div>

          <div className="section-title-wrap">
            <div className="section-icon flex-center">&#128203;</div>
            <h2>Observation Criteria</h2>
          </div>
          <div className="card">
            <div className="spa-criteria-table-wrap">
              <table className="spa-criteria-table">
                <thead>
                  <tr>
                    <th style={{ width: "26%" }}>Observation Criteria</th>
                    <th style={{ width: "34%" }}>Rating Options</th>
                    <th>Comments / Anecdotes</th>
                  </tr>
                </thead>
                <tbody>
                  {SPA_CRITERIA.map((crit, idx) => {
                    const current = criteriaScores[crit.key];
                    return (
                      <tr key={crit.key}>
                        <td className="spa-criteria-label">{idx + 1}. {crit.label}</td>
                        <td>
                          <div className="spa-option-row">
                            {crit.options.map((opt) => (
                              <button
                                type="button"
                                key={opt.score}
                                className={`spa-option-pill${current.score === opt.score ? " selected" : ""}`}
                                onClick={() => setCriterionScore(crit.key, opt.score)}
                              >
                                {opt.score} – {opt.label}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td>
                          <input
                            type="text"
                            className="input-text spa-comment-input"
                            placeholder="Optional comment..."
                            value={current.comment}
                            onChange={(e) => setCriterionComment(crit.key, e.target.value)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div>
          <div className="section-title-wrap">
            <div className="section-icon flex-center">&#128221;</div>
            <h2>Overall Feedback</h2>
          </div>
          <div className="card">
            <div className="form-group">
              <label className="field-label">Strengths Observed</label>
              <textarea
                placeholder="What went well..."
                style={{ minHeight: "100px" }}
                value={strengthsObserved}
                onChange={(e) => setStrengthsObserved(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="field-label">Areas of Improvement / Feedback</label>
              <textarea
                placeholder="What could be better..."
                style={{ minHeight: "100px" }}
                value={areasOfImprovement}
                onChange={(e) => setAreasOfImprovement(e.target.value)}
              />
            </div>
          </div>

          <div className="section-title-wrap">
            <div className="section-icon flex-center">&#9997;</div>
            <h2>Sign-off</h2>
          </div>
          <div className="card">
            <div className="spa-signoff-grid">
              <div className="spa-signoff-block">
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Observer Name</div>
                <div style={{ fontWeight: 700 }}>{user?.name}</div>
              </div>
              <div className="spa-signoff-block">
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Date</div>
                <div style={{ fontWeight: 700 }}>{formatDateStr(today())}</div>
              </div>

              <div className="spa-signoff-block" style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" }}>Feedback Shared with the Coach</div>
                <div style={{ display: "flex", gap: "16px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                    <input type="radio" name="feedbackShared" checked={feedbackShared === true} onChange={() => setFeedbackShared(true)} /> Yes
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                    <input type="radio" name="feedbackShared" checked={feedbackShared === false} onChange={() => setFeedbackShared(false)} /> No
                  </label>
                </div>
              </div>

              <div className="spa-signoff-block">
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Coach Name</div>
                <input type="text" className="input-text" value={coachName} onChange={(e) => setCoachName(e.target.value)} />
              </div>
              <div className="spa-signoff-block">
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Date</div>
                <input type="date" className="input-text" value={coachDate} onChange={(e) => setCoachDate(e.target.value)} />
              </div>

              <div className="spa-signoff-block">
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>SPA HOD Name</div>
                <input type="text" className="input-text" value={spaHodName} onChange={(e) => setSpaHodName(e.target.value)} />
              </div>
              <div className="spa-signoff-block">
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Date</div>
                <input type="date" className="input-text" value={spaHodDate} onChange={(e) => setSpaHodDate(e.target.value)} />
              </div>

              <div className="spa-signoff-block">
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>
                  CH Name <span style={{ color: "var(--harvest-red)" }}>*</span>
                </div>
                <input type="text" className="input-text" value={chName} onChange={(e) => setChName(e.target.value)} />
              </div>
              <div className="spa-signoff-block">
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>
                  Date <span style={{ color: "var(--harvest-red)" }}>*</span>
                </div>
                <input type="date" className="input-text" value={chDate} onChange={(e) => setChDate(e.target.value)} />
              </div>
            </div>
            {!chComplete && (
              <div style={{ fontSize: "11px", color: "var(--harvest-amber)", marginTop: "8px" }}>
                CH Name and Date are required to enable "Finalise Now". You can save as a draft any number of times without them.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="live-strip">
        <div className="live-strip-inner">
          <div className="live-strip-row">
            <div className="live-score-block">
              <div className="live-score-display">
                <span className="live-score-big">{totalScore}</span>
                <span className="live-score-denom">/ {SPA_MAX_SCORE}</span>
              </div>
            </div>
            <div className="live-strip-action">
              {submitError && <div className="error-banner" style={{ marginBottom: "6px", fontSize: "12px" }}>{submitError}</div>}
              {savedMsg && <div style={{ marginBottom: "6px", fontSize: "12px", color: "var(--harvest-green)" }}>{savedMsg}</div>}
              <div style={{ display: "flex", gap: "10px" }}>
                <button className="btn-save-draft-lg" disabled={submitting} onClick={handleSaveDraft}>
                  {submitting ? <><span className="spinner"></span>Saving...</> : "Save as Draft"}
                </button>
                <button
                  className="btn-submit-audit"
                  disabled={submitting || !chComplete}
                  style={{ opacity: !chComplete ? 0.5 : 1 }}
                  onClick={handleFinaliseNow}
                >
                  {submitting ? <><span className="spinner"></span>Processing...</> : "Finalise Now"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
