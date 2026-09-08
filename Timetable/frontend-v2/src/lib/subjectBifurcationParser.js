import * as XLSX from "xlsx";

// Port of Timetable/backend/app/excel_import.py::parse_sub_bifurcation.
// Substantially simplified vs the original: the Python version also had to
// cross-reference per-subject tabs to resolve teacher names
// (parse_subject_tab / parse_class_teacher / _find_tab_for_subject_component).
// None of that is needed anymore - teacher/section identity now comes from
// staff_roles. This only extracts {gradeNumber: [{subject, periods}, ...]},
// i.e. periods/week per subject per grade.

const MAX_GRADE = 10; // grades 11/12 and INTEGRATED are out of scope for v1

function rowsFromSheet(sheet) {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
  });
}

export function parseSubBifurcationWorkbook(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
  return parseSubBifurcation(rowsFromSheet(sheet));
}

export function parseSubBifurcation(rows) {
  const warnings = [];

  let headerRowIdx = null;
  let headerValues = null;
  for (let r = 0; r < Math.min(9, rows.length); r++) {
    const row = rows[r] || [];
    if (
      row.some(
        (c) => typeof c === "string" && c.trim().toLowerCase().startsWith("grade")
      )
    ) {
      headerRowIdx = r;
      headerValues = row;
      break;
    }
  }
  if (headerRowIdx === null) {
    throw new Error("Could not find the grade header row in SUB BIFURCATION");
  }

  // The grade-pair label row (e.g. "Grades 1-2") is immediately followed by
  // a "Subject" / "No of periods" sub-header row before real data starts.
  let dataStartIdx = headerRowIdx + 1;
  const subHeader = rows[dataStartIdx] || [];
  if (
    subHeader.some(
      (c) => typeof c === "string" && c.trim().toLowerCase() === "subject"
    )
  ) {
    dataStartIdx += 1;
  }

  // Map each column-pair index -> list of grade numbers it covers.
  const pairGrades = {};
  for (let col = 0; col < headerValues.length; col += 2) {
    const label = headerValues[col];
    if (typeof label === "string" && label.trim()) {
      const nums = [...label.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10));
      if (nums.length) pairGrades[col / 2] = nums;
    }
  }

  const gradeSubjects = {};
  for (let g = 1; g <= MAX_GRADE; g++) gradeSubjects[g] = [];

  const maxScanIdx = headerRowIdx + 30;
  for (const [pairIdxStr, grades] of Object.entries(pairGrades)) {
    const pairIdx = parseInt(pairIdxStr, 10);
    if (Math.min(...grades) > MAX_GRADE) continue; // Grades 11&12 / INTEGRATED

    const subjCol = pairIdx * 2;
    const perCol = pairIdx * 2 + 1;
    const entries = [];

    for (let r = dataStartIdx; r < maxScanIdx; r++) {
      const row = rows[r] || [];
      const subject = subjCol < row.length ? row[subjCol] : null;
      const periods = perCol < row.length ? row[perCol] : null;

      if (subject === null && periods === null) continue; // mid-list gap row

      const isValidEntry =
        typeof subject === "string" &&
        subject.trim() &&
        subject.trim().toUpperCase() !== "TOTAL" &&
        typeof periods === "number";

      if (isValidEntry) {
        entries.push({ subject: subject.trim(), periods: Math.trunc(periods) });
        continue;
      }
      break; // sentinel/end-of-list row for this column-pair
    }

    const total = entries.reduce((sum, e) => sum + e.periods, 0);
    if (total !== 40) {
      const gradeLabel = grades.map((g) => `Grade ${g}`).join("/");
      warnings.push(`${gradeLabel}: parsed periods total ${total}, expected 40`);
    }

    for (const g of grades) {
      if (g <= MAX_GRADE) gradeSubjects[g] = entries;
    }
  }

  return { gradeSubjects, warnings };
}
