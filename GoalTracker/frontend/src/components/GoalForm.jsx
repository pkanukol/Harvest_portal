import { useState } from "react";
import { api } from "../api";

export default function GoalForm({ token, editingGoal, defaultCadence, onDone, onCancel }) {
  const isEdit = Boolean(editingGoal);
  const [cadence, setCadence] = useState(editingGoal?.cadence || defaultCadence || "annual");
  const [title, setTitle] = useState(editingGoal?.title || "");
  const [specific, setSpecific] = useState(editingGoal?.specific_text || "");
  const [measurable, setMeasurable] = useState(editingGoal?.measurable_text || "");
  const [targetDate, setTargetDate] = useState(editingGoal?.target_date || "");
  // How long the goal runs for. A monthly or termly goal comes back as a
  // suggestion when its period rolls over; the period is fixed once set,
  // because changing it would orphan the repeat chain.
  const [period, setPeriod] = useState(editingGoal?.period || "year");
  // The plan. Each non-empty line becomes a task linked to this goal, dated
  // so the last lands on the target date. Only offered on a NEW goal - on an
  // existing one the steps are already tasks, edited from the Tasks tab.
  const [steps, setSteps] = useState([""]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || !specific.trim() || !measurable.trim()) {
      setError("Title, Specific and Measurable are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const fields = {
        title: title.trim(),
        specific_text: specific.trim(),
        measurable_text: measurable.trim(),
        // Achievable/Relevant are no longer collected in this form - carry
        // through any pre-existing values unchanged on edit rather than
        // wiping them, new goals simply never set them.
        achievable_text: editingGoal?.achievable_text ?? null,
        relevant_text: editingGoal?.relevant_text ?? null,
        target_date: targetDate || null,
      };
      if (isEdit) {
        await api.editGoal(token, editingGoal.id, fields);
      } else {
        await api.createGoal(token, {
          cadence,
          period,
          ...fields,
          steps: steps.map((x) => x.trim()).filter(Boolean),
        });
      }
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="section-title" style={{ marginTop: 0 }}>{isEdit ? "Edit goal" : "New SMART goal"}</div>
        <form onSubmit={handleSubmit}>
          {!isEdit && (
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-control" value={cadence} onChange={(e) => setCadence(e.target.value)}>
                <option value="mid_term">Role</option>
                <option value="annual">Organisation</option>
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Title</label>
            <input
              className={`form-control ${isEdit ? "readonly-field" : ""}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short name for this goal"
              readOnly={isEdit}
              title={isEdit ? "The title can't be changed once a goal exists" : undefined}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Specific</label>
            <textarea className="form-control" value={specific} onChange={(e) => setSpecific(e.target.value)} placeholder="What exactly will you accomplish?" />
          </div>
          <div className="form-group">
            <label className="form-label">Measurable</label>
            <textarea className="form-control" value={measurable} onChange={(e) => setMeasurable(e.target.value)} placeholder="How will you know it's done?" />
          </div>

          {!isEdit && (
            <div className="form-group">
              <label className="form-label">How long does this run for?</label>
              <select className="form-control" style={{ maxWidth: 260 }} value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="year">This year — set once</option>
                <option value="term">This term — comes back next term</option>
                <option value="month">This month — comes back next month</option>
              </select>
              <div className="hint-text">
                {period === "year"
                  ? "A yearly goal is set once for the academic year."
                  : "When the " + (period === "month" ? "month" : "term") + " ends you'll be asked whether to set it again. Nothing is created automatically."}
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Target date</label>
            <input
              type="date"
              className="form-control"
              style={{ maxWidth: 220 }}
              min={new Date().toISOString().slice(0, 10)}
              value={targetDate ? String(targetDate).slice(0, 10) : ""}
              onChange={(e) => setTargetDate(e.target.value)}
            />
            <div className="hint-text">
              {period === "year"
                ? "When you plan to have this achieved. You'll be warned a week before."
                : "Leave it blank and it defaults to the end of this " + (period === "month" ? "month" : "term") + "."}
            </div>
          </div>

          {!isEdit && (
            <div className="form-group">
              <label className="form-label">Plan — how will you get there?</label>
              <div className="hint-text">
                Each step becomes a task linked to this goal, spread evenly up to the target
                date. You can re-date, re-assign or edit them later from Tasks.
              </div>
              {steps.map((step, i) => (
                <div className="step-row" key={i}>
                  <span className="step-num">{i + 1}.</span>
                  <input
                    className="form-control"
                    value={step}
                    placeholder={i === 0 ? "First thing you'll do" : "Next step"}
                    onChange={(e) => {
                      const next = [...steps];
                      next[i] = e.target.value;
                      setSteps(next);
                    }}
                    onKeyDown={(e) => {
                      // Enter adds the next step rather than submitting the form
                      // half-typed - this list is the main thing being filled in.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (step.trim() && i === steps.length - 1) setSteps([...steps, ""]);
                      }
                    }}
                  />
                  {steps.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Remove this step"
                      onClick={() => setSteps(steps.filter((_, k) => k !== i))}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSteps([...steps, ""])}>
                + Add step
              </button>
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save goal"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
