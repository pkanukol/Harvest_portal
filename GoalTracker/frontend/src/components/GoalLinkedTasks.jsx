import { useEffect, useState } from "react";
import { api } from "../api";
import TaskNode from "./TaskNode";

function flatten(tasks) {
  const out = [];
  const walk = (ts) => { for (const t of ts) { out.push(t); walk(t.subtasks); } };
  walk(tasks);
  return out;
}

export default function GoalLinkedTasks({ token, user, myGoals, goal, onGoalChanged, readOnly, onHasTasks }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load({ checkForCompletionPrompt } = {}) {
    setLoading(true);
    setError("");
    try {
      const data = await api.getTasksForGoal(token, goal.id);
      setTasks(data);
      onHasTasks && onHasTasks(flatten(data).some((t) => t.goal_id === goal.id));
      // The server now closes (and reopens) a goal from the state of its
      // linked tasks, so there is nothing to ask about - a prompt could be
      // dismissed and leave the goal open with all its work finished.
      if (checkForCompletionPrompt) {
        onGoalChanged && onGoalChanged();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [goal.id]);

  const linkedCount = flatten(tasks).filter((t) => t.goal_id === goal.id);
  const completedCount = linkedCount.filter((t) => t.is_completed).length;

  return (
    <div className="goal-linked-tasks">
      <div className="goal-field-label">
        Linked tasks
        {linkedCount.length > 0 && <span className="hint-text"> — {completedCount}/{linkedCount.length} complete</span>}
      </div>
      {error && <div className="form-error">{error}</div>}
      {loading ? (
        <div className="loading-spinner">Loading…</div>
      ) : tasks.length === 0 ? (
        <div className="hint-text">No tasks linked to this goal yet.</div>
      ) : (
        <div className="task-tree">
          {tasks.map((t) => (
            <TaskNode
              key={t.id}
              task={t}
              token={token}
              user={user}
              myGoals={myGoals}
              depth={0}
              onChanged={() => load({ checkForCompletionPrompt: true })}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  );
}
