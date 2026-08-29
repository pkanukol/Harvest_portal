import { useState } from "react";
import GoalCard from "./GoalCard";

// Role and Organisation sit side by side rather than behind tabs (the old
// GoalTabs): the point of this screen is "do I have both, and how are they
// going" - a tabbed view hid half the answer, and an empty tab looked
// indistinguishable from a tab you hadn't clicked yet.
const PANELS = [
  { key: "mid_term", label: "Role goals", empty: "No role goal set yet." },
  { key: "annual", label: "Organisation goals", empty: "No organisation goal set yet." },
];

// A week's notice is the point of these - "overdue" alone is a post-mortem.
const RISK_BADGE = {
  due_soon: { label: "Due soon", cls: "risk-due_soon" },
  overdue: { label: "Overdue", cls: "risk-overdue" },
};

function formatTarget(d) {
  if (!d) return null;
  return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
}

const STATUS_TITLE = {
  modified_pending_ack: "Modified - needs your acknowledgment",
  struck_off_pending_ack: "Struck off - needs your acknowledgment",
};

// One segment per goal, filled when that goal is complete - readable at a
// glance in a panel too narrow for a labelled progress bar.
function Meter({ goals }) {
  if (goals.length === 0) return null;
  return (
    <span className="goal-panel-meter" title={`${goals.filter((g) => g.is_completed).length} of ${goals.length} complete`}>
      {goals.map((g) => (
        <span key={g.id} className={`goal-panel-seg ${g.is_completed ? "is-done" : ""}`} />
      ))}
    </span>
  );
}

function EmptyPanel({ message, onAdd }) {
  return (
    <div className="goal-panel-empty">
      {/* Ghost bullets keep the panel the same shape empty or full, so the
          page doesn't jump around as goals get added. */}
      <span className="ghost-bullet" />
      <span className="ghost-bullet ghost-bullet-short" />
      <span className="ghost-bullet ghost-bullet-shorter" />
      <div className="goal-panel-empty-msg">{message}</div>
      {onAdd && (
        <button className="btn btn-ghost btn-sm" onClick={onAdd}>+ Add</button>
      )}
    </div>
  );
}

export default function GoalPanels({
  goals,
  periodKey,
  token,
  user,
  myGoals,
  isOwner = false,
  reviewMode = false,
  onEditGoal,
  onDeleteGoal,
  onAddGoal,
  onChanged,
  emptyMessage,
  readOnly,
}) {
  // One open at a time - two expanded SMART blocks side by side in narrow
  // columns is unreadable, and it keeps the page short.
  const [openId, setOpenId] = useState(null);

  return (
    <div>
      {periodKey && <div className="period-superheader">Academic Year {periodKey}</div>}

      <div className="goals-grid">
        {PANELS.map((panel) => {
          const list = goals.filter((g) => g.cadence === panel.key);
          const done = list.filter((g) => g.is_completed).length;

          return (
            <section className={`goal-panel goal-panel-${panel.key}`} key={panel.key}>
              <header className="goal-panel-head">
                <span className="goal-panel-label">{panel.label}</span>
                <Meter goals={list} />
                {list.length > 0 && (
                  <span className="goal-panel-count">{done}/{list.length}</span>
                )}
              </header>

              {list.length === 0 ? (
                <EmptyPanel
                  message={emptyMessage || panel.empty}
                  onAdd={isOwner && onAddGoal ? () => onAddGoal(panel.key) : null}
                />
              ) : (
                <>
                  <ul className="goal-bullets">
                    {list.map((g) => {
                      const isOpen = openId === g.id;
                      return (
                        <li className={`goal-bullet ${isOpen ? "is-open" : ""}`} key={g.id}>
                          <div className="goal-bullet-row">
                            <button
                              type="button"
                              className="goal-bullet-main"
                              aria-expanded={isOpen}
                              onClick={() => setOpenId(isOpen ? null : g.id)}
                            >
                              <span className="goal-bullet-chevron">{isOpen ? "▾" : "▸"}</span>
                              <span className={`goal-bullet-title ${g.is_completed ? "is-completed" : ""}`}>
                                {g.title}
                              </span>
                              {g.is_completed && <span className="completed-tick" title="Completed">✓</span>}
                              {STATUS_TITLE[g.status] && <span className="flag-dot" title={STATUS_TITLE[g.status]} />}
                              {!g.is_completed && RISK_BADGE[g.risk] && (
                                <span
                                  className={`badge ${RISK_BADGE[g.risk].cls}`}
                                  title={`Target ${formatTarget(g.target_date)}`}
                                >
                                  {RISK_BADGE[g.risk].label}
                                </span>
                              )}
                              {g.plan_overruns_target && (
                                <span
                                  className="badge risk-overruns"
                                  title="A task on this goal is dated after the target date - the plan has slipped past the deadline"
                                >
                                  Plan overruns
                                </span>
                              )}
                              {g.target_date && !g.is_completed && !RISK_BADGE[g.risk] && (
                                <span className="goal-target-date">by {formatTarget(g.target_date)}</span>
                              )}
                            </button>
                            {isOwner && (
                              <span className="goal-bullet-actions">
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

                          {isOpen && (
                            <div className="goal-bullet-detail">
                              <GoalCard
                                goal={g}
                                token={token}
                                user={user}
                                myGoals={myGoals}
                                isOwner={isOwner}
                                reviewMode={reviewMode}
                                onChanged={onChanged}
                                embedded
                                readOnly={readOnly}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {isOwner && onAddGoal && (
                    <div className="goal-panel-add-row">
                      <button className="btn btn-ghost btn-sm" onClick={() => onAddGoal(panel.key)}>+ Add</button>
                    </div>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
