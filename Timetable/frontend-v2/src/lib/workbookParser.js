import * as XLSX from "xlsx";

// Port of Timetable/backend/app/timetable_workbook.py. Parses an
// already-generated timetable export (.xlsx) - one grid per grade+section on
// a single sheet: a section-header row ("1A"), a period/time header row,
// then one row per day with "Subject\nTeacher" in each cell.
//
// This is the single riskiest port in the migration (see the plan doc): the
// most heuristic-dependent code, runs only once or twice a year. Every
// function below mirrors its Python counterpart 1:1 on purpose - diff
// against timetable_workbook.py before changing behavior here.
//
// openpyxl's merged_cells needs data_only mode (non-read_only); SheetJS's
// default read already exposes cached values (cell.v) the same way, and
// `sheet["!merges"]` is the merged-range equivalent - no special mode needed.

const TIME_RANGE_RE = /(\d{1,2}[:.]\d{2})\s*[-–]\s*(\d{1,2}[:.]\d{2})/;
const SECTION_HEADER_RE = /^\s*(?:grade\s+)?(\d{1,2})\s*([A-Za-z]{1,3})\s*$/i;
const DAY_NAMES = {
  mon: 0, monday: 0,
  tue: 1, tues: 1, tuesday: 1,
  wed: 2, wednesday: 2,
  thu: 3, thur: 3, thurs: 3, thursday: 3,
  fri: 4, friday: 4,
};
const BREAK_WORD_RE = /break|lunch/i;
// "CT" is a common shorthand for the class-teacher period in real workbooks
// (confirmed by the user 2026-08-03) - matched as a whole word so it doesn't
// false-positive on an actual subject/period label that merely contains
// those two letters.
const CLASS_TEACHER_WORD_RE = /class\s*teacher|^ct$/i;
const NAME_RE = /^[A-Za-z][A-Za-z.\s]*$/;
const EMPTY_SLOT_TEXTS = new Set(["unassigned", "free", "tbd", "-", "--", "n/a", "na"]);

function normalizeTime(raw) {
  const m = raw.trim().match(/^(\d{1,2})[:.](\d{2})/);
  if (!m) return raw.trim();
  return `${String(parseInt(m[1], 10)).padStart(2, "0")}:${m[2]}`;
}

function sheetDims(sheet) {
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  return { maxRow: range.e.r + 1, maxCol: range.e.c + 1 };
}

function cellText(sheet, row, col) {
  const cell = sheet[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })];
  return cell === undefined || cell.v === undefined || cell.v === null
    ? ""
    : String(cell.v).trim();
}

function cellRawValue(sheet, row, col) {
  const cell = sheet[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })];
  return cell === undefined ? null : cell.v;
}

// merges: sheet["!merges"], each {s:{r,c}, e:{r,c}}, 0-indexed.
function mergeSpan(merges, row, col) {
  const r0 = row - 1;
  const c0 = col - 1;
  for (const rng of merges) {
    if (rng.s.r <= r0 && r0 <= rng.e.r && rng.s.c <= c0 && c0 <= rng.e.c) {
      return {
        minRow: rng.s.r + 1, maxRow: rng.e.r + 1,
        minCol: rng.s.c + 1, maxCol: rng.e.c + 1,
      };
    }
  }
  return null;
}

// A day/period cell is either two lines ("Subject" then "Teacher") or one
// line with "Subject - Teacher" / "Subject-Teacher". Some cells are
// subject-only with no teacher shown at all (e.g. "Yoga") - a null teacher
// there is fine, not an error.
//
// confident=false means no separator was found at all (e.g. "History /
// Civics Senthil", subject and teacher run together with just a space) -
// resolveAmbiguousCells() runs a second pass on these using teacher names
// already confirmed elsewhere in the same workbook.
function splitSubjectTeacher(cellValue) {
  const lines = String(cellValue)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { subject: null, teacher: null, confident: true };
  if (lines.length > 1) {
    return { subject: lines[0], teacher: lines.slice(1).join(" "), confident: true };
  }
  const line = lines[0];
  const dashSpaceIdx = line.indexOf(" - ");
  if (dashSpaceIdx !== -1) {
    return {
      subject: line.slice(0, dashSpaceIdx).trim(),
      teacher: line.slice(dashSpaceIdx + 3).trim(),
      confident: true,
    };
  }
  const dashIdx = line.indexOf("-");
  if (dashIdx !== -1) {
    return {
      subject: line.slice(0, dashIdx).trim(),
      teacher: line.slice(dashIdx + 1).trim(),
      confident: true,
    };
  }
  return { subject: line, teacher: null, confident: false };
}

// Some cells hold TWO alternating assignments instead of one, e.g.
// "Math - Priyanka (1&3) / STEM (2&4)" - Math/Priyanka happens on the 1st
// and 3rd occurrence of that weekday in the month, STEM on the 2nd and 4th.
// Per the user's explicit call (2026-08-03): this is NOT modeled as real
// scheduling data (no week-parity column, no date-aware logic) - both
// alternatives are placed as an ordinary same-period combo assignment
// (exactly like a 2-teacher SPA/PE period), so neither teacher's time
// silently looks free elsewhere; which one actually happens on a given
// week is left for staff to track manually. The "(1&3)"/"(2&4)" hint is
// kept, folded into the subject name ("Math (Wk 1&3)"), for readability
// only - the teacher name itself stays clean so it still resolves to a
// real Project A teacher and participates in clash detection normally.
// Only the common "(1&3)" / "(2&4)" shape is recognized; anything else - a
// different week pairing, more than two alternatives, no trailing "(n&n)"
// on one side - falls through to the normal single-assignment path and
// surfaces as an ambiguous-teacher-cell warning instead of being guessed at.
const ALT_PART_RE = /^(.*?)\s*\(\s*(\d)\s*&\s*(\d)\s*\)\s*$/;

function weeksLabel(a, b) {
  const nums = new Set([Number(a), Number(b)]);
  if (nums.size === 2 && nums.has(1) && nums.has(3)) return "1&3";
  if (nums.size === 2 && nums.has(2) && nums.has(4)) return "2&4";
  return undefined;
}

function splitAlternatingCell(cellValue) {
  const parts = String(cellValue).trim().split(" / ");
  if (parts.length !== 2) return null;

  const parsed = [];
  for (const part of parts) {
    const m = ALT_PART_RE.exec(part.trim());
    if (!m) return null;
    const label = weeksLabel(m[2], m[3]);
    if (label === undefined) return null;
    const { subject, teacher } = splitSubjectTeacher(m[1].trim());
    if (!subject) return null;
    parsed.push({ subject: `${subject} (Wk ${label})`, teacher });
  }
  return parsed;
}

function findLabelRow(sheet, startRow, endRow, labelWord) {
  for (let r = startRow; r < endRow; r++) {
    for (let c = 1; c <= 3; c++) {
      if (cellText(sheet, r, c).toLowerCase() === labelWord) return r;
    }
  }
  return null;
}

function splitTeachers(teacherLine, warnings, gradeName, section, subject) {
  if (!teacherLine) return [null];
  const parts = teacherLine.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return [teacherLine.trim()];
  if (parts.every((p) => NAME_RE.test(p))) return parts;
  warnings.push(
    `${gradeName}${section} ${subject}: teacher cell '${teacherLine}' contains '/' but doesn't look like ` +
      `multiple names - kept as a single teacher name, please verify`
  );
  return [teacherLine.trim()];
}

function findSectionHeaders(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: true });
  const headers = [];
  rows.forEach((row, idx) => {
    const r = idx + 1;
    const nonEmpty = [];
    row.forEach((v, cIdx) => {
      if (v !== null && v !== "") nonEmpty.push([cIdx + 1, v]);
    });
    if (nonEmpty.length === 1) {
      const m = SECTION_HEADER_RE.exec(String(nonEmpty[0][1]).trim());
      if (m) headers.push([r, parseInt(m[1], 10), m[2].toUpperCase()]);
    }
  });
  return headers;
}

// Two layouts are supported:
//   1. Two separate rows labeled "Timing" and "Period" (time ranges in one,
//      "1st period"/"BREAK"/"LUNCH" aligned under them in the other).
//   2. One combined row per column, number/label and time range together,
//      optionally on two lines within the cell.
// Returns {columns, classTeacherTime, headerRow} - day rows start right
// after headerRow.
function buildPeriodColumns(sheet, startRow, endRow, maxCol, warnings, gradeName, section) {
  const timingRow = findLabelRow(sheet, startRow, endRow, "timing");
  const periodRow = findLabelRow(sheet, startRow, endRow, "period");

  if (timingRow !== null && periodRow !== null) {
    const columns = {};
    let classTeacherTime = null;
    for (let c = 1; c <= maxCol; c++) {
      const timeText = cellText(sheet, timingRow, c);
      const m = TIME_RANGE_RE.exec(timeText);
      if (!m) continue;
      const start = normalizeTime(m[1]);
      const end = normalizeTime(m[2]);
      const label = cellText(sheet, periodRow, c);
      if (CLASS_TEACHER_WORD_RE.test(label)) {
        // The class-teacher slot (often labeled "CT") is period 0 - a real,
        // assignable period in the schedule, not just metadata on the side.
        classTeacherTime = [start, end];
        columns[c] = { kind: "period", number: 0, start, end };
      } else if (BREAK_WORD_RE.test(label)) {
        columns[c] = { kind: "break", label: label || "Break", start, end };
      } else {
        const numM = /\d+/.exec(label);
        if (!numM) {
          warnings.push(
            `${gradeName}${section}: time range '${timeText}' at column ${c} has no matching period ` +
              `number in the Period row ('${label}'), skipped that column`
          );
          continue;
        }
        columns[c] = { kind: "period", number: parseInt(numM[0], 10), start, end };
      }
    }
    return { columns, classTeacherTime, headerRow: Math.max(timingRow, periodRow) };
  }

  let combinedRow = null;
  let bestCount = 0;
  for (let r = startRow; r < endRow; r++) {
    let count = 0;
    for (let c = 1; c <= maxCol; c++) {
      if (TIME_RANGE_RE.test(cellText(sheet, r, c))) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      combinedRow = r;
    }
  }
  if (combinedRow === null) return { columns: {}, classTeacherTime: null, headerRow: null };

  const columns = {};
  let classTeacherTime = null;
  for (let c = 1; c <= maxCol; c++) {
    const text = cellText(sheet, combinedRow, c);
    const m = TIME_RANGE_RE.exec(text);
    if (!m) continue;
    const start = normalizeTime(m[1]);
    const end = normalizeTime(m[2]);
    let label = text.slice(0, m.index).trim();
    if (!label && combinedRow > startRow) {
      // Some layouts put the period/break label ("P1", "BREAK", "LUNCH") in
      // the row directly above the bare time-range row instead of in the
      // same cell - fall back to that row, same column.
      label = cellText(sheet, combinedRow - 1, c);
    }
    if (CLASS_TEACHER_WORD_RE.test(label)) {
      // The class-teacher slot (often labeled "CT") is period 0 - a real,
      // assignable period in the schedule, not just metadata on the side.
      classTeacherTime = [start, end];
      columns[c] = { kind: "period", number: 0, start, end };
    } else if (BREAK_WORD_RE.test(label) || BREAK_WORD_RE.test(text)) {
      columns[c] = { kind: "break", label: label || "Break", start, end };
    } else {
      const numM = /\d+/.exec(label);
      if (!numM) {
        warnings.push(
          `${gradeName}${section}: found a time range '${text}' at column ${c} with no period number, skipped that column`
        );
        continue;
      }
      columns[c] = { kind: "period", number: parseInt(numM[0], 10), start, end };
    }
  }
  return { columns, classTeacherTime, headerRow: combinedRow };
}

function parseSectionBlock(sheet, merges, startRow, endRow, maxCol, gradeNum, section, warnings) {
  const gradeName = `Grade ${gradeNum}`;
  const lessons = [];

  const { columns, classTeacherTime, headerRow } = buildPeriodColumns(
    sheet, startRow, endRow, maxCol, warnings, gradeName, section
  );
  if (headerRow === null) {
    warnings.push(`${gradeName}${section}: no period-timing row found (expected 'H:MM - H:MM' cells), skipped`);
    return { lessons, timing: null };
  }

  if (!Object.values(columns).some((v) => v.kind === "period")) {
    warnings.push(`${gradeName}${section}: timing row found but no period columns in it`);
    return { lessons, timing: null };
  }

  const dayRows = [];
  for (let r = headerRow + 1; r < endRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const text = cellText(sheet, r, c).toLowerCase();
      if (text in DAY_NAMES) {
        dayRows.push([r, DAY_NAMES[text]]);
        break;
      }
    }
  }
  if (!dayRows.length) {
    warnings.push(`${gradeName}${section}: no day rows found (expected Mon/Tue/Wed/Thu/Fri labels)`);
    return { lessons, timing: null };
  }

  // Some layouts give each day TWO rows - a subject row (with the day name)
  // and a teacher row directly below it, aligned by column - instead of
  // combining "Subject\nTeacher" into one cell. Can't detect this from a
  // fixed row-gap between day rows: a combo/parallel period (e.g. a
  // 4-teacher language combo) stacks extra row-pairs UNDER one of the
  // columns, stretching that day's block unevenly. Instead, check whether
  // the row directly below each day row's populated period cells is ALSO
  // populated, for most of those cells.
  //
  // A day row whose very next row is ANOTHER day row (no gap between days -
  // a compact grid with one line per day, "Subject - Teacher" combined in
  // each cell) gives no real signal here and must be skipped: that "next
  // row" is really the following day's own populated cells, not a teacher
  // continuation of this one, and counting it would make even a fully
  // combined-cell file look 100% populated-below. Real-file bug fixed
  // 2026-08-03: a dense Attibele upload with no gap between day rows was
  // misdetected as separate-teacher-row, splicing the NEXT day's whole
  // "Subject - Teacher" cell in as if it were THIS day's teacher name.
  const dayRowSet = new Set(dayRows.map(([r]) => r));
  let usesSeparateTeacherRow = false;
  {
    let populatedCells = 0;
    let populatedBelow = 0;
    for (const [row] of dayRows) {
      if (dayRowSet.has(row + 1)) continue;
      for (const [colKey, meta] of Object.entries(columns)) {
        if (meta.kind !== "period") continue;
        const col = parseInt(colKey, 10);
        const v = cellRawValue(sheet, row, col);
        if (v === null || !String(v).trim()) continue;
        populatedCells++;
        if (cellText(sheet, row + 1, col)) populatedBelow++;
      }
    }
    usesSeparateTeacherRow = populatedCells > 0 && populatedBelow / populatedCells > 0.5;
  }

  for (const [dayRowIdx, [row, dayIdx]] of dayRows.entries()) {
    // A combo/parallel period (e.g. a 4-teacher language combo) in this
    // layout repeats the SAME subject text down further (subject, teacher)
    // row-pairs in the SAME column, rather than a horizontal merge across
    // period columns - walk down each period column within this day's row
    // span collecting every pair until the subject text runs out.
    if (usesSeparateTeacherRow) {
      const blockEnd = dayRowIdx + 1 < dayRows.length ? dayRows[dayRowIdx + 1][0] : endRow;
      for (const [colKey, meta] of Object.entries(columns)) {
        if (meta.kind !== "period") continue;
        const col = parseInt(colKey, 10);
        for (let r = row; r < blockEnd; r += 2) {
          const cellValue = cellRawValue(sheet, r, col);
          if (cellValue === null || !String(cellValue).trim()) break;
          const subject = String(cellValue).trim();
          if (EMPTY_SLOT_TEXTS.has(subject.toLowerCase())) break;
          const teacher = cellText(sheet, r + 1, col) || null;
          lessons.push({
            day_of_week: dayIdx, period_number: meta.number,
            grade_name: gradeName, section_name: section,
            subject, teacher_name: teacher,
          });
        }
      }
      continue;
    }

    for (const [colKey, meta] of Object.entries(columns)) {
      if (meta.kind !== "period") continue;
      const col = parseInt(colKey, 10);

      const cellValue = cellRawValue(sheet, row, col);
      if (cellValue === null || !String(cellValue).trim()) continue;

      let periodNumbers = [meta.number];
      const rng = mergeSpan(merges, row, col);
      if (rng && rng.minRow === rng.maxRow && rng.maxCol > rng.minCol && rng.minCol === col) {
        periodNumbers = [];
        for (let c2 = rng.minCol; c2 <= rng.maxCol; c2++) {
          if (columns[c2] && columns[c2].kind === "period") periodNumbers.push(columns[c2].number);
        }
        periodNumbers.sort((a, b) => a - b);
      }

      const alt = splitAlternatingCell(cellValue);
      if (alt) {
        for (const pnum of periodNumbers) {
          for (const a of alt) {
            lessons.push({
              day_of_week: dayIdx, period_number: pnum,
              grade_name: gradeName, section_name: section,
              subject: a.subject, teacher_name: a.teacher,
            });
          }
        }
        continue;
      }

      const { subject, teacher, confident } = splitSubjectTeacher(cellValue);
      if (!subject || EMPTY_SLOT_TEXTS.has(subject.toLowerCase())) continue;

      // A day row's own cell in the class-teacher (period 0) column
      // typically just repeats the label ("CT") rather than naming a
      // subject+teacher - that's not an ambiguous cell to warn about, it's
      // simply "no separate subject here, this period belongs to the class
      // teacher" (who can still be assigned via the normal cell editor).
      if (!teacher && CLASS_TEACHER_WORD_RE.test(subject)) {
        for (const pnum of periodNumbers) {
          lessons.push({
            day_of_week: dayIdx, period_number: pnum,
            grade_name: gradeName, section_name: section,
            subject: "Class Teacher", teacher_name: null,
          });
        }
        continue;
      }

      if (!confident) {
        // A cell can list multiple subjects that happen in parallel with no
        // teacher named for any of them (e.g. a shared activity period where
        // each student picks one) - "Yoga/Karate", "Dance/Music/Drums/
        // Keyboard/Guitar" - confirmed by the user 2026-08-03: treat these
        // the same as any other combo/parallel period (like Hindi/Sanskrit
        // or a 2-teacher SPA slot), one lesson per subject, so each can be
        // assigned its own teacher later via the normal cell editor -
        // instead of being kept as one indivisible "ambiguous" subject.
        const parallelSubjects = subject
          .split("/")
          .map((s) => s.trim())
          .filter(Boolean);
        if (parallelSubjects.length >= 2) {
          for (const pnum of periodNumbers) {
            for (const s of parallelSubjects) {
              lessons.push({
                day_of_week: dayIdx, period_number: pnum,
                grade_name: gradeName, section_name: section,
                subject: s, teacher_name: null,
              });
            }
          }
          continue;
        }

        // No "-" or newline separator at all - resolved in
        // resolveAmbiguousCells() once every confidently-split cell's
        // teacher names are known, rather than guessing here with no
        // evidence.
        for (const pnum of periodNumbers) {
          lessons.push({
            day_of_week: dayIdx, period_number: pnum,
            grade_name: gradeName, section_name: section,
            subject, teacher_name: null, _unresolved_raw: subject,
          });
        }
        continue;
      }

      const teacherNames = splitTeachers(teacher, warnings, gradeName, section, subject);
      for (const pnum of periodNumbers) {
        for (const teacherName of teacherNames) {
          lessons.push({
            day_of_week: dayIdx, period_number: pnum,
            grade_name: gradeName, section_name: section,
            subject, teacher_name: teacherName,
          });
        }
      }
    }
  }

  const timing = {
    class_teacher_start: classTeacherTime ? classTeacherTime[0] : "08:00",
    class_teacher_end: classTeacherTime ? classTeacherTime[1] : "08:10",
    periods_per_day: Object.values(columns).filter((v) => v.kind === "period").length,
    schedule: Object.values(columns).map((v) =>
      v.kind === "break"
        ? { type: "break", label: v.label, start: v.start, end: v.end }
        : { type: "period", number: v.number, start: v.start, end: v.end }
    ),
  };
  return { lessons, timing };
}

// A combo/parallel period (e.g. "Hindi/Sanskrit" with two different teachers
// at the same day+period) produces one lesson entry PER TEACHER sharing that
// period, all with identical day_of_week/period_number - so periods/week
// must count DISTINCT (day, period) slots, not raw lesson entries, or a
// 2-teacher combo silently doubles the count.
function deriveAllocation(lessons, headers, warnings) {
  const gradeOrder = {};
  const gradeSections = {};
  for (const [, gradeNum, section] of headers) {
    const gradeName = `Grade ${gradeNum}`;
    gradeOrder[gradeName] = gradeNum;
    if (!gradeSections[gradeName]) gradeSections[gradeName] = {};
    if (!(section in gradeSections[gradeName])) {
      gradeSections[gradeName][section] = { class_teacher_name: null };
    }
  }

  const sectionSubjectSlots = new Map(); // "grade||subject" -> Map(section -> Set("day,period"))
  const subjectTeachers = new Map(); // "grade||subject||section" -> Set(teacherName)

  for (const l of lessons) {
    const slotsKey = `${l.grade_name}||${l.subject}`;
    if (!sectionSubjectSlots.has(slotsKey)) sectionSubjectSlots.set(slotsKey, new Map());
    const bySection = sectionSubjectSlots.get(slotsKey);
    if (!bySection.has(l.section_name)) bySection.set(l.section_name, new Set());
    bySection.get(l.section_name).add(`${l.day_of_week},${l.period_number}`);

    if (l.teacher_name) {
      const teachersKey = `${l.grade_name}||${l.subject}||${l.section_name}`;
      if (!subjectTeachers.has(teachersKey)) subjectTeachers.set(teachersKey, new Set());
      subjectTeachers.get(teachersKey).add(l.teacher_name);
    }
  }

  const gradesOut = [];
  const sortedGradeNames = Object.keys(gradeOrder).sort((a, b) => gradeOrder[a] - gradeOrder[b]);

  for (const gradeName of sortedGradeNames) {
    const sections = gradeSections[gradeName];
    const subjectsForGrade = [
      ...new Set(
        [...sectionSubjectSlots.keys()]
          .filter((k) => k.startsWith(`${gradeName}||`))
          .map((k) => k.slice(gradeName.length + 2))
      ),
    ].sort();

    const subjectsOut = [];
    for (const subject of subjectsForGrade) {
      const bySection = sectionSubjectSlots.get(`${gradeName}||${subject}`);
      const perSectionCounts = {};
      for (const [sec, slots] of bySection.entries()) perSectionCounts[sec] = slots.size;

      const counts = Object.values(perSectionCounts);
      const freq = new Map();
      for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1);
      let periodsPerWeek = counts[0];
      let bestFreq = -1;
      for (const [c, f] of freq.entries()) {
        if (f > bestFreq) {
          bestFreq = f;
          periodsPerWeek = c;
        }
      }

      for (const [sec, cnt] of Object.entries(perSectionCounts)) {
        if (cnt !== periodsPerWeek) {
          warnings.push(
            `${gradeName}${sec} '${subject}': ${cnt} period(s)/week placed, differs from this grade's ` +
              `typical ${periodsPerWeek} - using ${periodsPerWeek} for the allocation`
          );
        }
      }

      const assignments = {};
      let isCombo = false;
      for (const sec of Object.keys(sections)) {
        const teachersKey = `${gradeName}||${subject}||${sec}`;
        const teachers = [...(subjectTeachers.get(teachersKey) || new Set())].sort();
        if (teachers.length > 1) isCombo = true;
        assignments[sec] = teachers.length
          ? teachers.map((t) => ({ component_label: subject, teacher_name: t }))
          : [{ component_label: subject, teacher_name: null }];
      }

      subjectsOut.push({
        raw_name: subject, periods_per_week: periodsPerWeek,
        is_combo: isCombo, assignments,
      });
    }

    gradesOut.push({
      name: gradeName, order_index: gradeOrder[gradeName],
      sections, subjects: subjectsOut,
    });
  }

  return gradesOut;
}

// Resolves every lesson with an _unresolved_raw (a cell with no "-" or
// newline separator, e.g. "History / Civics Senthil") by checking whether
// its raw text ends with a teacher name already confirmed elsewhere in the
// same workbook via a normal hyphen/newline split. Longest known name wins,
// and only a whole-word suffix counts (never splits mid-word). Falls back to
// the unsplit subject with no teacher, plus a warning, if nothing matches.
//
// Note: tie-breaking between two equal-length candidate names is not
// guaranteed to match the Python original bit-for-bit (it iterates a Python
// `set`, whose string iteration order is hash-randomized per run and was
// never actually deterministic there either) - a real, deterministic
// tie-break here is a strict improvement, not a regression.
function resolveAmbiguousCells(lessons, warnings) {
  const knownNames = [
    ...new Set(
      lessons
        .filter((l) => l.teacher_name && !("_unresolved_raw" in l))
        .map((l) => l.teacher_name)
    ),
  ].sort((a, b) => b.length - a.length);

  for (const l of lessons) {
    if (!("_unresolved_raw" in l)) continue;
    const raw = l._unresolved_raw;
    delete l._unresolved_raw;
    if (raw == null) continue;

    let match = null;
    for (const name of knownNames) {
      if (name.length >= raw.length) continue;
      const prefix = raw.slice(0, raw.length - name.length);
      if (raw.toLowerCase().endsWith(name.toLowerCase()) && prefix && /\s$/.test(prefix)) {
        match = name;
        break;
      }
    }
    if (match) {
      l.subject = raw.slice(0, raw.length - match.length).trim();
      l.teacher_name = match;
    } else {
      warnings.push(
        `${l.grade_name}${l.section_name}: could not find a teacher name at the end of '${raw}' (no ` +
          `separator, and no matching name found elsewhere in the workbook) - kept as the whole subject ` +
          `with no teacher; assign one manually`
      );
    }
  }
}

// Returns {grades, timing, lessons, warnings} - "grades"/"timing" match the
// shape the Python parser produced (so the eventual commit RPC's input shape
// can stay the same); "lessons" is the flat placed-lesson list additionally
// needed to place timetable_slots rows / feed substitution suggestions.
export function parseGeneratedWorkbook(xlsxBytes) {
  const workbook = XLSX.read(xlsxBytes, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const merges = sheet["!merges"] || [];
  const { maxRow, maxCol } = sheetDims(sheet);

  const headers = findSectionHeaders(sheet);
  if (!headers.length) {
    throw new Error(
      "Could not find any grade+section header (e.g. '1A', '10C') alone on its own row - " +
        "expected each class's timetable to start with a row containing just the section name"
    );
  }
  const headersSorted = [...headers].sort((a, b) => a[0] - b[0]);
  const boundaries = [...headersSorted, [maxRow + 1, null, null]];

  const warnings = [];
  const lessons = [];
  let timing = null;

  for (let i = 0; i < headersSorted.length; i++) {
    const [startRow, gradeNum, section] = boundaries[i];
    const endRow = boundaries[i + 1][0];
    const { lessons: blockLessons, timing: blockTiming } = parseSectionBlock(
      sheet, merges, startRow, endRow, maxCol, gradeNum, section, warnings
    );
    lessons.push(...blockLessons);
    if (blockTiming && timing === null) timing = blockTiming;
  }

  if (timing === null) {
    throw new Error("Could not find a period/time header row (e.g. '9:05 - 9:45') in any class's timetable");
  }

  resolveAmbiguousCells(lessons, warnings);

  const grades = deriveAllocation(lessons, headersSorted, warnings);
  return { grades, timing, lessons, warnings };
}

// Variant of parseGeneratedWorkbook for a workbook laid out as one SHEET per
// class ("Grade 1A", "1A", "10C" as sheet/tab names) instead of one sheet
// with every class's block stacked vertically. Each sheet is treated as a
// single section block spanning the whole sheet (rows 1..maxRow) - reuses
// the exact same buildPeriodColumns/parseSectionBlock/resolveAmbiguousCells/
// deriveAllocation logic as the single-sheet layout, since a section block's
// internal parsing doesn't care what's above or below it. A sheet whose name
// doesn't look like a grade+section (e.g. a "Notes" or "Summary" tab) is
// skipped with a warning rather than aborting the whole import.
export function parseMultiSheetWorkbook(xlsxBytes) {
  const workbook = XLSX.read(xlsxBytes, { type: "array" });

  const warnings = [];
  const lessons = [];
  const headers = [];
  let timing = null;

  for (const sheetName of workbook.SheetNames) {
    const m = SECTION_HEADER_RE.exec(sheetName.trim());
    if (!m) {
      warnings.push(`Sheet '${sheetName}': name doesn't look like a grade+section (e.g. '1A') - skipped`);
      continue;
    }
    const gradeNum = parseInt(m[1], 10);
    const section = m[2].toUpperCase();
    headers.push([sheetName, gradeNum, section]);

    const sheet = workbook.Sheets[sheetName];
    const merges = sheet["!merges"] || [];
    const { maxRow, maxCol } = sheetDims(sheet);

    const { lessons: blockLessons, timing: blockTiming } = parseSectionBlock(
      sheet, merges, 1, maxRow + 1, maxCol, gradeNum, section, warnings
    );
    lessons.push(...blockLessons);
    if (blockTiming && timing === null) timing = blockTiming;
  }

  if (!headers.length) {
    throw new Error(
      "Could not find any sheet named like a grade+section (e.g. '1A', '10C', 'Grade 1A') in this workbook"
    );
  }
  if (timing === null) {
    throw new Error("Could not find a period/time header row (e.g. '9:05 - 9:45') in any sheet");
  }

  resolveAmbiguousCells(lessons, warnings);

  const grades = deriveAllocation(lessons, headers, warnings);
  return { grades, timing, lessons, warnings };
}

// ---------------------------------------------------------------------------
// Optional teacher-details sheet - Name / Email / Class Teacher (which
// section, if any). Everything else is derivable from the timetable export
// itself; a teacher's email (for portal SSO linking) and class-teacher
// section are the only genuinely new information here.
// ---------------------------------------------------------------------------

const HEADER_KEYWORDS = {
  name: ["name"],
  email: ["email"],
  class_teacher: ["class teacher", "classteacher", "class tr", "ct"],
};

function findTeacherDetailsHeader(sheet, maxRow, maxCol) {
  for (let r = 1; r <= Math.min(maxRow, 10); r++) {
    const cells = [];
    for (let c = 1; c <= maxCol; c++) cells.push(cellText(sheet, r, c).toLowerCase());
    if (cells.some((c) => c === "name")) {
      const colByField = {};
      for (const [field, keywords] of Object.entries(HEADER_KEYWORDS)) {
        for (let cIdx = 0; cIdx < cells.length; cIdx++) {
          if (keywords.includes(cells[cIdx])) {
            colByField[field] = cIdx + 1;
            break;
          }
        }
      }
      return { headerRow: r, colByField };
    }
  }
  return { headerRow: null, colByField: {} };
}

export function parseTeacherDetailsSheet(xlsxBytes) {
  const workbook = XLSX.read(xlsxBytes, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const { maxRow, maxCol } = sheetDims(sheet);
  const warnings = [];

  const { headerRow, colByField } = findTeacherDetailsHeader(sheet, maxRow, maxCol);
  if (headerRow === null || !("name" in colByField)) {
    throw new Error("Could not find a header row with a 'Name' column in the teacher details sheet");
  }

  const details = [];
  for (let r = headerRow + 1; r <= maxRow; r++) {
    const name = cellText(sheet, r, colByField.name);
    if (!name) continue;
    const email = "email" in colByField ? cellText(sheet, r, colByField.email) : "";
    const ctText = "class_teacher" in colByField ? cellText(sheet, r, colByField.class_teacher) : "";
    let gradeNum = null;
    let section = null;
    if (ctText) {
      const m = SECTION_HEADER_RE.exec(ctText);
      if (m) {
        gradeNum = parseInt(m[1], 10);
        section = m[2].toUpperCase();
      } else {
        warnings.push(
          `Teacher details: '${name}' has a Class Teacher value '${ctText}' that doesn't look like a ` +
            `grade+section (e.g. '1A') - ignored`
        );
      }
    }
    details.push({
      name, email: email || null,
      class_teacher_grade: gradeNum, class_teacher_section: section,
    });
  }

  if (!details.length) throw new Error("No teacher rows found under the header row");
  return { details, warnings };
}
