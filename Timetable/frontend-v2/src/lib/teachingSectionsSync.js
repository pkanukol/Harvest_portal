// Cross-checks an uploaded timetable's parsed (subject, teacher, grade+section)
// assignments against staff_roles.teaching_sections, and builds the update
// payload for anything missing. New logic, no Python original - staff_roles
// was read-only from Timetable's side until this feature; writes here are
// scoped to UPDATE only (append to teaching_sections on an existing row),
// never insert/delete a staff_roles row.

import { normalizeTeacherName } from "./teacherName";

function normalize(s) {
  return (s || "").trim().toLowerCase();
}

// Subject names that mean the same thing despite not matching textually -
// confirmed by the user 2026-08-03: in the lower grades, "EVS" (Environmental
// Studies) IS "Science" - staff_roles records some teachers under one name,
// Timetable's own uploaded-file subject column uses the other, for the same
// real subject/period. Kept as a flat synonym set (not grade-scoped) since
// "Science" as a bare subject name only actually occurs in the lower grades
// here - grades 6-10 already split it into Physics/Biology/Chemistry.
// "SPORTS" is likewise the uploaded file's own label for the same PE/SPA
// periods staff_roles records teachers against by those names (confirmed by
// the user 2026-08-05, found via Mr Prathap - a real Cricket Coach teaching
// SPA/PE for every grade/section - still not showing up for a cell literally
// labeled "SPORTS" despite it being the same class).
const SUBJECT_SYNONYMS = [
  ["evs", "science"],
  ["sports", "spa"],
  ["sports", "pe"],
];

export function subjectsOverlap(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  return SUBJECT_SYNONYMS.some(
    ([x, y]) => (na.includes(x) && nb.includes(y)) || (na.includes(y) && nb.includes(x))
  );
}

export function gradeSectionToken(gradeName, sectionName) {
  const gradeNum = (gradeName.match(/\d+/) || [])[0] || "";
  return `${gradeNum}${sectionName}`;
}

// lessons: workbookParser.js's parsed lessons list. Returns one entry per
// distinct (subject, teacherName, gradeSection) combo actually placed.
export function findDistinctAssignments(lessons) {
  const seen = new Map();
  for (const l of lessons) {
    if (!l.teacher_name) continue;
    const gradeSection = gradeSectionToken(l.grade_name, l.section_name);
    const key = `${l.subject}|${l.teacher_name}|${gradeSection}`;
    if (!seen.has(key)) {
      seen.set(key, { subject: l.subject, teacherName: l.teacher_name, gradeSection });
    }
  }
  return [...seen.values()];
}

// The other app's teaching_sections convention (confirmed by the user): a
// teacher who teaches only ONE subject records it as bare "|1A", "|1B" -
// the subject name before the "|" is left empty. A teacher who teaches MORE
// THAN ONE subject only omits the name for their first subject; every
// subject after that gets its own explicit "Subject|GradeSection" entry.
// So a blank-subject entry only safely means "matches whatever subject is
// being checked" when this teacher has NO other explicitly-labeled subject
// anywhere in their list (i.e. they really do teach just one subject) -
// otherwise the blank entries refer to some OTHER specific (already-used)
// subject we can't identify from the string alone, and claiming a match
// would risk silently skipping a genuinely new subject that hasn't been
// recorded yet. Under-matching here just means one extra confirmation
// prompt; over-matching would hide a real gap.
function entryMatches(raw, subject, gradeSection, hasAnyLabeledSubject) {
  const parts = String(raw).split("|").map((s) => s.trim());
  if (parts.length < 2) return false;
  const [subj, gs] = parts;
  if (gs.toUpperCase() !== gradeSection.toUpperCase()) return false;
  if (subj) return subjectsOverlap(subject, subj);
  return !hasAnyLabeledSubject;
}

// For the inline cell editor's teacher picker: a teacher is worth
// suggesting for a specific subject in a specific grade+section if
// staff_roles actually records them teaching that combination there, or if
// staff_roles has no teaching_sections recorded for them at all yet
// (nothing to rule them out with). A teacher recorded for other
// grades/sections but not this one is correctly excluded - under-suggesting
// just means one extra manual pick.
//
// Unlike entryMatches() above (used for the upload-mapping popup's
// auto-match, a HIGHER-stakes call since it silently marks something as
// already-recorded), a blank entry for the EXACT grade+section being edited
// is treated as a real candidate here even when the teacher has other
// explicitly-labeled subjects elsewhere - e.g. a real case found 2026-08-03:
// "Mr Praveen"'s teaching_sections has a blank "|1A" (his unlabeled first
// subject, actually SPA) alongside an explicit "PE|1A" for the same
// section; the stricter upload-matching rule correctly can't prove the
// blank means SPA, but excluding him from the SUGGESTION list entirely just
// makes a real assignment hard to find - the worst case here is one
// unhelpful extra name in a search box, not a silent wrong auto-match.
export function teacherTeachesSubjectInSection(staffRow, subjectRawName, gradeSection) {
  const entries = staffRow?.teaching_sections || [];
  if (!entries.length) return true;
  return entries.some((raw) => {
    const parts = String(raw).split("|").map((s) => s.trim());
    if (parts.length < 2) return false;
    const [subj, gs] = parts;
    if (gs.toUpperCase() !== gradeSection.toUpperCase()) return false;
    return subj ? subjectsOverlap(subjectRawName, subj) : true;
  });
}

const TITLE_RE = /^(mr|mrs|ms|miss)\.?\s+/i;

export function stripTitle(name) {
  return (name || "").trim().replace(TITLE_RE, "").trim();
}

function firstWord(name) {
  return (name || "").trim().split(/\s+/)[0] || "";
}

// Resolves an uploaded workbook's raw teacher-name string to a Project A
// teacher option using ONLY the two tiers `checkAssignmentsAgainstStaffRoles`
// below treats as fully certain (exact name, or exact once a leading Ms/Mr/
// Mrs/Miss title is stripped from either side) - safe to auto-apply when
// actually assigning a real teacher_id during commit, unlike the looser
// first-name-only/Levenshtein-fuzzy tiers (which stay suggestion-only,
// surfaced via TeacherMappingModal for the user to confirm explicitly).
// Root-caused 2026-08-04: commitUploadToAcademicYear previously only did a
// byte-exact normalizeTeacherName() comparison, so any file spelling that
// needed even the "certain" title-stripped tier (e.g. "Priyanka N" in the
// file vs "Ms Priyanka N" in staff_roles) silently resolved to no teacher at
// all - invisible for months because the wipe-before-replace bug (see
// uploadCommit.js) meant a fresh commit's poor resolution never actually
// overwrote the old, correctly-assigned data.
export function resolveCertainTeacherOption(rawName, teacherOptions) {
  if (!rawName) return null;
  const exact = normalizeTeacherName(rawName);
  let option = teacherOptions.find((t) => normalizeTeacherName(t.name) === exact);
  if (option) return option;
  const stripped = normalizeTeacherName(stripTitle(rawName));
  return teacherOptions.find((t) => normalizeTeacherName(stripTitle(t.name)) === stripped) || null;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// A looser "probably a spelling variant, not a different word" check than
// exact-firstname-equality - e.g. "Mamta" vs "Mamatha" (a real same-person
// spelling difference between the uploaded file and staff_roles, confirmed
// by the user 2026-08-03). Threshold scales with name length so short names
// still need to be quite close (a 3-letter name tolerates 1 edit, not 3).
function namesAreClose(a, b) {
  const na = normalizeTeacherName(a);
  const nb = normalizeTeacherName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Require the same first 2 letters too, not just a small edit distance -
  // two unrelated 5-letter names (e.g. "Ramya", "Amita") can be within 2
  // edits of "Mamta" purely by coincidence at this length; real spelling
  // variants of the same name (Mamta/Mamatha) always share their opening
  // sound, so this rules out same-length-different-person false positives
  // without rejecting the real case.
  if (na.slice(0, 2) !== nb.slice(0, 2)) return false;
  const threshold = Math.max(1, Math.ceil(Math.min(na.length, nb.length) * 0.3));
  return levenshtein(na, nb) <= threshold;
}

// Whether staffRow has ANY teaching_sections entry for this subject
// (ignoring grade+section) - used only as corroborating evidence for a
// fuzzy name guess, not as a full assignment match on its own. Same
// blank-first-subject convention as entryMatches()/teacherTeachesSubjectInSection:
// a staffRow whose entries are ALL blank teaches only one (unstated)
// subject, so there's nothing more specific to rule the guess out with -
// treated as corroborating.
function staffRowTeachesSubjectAnywhere(staffRow, subject) {
  const entries = staffRow?.teaching_sections || [];
  if (!entries.length) return false;
  const hasAnyLabeledSubject = entries.some((e) => String(e).split("|")[0].trim() !== "");
  if (!hasAnyLabeledSubject) return true;
  return entries.some((raw) => {
    const subj = String(raw).split("|")[0].trim();
    return subj && subjectsOverlap(subject, subj);
  });
}

// staffRows: [{id, name, teaching_sections}] for the selected branch.
// Returns each assignment tagged with whether it already matches a recorded
// teaching_sections entry, and the closest staff_roles row by name (even if
// that row doesn't have the entry yet - the common case is the teacher
// exists but this particular class isn't recorded for them).
//
// Real uploaded workbooks commonly use a shortened form of a teacher's name
// (bare first name, no title) where staff_roles has the full "Ms X Y" -
// name matching here is tiered so this doesn't force a manual pick every
// time for someone already correctly tracked under their full name:
//   1. exact match (unchanged)
//   2. same name once a leading Ms/Mr/Mrs/Miss title is stripped from
//      either side - a title being present/absent essentially never means
//      a different person, so this is treated as fully certain, same as a
//      real exact match (it can clear `matched` on its own).
//   3. only the first name matches (a surname/middle name is missing on
//      the uploaded side, e.g. "Priyanka" for "Ms Priyanka N") - NOT
//      treated as certain (two different real people can share a first
//      name), so it never sets `matched` by itself, but if exactly one
//      staff_roles row has that first name it's still offered as
//      `suggestedStaffRow` so the mapping picker defaults to it instead of
//      "Skip" - confirmed by the user 2026-08-03 rather than guessed at.
//   4. neither of the above matches outright (e.g. "Mamta" vs "Mamatha" -
//      a real spelling difference, confirmed by the user to be the same
//      person), but the name is a close spelling variant AND that
//      staff_roles row already teaches the SAME subject somewhere - the
//      subject match is what makes this safe to suggest despite the name
//      not lining up exactly (per the user's explicit instruction: cross
//      the fuzzy name guess against the subject they're recorded teaching).
//      Same as tier 3, only ever suggested when exactly one staff_roles row
//      qualifies - a genuine ambiguity (e.g. two "Gayathri"s where only one
//      teaches the subject in question resolves cleanly; where both do,
//      neither is guessed at).
export function checkAssignmentsAgainstStaffRoles(assignments, staffRows) {
  const byExactName = new Map(staffRows.map((r) => [normalizeTeacherName(r.name), r]));
  const byNameNoTitle = new Map(staffRows.map((r) => [normalizeTeacherName(stripTitle(r.name)), r]));
  const byFirstNameNoTitle = new Map();
  for (const r of staffRows) {
    const key = normalizeTeacherName(firstWord(stripTitle(r.name)));
    if (!key) continue;
    if (!byFirstNameNoTitle.has(key)) byFirstNameNoTitle.set(key, []);
    byFirstNameNoTitle.get(key).push(r);
  }

  return assignments.map((a) => {
    const nameMatch =
      byExactName.get(normalizeTeacherName(a.teacherName)) ||
      byNameNoTitle.get(normalizeTeacherName(stripTitle(a.teacherName))) ||
      null;

    let suggestedStaffRow = nameMatch;
    if (!nameMatch) {
      const candidates = byFirstNameNoTitle.get(normalizeTeacherName(firstWord(stripTitle(a.teacherName)))) || [];
      if (candidates.length === 1) suggestedStaffRow = candidates[0];
    }
    if (!suggestedStaffRow) {
      const uploadedFirstName = firstWord(stripTitle(a.teacherName));
      const fuzzyCandidates = staffRows.filter(
        (r) =>
          namesAreClose(uploadedFirstName, firstWord(stripTitle(r.name))) &&
          staffRowTeachesSubjectAnywhere(r, a.subject)
      );
      if (fuzzyCandidates.length === 1) suggestedStaffRow = fuzzyCandidates[0];
    }

    const entries = nameMatch?.teaching_sections || [];
    const hasAnyLabeledSubject = entries.some((e) => String(e).split("|")[0].trim() !== "");
    const matched = !!nameMatch && entries.some((raw) => entryMatches(raw, a.subject, a.gradeSection, hasAnyLabeledSubject));
    return { ...a, matched, suggestedStaffRow };
  });
}

// Appends "subject|gradeSection" to staffRow.teaching_sections if not
// already present (case-insensitive on the whole token, since these are
// meant to be exact once written).
export function withAppendedEntry(staffRow, subject, gradeSection) {
  const entry = `${subject}|${gradeSection}`;
  const existing = staffRow.teaching_sections || [];
  if (existing.some((e) => normalize(e) === normalize(entry))) return existing;
  return [...existing, entry];
}
