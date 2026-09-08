// Filters the teacher picker down to people who could plausibly be
// assigned to teach a period - staff_roles.designation also holds pure
// admin/leadership roles (Principal, Chairman, IT Manager, ...) that should
// never show up as an assignable "teacher". Confirmed by the user
// 2026-08-03: explicitly exclude this list; HOD and Coordinator are kept in
// (they do teach). Anything NOT in this list (including designations we
// haven't seen yet, and a blank/missing designation) is treated as
// teaching-eligible - under-excluding is safer than hiding a real teacher.
const NON_TEACHING_DESIGNATIONS = new Set(
  [
    "MD",
    "HR Manager",
    "Principal",
    "Managing Director",
    "Curriculum Head",
    "Vice Principal",
    "System Admin",
    "Subject Matter Expert",
    "IT Manager",
    "Information Technology",
    "Chairman",
    "DLP Manager",
    "APM",
  ].map((d) => d.toLowerCase())
);

export function isTeachingDesignation(designation) {
  const d = (designation || "").trim().toLowerCase();
  if (!d) return true;
  return !NON_TEACHING_DESIGNATIONS.has(d);
}
