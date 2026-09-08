// Cross-references a parsed subject-bifurcation upload (periods/week per
// subject per grade) against the parsed Work Allotment sheet (teacher ->
// subject -> grade+section) to build the {grades, sections,
// gradeSubjectPeriods, sectionSubjectTeachers} shape scheduler.js's
// generate() expects.
//
// Replaces staffCrossReference.js's staff_roles-driven version (confirmed by
// the user 2026-08-04): staff_roles.teaching_sections turned out to be
// essentially unpopulated in practice, so "who teaches what" for Build New
// now comes directly from the Work Allotment excel the user uploads instead.
// staff_roles is still used elsewhere (teacher-name auto-provisioning into
// Project A, Class Teacher/period 0 resolution) - just not this mapping.
//
// Every (grade, section, subject) combo implied by the bifurcation sheet is
// checked for a matching Work Allotment row - confirmed by the user
// 2026-08-04: "use subject bifurcation to check all the subjects and the
// corresponding number of periods... are there. If not, flag it." A missing
// combo is still included as an unassigned SectionSubjectTeacher (so the
// scheduler still reserves periods for it) but reported as a warning naming
// the expected periods/week, so a gap in the Work Allotment sheet is
// impossible to miss silently.

import { subjectsOverlap } from "./teachingSectionsSync";

const MAX_GRADE = 10; // grades 11/12 and INTEGRATED are out of scope for v1

// gradeSubjects: subjectBifurcationParser.js's output, {gradeNumber: [{subject, periods}]}.
// workAllotment: workAllotmentParser.js's output, [{teacherName, subject, gradeNum, section}].
export function buildTimetableInputsFromWorkAllotment(gradeSubjects, workAllotment) {
  const warnings = [];

  const sectionsByGrade = new Map();
  for (const a of workAllotment) {
    if (a.gradeNum > MAX_GRADE) continue;
    if (!sectionsByGrade.has(a.gradeNum)) sectionsByGrade.set(a.gradeNum, new Set());
    sectionsByGrade.get(a.gradeNum).add(a.section);
  }

  const grades = [];
  const sections = [];
  const gradeSubjectPeriods = [];
  const sectionSubjectTeachers = [];
  let gspId = 1;
  let sstId = 1;
  let sectionId = 1;

  for (const [gradeNumStr, subjectList] of Object.entries(gradeSubjects)) {
    const gradeNum = parseInt(gradeNumStr, 10);
    if (!subjectList.length) continue;

    const gradeSections = sectionsByGrade.get(gradeNum);
    if (!gradeSections || !gradeSections.size) {
      warnings.push(
        `Grade ${gradeNum}: no Work Allotment rows found for this grade - skipped ` +
          `(needs at least one row with a "${gradeNum}X" grade+section code)`
      );
      continue;
    }

    const grade = { id: gradeNum, name: `Grade ${gradeNum}`, order_index: gradeNum };
    grades.push(grade);

    const gradeSectionObjs = [...gradeSections].sort().map((letter) => {
      const section = { id: sectionId++, grade_id: gradeNum, name: letter };
      sections.push(section);
      return section;
    });

    for (const { subject, periods } of subjectList) {
      const gsp = {
        id: gspId++, grade_id: gradeNum, periods_per_week: periods,
        subject: { raw_name: subject }, grade: { name: grade.name, order_index: gradeNum },
      };
      gradeSubjectPeriods.push(gsp);

      for (const section of gradeSectionObjs) {
        const teacherNames = [
          ...new Set(
            workAllotment
              .filter((a) => a.gradeNum === gradeNum && a.section === section.name && subjectsOverlap(subject, a.subject))
              .map((a) => a.teacherName)
          ),
        ];
        if (!teacherNames.length) {
          warnings.push(
            `Grade ${gradeNum}${section.name} '${subject}' (${periods} period(s)/week per Subject Bifurcation): ` +
              `no matching Work Allotment row - left unassigned`
          );
          sectionSubjectTeachers.push({ id: sstId++, section_id: section.id, grade_subject_period_id: gsp.id, teacher_id: null });
        } else {
          for (const teacherName of teacherNames) {
            sectionSubjectTeachers.push({ id: sstId++, section_id: section.id, grade_subject_period_id: gsp.id, teacher_id: teacherName });
          }
        }
      }
    }
  }

  // Rows in the Work Allotment sheet naming a grade+section that Subject
  // Bifurcation never mentions for that subject - could be a typo'd subject
  // name or a section Subject Bifurcation doesn't know about yet.
  for (const a of workAllotment) {
    if (a.gradeNum > MAX_GRADE) continue;
    const subjectList = gradeSubjects[a.gradeNum] || [];
    const hasMatch = subjectList.some((s) => subjectsOverlap(s.subject, a.subject));
    if (!hasMatch) {
      warnings.push(
        `Work Allotment: "${a.teacherName}" - Grade ${a.gradeNum}${a.section} '${a.subject}' doesn't match any ` +
          `Subject Bifurcation entry for Grade ${a.gradeNum} - check for a typo in the subject name`
      );
    }
  }

  return { grades, sections, gradeSubjectPeriods, sectionSubjectTeachers, warnings };
}
