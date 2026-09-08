// Logic for the "View timetable" inline cell editor: finding/creating the
// section_subject_teacher a cell edit should point to, detecting teacher
// double-booking across the whole academic year before committing, and
// checking placed periods against the grade's subject-bifurcation
// (grade_subject_periods.periods_per_week). New logic, no Python original.

// pairs: the draft [{gspId, teacherName, sstId}, ...] being saved for ONE
// cell (section+day+period) - the inline editor only ever edits one cell at
// a time, so this only needs to check that single day/period, and only for
// the teacher(s) actually being placed there - never the whole week's
// pre-existing (and possibly already-clashing) schedule.
// allSlots: every timetable_slot for the whole academic year (not just the
//   visible section(s)) - a clash can be with a section not currently shown.
// slotTeacherName: (slot) => teacher name or null. staff_roles is the only
//   teacher identity now and it is not reachable through this client, so the
//   caller resolves each slot's name (staff_roles id, falling back to the
//   SST's unmatched_teacher_name) and passes the resolver in.
// editingSectionId: the section whose cell is being edited - its OWN
//   existing slot at this day/period is being replaced, not a clash with
//   itself.
//
// Returns [{ teacherName, sectionIds: [sectionId, ...] }] - one entry per
// teacher (among those newly placed in this cell) who is already teaching a
// DIFFERENT section at this exact day/period.
export function detectClashesForCell(day, period, pairs, allSlots, slotTeacherName, editingSectionId) {
  const newTeacherNames = [...new Set(pairs.map((p) => p.teacherName).filter(Boolean))];
  if (!newTeacherNames.length) return [];
  const newTeacherKeys = new Set(newTeacherNames.map((t) => t.trim().toLowerCase()));

  const bySection = new Map(); // teacherKey -> Map(sectionId -> teacherName)
  for (const slot of allSlots) {
    if (slot.day_of_week !== day || slot.period_number !== period) continue;
    if (String(slot.section_id) === String(editingSectionId)) continue;
    const teacherName = slotTeacherName(slot);
    if (!teacherName) continue;
    const key = teacherName.trim().toLowerCase();
    if (!newTeacherKeys.has(key)) continue;
    if (!bySection.has(key)) bySection.set(key, new Map());
    bySection.get(key).set(slot.section_id, teacherName);
  }

  const clashes = [];
  for (const teacherName of newTeacherNames) {
    const sections = bySection.get(teacherName.trim().toLowerCase());
    if (sections && sections.size) {
      clashes.push({ teacherName, sectionIds: [...sections.keys()] });
    }
  }
  return clashes;
}

// Finds an existing section_subject_teacher for (sectionId, gspId, teacherId)
// among already-loaded rows, or returns null if one needs to be created.
export function findExistingSST(sectionSubjectTeachers, sectionId, gspId, teacherId, unmatchedName = null) {
  return (
    sectionSubjectTeachers.find(
      (s) =>
        String(s.section_id) === String(sectionId) &&
        String(s.grade_subject_period_id) === String(gspId) &&
        String(s.teacher_id) === String(teacherId) &&
        String(s.unmatched_teacher_name ?? "") === String(unmatchedName ?? "")
    ) || null
  );
}

// Reuses an existing section_subject_teacher row if one already matches
// (section, subject, teacher), else creates it. teacherId may be null - an
// unassigned subject slot, or a grandfathered name with no staff_roles row,
// which is stored as unmatchedName instead. The two are mutually exclusive
// (a check constraint on the table enforces it).
export async function getOrCreateSST(
  client, sectionSubjectTeachers, sectionId, gspId, teacherId, subjectRawName, unmatchedName = null
) {
  const existing = findExistingSST(sectionSubjectTeachers, sectionId, gspId, teacherId, unmatchedName);
  if (existing) return existing.id;
  const { data, error } = await client
    .from("tt_section_subject_teachers")
    .insert({
      section_id: sectionId,
      grade_subject_period_id: gspId,
      component_label: subjectRawName,
      teacher_id: teacherId,
      unmatched_teacher_name: unmatchedName,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

// Compares placed periods/week per subject (distinct day/period slots, same
// distinct-slot counting rule as scheduler.js/workbookParser.js - a combo
// period with 2 teachers must count once, not twice) against
// grade_subject_periods.periods_per_week for one section. Returns
// [{subject, placed, expected}] for every mismatch.
export function checkBifurcationForSection(sectionId, slots, sstById, gspSubjectById, gradeSubjectPeriods, gradeId) {
  const bySubjectSlots = new Map(); // subject -> Set("day,period")
  for (const slot of slots) {
    if (String(slot.section_id) !== String(sectionId)) continue;
    const sst = sstById.get(slot.section_subject_teacher_id);
    if (!sst) continue;
    const subject = gspSubjectById.get(sst.grade_subject_period_id) || "?";
    if (!bySubjectSlots.has(subject)) bySubjectSlots.set(subject, new Set());
    bySubjectSlots.get(subject).add(`${slot.day_of_week},${slot.period_number}`);
  }

  const mismatches = [];
  for (const gsp of gradeSubjectPeriods) {
    if (String(gsp.grade_id) !== String(gradeId)) continue;
    const subject = gsp.subject.raw_name;
    const placed = bySubjectSlots.get(subject)?.size || 0;
    if (placed !== gsp.periods_per_week) {
      mismatches.push({ subject, placed, expected: gsp.periods_per_week });
    }
  }
  return mismatches;
}
