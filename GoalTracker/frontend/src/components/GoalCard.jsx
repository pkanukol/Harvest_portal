import { useState } from "react";
import { api } from "../api";

const CADENCE_LABEL = { mid_term: "Mid Term", annual: "Annual" };
const CATEGORY_LABEL = { role_based: "Role-based", organizational: "Organizational" };

const STATUS_LABEL = {
  active: "Active",
  modified_pending_ack: "Modified — needs your acknowledgment",
  struck_off_pending_ack: "Struck off — needs your acknowledgment",
  deleted: "Deleted",
};

export default function GoalCard({ goal, token, isOwner, reviewMode, onChanged, onEdit }) {
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [reviewAction, setReviewAction] = useState("approved");
  const [reviewReason, setReviewReason] = useState("");
  const [editFields, setEditFields] = useState({
    title: goal.title,
    specific_text: goal.specific_text,
    measurable_text: goal.measurable_text,
    achievable_text: goal.achievable_text || "",
    relevant_text: goal.relevant_text || "",
  });

  const latestAction = goal.review_actions && goal.review_actions[0];
  const pendingOwnerAck = isOwner && goal.status !== "active" && goal.status !== "deleted" && latestAction && !latestAction.owner_ack_at;
  const canDelete = isOwner && goal.status === "struck_off_pending_ack" && latestAction && latestAction.owner_ack_at;

  async function submitLog(e) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSaving(true);
    setError("");
    try {
      await api.addGoalLog(token, goal.id, { notes: noteText.trim() });
      setNoteText("");
      onChanged && onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitOwnerAck() {
    setSaving(true);
    setError("");
    try {
      await api.ownerAck(token, goal.id, latestAction.id);
      onChanged && onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitDelete() {
    setSaving(true);
    setError("");
    try {
      await api.deleteGoal(token, goal.id);
      onChanged && onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitReview(e) {
    e.preventDefault();
    if (reviewAction !== "approved" && !reviewReason.trim()) {
      setError("A reason is required to modify or strike off a goal.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.reviewGoal(token, goal.id, {
        action_type: reviewAction,
        reason: reviewReason.trim() || null,
        edit: reviewAction === "modified" ? editFields : null,
      });
      setReviewReason("");
      onChanged && onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="goal-card">
      <div className="goal-card-header">
        <div>
          <div className="goal-card-title">{goal.title}</div>
          <div className="goal-card-period">{goal.period_key}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span className={`badge badge-${goal.cadence}`}>{CADENCE_LABEL[goal.cadence]}</span>
          <span className="badge badge-category">{CATEGORY_LABEL[goal.category]}</span>
        </div>
      </div>
      <div className="goal-card-body">
        {goal.status !== "active" && (
          <div className={`status-banner status-${goal.status}`}>{STATUS_LABEL[goal.status]}</div>
        )}

        <div className="goal-field">
          <div className="goal-field-label">Specific</div>
          <div className="goal-field-value">{goal.specific_text}</div>
        </div>
        <div className="goal-field">
          <div className="goal-field-label">Measurable</div>
          <div className="goal-field-value">{goal.measurable_text}</div>
        </div>
        {goal.achievable_text && (
          <div className="goal-field">
            <div className="goal-field-label">Achievable</div>
            <div className="goal-field-value">{goal.achievable_text}</div>
          </div>
        )}
        {goal.relevant_text && (
          <div className="goal-field">
            <div className="goal-field-label">Relevant</div>
            <div className="goal-field-value">{goal.relevant_text}</div>
          </div>
        )}

        {isOwner && goal.status === "active" && onEdit && (
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(goal)}>Edit</button>
        )}

        {goal.review_actions.length > 0 && (
          <div className="review-history">
            <div className="goal-field-label">Review history</div>
            {goal.review_actions.map((a) => (
              <div className="review-history-item" key={a.id}>
                <strong>{a.action_type}</strong> by {a.reviewed_by}
                {a.reason && <> — "{a.reason}"</>}
                {a.owner_ack_at && <div className="hint-text">Acknowledged by owner on {a.owner_ack_at.slice(0, 10)}</div>}
                {a.upper_ack_at && <div className="hint-text">Acknowledged by {a.upper_ack_by} on {a.upper_ack_at.slice(0, 10)}</div>}
              </div>
            ))}
          </div>
        )}

        {pendingOwnerAck && (
          <div className="ack-box">
            <div className="hint-text">Reason: {latestAction.reason}</div>
            <button className="btn btn-primary btn-sm" onClick={submitOwnerAck} disabled={saving}>Acknowledge</button>
          </div>
        )}
        {canDelete && (
          <div className="ack-box">
            <button className="btn btn-ghost btn-sm" onClick={submitDelete} disabled={saving}>Delete this goal</button>
          </div>
        )}

        {reviewMode && goal.status === "active" && (
          <form className="review-form" onSubmit={submitReview}>
            <div className="goal-field-label">Review this goal</div>
            <select className="form-control" value={reviewAction} onChange={(e) => setReviewAction(e.target.value)}>
              <option value="approved">Approve as-is</option>
              <option value="modified">Modify</option>
              <option value="struck_off">Strike off</option>
            </select>
            {reviewAction === "modified" && (
              <div style={{ marginTop: 8 }}>
                {["title", "specific_text", "measurable_text", "achievable_text", "relevant_text"].map((f) => (
                  <input
                    key={f}
                    className="form-control"
                    placeholder={f.replace("_text", "").replace("_", " ")}
                    value={editFields[f]}
                    onChange={(e) => setEditFields({ ...editFields, [f]: e.target.value })}
                    style={{ marginBottom: 6 }}
                  />
                ))}
              </div>
            )}
            {reviewAction !== "approved" && (
              <input
                className="form-control"
                placeholder="Reason (required)"
                value={reviewReason}
                onChange={(e) => setReviewReason(e.target.value)}
                style={{ marginTop: 8 }}
              />
            )}
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving} style={{ marginTop: 8 }}>
              Submit review
            </button>
          </form>
        )}

        {isOwner && goal.status === "active" && (
          <div className="log-list">
            <div className="goal-field-label">Progress log</div>
            {goal.logs.length === 0 && <div className="hint-text">No progress logged yet.</div>}
            {goal.logs.map((log) => (
              <div className="log-item" key={log.id}>
                <span className="log-date">{log.log_date}</span>
                <span>{log.notes}</span>
              </div>
            ))}
            <form className="log-add-row" onSubmit={submitLog}>
              <input
                className="form-control"
                placeholder="What did you do today/this week?"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>Log</button>
            </form>
          </div>
        )}

        {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}
