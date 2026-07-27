import { useState } from "react";
import { api } from "../api";

export default function GoalForm({ token, editingGoal, onDone, onCancel }) {
  const isEdit = Boolean(editingGoal);
  const [cadence, setCadence] = useState(editingGoal?.cadence || "annual");
  const [category, setCategory] = useState(editingGoal?.category || "role_based");
  const [title, setTitle] = useState(editingGoal?.title || "");
  const [specific, setSpecific] = useState(editingGoal?.specific_text || "");
  const [measurable, setMeasurable] = useState(editingGoal?.measurable_text || "");
  const [achievable, setAchievable] = useState(editingGoal?.achievable_text || "");
  const [relevant, setRelevant] = useState(editingGoal?.relevant_text || "");
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
        achievable_text: achievable.trim() || null,
        relevant_text: relevant.trim() || null,
      };
      if (isEdit) {
        await api.editGoal(token, editingGoal.id, fields);
      } else {
        await api.createGoal(token, { cadence, category, ...fields });
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
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-control" value={cadence} onChange={(e) => setCadence(e.target.value)}>
                  <option value="mid_term">Mid Term</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select className="form-control" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="role_based">Role-based</option>
                  <option value="organizational">Organizational</option>
                </select>
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Title</label>
            <input className="form-control" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short name for this goal" />
          </div>
          <div className="form-group">
            <label className="form-label">Specific</label>
            <textarea className="form-control" value={specific} onChange={(e) => setSpecific(e.target.value)} placeholder="What exactly will you accomplish?" />
          </div>
          <div className="form-group">
            <label className="form-label">Measurable</label>
            <textarea className="form-control" value={measurable} onChange={(e) => setMeasurable(e.target.value)} placeholder="How will you know it's done?" />
          </div>
          <div className="form-group">
            <label className="form-label">Achievable (optional)</label>
            <textarea className="form-control" value={achievable} onChange={(e) => setAchievable(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Relevant (optional)</label>
            <textarea className="form-control" value={relevant} onChange={(e) => setRelevant(e.target.value)} />
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
