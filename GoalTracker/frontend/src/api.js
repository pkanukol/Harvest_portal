// In local dev, VITE_API_URL is empty -> requests go to "/" -> Vite proxy forwards to localhost:8040
// In production (Render), VITE_API_URL is set to the backend Render URL
export const API_ROOT = import.meta.env.VITE_API_URL || "";
const API_BASE = API_ROOT + "/api";

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = "GET", token, body } = {}) {
  const headers = { ...authHeaders(token) };
  const options = { method, headers };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }

  return data;
}

export const api = {
  ssoLogin: (supabaseToken) =>
    request("/auth/sso", { method: "POST", body: { supabase_token: supabaseToken } }),

  // Local-testing-only shortcut - the backend 404s this unless it's running
  // against the local SQLite DB, so it's structurally inert against a real
  // deployment regardless of whether this button is visible.
  devLogin: (email) => request("/dev/login", { method: "POST", body: { email } }),

  getMyGoals: (token) => request("/goals", { token }),

  createGoal: (token, payload) => request("/goals", { method: "POST", token, body: payload }),

  editGoal: (token, goalId, payload) =>
    request(`/goals/${goalId}`, { method: "PATCH", token, body: payload }),

  deleteGoal: (token, goalId) => request(`/goals/${goalId}`, { method: "DELETE", token }),

  setGoalCompletion: (token, goalId, isCompleted) =>
    request(`/goals/${goalId}/completion`, { method: "PATCH", token, body: { is_completed: isCompleted } }),

  addGoalLog: (token, goalId, payload) =>
    request(`/goals/${goalId}/logs`, { method: "POST", token, body: payload }),

  reviewGoal: (token, goalId, payload) =>
    request(`/goals/${goalId}/review`, { method: "POST", token, body: payload }),

  ownerAck: (token, goalId, actionId, notes) =>
    request(`/goals/${goalId}/review/${actionId}/owner-ack`, { method: "POST", token, body: { notes } }),

  getTeam: (token) => request("/team", { token }),

  getMemberGoals: (token, email) => request(`/team/${encodeURIComponent(email)}/goals`, { token }),

  getGoalsOverview: (token) => request("/admin/goals-overview", { token }),

  // Manual stand-in for the daily flag-check cron (paid-tier only on Render).
  // Idempotent - the server's renotify window stops a second click re-emailing.
  runFlagCheck: (token) => request("/admin/flag-check", { method: "POST", token }),

  // Leadership preview: one person's whole dashboard (goals + tasks) resolved
  // against their own visibility. Read-only - mints no token for them.
  // Flat roster for the "view as" picker - cheap, unlike getGoalsOverview.
  getOrgPeople: (token) => request("/admin/people", { token }),

  viewAs: (token, email) => request(`/admin/view-as/${encodeURIComponent(email)}`, { token }),

  // Switch into someone's account (write-capable). Restricted server-side to
  // settings.ACT_AS_ADMIN_EMAIL; the returned token carries impersonated_by.
  actAs: (token, email) => request(`/admin/act-as/${encodeURIComponent(email)}`, { method: "POST", token }),

  getObservations: (token, email) => request(`/observations/${encodeURIComponent(email)}`, { token }),

  getTasksForGoal: (token, goalId) => request(`/goals/${goalId}/tasks`, { token }),

  getGoalOptions: (token, email) => request(`/tasks/goal-options?email=${encodeURIComponent(email)}`, { token }),

  getReviewerAssignments: (token) => request("/admin/reviewer-assignments", { token }),

  putReviewerAssignment: (token, payload) =>
    request("/admin/reviewer-assignments", { method: "PUT", token, body: payload }),

  getTasks: (token) => request("/tasks", { token }),

  createTask: (token, payload) => request("/tasks", { method: "POST", token, body: payload }),

  editTask: (token, taskId, payload) =>
    request(`/tasks/${taskId}`, { method: "PATCH", token, body: payload }),

  setTaskCompletion: (token, taskId, isCompleted) =>
    request(`/tasks/${taskId}/completion`, { method: "PATCH", token, body: { is_completed: isCompleted } }),

  deleteTask: (token, taskId) => request(`/tasks/${taskId}`, { method: "DELETE", token }),

  postponeTaskWeek: (token, taskId) => request(`/tasks/${taskId}/postpone-week`, { method: "POST", token }),

  addTaskNote: (token, taskId, note) =>
    request(`/tasks/${taskId}/notes`, { method: "POST", token, body: { note } }),

  searchStaff: (token, query, location) =>
    request(`/staff/search?q=${encodeURIComponent(query)}${location ? `&location=${encodeURIComponent(location)}` : ""}`, { token }),
};
