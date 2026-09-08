import { staffClient } from "./supabaseClients";

// All Project B (staff_roles) access goes through SECURITY DEFINER RPCs -
// see staff_roles_rpc.sql. Timetable no longer touches the staff_roles table
// directly, because the table-level GRANT to `anon` is owned by a different
// app's migrations and kept getting silently revoked, breaking this app.
// Only EXECUTE on those three functions is needed now.
//
// staff_roles is this app's ONLY teacher identity - there is no longer a
// separate `teachers` table duplicating it. Its columns, per the user
// 2026-09-08: `designation` says who counts as a teacher, `subjects` and
// `grades` what they handle, `class_sections` which grade-sections they are
// class teacher of, `teaching_sections` the "Subject|grade-section" list
// (e.g. ["Maths|4A","Maths|5A","Maths|6A"]), `branches` the campus. A row's
// `id` is the int that this app stores as `teacher_id` on its own tables.
//
// The read RPC returns whole rows, so a column the owning app adds shows up
// here with no change on our side.
export async function fetchStaffByBranch(branch) {
  const { data, error } = await staffClient().rpc("timetable_staff_by_branch", {
    p_branch: branch,
  });
  if (error) throw error;
  return data || [];
}

// Append-only by contract: the RPC rejects any array that drops an entry
// already on record, so a parsing bug here can never wipe the owning app's
// data. Returns the stored array.
export async function appendTeachingSections(id, teachingSections) {
  const { data, error } = await staffClient().rpc(
    "timetable_append_teaching_sections",
    { p_id: id, p_teaching_sections: teachingSections }
  );
  if (error) throw error;
  return data;
}

// The signed-in user's own staff_roles row, or null when their auth account
// has no matching row (treated as read-only by canEditTimetable, not as an
// error). The RPC scopes itself to auth.jwt() ->> 'email', so this cannot
// read anybody else's record.
export async function fetchCurrentStaff() {
  const { data, error } = await staffClient().rpc("timetable_current_staff");
  if (error) throw error;
  return (data || [])[0] ?? null;
}
