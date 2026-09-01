import { useEffect, useState } from "react";
import { api } from "../api";
import TaskForm from "./TaskForm";
import TaskNode from "./TaskNode";
import { getWeekStart, collectOverdue, weeksLate } from "../taskUtils";

function formatWeekRange(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const startStr = weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endStr = weekEnd.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${startStr} – ${endStr}`;
}

const OWNERSHIP_TABS = [
  { key: "all", label: "All" },
  { key: "assigned", label: "Assigned to me" },
  { key: "created", label: "Created by me" },
];

export default function TaskTracker({ token, user, myGoals, onTasksChanged, tasksOverride, readOnly }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [ownershipTab, setOwnershipTab] = useState("all");
  const [showCarried, setShowCarried] = useState(true);
  // Filter by the period a task inherited from its goal. "None" covers tasks
  // with no goal at all, which is most standalone tasks.
  const [periodFilter, setPeriodFilter] = useState("all");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api.getTasks(token);
      setTasks(data);
      // Lets Dashboard refresh the overdue count on the Tasks tab.
      onTasksChanged && onTasksChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (!tasksOverride) load(); }, []);

  const effectiveTasks = tasksOverride || tasks;
  const isLoading = tasksOverride ? false : loading;

  const viewWeekStart = new Date(getWeekStart(new Date()));
  viewWeekStart.setDate(viewWeekStart.getDate() + weekOffset * 7);
  const viewWeekEnd = new Date(viewWeekStart);
  viewWeekEnd.setDate(viewWeekEnd.getDate() + 7);

  const matchesPeriod = (t) => {
    if (periodFilter === "all") return true;
    if (periodFilter === "none") return !t.goal_period || t.goal_period === "year";
    return t.goal_period === periodFilter;
  };

  const ownershipFiltered = effectiveTasks.filter((t) => {
    if (ownershipTab === "assigned") return t.assignee_email.toLowerCase() === user.email.toLowerCase();
    if (ownershipTab === "created") return t.created_by_email.toLowerCase() === user.email.toLowerCase();
    if (!matchesPeriod(t)) return false;
    return true;
  });

  const weekTasks = ownershipFiltered.filter((t) => t.due_at && new Date(t.due_at) >= viewWeekStart && new Date(t.due_at) < viewWeekEnd);
  const undatedTasks = ownershipFiltered.filter((t) => !t.due_at);

  // Anything still open from a week before this one. The week filter above is
  // a window, so without this a task due last week disappears from view
  // entirely the moment the week rolls over - the whole reason these got
  // missed. Pinned above the current week, never on a past week (there
  // "carried over" would mean the weeks after the one being viewed).
  const thisWeekStart = getWeekStart(new Date());
  const carriedOver = weekOffset >= 0 ? collectOverdue(ownershipFiltered, thisWeekStart) : [];

  return (
    <div>
      {!readOnly && (
        <div className="dashboard-actions">
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Add task</button>
        </div>
      )}

      <div className="week-header">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWeekOffset(weekOffset - 1)}>◀ Prev</button>
        <span className="week-header-label">
          Week of {formatWeekRange(viewWeekStart)}
          {weekOffset === 0 && <span className="badge badge-category" style={{ marginLeft: 8 }}>Current week</span>}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWeekOffset(weekOffset + 1)}>Next ▶</button>
        {weekOffset !== 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWeekOffset(0)}>Today</button>
        )}
      </div>

      <div className="task-filter-row">
        <select className="form-control form-control-sm" style={{ maxWidth: 170 }}
                value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}>
          <option value="all">Every period</option>
          <option value="month">Monthly goals</option>
          <option value="term">Termly goals</option>
          <option value="none">Yearly / no goal</option>
        </select>
      </div>

      <div className="cadence-tabs" style={{ marginTop: 12, marginBottom: 12 }}>
        {OWNERSHIP_TABS.map((t) => (
          <button key={t.key} className={`cadence-tab ${ownershipTab === t.key ? "active" : ""}`} onClick={() => setOwnershipTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}

      {!isLoading && carriedOver.length > 0 && (
        <section className="carried-panel">
          <button type="button" className="carried-head" onClick={() => setShowCarried(!showCarried)}>
            <span className="carried-chevron">{showCarried ? "▾" : "▸"}</span>
            <span className="carried-title">Still open from earlier weeks</span>
            <span className="carried-count">{carriedOver.length}</span>
          </button>
          {showCarried && (
            <div className="task-tree carried-tree">
              {carriedOver.map((t) => (
                <TaskNode
                  key={`carried-${t.id}`}
                  task={t}
                  token={token}
                  user={user}
                  myGoals={myGoals}
                  depth={0}
                  onChanged={load}
                  lateLabel={weeksLate(t.due_at)}
                  readOnly={readOnly}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {isLoading ? (
        <div className="loading-spinner">Loading…</div>
      ) : weekTasks.length === 0 && undatedTasks.length === 0 && carriedOver.length === 0 ? (
        <div className="empty-msg">No tasks for this week.</div>
      ) : (
        <>
          {weekTasks.length > 0 ? (
            <div className="task-tree">
              {weekTasks.map((t) => <TaskNode key={t.id} task={t} token={token} user={user} myGoals={myGoals} depth={0} onChanged={load} readOnly={readOnly} />)}
            </div>
          ) : (
            <div className="empty-msg">No tasks due this week.</div>
          )}
          {undatedTasks.length > 0 && (
            <>
              <div className="section-title" style={{ fontSize: 12 }}>No due date</div>
              <div className="task-tree">
                {undatedTasks.map((t) => <TaskNode key={t.id} task={t} token={token} user={user} myGoals={myGoals} depth={0} onChanged={load} readOnly={readOnly} />)}
              </div>
            </>
          )}
        </>
      )}

      {showForm && (
        <TaskForm token={token} user={user} myGoals={myGoals} onCancel={() => setShowForm(false)} onDone={() => { setShowForm(false); load(); }} />
      )}
    </div>
  );
}
