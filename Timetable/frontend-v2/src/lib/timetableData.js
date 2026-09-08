import { fetchStaffByBranch } from "./staffRoles";

// staff_roles is the only teacher identity now, and it is reached through an
// RPC on a different client - so a slot's teacher name can no longer be
// embedded with PostgREST's `teacher:teachers(name)`. Resolve it in JS from
// the branch's staff rows instead, falling back to the SST's
// unmatched_teacher_name for people an uploaded file named who have no
// staff_roles row at all.
async function teacherNameById(branch) {
  const staff = await fetchStaffByBranch(branch);
  return new Map(staff.map((r) => [r.id, r.name]));
}
// Fetches the plain-data shape scheduler.js's generate() expects, straight
// from Project A via PostgREST embedded selects (no RPC needed - these are
// all plain reads, already confirmed open to the publishable key).

// PostgREST silently caps any request at 1000 rows unless you page through
// with .range() - it does NOT error, it just returns the first 1000 with no
// indication anything was cut off. Root cause of a real bug found live
// 2026-08-04: `section_subject_teachers` for one real academic year had
// grown to 1163 rows (historical duplicate-row accumulation - see
// uploadCommit.js's firstMatch() comment), so `fetchGeneratorInputs`'s
// unpaginated fetch silently dropped the last 163 - any timetable_slot
// referencing one of those missing rows rendered as subject "-- none --"
// with the teacher name still showing (since teacher_id comes from a
// separate query), which is exactly what made "the second SPORTS teacher I
// just added" and "so many periods missing in grade 3 and above" both look
// like data/UI bugs when the underlying rows were actually fine. Every
// list query in this file that could plausibly cross 1000 rows for a real
// school (not just today's data) goes through this helper now.
async function fetchAllRows(buildQuery, pageSize = 1000) {
  let rows = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows = rows.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

export async function listAcademicYears(client, location) {
  const { data, error } = await client
    .from("tt_academic_years")
    .select("id, label, location, is_active, rules_text")
    .eq("location", location)
    .order("label");
  if (error) throw error;
  return data;
}

// Resolves a user-typed label to an academic_years row for this branch,
// creating one if none matches yet - lets Upload/Build New offer "give it a
// label, same label overwrites that year, a new label starts a fresh one"
// instead of only ever picking from a fixed pre-existing list. Matched
// case-insensitively so "2026-27" and "2026-27 " typos don't spawn dupes.
// New rows default is_active=false - this app has no in-app activate/
// deactivate action (existing views just list every year for the branch and
// let the user pick), so a fresh label never silently displaces whatever is
// currently flagged active elsewhere.
export async function getOrCreateAcademicYear(client, location, label) {
  const trimmed = label.trim();
  const { data: existing, error: selError } = await client
    .from("tt_academic_years")
    .select("id, label, location, is_active, rules_text")
    .eq("location", location)
    .ilike("label", trimmed)
    .maybeSingle();
  if (selError) throw selError;
  if (existing) return { year: existing, created: false };

  const { data: created, error: insError } = await client
    .from("tt_academic_years")
    .insert({ location, label: trimmed, is_active: false })
    .select("id, label, location, is_active, rules_text")
    .single();
  if (insError) throw insError;
  return { year: created, created: true };
}

// existingSlots comes back with is_manual_override so the caller can decide
// how to simulate a wipe (a real generate() run deletes every non-manual
// slot before recomputing - see scheduler.js's module comment).
export async function fetchGeneratorInputs(client, academicYearId) {
  const [{ data: timing, error: timingError }, grades] = await Promise.all([
    client.from("tt_timing_configs").select("periods_per_day, schedule").eq("academic_year_id", academicYearId).maybeSingle(),
    fetchAllRows(() =>
      client.from("tt_grades").select("id, name, order_index").eq("academic_year_id", academicYearId).order("order_index")
    ),
  ]);
  if (timingError) throw timingError;

  const gradeIds = grades.map((g) => g.id);

  const [gsps, sections] = await Promise.all([
    fetchAllRows(() =>
      client
        .from("tt_grade_subject_periods")
        .select("id, grade_id, periods_per_week, subject_label, subject_code, combo_id, grade:tt_grades(name, order_index)")
        .eq("academic_year_id", academicYearId)
    ),
    fetchAllRows(() =>
      client.from("tt_sections").select("id, grade_id, name").in("grade_id", gradeIds.length ? gradeIds : [-1])
    ),
  ]);

  const sectionIds = sections.map((s) => s.id);

  const [ssts, allSlots] = await Promise.all([
    fetchAllRows(() =>
      client
        .from("tt_section_subject_teachers")
        .select("id, section_id, grade_subject_period_id, teacher_id, unmatched_teacher_name")
        .in("section_id", sectionIds.length ? sectionIds : [-1])
    ),
    fetchAllRows(() =>
      client
        .from("tt_timetable_slots")
        .select(
          "id, section_id, day_of_week, period_number, teacher_id, section_subject_teacher_id, is_manual_override, " +
            "section_subject_teacher:tt_section_subject_teachers(grade_subject_period_id, unmatched_teacher_name)"
        )
        .eq("academic_year_id", academicYearId)
    ),
  ]);

  // subject_label lives directly on the grade_subject_period row now, so the
  // old `subject:subjects(raw_name)` embed is gone - Timetable no longer owns
  // a subjects table, and public.subjects (the shared catalogue) has no FK
  // from here to embed through.
  //
  // The nested {subject:{raw_name}} shape is rebuilt for the callers, because
  // it is also the shape the in-memory generator model uses
  // (workAllotmentCrossReference.js builds it directly) - scheduler.js,
  // TimetableViewer, timetableEdits and BuildNewTimetable all read
  // gsp.subject.raw_name and none of them should have to care where it came
  // from. subject_code / combo_id ride along for anything that needs the
  // catalogue link.
  const gspsForCallers = gsps.map((g) => ({
    ...g,
    subject: { raw_name: g.subject_label },
  }));

  // No teacher lookup here any more: staff_roles is the only teacher
  // identity, it is reached through an RPC rather than this client, and the
  // caller already holds the branch's staff rows. It builds the id -> name
  // map itself (see TimetableViewer's teacherNameById).
  return {
    periodsPerDay: timing?.periods_per_day || 8,
    schedule: timing?.schedule || [],
    grades,
    gradeSubjectPeriods: gspsForCallers,
    sections,
    sectionSubjectTeachers: ssts,
    allSlots,
  };
}

// Port of crud.py's get_all_lessons - every teacher-assigned lesson for the
// whole week, the shape substitution.js's computeSuggestions() expects.
// subject prefers component_label (e.g. "Hindi") over the raw combo subject
// name (e.g. "Hindi/Kannada/Sanskrit (Lang II)") so subject-matching in tier
// 2 works on the specific component actually taught - mirrors the Python
// original's `(sst.component_label if sst else None) or (...)` fallback chain.
export async function fetchAllLessons(client, academicYearId, branch) {
  const [data, nameById] = await Promise.all([
    fetchAllRows(() =>
      client
        .from("tt_timetable_slots")
        .select(
          "day_of_week, period_number, teacher_id, " +
            "section:tt_sections(name, grade:tt_grades(name)), " +
            "section_subject_teacher:tt_section_subject_teachers(component_label, unmatched_teacher_name, grade_subject_period:tt_grade_subject_periods(subject_label))"
        )
        .eq("academic_year_id", academicYearId)
    ),
    teacherNameById(branch),
  ]);

  // The old `.not("teacher_id","is",null)` filter can't be used any more: a
  // slot taught by somebody with no staff_roles row carries a null teacher_id
  // and its name on the SST, and those lessons still count. Filter on the
  // RESOLVED name instead, which keeps the same "lessons with a teacher"
  // contract callers rely on.
  return data
    .map((slot) => ({
      day_of_week: slot.day_of_week,
      period_number: slot.period_number,
      grade_name: slot.section?.grade?.name ?? null,
      section_name: slot.section?.name ?? null,
      subject:
        slot.section_subject_teacher?.component_label ||
        slot.section_subject_teacher?.grade_subject_period?.subject_label ||
        "?",
      teacher_name:
        nameById.get(slot.teacher_id) ??
        slot.section_subject_teacher?.unmatched_teacher_name ??
        null,
    }))
    .filter((l) => l.teacher_name);
}

// Port of crud.py's get_teacher_week - one teacher's placed lessons for the
// week, kept as a display view (subject and component_label stay separate,
// unlike fetchAllLessons's folded single "subject" field).
export async function fetchTeacherWeek(client, academicYearId, teacherId) {
  const data = await fetchAllRows(() =>
    client
      .from("tt_timetable_slots")
      .select(
        "day_of_week, period_number, " +
          "section:tt_sections(name, grade:tt_grades(name)), " +
          "section_subject_teacher:tt_section_subject_teachers(component_label, grade_subject_period:tt_grade_subject_periods(subject_label))"
      )
      .eq("academic_year_id", academicYearId)
      .eq("teacher_id", teacherId)
  );

  return data.map((slot) => ({
    day_of_week: slot.day_of_week,
    period_number: slot.period_number,
    grade_name: slot.section?.grade?.name ?? null,
    section_name: slot.section?.name ?? null,
    subject: slot.section_subject_teacher?.grade_subject_period?.subject_label ?? null,
    component_label: slot.section_subject_teacher?.component_label ?? null,
  }));
}

// Like fetchAllLessons, but keeps slots with no teacher assigned - resource
// periods (Library, Yoga, ...) are frequently placed without a dedicated
// teacher on record, and a "which class has this room right now" view still
// needs to show those.
export async function fetchAllPlacements(client, academicYearId, branch) {
  const [data, nameById] = await Promise.all([
    fetchAllRows(() =>
      client
        .from("tt_timetable_slots")
        .select(
          "day_of_week, period_number, teacher_id, " +
            "section:tt_sections(name, grade:tt_grades(name)), " +
            "section_subject_teacher:tt_section_subject_teachers(component_label, unmatched_teacher_name, grade_subject_period:tt_grade_subject_periods(subject_label))"
        )
        .eq("academic_year_id", academicYearId)
    ),
    teacherNameById(branch),
  ]);

  // Unlike fetchAllLessons this deliberately KEEPS teacher-less slots -
  // resource periods (Library, Yoga, ...) are often placed with nobody on
  // record, and "which class has this room now" still needs them.
  return data.map((slot) => ({
    day_of_week: slot.day_of_week,
    period_number: slot.period_number,
    grade_name: slot.section?.grade?.name ?? null,
    section_name: slot.section?.name ?? null,
    subject:
      slot.section_subject_teacher?.component_label ||
      slot.section_subject_teacher?.grade_subject_period?.subject_label ||
      "?",
    teacher_name:
      nameById.get(slot.teacher_id) ??
      slot.section_subject_teacher?.unmatched_teacher_name ??
      null,
  }));
}

// Just the bell schedule (day headers), for views that only need to render
// a grid and don't need the full generator-inputs fetch.
export async function fetchTimingSchedule(client, academicYearId) {
  const { data, error } = await client
    .from("tt_timing_configs")
    .select("periods_per_day, schedule")
    .eq("academic_year_id", academicYearId)
    .maybeSingle();
  if (error) throw error;
  return data?.schedule || [];
}

// Full timing_configs row (periods_per_day + schedule) for a specific
// academic year, or null if none exists yet - used by TimingSetup to
// pre-fill its form when editing an already-configured year.
export async function fetchTimingConfig(client, academicYearId) {
  const { data, error } = await client
    .from("tt_timing_configs")
    .select("periods_per_day, schedule")
    .eq("academic_year_id", academicYearId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Upserts (by academic_year_id) the timing_configs row - re-editable at any
// time, same "correct timing without touching placed data" intent as the
// old timing.txt re-upload had.
export async function saveTimingConfig(client, academicYearId, { periodsPerDay, schedule }) {
  const { data: existing, error: selError } = await client
    .from("tt_timing_configs")
    .select("id")
    .eq("academic_year_id", academicYearId)
    .maybeSingle();
  if (selError) throw selError;

  if (existing) {
    const { error } = await client
      .from("tt_timing_configs")
      .update({ periods_per_day: periodsPerDay, schedule })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await client
      .from("tt_timing_configs")
      .insert({ academic_year_id: academicYearId, periods_per_day: periodsPerDay, schedule });
    if (error) throw error;
  }
}

// Teacher names for a branch, from staff_roles - the substitution planner's
// candidate pool. Was a query against Project A's `teachers` table filtered
// by location + is_active; staff_roles is the only teacher identity now, and
// the RPC already returns active rows for the branch.
export async function listActiveTeacherNames(client, branch) {
  const staff = await fetchStaffByBranch(branch);
  return staff.map((r) => r.name).filter(Boolean);
}
