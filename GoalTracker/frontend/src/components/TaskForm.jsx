import { useState } from "react";
import { api } from "../api";
import StaffSearchSelect from "./StaffSearchSelect";

function toDateInputValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function splitDueAt(dueAt) {
  return dueAt ? toDateInputValue(new Date(dueAt)) : "";
}

const TODAY = toDateInputValue(new Date());

export default function TaskForm({ token, user, myGoals, editingTask, parentId, onDone, onCancel }) {
  const isEdit = Boolean(editingTask);

  const [title, setTitle] = useState(editingTask?.title || "");
  const [description, setDescription] = useState(editingTask?.description || "");
  const [goalId, setGoalId] = useState(editingTask?.goal_id || "");
  // Defaults to the logged-in person when creating - if you don't pick
  // someone else, a task/subtask assigns itself to you rather than staying
  // unassigned.
  const [assignee, setAssignee] = useState(
    editingTask
      ? { email: editingTask.assignee_email, name: editingTask.assignee_name }
      : { email: user.email, name: user.name }
  );
  const [dueDate, setDueDate] = useState(splitDueAt(editingTask?.due_at));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [notes, setNotes] = useState(editingTask?.notes || []);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const notesLocked = isEdit && editingTask.is_completed;

  async function submitNote(e) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setNoteSaving(true);
    setError("");
    try {
      const saved = await api.addTaskNote(token, editingTask.id, noteText.trim());
      setNotes([...notes, saved]);
      setNoteText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setNoteSaving(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || !assignee) {
      setError("Title and assignee are required.");
      return;
    }
    if (dueDate && dueDate < TODAY) {
      setError("Due date can't be in the past.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const fields = {
        title: title.trim(),
        description: description.trim() || null,
        assignee_email: assignee.email,
        assignee_name: assignee.name,
        due_at: dueDate ? new Date(`${dueDate}T00:00`).toISOString() : null,
        goal_id: goalId ? Number(goalId) : null,
      };
      if (isEdit) {
        await api.editTask(token, editingTask.id, fields);
      } else {
        const created = await api.createTask(token, { ...fields, parent_id: parentId || null });
        if (noteText.trim()) {
          await api.addTaskNote(token, created.id, noteText.trim());
        }
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
        <div className="section-title" style={{ marginTop: 0 }}>
          {isEdit ? "Edit task" : parentId ? "New subtask" : "New task"}
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Title</label>
            <input className="form-control" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="form-control" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional details" />
          </div>
          {myGoals && myGoals.length > 0 && (
            <div className="form-group">
              <label className="form-label">Link to one of my goals</label>
              <select className="form-control" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">— none —</option>
                {myGoals.map((g) => (
                  <option key={g.id} value={g.id}>
                    [{g.cadence === "mid_term" ? "Role" : "Organisation"}] {g.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Assign to</label>
            <StaffSearchSelect token={token} value={assignee} onChange={setAssignee} />
          </div>
          <div className="form-group">
            <label className="form-label">Due date</label>
            <input className="form-control" type="date" min={TODAY} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          {!isEdit && (
            <div className="form-group">
              <label className="form-label">Note</label>
              <input
                className="form-control"
                placeholder="Optional starting note"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save task"}</button>
          </div>
        </form>

        {isEdit && (
          <div className="log-list">
            <div className="goal-field-label">Progress notes</div>
            {notes.length === 0 && <div className="hint-text">No notes yet.</div>}
            {notes.map((n) => (
              <div className="log-item" key={n.id}>
                <span className="log-date">{n.created_at.slice(0, 10)}</span>
                <span>{n.note} <span className="hint-text">— {n.author_name}</span></span>
              </div>
            ))}
            {notesLocked ? (
              <div className="hint-text">Task is complete - no more notes can be added.</div>
            ) : (
              <form className="log-add-row" onSubmit={submitNote}>
                <input
                  className="form-control"
                  placeholder="Add a progress note…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <button className="btn btn-primary btn-sm" type="submit" disabled={noteSaving}>Log</button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
