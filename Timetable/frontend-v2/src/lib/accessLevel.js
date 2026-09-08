// Who may edit the timetable.
//
// Driven by staff_roles.access_level - the tier the rest of Project B already
// maintains - per the decision of 2026-09-08.
//
// This replaces v1's rule, which matched designation keywords (vice
// principal, block head, coordinator, principal, managing director, chairman,
// apm) in backend/app/auth.py.
//
// 'admin' was initially left out and added back on 2026-09-08, when it turned
// out to exclude the person administering the app. It also covers Principal,
// Chairman, MD and Curriculum Head - editors under v1 - and, less obviously,
// IT Manager and Graphic Designer. Read-only tiers: teacher, sme, reviewer,
// viewer.
//
// KEEP IN SYNC with public.timetable_is_leadership() in staff_roles_rpc.sql.
// The SQL copy is the real enforcement (it backs the RLS write policy); this
// copy only decides which controls render. If the two ever drift, the
// database wins and the user sees a control that errors on save - the safe
// direction for them to disagree in.
export const EDIT_ACCESS_LEVELS = ["super_admin", "approver", "admin"];

export function accessLevelCanEdit(accessLevel) {
  return EDIT_ACCESS_LEVELS.includes((accessLevel || "").trim().toLowerCase());
}

// staffRow is the signed-in user's staff_roles row, or null when their auth
// account has no matching row. Null means read-only, not an error: v1 gave
// every valid account at least view access, and a missing staff_roles row is
// a data gap rather than something to lock somebody out over.
//
// Matching happens server-side on email, because staff_roles.auth_user_id is
// populated on 0 of 168 active rows (checked 2026-09-08) - see
// timetable_current_staff().
export function canEditTimetable(staffRow) {
  return accessLevelCanEdit(staffRow?.access_level);
}
