// Shared week/overdue maths - used by TaskTracker (to pin carried-over tasks
// at the top of the list) and by Dashboard (to badge the Tasks tab), so both
// agree on what "overdue" means.

export function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

// Every still-open task due before `cutoff`, pulled out of the subtask tree.
// A task whose ancestor is also overdue is skipped: TaskNode renders its own
// subtasks, so listing both would show it twice.
export function collectOverdue(tasks, cutoff) {
  const out = [];
  (function walk(list, ancestorOverdue) {
    for (const t of list) {
      const isOverdue = !t.is_completed && !!t.due_at && new Date(t.due_at) < cutoff;
      if (isOverdue && !ancestorOverdue) out.push(t);
      if (t.subtasks && t.subtasks.length) walk(t.subtasks, ancestorOverdue || isOverdue);
    }
  })(tasks, false);
  return out;
}

// Whole weeks between the task's week and the current one - "2 weeks late"
// reads better than a raw date when the point is how long it has been slipping.
export function weeksLate(dueAt, now = new Date()) {
  const dueWeek = getWeekStart(dueAt);
  const thisWeek = getWeekStart(now);
  const weeks = Math.round((thisWeek - dueWeek) / (7 * 24 * 60 * 60 * 1000));
  if (weeks <= 0) return null;
  return weeks === 1 ? "1 week late" : `${weeks} weeks late`;
}
