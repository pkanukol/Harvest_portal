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

  listAcademicYears: (token, location) => request(`/academic-years${qs({ location })}`, { token }),

  listSubjects: (token, academicYearId) => request(`/academic-years/${academicYearId}/subjects`, { token }),

  activateAcademicYear: (token, academicYearId, location) =>
    request(`/academic-years/${academicYearId}/activate${qs({ location })}`, { method: "POST", token }),

  deactivateAcademicYear: (token, academicYearId, location) =>
    request(`/academic-years/${academicYearId}/deactivate${qs({ location })}`, { method: "POST", token }),

  deleteAcademicYear: (token, academicYearId, location) =>
    request(`/academic-years/${academicYearId}${qs({ location })}`, { method: "DELETE", token }),

  importPreview: (token, workbookFile, timingText) => {
    const formData = new FormData();
    formData.append("workbook", workbookFile);
    formData.append("timing_text", timingText);
    return request("/import/preview", { method: "POST", token, formData, timeoutMs: 60000 });
  },

  importPreviewTimetableExport: (token, workbookFile) => {
    const formData = new FormData();
    formData.append("workbook", workbookFile);
    // A full multi-grade school export has a lot more rows/formatting than a
    // small test file, and openpyxl has to load it non-read-only (merged-cell
    // info isn't available in read-only mode) - give this real room.
    return request("/import/preview-timetable-export", { method: "POST", token, formData, timeoutMs: 180000 });
  },

  importPreviewTeacherDetails: (token, workbookFile) => {
    const formData = new FormData();
    formData.append("workbook", workbookFile);
    return request("/import/preview-teacher-details", { method: "POST", token, formData, timeoutMs: 60000 });
  },

  importCommit: (token, label, location, parsed, rulesText, lessons, teacherDetails) =>
    request("/import/commit", {
      method: "POST", token,
      // Committing a full school (grades/sections/subjects/teachers/slots)
      // is a lot of individual writes over a remote DB connection - same
      // reasoning as the existing WORK ALLOTMENT import's generous timeout.
      timeoutMs: 180000,
      body: {
        label, location, parsed, rules_text: rulesText || null,
        lessons: lessons || null, teacher_details: teacherDetails || null,
      },
    }),

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

  createTeacher: (token, location, name, linkedEmail) =>
    request(`/teachers${qs({ location })}`, { method: "POST", token, body: { name, linked_email: linkedEmail || null } }),

  linkTeacherEmail: (token, teacherId, linkedEmail) =>
    request(`/teachers/${teacherId}/linked-email`, { method: "PATCH", token, body: { linked_email: linkedEmail } }),

  renameTeacher: (token, teacherId, name) =>
    request(`/teachers/${teacherId}`, { method: "PATCH", token, body: { name } }),

  deleteTeacher: (token, teacherId, mergeIntoId) =>
    request(`/teachers/${teacherId}${qs({ merge_into: mergeIntoId })}`, { method: "DELETE", token }),

  setClassTeacher: (token, sectionId, teacherId) =>
    request(`/sections/${sectionId}/class-teacher`, { method: "PATCH", token, body: { teacher_id: teacherId } }),

  getSectionSubjectSlots: (token, sectionId) =>
    request(`/sections/${sectionId}/subject-slots`, { token }),

  addSubjectSlot: (token, sectionId, { subjectName, periodsPerWeek, componentLabel, teacherId }) =>
    request(`/sections/${sectionId}/subject-slots`, {
      method: "POST", token,
      body: {
        subject_name: subjectName, periods_per_week: periodsPerWeek || null,
        component_label: componentLabel || null, teacher_id: teacherId || null,
      },
    }),

  renameSubject: (token, subjectId, rawName) =>
    request(`/subjects/${subjectId}`, { method: "PATCH", token, body: { raw_name: rawName } }),

  setSstTeacher: (token, sstId, teacherId) =>
    request(`/section-subject-teachers/${sstId}`, { method: "PATCH", token, body: { teacher_id: teacherId } }),

  substitutionSuggest: (token, payload) =>
    request(`/substitution/suggest`, { method: "POST", token, body: payload, timeoutMs: 30000 }),

  createSubstitution: (token, payload) =>
    request(`/substitutions`, { method: "POST", token, body: payload }),

  listSubstitutions: (token, academicYearId, date, teacherName) =>
    request(`/substitutions${qs({ academic_year_id: academicYearId, date, teacher_name: teacherName })}`, { token }),

  deleteSubstitution: (token, substitutionId) =>
    request(`/substitutions/${substitutionId}`, { method: "DELETE", token }),
};
