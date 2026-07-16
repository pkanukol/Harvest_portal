const API_BASE = (import.meta.env.VITE_API_URL || "") + "/api";

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = "GET", token, body, formData, timeoutMs = 20000 } = {}) {
  const headers = { ...authHeaders(token) };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const options = { method, headers, signal: controller.signal };

  if (formData) {
    options.body = formData;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Request timed out — the server didn't respond in time. Please try again.");
    }
    throw new Error("Network error — could not reach the server.");
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }
  return data;
}

function qs(params) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export const api = {
  getActiveYear: (token, location) => request(`/academic-years/active${qs({ location })}`, { token }),

  importPreview: (token, workbookFile, timingText) => {
    const formData = new FormData();
    formData.append("workbook", workbookFile);
    formData.append("timing_text", timingText);
    return request("/import/preview", { method: "POST", token, formData, timeoutMs: 60000 });
  },

  importCommit: (token, label, location, parsed, rulesText) =>
    request("/import/commit", { method: "POST", token, body: { label, location, parsed, rules_text: rulesText || null }, timeoutMs: 60000 }),

  generate: (token, academicYearId, sections) =>
    request(`/academic-years/${academicYearId}/generate${qs({ sections })}`, { method: "POST", token, timeoutMs: 60000 }),

  getGaps: (token, academicYearId) =>
    request(`/academic-years/${academicYearId}/gaps`, { token, timeoutMs: 30000 }),

  generateSelected: (token, academicYearId, targets) =>
    request(`/academic-years/${academicYearId}/generate-selected`, {
      method: "POST", token, body: { targets }, timeoutMs: 60000,
    }),

  saveTimetable: (token, academicYearId) =>
    request(`/academic-years/${academicYearId}/save-timetable`, { method: "POST", token, timeoutMs: 30000 }),

  getSectionTimetable: (token, academicYearId, sectionId) =>
    request(`/timetable/section/${sectionId}${qs({ academic_year_id: academicYearId })}`, { token }),

  getMyWeek: (token, academicYearId) =>
    request(`/timetable/my-week${qs({ academic_year_id: academicYearId })}`, { token }),

  getTeacherWeek: (token, academicYearId, teacherId) =>
    request(`/timetable/teacher/${teacherId}${qs({ academic_year_id: academicYearId })}`, { token }),

  patchSlot: (token, { academicYearId, sectionId, dayOfWeek, periodNumber, force }, sectionSubjectTeacherIds) =>
    request(`/timetable/slot${qs({
      academic_year_id: academicYearId, section_id: sectionId,
      day_of_week: dayOfWeek, period_number: periodNumber, force: !!force,
    })}`, { method: "PATCH", token, body: { section_subject_teacher_ids: sectionSubjectTeacherIds } }),

  listTeachers: (token, location) => request(`/teachers${qs({ location })}`, { token }),

  linkTeacherEmail: (token, teacherId, linkedEmail) =>
    request(`/teachers/${teacherId}/linked-email`, { method: "PATCH", token, body: { linked_email: linkedEmail } }),

  deleteTeacher: (token, teacherId, mergeIntoId) =>
    request(`/teachers/${teacherId}${qs({ merge_into: mergeIntoId })}`, { method: "DELETE", token }),

  setClassTeacher: (token, sectionId, teacherId) =>
    request(`/sections/${sectionId}/class-teacher`, { method: "PATCH", token, body: { teacher_id: teacherId } }),

  getSectionSubjectSlots: (token, sectionId) =>
    request(`/sections/${sectionId}/subject-slots`, { token }),

  setSstTeacher: (token, sstId, teacherId) =>
    request(`/section-subject-teachers/${sstId}`, { method: "PATCH", token, body: { teacher_id: teacherId } }),
};
