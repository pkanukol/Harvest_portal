// In local dev, VITE_API_URL is empty → requests go to "/" → Vite proxy forwards to localhost:8000
// In production (Render), VITE_API_URL is set to the backend Render URL
const API_BASE = (import.meta.env.VITE_API_URL || "") + "/api";

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = "GET", token, body, formData } = {}) {
  const headers = { ...authHeaders(token) };
  const options = { method, headers };

  if (formData) {
    options.body = formData;
  } else if (body !== undefined) {
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
  login: (email, password) =>
    request("/auth/login", { method: "POST", body: { email, password } }),

  getTeachers: (token, location) =>
    request(`/users/teachers${location ? `?location=${encodeURIComponent(location)}` : ""}`, { token }),

  getDashboard: (token, location) =>
    request(`/dashboard?location=${encodeURIComponent(location)}`, { token }),

  getObservation: (token, obsId) =>
    request(`/observations/${obsId}`, { token }),

  getTeacherObservations: (token, teacherId) =>
    request(`/observations/teacher/${teacherId}`, { token }),

  createObservation: (token, payload) =>
    request("/observations", { method: "POST", token, body: payload }),

  uploadImage: (token, observationId, file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request(`/observations/${observationId}/images`, {
      method: "POST",
      token,
      formData,
    });
  },

  updateDraft: (token, observationId, payload) =>
    request(`/observations/${observationId}/draft`, {
      method: "PUT",
      token,
      body: payload,
    }),

  finaliseObservation: (token, observationId) =>
    request(`/observations/${observationId}/finalise`, {
      method: "POST",
      token,
    }),

  saveRemarks: (token, observationId, teacher_remarks) =>
    request(`/observations/${observationId}/remarks`, {
      method: "POST",
      token,
      body: { teacher_remarks },
    }),

  compareProgress: (token, teacher_id) =>
    request("/dashboard/compare", {
      method: "POST",
      token,
      body: { teacher_id },
    }),

  getAlerts: (token) => request("/alerts", { token }),

  ssoLogin: (supabaseToken) =>
    request("/auth/sso", { method: "POST", body: { supabase_token: supabaseToken } }),

  getAuditList: (token, location) =>
    request(`/dashboard/audit-list?location=${encodeURIComponent(location)}`, { token }),

  getSubjectSummary: (token, location, subject) =>
    request(`/dashboard/subject-summary?location=${encodeURIComponent(location)}&subject=${encodeURIComponent(subject)}`, { token }),
};
