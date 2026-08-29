import { useState } from "react";
import { api } from "../api";
import GoalLinkedTasks from "./GoalLinkedTasks";

const CADENCE_LABEL = { mid_term: "Role", annual: "Organisation" };

const STATUS_LABEL = {
  active: "Active",
  modified_pending_ack: "Modified — needs your acknowledgment",
  struck_off_pending_ack: "Struck off — needs your acknowledgment",
  deleted: "Deleted",
};

const REVIEW_PLACEHOLDER = {
  approved: "Anything you want the owner to know (optional)",
  modified: "What did you change, and why?",
  struck_off: "Why is this goal being struck off?",
};

const REVIEW_ACTIONS = [
  { key: "approved", icon: "✅", title: "Approve as-is" },
  { key: "modified", icon: "✏️", title: "Modify" },
  { key: "struck_off", icon: "🚫", title: "Strike off" },
];

export default function GoalCard({ goal, token, user, myGoals, isOwner, reviewMode, onChanged, embedded, readOnly }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [reviewAction, setReviewAction] = useState(null);
  const [reviewReason, setReviewReason] = useState("");
  const [editFields, setEditFields] = useState({
    specific_text: goal.specific_text,
    measurable_text: goal.measurable_text,
    achievable_text: goal.achievable_text || "",
    relevant_text: goal.relevant_text || "",
  });

  const isModifying = reviewMode && reviewAction === "modified" && goal.status === "active";

  const latestAction = goal.review_actions && goal.review_actions[0];
  const pendingOwnerAck = isOwner && goal.status !== "active" && goal.status !== "deleted" && latestAction && !latestAction.owner_ack_at;
  const canDelete = isOwner && goal.status === "struck_off_pending_ack" && latestAction && latestAction.owner_ack_at;
  // Set by GoalLinkedTasks once it knows whether this goal has linked tasks:
  // with a plan, completion is derived rather than ticked by hand.
  const [hasPlan, setHasPlan] = useState(false);

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

  async function toggleCompletion() {
    setSaving(true);
    setError("");
    try {
      await api.setGoalCompletion(token, goal.id, !goal.is_completed);
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

  async function submitReview() {
    if (!reviewAction) return;
    // Optional when approving; required when changing or rejecting, since the
    // owner has to acknowledge those and "why" is the substance of it.
    if (reviewAction !== "approved" && !reviewReason.trim()) {
      setError(
        reviewAction === "struck_off"
          ? "Please say why you're striking this goal off."
          : "Please say what you changed and why."
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.reviewGoal(token, goal.id, {
        action_type: reviewAction,
        reason: reviewReason.trim() || null,
        edit: reviewAction === "modified" ? { title: goal.title, ...editFields } : null,
      });
      setReviewReason("");
      setReviewAction(null);
      onChanged && onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // One labelled band per SMART element, laid out as a table (label column +
  // value column) so a goal reads like the school's paper goal-setting sheet.
  // Required rows always show, even empty, so the shape of a goal is
  // consistent; optional rows appear only once filled in - except in modify
  // mode, where a reviewer needs a box to type into.
  function field(label, key, required) {
    const value = goal[key];
    if (!required && !value && !isModifying) return null;
    return (
      <tr className={`smart-row smart-row-${key.replace("_text", "")}`}>
        <th scope="row">{label}</th>
        <td>
          {isModifying ? (
            <textarea
              className="form-control"
              value={editFields[key]}
              onChange={(e) => setEditFields({ ...editFields, [key]: e.target.value })}
            />
          ) : (
            value || <span className="smart-empty">Not set</span>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className={embedded ? "goal-card goal-card-embedded" : "goal-card"}>
      {/* Inside an expanded accordion row the title and cadence are already
          on the row itself - repeating them here just wastes vertical space. */}
      {!embedded && (
        <div className="goal-card-header">
          <div className="goal-card-title">{goal.title}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <span className={`badge badge-${goal.cadence}`}>{CADENCE_LABEL[goal.cadence]}</span>
          </div>
        </div>
      )}
      <div className="goal-card-body">
        {isOwner && (
          hasPlan ? (
            <div className="completion-derived">
              <span className="task-complete-icon">{goal.is_completed ? "✅" : "⬜"}</span>
              {goal.is_completed
                ? "Complete — every task in the plan is done"
                : "Closes automatically when every task in the plan is done"}
            </div>
          ) : (
            <button type="button" className="completion-toggle" onClick={toggleCompletion} disabled={saving}>
              <span className="task-complete-icon">{goal.is_completed ? "✅" : "⬜"}</span>
              {goal.is_completed ? "Marked complete" : "Mark this goal complete"}
            </button>
          )
        )}

        {goal.status !== "active" && (
          <div className={`status-banner status-${goal.status}`}>{STATUS_LABEL[goal.status]}</div>
        )}

        <table className="smart-table">
          <tbody>
            {field("Specific", "specific_text", true)}
            {field("Measurable", "measurable_text", true)}
            {goal.target_date && (
              <tr className="smart-row smart-row-target">
                <th scope="row">By when</th>
                <td>
                  {new Date(`${String(goal.target_date).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
                    day: "numeric", month: "long", year: "numeric",
                  })}
                  {goal.risk === "overdue" && <span className="risk-inline"> — target date has passed</span>}
                  {goal.risk === "due_soon" && <span className="risk-inline"> — due within a week</span>}
                </td>
              </tr>
            )}
            {field("Achievable", "achievable_text", false)}
            {field("Relevant", "relevant_text", false)}
          </tbody>
        </table>

        {goal.review_actions.length > 0 && (
          <div className="review-history">
            <div className="goal-field-label">Review history</div>
            {goal.review_actions.map((a) => (
              <div className="review-history-item" key={a.id}>
                <strong>{a.action_type}</strong> by {a.reviewed_by}
                {a.reason && <> — "{a.reason}"</>}
                {a.owner_ack_at && <div className="hint-text">Acknowledged by owner on {a.owner_ack_at.slice(0, 10)}</div>}
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
          <div className="review-form">
            <div className="goal-field-label">
              Review this goal
              {readOnly && <span className="hint-text"> — preview only, not clickable</span>}
            </div>
            <div className="review-action-icons">
              {REVIEW_ACTIONS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className={`btn btn-ghost btn-sm review-action-btn ${reviewAction === a.key ? "active" : ""}`}
                  title={readOnly ? `${a.title} (preview only)` : a.title}
                  disabled={readOnly}
                  onClick={readOnly ? undefined : () => { setReviewAction(a.key); setReviewReason(""); setError(""); }}
                >
                  {a.icon}
                </button>
              ))}
            </div>

            {reviewAction && (
              <div style={{ marginTop: 8 }}>
                <label className="form-label">
                  {reviewAction === "approved" ? "Comments (optional)" : "Comments (required)"}
                </label>
                <textarea
                  className="form-control"
                  rows={3}
                  placeholder={REVIEW_PLACEHOLDER[reviewAction]}
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                />
              </div>
            )}

            {reviewAction && (
              <button className="btn btn-primary btn-sm" onClick={submitReview} disabled={saving} style={{ marginTop: 8 }}>
                Submit review
              </button>
            )}
          </div>
        )}

        {goal.logs.length > 0 && (
          <div className="log-list">
            <div className="goal-field-label">Earlier progress notes</div>
            {goal.logs.map((log) => (
              <div className="log-item" key={log.id}>
                <span className="log-date">{log.log_date}</span>
                <span>{log.notes}</span>
              </div>
            ))}
          </div>
        )}

        <GoalLinkedTasks token={token} user={user} myGoals={myGoals} goal={goal} onGoalChanged={onChanged} readOnly={readOnly} onHasTasks={setHasPlan} />

        {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}
