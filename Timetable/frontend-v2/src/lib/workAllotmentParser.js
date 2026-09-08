import * as XLSX from "xlsx";

// Parses the "Work Allotment" tab of the Build New planning workbook - a
// flat sheet, one row per (teacher, subject, grade+section[, periods/week]),
// confirmed by the user 2026-08-04 as the preferred replacement for the old
// Python app's WORK ALLOTMENT.xlsx (one tab per subject, teacher rows
// scanned for grade+section tokens - Timetable/backend/app/excel_import.py::
// parse_subject_tab) - simpler to prepare fresh than reusing that multi-tab
// layout. This is also why Build New no longer resolves "who teaches what"
// from staff_roles.teaching_sections: that data turned out to be essentially
// unpopulated in practice, so the user supplies it directly in this sheet
// instead. staff_roles is still used for teacher-name auto-provisioning and
// the Class Teacher (period 0) assignment - just not this mapping.
//
// Header row (any column order, matched case-insensitively):
//   Teacher Name | Subject | Grade Section | Periods Per Week (optional)
// "Grade Section" accepts multiple codes in one cell, separated by commas/
// semicolons/whitespace (e.g. "6A, 6B" or "6A 7B") - each token must look
// like a grade number followed by a section letter ("6A", "10C").

const GRADE_SECTION_TOKEN = /^(\d{1,2})([A-Za-z]+)$/;

const TEACHER_HEADERS = ["teacher name", "teacher", "name of teacher", "name of the teacher"];
const SUBJECT_HEADERS = ["subject"];
const GRADE_SECTION_HEADERS = ["grade section", "grade+section", "grade & section", "grade/section", "class", "class assigned", "section"];
const PERIODS_HEADERS = ["periods per week", "periods/week", "periods", "no of periods", "no. of periods"];

function normalizeHeader(h) {
  return (h ?? "").toString().trim().toLowerCase();
}

function findColumn(headerRow, candidates) {
  for (let i = 0; i < headerRow.length; i++) {
    if (candidates.includes(normalizeHeader(headerRow[i]))) return i;
  }
  return -1;
}

export function parseWorkAllotmentWorkbook(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: true });
  return parseWorkAllotment(rows);
}

export function parseWorkAllotment(rows) {
  if (!rows.length) return { assignments: [], warnings: ["Work Allotment sheet is empty"] };

  const headerRow = rows[0] || [];
  const teacherCol = findColumn(headerRow, TEACHER_HEADERS);
  const subjectCol = findColumn(headerRow, SUBJECT_HEADERS);
  const gradeSectionCol = findColumn(headerRow, GRADE_SECTION_HEADERS);
  const periodsCol = findColumn(headerRow, PERIODS_HEADERS);

  if (teacherCol === -1 || subjectCol === -1 || gradeSectionCol === -1) {
    throw new Error(
      'Work Allotment sheet needs "Teacher Name", "Subject", and "Grade Section" columns in its header row.'
    );
  }

  const warnings = [];
  const assignments = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const teacherName = (row[teacherCol] ?? "").toString().trim();
    const subject = (row[subjectCol] ?? "").toString().trim();
    const gradeSectionRaw = (row[gradeSectionCol] ?? "").toString().trim();
    const periods = periodsCol !== -1 ? row[periodsCol] : null;

    if (!teacherName && !subject && !gradeSectionRaw) continue; // blank row
    if (!teacherName || !subject || !gradeSectionRaw) {
      warnings.push(`Row ${r + 1}: missing teacher name, subject, or grade+section - skipped`);
      continue;
    }

    const tokens = gradeSectionRaw.split(/[,;\s]+/).filter(Boolean);
    let anyValid = false;
    for (const tok of tokens) {
      const m = GRADE_SECTION_TOKEN.exec(tok);
      if (!m) {
        warnings.push(`Row ${r + 1}: "${tok}" isn't a valid grade+section code - skipped`);
        continue;
      }
      anyValid = true;
      assignments.push({
        teacherName,
        subject,
        gradeNum: parseInt(m[1], 10),
        section: m[2].toUpperCase(),
        periodsPerWeek: typeof periods === "number" ? Math.trunc(periods) : null,
      });
    }
    if (!anyValid) warnings.push(`Row ${r + 1}: no valid grade+section codes found for "${teacherName}" - skipped`);
  }

  return { assignments, warnings };
}
