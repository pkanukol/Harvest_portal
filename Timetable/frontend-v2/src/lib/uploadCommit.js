// Commits a parsed multi-sheet timetable upload (workbookParser.js's output)
// into a specific, already-existing academic year in Project A. New logic,
// loosely mirrors the old Python app's crud.commit_import + place_generated_slots,
// but simplified: no Timetable-owned teacher table to populate (teacher
// identity is resolved against already-loaded Project A teachers, matched by
// name via staff_roles/teacherOptions).
//
// "Full replace" scope: EVERY timetable_slot for the academic year is wiped
// and rebuilt from the upload, regardless of is_manual_override - confirmed
// by the user 2026-08-03: uploading a new file under the same academic year
// tag means starting that year's placed periods over completely, not
// merging with whatever was there before (which turned out to be nearly
// all flagged manual already, blocking any update at all - see memory).
// Grades/Sections/Subjects/GradeSubjectPeriods/SectionSubjectTeachers are
// still upserted (matched by name/combo, updated in place) rather than
// wholesale deleted - a subject/section that existed before but isn't in
// the new upload is left as-is, not purged; only the day/period placements
// themselves are a full replace.

import { normalizeTeacherName } from "./teacherName";
import {
  fetchSubjectCatalogue,
  fetchSubjectAliases,
  fetchCombosByWorkbookName,
  resolveSubjectCode,
  looksLikeCombo,
} from "./subjectCatalogue";
import { gradeSectionToken, resolveCertainTeacherOption } from "./teachingSectionsSync";

function normalize(s) {
  return (s || "").trim().toLowerCase();
}

// The uploaded workbook's "CT"/Class Teacher (period 0) cell never names a
// teacher - who it is comes from staff_roles.class_sections instead, not
// anything written per-cell. Resolves that lookup once per (subject,
// teacher_name, gradeSection) so both the SST-creation pass and the
// timetable_slots-placement pass agree on the same resolved name.
function resolveTeacherName(rawTeacherName, subjectRawName, gradeName, sectionName, classTeacherNameByGradeSection) {
  if (rawTeacherName) return rawTeacherName;
  if (subjectRawName !== "Class Teacher") return null;
  return classTeacherNameByGradeSection.get(gradeSectionToken(gradeName, sectionName).toUpperCase()) || null;
}

// Real data for years that have been committed to repeatedly (e.g. Attibele
// A2026-27) turned out to have duplicate rows under the same name - grades/
// subjects/GSPs/SSTs each accumulated 2-12 rows sharing a name over many past
// commit attempts (root cause undetermined, likely an earlier version of
// this lookup not finding what a previous run had already created). Any
// `.maybeSingle()` lookup throws "JSON object requested, multiple (or no)
// rows returned" the moment 2+ rows match, which was silently blocking EVERY
// commit against that year - the function threw here, before ever reaching
// the timetable_slots wipe, so nothing downstream ever ran. Confirmed live
// 2026-08-04: `subjects` for academic_year_id=9 had "CS" x7, "Art" x12, "SPA"
// x10, etc. Fixed by tolerating duplicates - deterministically pick the
// lowest id - rather than crashing, so a commit can proceed regardless of
// this pre-existing data mess. Doesn't clean up the duplicates themselves;
// that's a separate, deliberately not-yet-taken step (some may be referenced
// by real placed slots, so blind deletion risks orphaning live data).
async function firstMatch(query) {
  const { data, error } = await query.order("id", { ascending: true }).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function getOrCreateGrade(client, academicYearId, gradeName, orderIndex, cache) {
  if (cache.has(gradeName)) return cache.get(gradeName);
  const existing = await firstMatch(
    client.from("tt_grades").select("id").eq("academic_year_id", academicYearId).eq("name", gradeName)
  );
  if (existing) {
    cache.set(gradeName, existing.id);
    return existing.id;
  }
  const { data: created, error: insError } = await client
    .from("tt_grades")
    .insert({ academic_year_id: academicYearId, name: gradeName, order_index: orderIndex })
    .select("id")
    .single();
  if (insError) throw insError;
  cache.set(gradeName, created.id);
  return created.id;
}

async function getOrCreateSection(client, gradeId, sectionName, cache) {
  const key = `${gradeId}|${sectionName}`;
  if (cache.has(key)) return cache.get(key);
  const existing = await firstMatch(
    client.from("tt_sections").select("id").eq("grade_id", gradeId).eq("name", sectionName)
  );
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }
  const { data: created, error: insError } = await client
    .from("tt_sections")
    .insert({ grade_id: gradeId, name: sectionName })
    .select("id")
    .single();
  if (insError) throw insError;
  cache.set(key, created.id);
  return created.id;
}

// Timetable no longer owns a subjects table, so there is nothing to
// get-or-create on that side any more: the grade_subject_period row itself
// carries subject_label (always), plus subject_code (a soft link into the
// shared public.subjects catalogue) or combo_id. Identity is therefore
// (grade, subject_label) rather than (grade, subject_id).
async function getOrCreateGSP(
  client, academicYearId, gradeId, subjectLabel, periodsPerWeek, cache,
  { subjectCode = null, comboId = null } = {}
) {
  const key = `${gradeId}|${normalize(subjectLabel)}`;
  if (cache.has(key)) return cache.get(key);
  const existing = await firstMatch(
    client.from("tt_grade_subject_periods").select("id").eq("grade_id", gradeId).ilike("subject_label", subjectLabel)
  );
  if (existing) {
    const { error: updError } = await client
      .from("tt_grade_subject_periods")
      .update({ periods_per_week: periodsPerWeek, subject_code: subjectCode, combo_id: comboId })
      .eq("id", existing.id);
    if (updError) throw updError;
    cache.set(key, existing.id);
    return existing.id;
  }
  const { data: created, error: insError } = await client
    .from("tt_grade_subject_periods")
    .insert({
      academic_year_id: academicYearId,
      grade_id: gradeId,
      subject_label: subjectLabel,
      subject_code: subjectCode,
      combo_id: comboId,
      periods_per_week: periodsPerWeek,
    })
    .select("id")
    .single();
  if (insError) throw insError;
  cache.set(key, created.id);
  return created.id;
}

async function getOrCreateSST(client, sectionId, gspId, teacherId, componentLabel, cache, unmatchedName = null, subjectCode = null) {
  const key = `${sectionId}|${gspId}|${teacherId}|${unmatchedName || ""}`;
  if (cache.has(key)) return cache.get(key);
  // .eq("teacher_id", null) sends the literal filter "teacher_id=eq.null",
  // which Postgres tries to parse as an integer and rejects ("invalid input
  // syntax for type integer: null") - .eq() only ever means an actual value
  // comparison, never IS NULL. Needed here because an unresolved teacher
  // name legitimately produces teacherId=null (see resolveTeacherName above).
  let query = client
    .from("tt_section_subject_teachers")
    .select("id")
    .eq("section_id", sectionId)
    .eq("grade_subject_period_id", gspId);
  query = teacherId == null ? query.is("teacher_id", null) : query.eq("teacher_id", teacherId);
  query =
    unmatchedName == null
      ? query.is("unmatched_teacher_name", null)
      : query.eq("unmatched_teacher_name", unmatchedName);
  const existing = await firstMatch(query);
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }
  const { data: created, error: insError } = await client
    .from("tt_section_subject_teachers")
    .insert({
      section_id: sectionId,
      grade_subject_period_id: gspId,
      component_label: componentLabel,
      subject_code: subjectCode,
      teacher_id: teacherId,
      unmatched_teacher_name: unmatchedName,
    })
    .select("id")
    .single();
  if (insError) throw insError;
  cache.set(key, created.id);
  return created.id;
}

// parsed: workbookParser.js's {grades, timing, lessons, warnings}.
// teacherOptions: [{name, teacherId}] - staff_roles-driven (teacherId IS
// staff_roles.id), same shape used by TimetableViewer/GeneratePreview. A
// lesson naming somebody with no staff_roles row keeps that name on the SST's
// unmatched_teacher_name instead of being dropped, and is reported back
// as a warning, rather than blocking the whole commit.
// classTeacherNameByGradeSection: Map "1A" -> teacher name, built by the
// caller from staff_roles.class_sections - used only to fill in the
// Class Teacher (period 0) subject, which the workbook itself never names
// a teacher for.
// teacherNameOverrides: Map normalizeTeacherName(uploaded file's spelling) ->
// real staff_roles name, from TeacherMappingModal confirmations - checked
// BEFORE any automatic name matching, since a user's explicit confirmation
// outranks a guess. Without this, a confirmed mapping only ever updated
// staff_roles.teaching_sections and had literally no effect on which
// teacher_id got assigned here - a real bug found 2026-08-04.
export async function commitUploadToAcademicYear(
  client,
  academicYearId,
  parsed,
  teacherOptions,
  classTeacherNameByGradeSection = new Map(),
  teacherNameOverrides = new Map()
) {
  const warnings = [];
  const gradeCache = new Map();
  const sectionCache = new Map();
  const gspCache = new Map();
  const sstCache = new Map();

  // Subject resolution inputs, loaded once. The catalogue and aliases decide
  // which public.subjects row (if any) a workbook spelling means; the combo
  // map turns a previously-confirmed slash name back into a combo without
  // asking again. Nothing here blocks a commit - an unresolved subject is
  // still placed, by label, and reported as a warning.
  const [catalogue, aliases, combosByWorkbookName] = await Promise.all([
    fetchSubjectCatalogue(),
    fetchSubjectAliases(),
    fetchCombosByWorkbookName(academicYearId),
  ]);

  // -> { subjectCode, comboId } for one workbook subject name.
  function resolveSubject(rawName) {
    const combo = combosByWorkbookName.get((rawName || "").trim().toLowerCase().replace(/\s+/g, " "));
    if (combo) return { subjectCode: null, comboId: combo.id };

    const subjectCode = resolveSubjectCode(rawName, catalogue, aliases);
    if (subjectCode) return { subjectCode, comboId: null };

    warnings.push(
      looksLikeCombo(rawName)
        ? `"${rawName}" looks like a combined period but no combo is defined for it yet - placed by name only.`
        : `"${rawName}" isn't in the subject catalogue and has no alias - placed by name only.`
    );
    return { subjectCode: null, comboId: null };
  }

  // Single teacher-name-to-Project-A-id resolver used by BOTH passes below
  // (SST creation and slot placement) so they can never disagree. Order:
  // explicit user-confirmed override > exact name > title-stripped exact
  // name (the two tiers teachingSectionsSync.js treats as fully certain) -
  // previously this was a byte-exact match only, which silently left most
  // real-world name-spelling variants (e.g. "Priyanka N" in a file vs
  // "Ms Priyanka N" in staff_roles) completely unassigned.
  function resolveTeacherOption(rawName) {
    if (!rawName) return null;
    const overrideName = teacherNameOverrides.get(normalizeTeacherName(rawName));
    return resolveCertainTeacherOption(overrideName || rawName, teacherOptions);
  }

  const gradeIdByName = new Map();
  const sectionIdByKey = new Map(); // "gradeName|sectionName" -> sectionId
  const gspIdByKey = new Map(); // "gradeName|subject" -> gspId

  for (const grade of parsed.grades) {
    const gradeId = await getOrCreateGrade(client, academicYearId, grade.name, grade.order_index, gradeCache);
    gradeIdByName.set(grade.name, gradeId);

    for (const sectionName of Object.keys(grade.sections)) {
      const sectionId = await getOrCreateSection(client, gradeId, sectionName, sectionCache);
      sectionIdByKey.set(`${grade.name}|${sectionName}`, sectionId);
    }

    for (const subj of grade.subjects) {
      const { subjectCode, comboId } = resolveSubject(subj.raw_name);
      const gspId = await getOrCreateGSP(
        client, academicYearId, gradeId, subj.raw_name, subj.periods_per_week, gspCache,
        { subjectCode, comboId }
      );
      gspIdByKey.set(`${grade.name}|${subj.raw_name}`, gspId);

      for (const [sectionName, assignments] of Object.entries(subj.assignments)) {
        const sectionId = sectionIdByKey.get(`${grade.name}|${sectionName}`);
        for (const a of assignments) {
          let teacherId = null;
          let unmatchedName = null;
          const teacherName = resolveTeacherName(
            a.teacher_name,
            subj.raw_name,
            grade.name,
            sectionName,
            classTeacherNameByGradeSection
          );
          if (teacherName) {
            const option = resolveTeacherOption(teacherName);
            if (option) {
              teacherId = option.teacherId;
            } else {
              // Keep the name the file gave us rather than dropping it - see
              // unmatched_teacher_name in project_b_schema.sql.
              unmatchedName = teacherName;
              warnings.push(`"${teacherName}" (${grade.name}${sectionName} ${subj.raw_name}) isn't in staff_roles - kept by name, not linked.`);
            }
          }
          // The component is the specific part this teacher covers ("Hindi"
          // out of a Lang II combo), so it resolves on its own rather than
          // inheriting the combo's code.
          const componentCode = resolveSubjectCode(a.component_label, catalogue, aliases);
          await getOrCreateSST(
            client, sectionId, gspId, teacherId, a.component_label, sstCache, unmatchedName, componentCode
          );
        }
      }
    }
  }

  // Full replace of every slot for this year, including previously
  // manually-edited ones - confirmed by the user 2026-08-03 (a fresh upload
  // under the same academic year is meant to start that year's placements
  // over, not merge with what was there).
  const { error: wipeError } = await client.from("tt_timetable_slots").delete().eq("academic_year_id", academicYearId);
  if (wipeError) throw wipeError;

  const newSlots = [];
  for (const lesson of parsed.lessons) {
    const gspId = gspIdByKey.get(`${lesson.grade_name}|${lesson.subject}`);
    const sectionId = sectionIdByKey.get(`${lesson.grade_name}|${lesson.section_name}`);
    if (!gspId || !sectionId) continue;

    let teacherId = null;
    let unmatchedName = null;
    const teacherName = resolveTeacherName(
      lesson.teacher_name,
      lesson.subject,
      lesson.grade_name,
      lesson.section_name,
      classTeacherNameByGradeSection
    );
    if (teacherName) {
      const option = resolveTeacherOption(teacherName);
      if (option) teacherId = option.teacherId;
      else unmatchedName = teacherName;
    }
    const sstKey = `${sectionId}|${gspId}|${teacherId}|${unmatchedName || ""}`;
    const sstId = sstCache.get(sstKey);
    if (!sstId) continue; // shouldn't happen - every (grade,subject,section,teacher) combo was created above

    newSlots.push({
      academic_year_id: academicYearId,
      section_id: sectionId,
      day_of_week: lesson.day_of_week,
      period_number: lesson.period_number,
      section_subject_teacher_id: sstId,
      teacher_id: teacherId,
      is_manual_override: false,
    });
  }

  if (newSlots.length) {
    const { error: insError } = await client.from("tt_timetable_slots").insert(newSlots);
    if (insError) throw insError;
  }

  return { placedCount: newSlots.length, warnings: [...parsed.warnings, ...warnings] };
}

// Commits a Build New run (staffCrossReference/workAllotmentCrossReference's
// {grades, sections, gradeSubjectPeriods, sectionSubjectTeachers} built from
// local/synthetic ids + scheduler.js's generate() output, both keyed off
// those same local ids) into a specific, already-existing academic year -
// the Build New equivalent of commitUploadToAcademicYear above. New 2026-08-04
// per the user's request that Build New stop being preview-only ("nothing is
// written back") and gain the same label-based create-or-overwrite ability
// as Upload. Same full-replace scope for timetable_slots as the upload path
// (confirmed symmetric by the user - a same-label commit from either tab
// starts that year's placements over).
// teacherOptions: [{name, teacherId}] - staff_roles-driven, same shape used
// everywhere else a teacher name needs resolving to an id.
// built.sectionSubjectTeachers' teacher_id is a NAME string at this point
// (the cross-reference builders work in names), not yet a real id.
export async function commitGeneratedToAcademicYear(client, academicYearId, built, generated, teacherOptions) {
  const warnings = [];
  const gradeCache = new Map();
  const sectionCache = new Map();
  const gspCache = new Map();
  const sstCache = new Map();

  const realGradeIdByLocal = new Map();
  const realSectionIdByLocal = new Map();
  const realGspIdByLocal = new Map();
  const realSstIdByLocal = new Map();
  const subjectNameByLocalGspId = new Map();

  function resolveTeacherId(teacherName) {
    if (!teacherName) return null;
    const option = teacherOptions.find((t) => normalizeTeacherName(t.name) === normalizeTeacherName(teacherName));
    if (option) return option.teacherId;
    warnings.push(`"${teacherName}" isn't in staff_roles - left unassigned.`);
    return null;
  }

  for (const grade of built.grades) {
    const realGradeId = await getOrCreateGrade(client, academicYearId, grade.name, grade.order_index, gradeCache);
    realGradeIdByLocal.set(grade.id, realGradeId);
  }

  for (const section of built.sections) {
    const realGradeId = realGradeIdByLocal.get(section.grade_id);
    if (!realGradeId) continue;
    const realSectionId = await getOrCreateSection(client, realGradeId, section.name, sectionCache);
    realSectionIdByLocal.set(section.id, realSectionId);
  }

  for (const gsp of built.gradeSubjectPeriods) {
    const realGradeId = realGradeIdByLocal.get(gsp.grade_id);
    if (!realGradeId) continue;
    const realGspId = await getOrCreateGSP(
      client, academicYearId, realGradeId, gsp.subject.raw_name, gsp.periods_per_week, gspCache
    );
    realGspIdByLocal.set(gsp.id, realGspId);
    subjectNameByLocalGspId.set(gsp.id, gsp.subject.raw_name);
  }

  // component_label is NOT NULL on section_subject_teachers - Build New has
  // no separate "component" concept the way a combo-subject upload does
  // (Hindi/Kannada each getting their own label), so the subject's own raw
  // name is the label here - matches how a plain (non-combo) uploaded
  // subject's component_label already equals its subject name.
  for (const sst of built.sectionSubjectTeachers) {
    const realSectionId = realSectionIdByLocal.get(sst.section_id);
    const realGspId = realGspIdByLocal.get(sst.grade_subject_period_id);
    if (!realSectionId || !realGspId) continue;
    const teacherId = resolveTeacherId(sst.teacher_id);
    const componentLabel = subjectNameByLocalGspId.get(sst.grade_subject_period_id) || "?";
    const realSstId = await getOrCreateSST(client, realSectionId, realGspId, teacherId, componentLabel, sstCache);
    realSstIdByLocal.set(sst.id, realSstId);
  }

  const { error: wipeError } = await client.from("tt_timetable_slots").delete().eq("academic_year_id", academicYearId);
  if (wipeError) throw wipeError;

  const newSlots = [];
  for (const slot of generated.newSlots) {
    const realSectionId = realSectionIdByLocal.get(slot.section_id);
    const realSstId = realSstIdByLocal.get(slot.section_subject_teacher_id);
    if (!realSectionId || !realSstId) continue;

    newSlots.push({
      academic_year_id: academicYearId,
      section_id: realSectionId,
      day_of_week: slot.day_of_week,
      period_number: slot.period_number,
      section_subject_teacher_id: realSstId,
      teacher_id: resolveTeacherId(slot.teacher_id),
      is_manual_override: false,
    });
  }

  if (newSlots.length) {
    const { error: insError } = await client.from("tt_timetable_slots").insert(newSlots);
    if (insError) throw insError;
  }

  return { placedCount: newSlots.length, warnings: [...built.warnings, ...warnings] };
}

// Creates/updates the Class Teacher (period 0) slot for every section in an
// academic year directly from Timing Setup, rather than depending on the
// uploaded workbook having its own "CT" cell for every day - confirmed by
// the user 2026-08-03: there's no real per-day subject for this period at
// all (it's the same class teacher every day), so it should be generated
// the moment "Include a Class Teacher / Zero Period" is set up, independent
// of any timetable upload. Mon-Fri, 5 slots per section. A subsequent
// "Replace timetable data" run will still regenerate these the same way
// (via commitUploadToAcademicYear's own Class Teacher handling, if the
// uploaded workbook has a CT column) - both paths resolve the same teacher
// from the same staff_roles.class_sections source, so they can't disagree.
// Existing manually-edited period-0 slots (is_manual_override=true) are
// left untouched, same convention as everywhere else in this app.
// teacherOptions: [{name, teacherId}] - the same staff_roles-driven,
// branch-scoped list used everywhere else. The class teacher's name comes
// from staff_roles.class_sections, so it resolves against the same rows it
// came from; the not-found branch below is a data-integrity guard, not the
// normal path.
export async function ensureClassTeacherPeriod(client, academicYearId, staffRows, teacherOptions) {
  const warnings = [];
  const classTeacherNameByToken = new Map();
  for (const r of staffRows) {
    const cs = r.class_sections;
    const tokens = Array.isArray(cs) ? cs : cs ? [cs] : [];
    for (const tok of tokens) classTeacherNameByToken.set(String(tok).trim().toUpperCase(), r.name);
  }

  const { data: grades, error: gradesError } = await client
    .from("tt_grades")
    .select("id, name")
    .eq("academic_year_id", academicYearId);
  if (gradesError) throw gradesError;
  if (!grades.length) return { placedCount: 0, warnings };

  const { data: sections, error: sectionsError } = await client
    .from("tt_sections")
    .select("id, grade_id, name")
    .in("grade_id", grades.map((g) => g.id));
  if (sectionsError) throw sectionsError;

  const gspCache = new Map();
  const sstCache = new Map();
  let placedCount = 0;

  for (const grade of grades) {
    // "Class Teacher" is period 0 - the 08:00-08:10 homeroom slot from
    // timing_configs, during which the class teacher is genuinely occupied
    // (so it must be a real placed slot, countable by clash detection). It is
    // not an academic subject and the catalogue has no row for it, hence
    // subject_code stays null: a label-only grade_subject_period.
    const gspId = await getOrCreateGSP(client, academicYearId, grade.id, "Class Teacher", 5, gspCache);

    for (const section of sections.filter((s) => s.grade_id === grade.id)) {
      const token = gradeSectionToken(grade.name, section.name).toUpperCase();
      const teacherName = classTeacherNameByToken.get(token) || null;
      let teacherId = null;
      if (teacherName) {
        const option = teacherOptions.find((t) => normalizeTeacherName(t.name) === normalizeTeacherName(teacherName));
        if (option) {
          teacherId = option.teacherId;
        } else {
          warnings.push(`Class teacher "${teacherName}" (${token}) isn't in staff_roles for this branch - period left unassigned.`);
        }
      } else {
        warnings.push(`No class teacher recorded in staff_roles for ${token} - period created unassigned.`);
      }

      const sstId = await getOrCreateSST(client, section.id, gspId, teacherId, "Class Teacher", sstCache);

      const { data: existingSlots, error: slotsError } = await client
        .from("tt_timetable_slots")
        .select("id, day_of_week, is_manual_override")
        .eq("section_id", section.id)
        .eq("period_number", 0);
      if (slotsError) throw slotsError;
      const existingByDay = new Map(existingSlots.map((s) => [s.day_of_week, s]));

      for (let day = 0; day <= 4; day++) {
        const existing = existingByDay.get(day);
        if (existing?.is_manual_override) continue; // respect manual edits
        if (existing) {
          const { error: updError } = await client
            .from("tt_timetable_slots")
            .update({ section_subject_teacher_id: sstId, teacher_id: teacherId, is_manual_override: false })
            .eq("id", existing.id);
          if (updError) throw updError;
        } else {
          const { error: insError } = await client.from("tt_timetable_slots").insert({
            academic_year_id: academicYearId,
            section_id: section.id,
            day_of_week: day,
            period_number: 0,
            section_subject_teacher_id: sstId,
            teacher_id: teacherId,
            is_manual_override: false,
          });
          if (insError) throw insError;
        }
        placedCount += 1;
      }
    }
  }

  return { placedCount, warnings };
}
