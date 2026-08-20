// In local dev, VITE_API_URL is empty -> requests go to "/" -> Vite proxy forwards to localhost:8030
// In production (Render), VITE_API_URL is set to the backend Render URL
export const API_ROOT = import.meta.env.VITE_API_URL || "";
const API_BASE = API_ROOT + "/api";

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// A stored token the backend rejects (expired at the weekly Monday reset, or
// signed with a SECRET_KEY the server no longer has) used to leave the app
// stuck: every call 401s, and since sign-out lives in the portal there is no
// control here to clear it. So a 401 discards the dead session and sends the
// user back to the portal, which re-enters the app with a fresh ?sso= token.
let recovering = false;

function recoverFromExpiredSession() {
  if (recovering) return;                       // one redirect, not one per failed call
  if (!localStorage.getItem("token")) return;   // never had a session — leave the login view alone
  recovering = true;
  ["token", "user", "real_token", "real_user"].forEach((k) => localStorage.removeItem(k));
  const portalUrl = import.meta.env.VITE_PORTAL_URL || "https://his-academy360.netlify.app";
  window.location.href = portalUrl;
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

  if (response.status === 401) {
    recoverFromExpiredSession();
    throw new Error("Your session has expired — sending you back to the portal to sign in again.");
  }

  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }

  return data;
}

// Multipart sibling of request() — the browser must set its own multipart
// boundary on Content-Type, so unlike request() this deliberately never sets
// that header itself.
async function upload(path, { token, file, fields = {} }) {
  const form = new FormData();
  form.append("file", file);
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") form.append(key, String(value));
  });

  const response = await fetch(`${API_BASE}${path}`, { method: "POST", headers: authHeaders(token), body: form });
  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    recoverFromExpiredSession();
    throw new Error("Your session has expired — sending you back to the portal to sign in again.");
  }

  if (!response.ok) {
    // FastAPI returns a list of field errors for validation failures, a plain
    // string for the ones this app raises deliberately.
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d) => d.msg).join("; ")
      : data.detail;
    throw new Error(detail || "Upload failed");
  }

  return data;
}

export const api = {
  ssoLogin: (supabaseToken) =>
    request("/auth/sso", { method: "POST", body: { supabase_token: supabaseToken } }),

  getPlannerTopics: (token, subject, grade) =>
    request(`/planner/topics?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`, { token }),

  getMe: (token) => request("/me", { token }),

  getTeachers: (token) => request("/teachers", { token }),

  searchStaff: (token, q) => request(`/staff/search?q=${encodeURIComponent(q)}`, { token }),

  viewAs: (token, email) => request("/auth/view-as", { method: "POST", token, body: { email } }),

  getLagging: (token) => request("/progress/lagging", { token }),

  getPlannerInventory: (token) => request("/planner/inventory", { token }),

  // commit=false previews without writing; commit=true imports every grade
  // tab in the workbook, each replacing its own subject+grade. Same call,
  // same file, twice.
  importPlanner: (token, { file, subject, commit }) =>
    upload("/planner/import", {
      token, file,
      fields: { subject, commit: commit ? "true" : "false" },
    }),

  getPowCards: (token, subject, grade) =>
    request(`/pow/cards?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`, { token }),

  getTbsMomAlerts: (token) => request("/pow/tbs-mom-alerts", { token }),

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
