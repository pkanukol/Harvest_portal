// In local dev, VITE_API_URL is empty -> requests go to "/" -> Vite proxy forwards to localhost:8030
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

  getPlannerTopics: (token, subject, grade) =>
    request(`/planner/topics?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`, { token }),

  getPowCards: (token) => request("/pow/cards", { token }),

  getPow: (token, id) => request(`/pow/${id}`, { token }),

  createPow: (token, payload) => request("/pow", { method: "POST", token, body: payload }),

  updatePowImplementation: (token, id, payload) =>
    request(`/pow/${id}/implementation`, { method: "PATCH", token, body: payload }),

  saveSmeReview: (token, id, payload) =>
    request(`/pow/${id}/review`, { method: "PUT", token, body: payload }),

  getProgressSummary: (token, subject, grade, teacherEmail) =>
    request(`/progress/summary?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}&teacher_email=${encodeURIComponent(teacherEmail || "")}`, { token }),

  getProgressChart: (token, subject, grade) =>
    request(`/progress/chart?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`, { token }),
};
