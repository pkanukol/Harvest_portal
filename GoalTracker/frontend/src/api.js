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

  getMyGoals: (token) => request("/goals", { token }),

  createGoal: (token, payload) => request("/goals", { method: "POST", token, body: payload }),

  editGoal: (token, goalId, payload) =>
    request(`/goals/${goalId}`, { method: "PATCH", token, body: payload }),

  deleteGoal: (token, goalId) => request(`/goals/${goalId}`, { method: "DELETE", token }),

  addGoalLog: (token, goalId, payload) =>
    request(`/goals/${goalId}/logs`, { method: "POST", token, body: payload }),

  reviewGoal: (token, goalId, payload) =>
    request(`/goals/${goalId}/review`, { method: "POST", token, body: payload }),

  ownerAck: (token, goalId, actionId, notes) =>
    request(`/goals/${goalId}/review/${actionId}/owner-ack`, { method: "POST", token, body: { notes } }),

  upperAck: (token, goalId, actionId, notes) =>
    request(`/goals/${goalId}/review/${actionId}/upper-ack`, { method: "POST", token, body: { notes } }),

  getTeam: (token) => request("/team", { token }),

  getMemberGoals: (token, email) => request(`/team/${encodeURIComponent(email)}/goals`, { token }),

  getReviewerAssignments: (token) => request("/admin/reviewer-assignments", { token }),

  putReviewerAssignment: (token, payload) =>
    request("/admin/reviewer-assignments", { method: "PUT", token, body: payload }),
};
