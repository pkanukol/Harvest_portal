import { useEffect, useState } from "react";

const CADENCES = [
  { key: "mid_term", label: "Role" },
  { key: "annual", label: "Organisation" },
];

const STATUS_TITLE = {
  modified_pending_ack: "Modified — needs your acknowledgment",
  struck_off_pending_ack: "Struck off — needs your acknowledgment",
};

export default function GoalTabs({ goals, periodKey, onSelectGoal, onTabChange, emptyMessage, isOwner, onEditGoal, onDeleteGoal }) {
  const [cadence, setCadence] = useState("mid_term");

  useEffect(() => {
    onTabChange && onTabChange(cadence);
  }, [cadence]);

  const filtered = goals.filter((g) => g.cadence === cadence);

  return (
    <div>
      {periodKey && <div className="period-superheader">Academic Year {periodKey}</div>}

      <div className="cadence-tabs">
        {CADENCES.map((c) => (
          <button
            key={c.key}
            className={`cadence-tab ${cadence === c.key ? "active" : ""}`}
            onClick={() => setCadence(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-msg">{emptyMessage || "No goals here yet."}</div>
      ) : (
        <div className="goal-list">
          {filtered.map((g) => (
            <div key={g.id} className="goal-list-item">
              <span
                className={`goal-list-item-title ${g.is_completed ? "is-completed" : ""}`}
                onClick={() => onSelectGoal(g)}
              >
                {g.title}
                {g.is_completed && <span className="completed-tick" title="Completed">✓</span>}
                {STATUS_TITLE[g.status] && <span className="flag-dot" title={STATUS_TITLE[g.status]} />}
              </span>
              {isOwner && (
                <span className="goal-list-item-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Edit"
                    onClick={(e) => { e.stopPropagation(); onEditGoal && onEditGoal(g); }}
                  >
                    ✏️
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Delete"
                    onClick={(e) => { e.stopPropagation(); onDeleteGoal && onDeleteGoal(g); }}
                  >
                    🗑️
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
