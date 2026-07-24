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

  getTeachers: (token, location, subject) => {
    const params = new URLSearchParams();
    if (location) params.set("location", location);
    if (subject) params.set("subject", subject);
    const qs = params.toString();
    return request(`/users/teachers${qs ? `?${qs}` : ""}`, { token });
  },

  getDashboard: (token, location) =>
    request(`/dashboard?location=${encodeURIComponent(location)}`, { token }),

  getObservation: (token, obsId) =>
    request(`/observations/${obsId}`, { token }),

  getTeacherObservations: (token, teacherId) =>
    request(`/observations/teacher/${teacherId}`, { token }),

  createObservation: (token, payload) =>
    request("/observations", { method: "POST", token, body: payload }),

  addImageLink: (token, observationId, driveLink) =>
    request(`/observations/${observationId}/images`, {
      method: "POST",
      token,
      body: { drive_link: driveLink },
    }),

  updateDraft: (token, observationId, payload) =>
    request(`/observations/${observationId}/draft`, {
      method: "PUT",
      token,
      body: payload,
    }),

  finaliseObservation: (token, observationId, witnessName = "", witnessDesignation = "") =>
    request(`/observations/${observationId}/finalise`, {
      method: "POST",
      token,
      body: { witness_name: witnessName, witness_designation: witnessDesignation },
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

  getAuditList: (token, location, filters = {}) => {
    const params = new URLSearchParams({ location });
    if (filters.subject) params.set("subject", filters.subject);
    if (filters.grade) params.set("grade", filters.grade);
    if (filters.auditorId) params.set("auditor_id", filters.auditorId);
    if (filters.teacherId) params.set("teacher_id", filters.teacherId);
    if (filters.status) params.set("status", filters.status);
    return request(`/dashboard/audit-list?${params.toString()}`, { token });
  },

  getDashboardFilterOptions: (token, location) =>
    request(`/dashboard/filter-options?location=${encodeURIComponent(location)}`, { token }),

  getSubjectSummary: (token, location, subject) =>
    request(`/dashboard/subject-summary?location=${encodeURIComponent(location)}&subject=${encodeURIComponent(subject)}`, { token }),

  getSmeActivity: (token, location) =>
    request(`/dashboard/sme-activity?location=${encodeURIComponent(location)}`, { token }),

  getObservationCoverage: (token, location) =>
    request(`/dashboard/observation-coverage?location=${encodeURIComponent(location)}`, { token }),

  // --- SPA (Sports / Performing Arts) observations ---
  createSpaObservation: (token, payload) =>
    request("/spa-observations", { method: "POST", token, body: payload }),

  getSpaObservation: (token, obsId) =>
    request(`/spa-observations/${obsId}`, { token }),

  getTeacherSpaObservations: (token, teacherId) =>
    request(`/spa-observations/teacher/${teacherId}`, { token }),

  updateSpaDraft: (token, observationId, payload) =>
    request(`/spa-observations/${observationId}/draft`, { method: "PUT", token, body: payload }),

  finaliseSpaObservation: (token, observationId, payload) =>
    request(`/spa-observations/${observationId}/finalise`, { method: "POST", token, body: payload }),

  getSpaAuditList: (token, location) =>
    request(`/spa-dashboard/audit-list?location=${encodeURIComponent(location)}`, { token }),
};
