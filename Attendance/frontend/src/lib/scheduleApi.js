export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const SATURDAY_OCCURRENCES = [1, 2, 3, 4, 5];

// Current (effective_to is null) schedule rows for a staff member - a flat
// list now, not one-per-weekday, since Saturday can have more than one row
// (alternating-Saturday: different occurrence-of-month subsets).
export async function fetchCurrentSchedule(client, staffId) {
  const { data, error } = await client
    .from("staff_schedule")
    .select("*")
    .eq("staff_id", staffId)
    .is("effective_to", null);
  if (error) throw error;
  return data ?? [];
}

// Wholesale replace, not per-row update - simplest way to handle a rule
// editor where days/occurrences can move between rules or drop out
// entirely between loads, without needing to track which UI slot owns which
// underlying row id across edits. desiredRows: [{ weekday, isWorkingDay,
// checkInTime, checkOutTime, graceMinutes, weekOccurrence }].
// Which of these staff have a "custom" (By-Person) schedule that a By-Category
// apply must NOT overwrite.
export async function fetchCustomScheduleStaffIds(client, staffIds) {
  if (!staffIds || staffIds.length === 0) return new Set();
  const { data, error } = await client
    .from("staff_schedule")
    .select("staff_id")
    .in("staff_id", staffIds)
    .eq("is_custom", true)
    .is("effective_to", null);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.staff_id));
}

export async function replaceSchedule(client, { staffId, desiredRows, updatedBy, isCustom = false }) {
  const { error: deleteError } = await client
    .from("staff_schedule")
    .delete()
    .eq("staff_id", staffId)
    .is("effective_to", null);
  if (deleteError) throw deleteError;

  if (desiredRows.length === 0) return;

  const payload = desiredRows.map((r) => ({
    staff_id: staffId,
    weekday: r.weekday,
    is_working_day: r.isWorkingDay,
    check_in_time: r.isWorkingDay ? r.checkInTime || null : null,
    check_out_time: r.isWorkingDay ? r.checkOutTime || null : null,
    grace_minutes: r.graceMinutes || 0,
    week_occurrence: r.weekOccurrence && r.weekOccurrence.length > 0 ? r.weekOccurrence : null,
    is_custom: isCustom,
    // Deliberately NOT the column's default (today) - compute_attendance_status
    // requires effective_from <= the date being computed, so a schedule saved
    // "today" would never apply to any earlier date, silently breaking
    // recompute for imported historical months (e.g. importing July's
    // biometric data works, but a schedule saved in August never matches any
    // July date). There's no UI yet for deliberately dating a schedule
    // change, so applying every saved schedule from a fixed early date is
    // the only option that matches what an admin actually expects: "this is
    // how their hours work," not "how their hours work starting today."
    effective_from: "2020-01-01",
    updated_by: updatedBy,
  }));
  const { error: insertError } = await client.from("staff_schedule").insert(payload);
  if (insertError) throw insertError;

  await recomputeExistingAttendance(client, staffId);
}

// Saving a schedule only writes staff_schedule - it never touches whatever
// punch_record_daily rows already exist for this person (e.g. from an
// earlier biometric import). Without this, "import first, configure the
// schedule after" (or the reverse, if the import gets re-run later) leaves
// attendance_daily_status stale or empty depending on which happened first.
// Called automatically at the end of every replaceSchedule so the UI alone
// is enough - no manual SQL recompute needed regardless of order.
async function recomputeExistingAttendance(client, staffId) {
  const { data, error } = await client
    .from("punch_record_daily")
    .select("attendance_date")
    .eq("staff_id", staffId)
    .order("attendance_date", { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) return;

  const minDate = data[0].attendance_date;
  const maxDate = data[data.length - 1].attendance_date;
  const { error: rpcError } = await client.rpc("recompute_attendance_range", { p_staff_id: staffId, p_from: minDate, p_to: maxDate });
  if (rpcError) throw rpcError;
}

export async function fetchStaybackOverrides(client, staffId) {
  const { data, error } = await client
    .from("staff_stayback_override")
    .select("*")
    .eq("staff_id", staffId)
    .eq("active", true)
    .order("weekday");
  if (error) throw error;
  return data ?? [];
}

export async function addStaybackOverride(client, { staffId, weekday, staybackCheckOutTime, reason }) {
  const { error } = await client.from("staff_stayback_override").insert({
    staff_id: staffId,
    weekday,
    stayback_check_out_time: staybackCheckOutTime,
    reason: reason || null,
  });
  if (error) throw error;
}

export async function removeStaybackOverride(client, id) {
  const { error } = await client.from("staff_stayback_override").update({ active: false }).eq("id", id);
  if (error) throw error;
}

