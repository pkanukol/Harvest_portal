import { useState } from "react";
import { api } from "../api";
import TaskForm from "./TaskForm";

function formatDue(dueAt) {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return hasTime ? `${dateStr}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : dateStr;
}

export default function TaskNode({ task, token, user, myGoals, depth, onChanged, lateLabel, readOnly }) {
  const [expanded, setExpanded] = useState(true);
  const [showAddSubtask, setShowAddSubtask] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggleComplete() {
    setBusy(true);
    setError("");
    try {
      await api.setTaskCompletion(token, task.id, !task.is_completed);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function moveToNextWeek() {
    setBusy(true);
    setError("");
    try {
      await api.postponeTaskWeek(token, task.id);
      onChanged();
      alert(`"${task.title}" was transferred to next week.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${task.title}"${task.subtasks.length ? " and all its subtasks" : ""}? This can't be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteTask(token, task.id);
      onChanged();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const due = formatDue(task.due_at);
  const overdue = Boolean(task.due_at) && !task.is_completed && new Date(task.due_at) < new Date();
  const rolledOver = task.postpone_count > 0;
  const canAct = task.can_edit && !readOnly;

  return (
    <div className="task-node">
      <div className="task-row" style={{ marginLeft: depth * 20 }}>
        <button
          type="button"
          className="task-expand-btn"
          onClick={() => setExpanded(!expanded)}
          style={{ visibility: task.subtasks.length > 0 ? "visible" : "hidden" }}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <button
          type="button"
          className="task-complete-icon"
          title={task.is_completed ? "Mark incomplete" : "Mark complete"}
          onClick={readOnly ? undefined : toggleComplete}
          disabled={!canAct || busy}
        >
          {task.is_completed ? "✅" : "⬜"}
        </button>
        <span
          className={`task-title ${task.is_completed ? "is-completed" : ""} ${canAct ? "" : "task-title-readonly"}`}
          onClick={canAct ? () => setShowEdit(true) : undefined}
          title={task.description || undefined}
        >
          {task.title}
        </span>
        <span className="hint-text">→ {task.assignee_name}</span>
        {due && <span className={`badge task-due ${overdue ? "task-due-overdue" : ""} ${rolledOver ? "task-due-rolled-over" : ""}`}>{due}</span>}
        {rolledOver && <span className="badge task-rolled-badge" title={`Moved ${task.postpone_count} time${task.postpone_count === 1 ? "" : "s"}`}>↻ Rolled over</span>}
        {lateLabel && <span className="badge task-late-badge">{lateLabel}</span>}
        <span className="task-goal-col" title={task.goal_title ? "Linked goal" : undefined}>
          {task.goal_title ? `🎯 ${task.goal_title}` : "—"}
        </span>
        <span className="task-row-actions">
          {canAct && !task.is_completed && (
            <button type="button" className="btn btn-ghost btn-sm" title="Move to next week" onClick={moveToNextWeek} disabled={busy}>⏭️ Next week</button>
          )}
          {!readOnly && (
            <button type="button" className="btn btn-ghost btn-sm" title="Add subtask" onClick={() => setShowAddSubtask(true)}>+ Sub</button>
          )}
          {canAct && (
            <button type="button" className="btn btn-ghost btn-sm" title="Delete" onClick={handleDelete} disabled={busy}>🗑️</button>
          )}
        </span>
      </div>
      {error && <div className="form-error" style={{ marginLeft: depth * 20 + 24 }}>{error}</div>}

      {expanded && task.subtasks.map((st) => (
        <TaskNode key={st.id} task={st} token={token} user={user} myGoals={myGoals} depth={depth + 1} onChanged={onChanged} readOnly={readOnly} />
      ))}

      {showAddSubtask && (
        <TaskForm
          token={token}
          user={user}
          myGoals={myGoals}
          parentId={task.id}
          onCancel={() => setShowAddSubtask(false)}
          onDone={() => { setShowAddSubtask(false); onChanged(); }}
        />
      )}
      {showEdit && (
        <TaskForm
          token={token}
          user={user}
          myGoals={myGoals}
          editingTask={task}
          onCancel={() => setShowEdit(false)}
          onDone={() => { setShowEdit(false); onChanged(); }}
        />
      )}
    </div>
  );
}
