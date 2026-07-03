import { useState } from "react";
import { RUBRICS } from "../constants/rubrics";
import {
  calculateScores,
  EMPTY_SCORES,
  GRADES,
  SECTIONS,
  SUBJECTS,
} from "../utils/helpers";

function RubricParameter({ param, score, onSelect }) {
  return (
    <div className="param-block">
      <div className="param-header">
        <div className="param-title">
          <span className="param-code-badge">{param.code}</span>
          {param.title}
        </div>
        <div
          className={`param-score-pill flex-center${score ? ` active-${score}` : ""}`}
          id={`score_${param.key}`}
        >
          {score || "—"}
        </div>
      </div>
      <div className="rubric-list">
        {param.levels.map((level) => (
          <label
            key={level.score}
            className={`rubric-card${score === level.score ? ` selected-${level.score}` : ""}`}
            onClick={() => onSelect(param.key, level.score)}
          >
            <input type="radio" name={param.key} value={level.score} readOnly checked={score === level.score} />
            <div className="rubric-card-header">
              <div className="custom-radio"></div>
              <div className="rubric-score-tag">
                <span className="rst-num">{level.score}</span>
                <span className="rst-label">{level.label}</span>
              </div>
            </div>
            <div className="rubric-desc">{level.desc}</div>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function ObservationForm({
  token,
  teachers,
  formScores,
  setFormScores,
  timestampedNotes,
  setTimestampedNotes,
  selectedImages,
  setSelectedImages,
  onSubmit,
  submitting,
  submitError,
  onSchoolChange,
}) {
  const [school, setSchool] = useState("Kodathi");
  const [teacherId, setTeacherId] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [section, setSection] = useState("");
  const [infraIssues, setInfraIssues] = useState("");
  const [otherIssues, setOtherIssues] = useState("");
  const [domain1Remarks, setDomain1Remarks] = useState("");
  const [domain2Remarks, setDomain2Remarks] = useState("");
  const [domain3Remarks, setDomain3Remarks] = useState("");
  const [liveNote, setLiveNote] = useState("");
  const [p34Na, setP34Na] = useState(true);

  const { d1, d2, d3, total, rating } = calculateScores(formScores);

  const addNote = () => {
    const note = liveNote.trim();
    if (!note) return;
    const time = new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setTimestampedNotes((prev) => [...prev, `[${time}] ${note}`]);
    setLiveNote("");
  };

  const handleImageSelection = (event) => {
    const files = Array.from(event.target.files || []);
    setSelectedImages((prev) => [...prev, ...files]);
    event.target.value = "";
  };

  const removeImage = (index) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    onSubmit({
      school,
      teacher_id: parseInt(teacherId, 10),
      subject: subject || "General",
      grade: grade || "N/A",
      section: section || "N/A",
      infrastructure_issues: infraIssues.trim(),
      other_issues: otherIssues.trim(),
      objective_observations: timestampedNotes.join("\n"),
      domain1_remarks: domain1Remarks.trim(),
      domain2_remarks: domain2Remarks.trim(),
      domain3_remarks: domain3Remarks.trim(),
      ...formScores,
      p34: p34Na ? 0 : formScores.p34,
      p34_na: p34Na,
    });
  };

  const ratingStyle = (() => {
    if (total >= 20) {
      return { color: "#4ff57f", background: "rgba(79, 255, 127, 0.1)", borderColor: "rgba(79, 255, 127, 0.3)" };
    }
    if (total >= 15) {
      return { color: "var(--harvest-blue)", background: "rgba(41, 171, 226, 0.1)", borderColor: "rgba(41, 171, 226, 0.3)" };
    }
    if (total >= 10) {
      return { color: "var(--harvest-amber)", background: "rgba(232, 160, 28, 0.1)", borderColor: "rgba(232, 160, 28, 0.3)" };
    }
    return { color: "var(--harvest-red)", background: "rgba(232, 64, 28, 0.1)", borderColor: "rgba(232, 64, 28, 0.3)" };
  })();

  return (
    <>
      <div className="form-layout">
        <div>
          <div className="section-title-wrap">
            <div className="section-icon flex-center">&#127978;</div>
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
                Select Teacher <span style={{ color: "var(--harvest-red)" }}>*</span>
              </label>
              <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                <option value="">-- Choose Teacher --</option>
                {[...teachers]
                  .sort((a, b) => {
                    const strip = (n) => n.replace(/^(Ms\.?|Mr\.?|Dr\.?)\s+/i, "");
                    return strip(a.name).localeCompare(strip(b.name));
                  })
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.location})
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-group">
              <label className="field-label">Subject</label>
              <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">-- Choose Subject --</option>
                {SUBJECTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="field-label">Grade & Section</label>
              <div className="grade-row">
                <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                  <option value="">-- Grade --</option>
                  {GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <select value={section} onChange={(e) => setSection(e.target.value)}>
                  <option value="">-- Section --</option>
                  {SECTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="section-title-wrap">
            <div className="section-icon flex-center">&#128065;</div>
            <h2>Objective Observations</h2>
          </div>
          <div className="card">
            <div className="remarks-list">
              {timestampedNotes.length === 0 ? (
                <div className="remark-item text-center" style={{ color: "var(--text-muted)" }}>
                  No timestamped logs recorded yet.
                </div>
              ) : (
                timestampedNotes.map((note, idx) => {
                  const parts = note.split(" ");
                  const time = parts[0];
                  const text = parts.slice(1).join(" ");
                  return (
                    <div className="remark-item" key={idx}>
                      <span className="remark-time">{time}</span>
                      {text}
                    </div>
                  );
                })
              )}
            </div>
            <div className="timestamper-row">
              <textarea
                placeholder="Add running log during the class..."
                style={{ minHeight: "48px" }}
                value={liveNote}
                onChange={(e) => setLiveNote(e.target.value)}
              />
              <button type="button" className="btn-timestamp" onClick={addNote}>
                Add Log
              </button>
            </div>
          </div>

          <div className="section-title-wrap">
            <div className="section-icon flex-center">&#128203;</div>
            <h2>Domain Parameters & Rubrics</h2>
          </div>
          <div className="card">
            {RUBRICS.map((domain, idx) => {
              const remarkState = [
                [domain1Remarks, setDomain1Remarks],
                [domain2Remarks, setDomain2Remarks],
                [domain3Remarks, setDomain3Remarks],
              ][idx];
              return (
                <div key={domain.domain}>
                  <h3
                    style={{
                      color: "var(--harvest-blue)",
                      marginBottom: "20px",
                      marginTop: idx > 0 ? "30px" : 0,
                      borderBottom: "1.5px solid rgba(41,171,226,0.2)",
                      paddingBottom: "5px",
                    }}
                  >
                    {domain.domain}
                  </h3>
                  {domain.params.map((param) => {
                    if (param.key === "p34") {
                      return (
                        <div className="param-block" key={param.key}>
                          <div className="param-header">
                            <div className="param-title">
                              <span className="param-code-badge">{param.code}</span>
                              {param.title}
                            </div>
                            {p34Na ? (
                              <div className="param-score-pill flex-center" style={{ background: "rgba(150,150,150,0.12)", color: "#888", border: "1px solid rgba(150,150,150,0.25)" }}>N/A</div>
                            ) : (
                              <div className={`param-score-pill flex-center${formScores.p34 ? ` active-${formScores.p34}` : ""}`}>{formScores.p34 || "—"}</div>
                            )}
                          </div>
                          <div className="p34-toggle-row">
                            <label className={`p34-toggle-opt${p34Na ? " p34-active" : ""}`}>
                              <input type="radio" name="p34_mode" checked={p34Na} onChange={() => { setP34Na(true); setFormScores((prev) => ({ ...prev, p34: 0 })); }} />
                              <span>N/A — Technology not applicable for this class</span>
                            </label>
                            <label className={`p34-toggle-opt${!p34Na ? " p34-active" : ""}`}>
                              <input type="radio" name="p34_mode" checked={!p34Na} onChange={() => setP34Na(false)} />
                              <span>Score — Technology was used; evaluate this parameter</span>
                            </label>
                          </div>
                          {!p34Na && (
                            <div className="rubric-list">
                              {param.levels.map((level) => (
                                <label
                                  key={level.score}
                                  className={`rubric-card${formScores.p34 === level.score ? ` selected-${level.score}` : ""}`}
                                  onClick={() => setFormScores((prev) => ({ ...prev, p34: level.score }))}
                                >
                                  <input type="radio" name={param.key} value={level.score} readOnly checked={formScores.p34 === level.score} />
                                  <div className="rubric-card-header">
                                    <div className="custom-radio"></div>
                                    <div className="rubric-score-tag">
                                      <span className="rst-num">{level.score}</span>
                                      <span className="rst-label">{level.label}</span>
                                    </div>
                                  </div>
                                  <div className="rubric-desc">{level.desc}</div>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return (
                      <RubricParameter
                        key={param.key}
                        param={param}
                        score={formScores[param.key]}
                        onSelect={(key, score) => setFormScores((prev) => ({ ...prev, [key]: score }))}
                      />
                    );
                  })}
                  <div className="form-group" style={{ marginTop: "12px" }}>
                    <label className="field-label" style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                      Remarks for {domain.domain.split(":")[0]}
                    </label>
                    <textarea
                      placeholder={`Observations and suggestions for ${domain.domain.split(":")[1]?.trim() || "this domain"}...`}
                      style={{ minHeight: "72px", fontSize: "13px" }}
                      value={remarkState[0]}
                      onChange={(e) => remarkState[1](e.target.value)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="section-title-wrap">
            <div className="section-icon flex-center">&#9888;</div>
            <h2>Challenges</h2>
          </div>
          <div className="card">
            <div className="form-group">
              <label className="field-label">Infrastructure Issues</label>
              <textarea
                placeholder="Projector issues, audio setup lags..."
                style={{ minHeight: "80px" }}
                value={infraIssues}
                onChange={(e) => setInfraIssues(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="field-label">Other Issues / Cancellations</label>
              <textarea
                placeholder="Class delay, disruptions..."
                style={{ minHeight: "80px" }}
                value={otherIssues}
                onChange={(e) => setOtherIssues(e.target.value)}
              />
            </div>
          </div>

          <div className="section-title-wrap">
            <div className="section-icon flex-center">&#128247;</div>
            <h2>Audit Media (Images)</h2>
          </div>
          <div className="card">
            <input
              type="file"
              id="imageFilesInput"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleImageSelection}
            />
            <div
              className="image-upload-area flex-center"
              onClick={() => document.getElementById("imageFilesInput").click()}
            >
              <div>
                <div className="upload-icon">✦</div>
                <div className="upload-txt">
                  Click to select files
                  <br />
                  Supports multiple observation images
                </div>
              </div>
            </div>
            <div className="upload-preview-grid">
              {selectedImages.map((file, index) => (
                <div className="preview-img-wrapper" key={`${file.name}-${index}`}>
                  <img src={URL.createObjectURL(file)} alt={file.name} />
                  <button
                    type="button"
                    className="preview-remove-btn flex-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(index);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="live-strip">
        <div className="live-strip-inner">
          <div className="live-strip-row">
            {/* Score + rating */}
            <div className="live-score-block">
              <div className="live-score-display">
                <span className="live-score-big">{total}</span>
                <span className="live-score-denom">/ 24</span>
              </div>
              <div className="live-rating-txt" style={ratingStyle}>{rating}</div>
              {!p34Na && formScores.p34 > 0 && (
                <div className="live-p34-badge">3.4: {formScores.p34}/4</div>
              )}
            </div>

            {/* Progress bars */}
            <div className="live-progress-bars" style={{ gridTemplateColumns: `repeat(${p34Na ? 4 : 5}, 1fr)` }}>
              <div className="lbar-col">
                <div className="lbar-lbl">D1</div>
                <div className="lbar-val">{d1}/8</div>
                <div className="lbar-track"><div className="lbar-fill" style={{ width: `${(d1 / 8) * 100}%` }}></div></div>
              </div>
              <div className="lbar-col">
                <div className="lbar-lbl">D2</div>
                <div className="lbar-val">{d2}/4</div>
                <div className="lbar-track"><div className="lbar-fill" style={{ width: `${(d2 / 4) * 100}%` }}></div></div>
              </div>
              <div className="lbar-col">
                <div className="lbar-lbl">D3</div>
                <div className="lbar-val">{d3}/12</div>
                <div className="lbar-track"><div className="lbar-fill" style={{ width: `${(d3 / 12) * 100}%` }}></div></div>
              </div>
              {!p34Na && (
                <div className="lbar-col">
                  <div className="lbar-lbl" style={{ color: "var(--harvest-amber)" }}>3.4</div>
                  <div className="lbar-val" style={{ color: "var(--harvest-amber)" }}>{formScores.p34 || "—"}/4</div>
                  <div className="lbar-track"><div className="lbar-fill" style={{ width: `${((formScores.p34 || 0) / 4) * 100}%`, background: "var(--harvest-amber)" }}></div></div>
                </div>
              )}
              <div className="lbar-col">
                <div className="lbar-lbl">Total</div>
                <div className="lbar-val">{total}/24</div>
                <div className="lbar-track"><div className="lbar-fill" style={{ width: `${(total / 24) * 100}%` }}></div></div>
              </div>
            </div>

            {/* Save button */}
            <div className="live-strip-action">
              {submitError && <div className="error-banner" style={{ marginBottom: "6px", fontSize: "12px" }}>{submitError}</div>}
              <button className="btn-submit-audit" disabled={submitting} onClick={handleSubmit}>
                {submitting ? <><span className="spinner"></span>Saving...</> : "Save as Draft"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export { EMPTY_SCORES };
