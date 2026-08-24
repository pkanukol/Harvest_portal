import { useState } from "react";
import { api } from "../api";

export default function GoalForm({ token, editingGoal, defaultCadence, onDone, onCancel }) {
  const isEdit = Boolean(editingGoal);
  const [cadence, setCadence] = useState(editingGoal?.cadence || defaultCadence || "annual");
  const [title, setTitle] = useState(editingGoal?.title || "");
  const [specific, setSpecific] = useState(editingGoal?.specific_text || "");
  const [measurable, setMeasurable] = useState(editingGoal?.measurable_text || "");
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
      };
      if (isEdit) {
        await api.editGoal(token, editingGoal.id, fields);
      } else {
        await api.createGoal(token, { cadence, ...fields });
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
