// In local dev, VITE_API_URL is empty -> requests go to "/" -> Vite proxy forwards to localhost:8030
// In production (Render), VITE_API_URL is set to the backend Render URL
export const API_ROOT = import.meta.env.VITE_API_URL || "";
// The school portal is where every session starts: the Curriculum Tracker has
// no login of its own, only the SSO handoff from there. Hard-coded rather than
// read from VITE_PORTAL_URL, because a build that shipped without that variable
// sent an expired session to a page that cannot sign anyone back in.
const PORTAL_URL = "https://elevate360.netlify.app";

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

// The SSO exchange is the way BACK IN, so a 401 from it is a failed login, not
// a dead session. Bouncing to the portal for those loops forever: portal ->
// app -> exchange fails -> portal. Auth endpoints opt out of recovery and
// surface their error instead.
function isAuthPath(path) {
  return path.startsWith("/auth/");
}

function recoverFromExpiredSession(path) {
  if (isAuthPath(path)) return;
  if (recovering) return;                       // one redirect, not one per failed call
  if (!localStorage.getItem("token")) return;   // never had a session — leave the login view alone
  recovering = true;
  ["token", "user", "real_token", "real_user"].forEach((k) => localStorage.removeItem(k));
  window.location.href = PORTAL_URL;
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
    recoverFromExpiredSession(path);
    if (!isAuthPath(path)) {
      throw new Error("Your session has expired — sending you back to the portal to sign in again.");
    }
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
    recoverFromExpiredSession(path);
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

// File downloads: same auth and 401 handling as request(), but the body is a
// binary blob rather than JSON, and the filename comes from the server's
// Content-Disposition so the backend stays the one naming the report.
async function download(path, { token }) {
  const response = await fetch(`${API_BASE}${path}`, { headers: authHeaders(token) });

  if (response.status === 401) {
    recoverFromExpiredSession(path);
    throw new Error("Your session has expired — sending you back to the portal to sign in again.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Download failed");
  }

  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  return { blob: await response.blob(), filename: match ? match[1] : "download.xlsx" };
}

// /api/teachers is the heaviest read on the app (for Leadership it walks every
// staff row and the staff_roles directory) and three screens ask for the same
// answer - the dashboard, Progress Check and Curriculum Overview. Cached per
// session per branch, so navigating between them costs nothing after the first
// look. Keyed by token as well as branch, so a "View as" switch misses the
// cache and re-reads the scope for whoever is being previewed.
const teacherCache = new Map();

export const api = {
  ssoLogin: (supabaseToken) =>
    request("/auth/sso", { method: "POST", body: { supabase_token: supabaseToken } }),

  getPlannerTopics: (token, subject, grade) =>
    request(`/planner/topics?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`, { token }),

  getMe: (token) => request("/me", { token }),

  getTeachers: (token, branch = "") => {
    const key = `${token}|${branch}`;
    if (!teacherCache.has(key)) {
      // The promise is cached, not just the result, so two screens mounting at
      // once share one request instead of racing.
      teacherCache.set(
        key,
        request(`/teachers?branch=${encodeURIComponent(branch)}`, { token })
          .catch((err) => { teacherCache.delete(key); throw err; }),
      );
    }
    return teacherCache.get(key);
  },

  searchStaff: (token, q) => request(`/staff/search?q=${encodeURIComponent(q)}`, { token }),

  viewAs: (token, email) => request("/auth/view-as", { method: "POST", token, body: { email } }),

  getLagging: (token, branch = "") =>
    request(`/progress/lagging?branch=${encodeURIComponent(branch)}`, { token }),

  getBackfill: (token, subject, grade, branch = "") =>
    request(
      `/backfill?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}` +
        `&branch=${encodeURIComponent(branch)}`,
      { token },
    ),

  saveBackfill: (token, payload) => request("/backfill", { method: "POST", token, body: payload }),

  confirmBackfill: (token, payload) =>
    request("/backfill/confirm", { method: "POST", token, body: payload }),

  reopenBackfill: (token, payload) =>
    request("/backfill/reopen", { method: "POST", token, body: payload }),

  getPlannerInventory: (token) => request("/planner/inventory", { token }),

  // commit=false previews without writing; commit=true imports every grade
  // tab in the workbook, each replacing its own subject+grade. Same call,
  // same file, twice.
  importPlanner: (token, { file, subject, commit }) =>
    upload("/planner/import", {
      token, file,
      fields: { subject, commit: commit ? "true" : "false" },
    }),

  getPowCards: (token, subject, grade, branch = "") =>
    request(
      `/pow/cards?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}` +
        `&branch=${encodeURIComponent(branch)}`,
      { token },
    ),

  getTbsMomAlerts: (token) => request("/pow/tbs-mom-alerts", { token }),

  // Where each section of a grade got to, so a new POW starts each one from
  // its own last topic rather than the grade's.
  // The sections a campus runs for a grade - Attibele runs two where Kodathi
  // runs five or six, so the POW form must not offer A-F everywhere.
  getSectionsForGrade: (token, subject, grade, branch = "") =>
    request(
      `/pow/sections?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}` +
        `&branch=${encodeURIComponent(branch)}`,
      { token },
    ),

  getLastSectionPlans: (token, subject, grade, branch = "") =>
    request(
      `/pow/last-plans?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`
        + (branch ? `&branch=${encodeURIComponent(branch)}` : ""),
      { token },
    ),

  downloadCurriculumOverview: (token, subject, grade, branch = "") =>
    download(
      `/pow/overview.xlsx?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}` +
        `&branch=${encodeURIComponent(branch)}`,
      { token },
    ),

  getCurriculumOverview: (token, subject, grade, branch = "") =>
    request(
      `/pow/overview?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}` +
        `&branch=${encodeURIComponent(branch)}`,
      { token },
    ),

  getPow: (token, id) => request(`/pow/${id}`, { token }),

  createPow: (token, payload) => request("/pow", { method: "POST", token, body: payload }),

  updatePowImplementation: (token, id, payload) =>
    request(`/pow/${id}/implementation`, { method: "PATCH", token, body: payload }),

  saveSmeReview: (token, id, payload) =>
    request(`/pow/${id}/review`, { method: "PUT", token, body: payload }),

  getProgressSummary: (token, subject, grade, teacherEmail, discipline = "", branch = "", month = "") =>
    request(
      `/progress/summary?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}` +
        `&teacher_email=${encodeURIComponent(teacherEmail || "")}&discipline=${encodeURIComponent(discipline)}` +
        `&branch=${encodeURIComponent(branch)}&month=${encodeURIComponent(month)}`,
      { token },
    ),

  getAnnualProgress: (token, subject, grade, discipline = "", branch = "") =>
    request(
      `/progress/annual?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}` +
        `&discipline=${encodeURIComponent(discipline)}&branch=${encodeURIComponent(branch)}`,
      { token },
    ),

  // Cumulative year-to-date, month by month — the Full year tab.
  // Grade x subject delivery for one campus - the management report.
  deliveryReport: (token, branch = "") =>
    request(`/progress/report?branch=${encodeURIComponent(branch)}`, { token }),

  // Kodathi against Attibele, grade by grade, for one subject.
  compareBranches: (token, subject, discipline = "") =>
    request(
      `/progress/compare?subject=${encodeURIComponent(subject)}&discipline=${encodeURIComponent(discipline)}`,
      { token },
    ),

  getProgressChart: (token, subject, grade, discipline = "", branch = "") =>
    request(
      `/progress/chart?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}` +
        `&discipline=${encodeURIComponent(discipline)}&branch=${encodeURIComponent(branch)}`,
      { token },
    ),

  // One month, week by week — the This month tab. Empty month means the
  // current one; August can still be read back in September.
  getMonthChart: (token, subject, grade, discipline = "", branch = "", month = "") =>
    request(
      `/progress/month-chart?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}` +
        `&discipline=${encodeURIComponent(discipline)}&branch=${encodeURIComponent(branch)}` +
        `&month=${encodeURIComponent(month)}`,
      { token },
    ),
};
