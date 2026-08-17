import { bridgeToAttendancePipeline } from "./biometricReportImport";

// Walks the FULL chain the calendar depends on, including the two steps
// that live outside punch_record_daily - the raw biometric import
// (employee_daily_attendance, keyed by employee_id) and the staff_master ->
// staff_roles email link - so a blank calendar can be diagnosed from the UI
// instead of via one-off SQL every time. staffEmail is needed to resolve
// this person's employee_id via staff_master (there's no other link from a
// staff_roles id back to an employee_id).
export async function runAttendanceDiagnostics(client, staffId, staffEmail) {
  const [scheduleRes, punchRes, statusRes, masterRes, holidayRes] = await Promise.all([
    client.from("staff_schedule").select("*").eq("staff_id", staffId).is("effective_to", null),
    client.from("punch_record_daily").select("attendance_date, first_in_time, last_out_time").eq("staff_id", staffId).order("attendance_date"),
    client.from("attendance_daily_status").select("attendance_date, status").eq("staff_id", staffId).order("attendance_date"),
    client.from("staff_master").select("employee_id, email, category").eq("email", staffEmail).maybeSingle(),
    client.from("staff_holiday").select("holiday_date, label, source").eq("staff_id", staffId).order("holiday_date"),
  ]);
  if (scheduleRes.error) throw scheduleRes.error;
  if (punchRes.error) throw punchRes.error;
  if (statusRes.error) throw statusRes.error;
  if (masterRes.error) throw masterRes.error;
  if (holidayRes.error) throw holidayRes.error;

  const employeeId = masterRes.data?.employee_id ?? null;
  const staffMasterCategory = masterRes.data?.category ?? null;
  const holidayRows = holidayRes.data ?? [];
  let rawCount = 0;
  let rawRange = null;
  if (employeeId) {
    const { data: rawRows, error: rawError } = await client
      .from("employee_daily_attendance")
      .select("attendance_date")
      .eq("employee_id", employeeId)
      .order("attendance_date");
    if (rawError) throw rawError;
    const rawDates = (rawRows ?? []).map((r) => r.attendance_date);
    rawCount = rawDates.length;
    rawRange = rawDates.length ? [rawDates[0], rawDates[rawDates.length - 1]] : null;
  }

  const punchRows = punchRes.data ?? [];
  const punchDates = punchRows.map((r) => r.attendance_date);
  const statusRows = statusRes.data ?? [];

  return {
    employeeId,
    staffMasterCategory,
    holidayCount: holidayRows.length,
    holidayRows,
    rawCount,
    rawRange,
    scheduleRowCount: (scheduleRes.data ?? []).length,
    scheduleRows: scheduleRes.data ?? [],
    punchCount: punchDates.length,
    punchRange: punchDates.length ? [punchDates[0], punchDates[punchDates.length - 1]] : null,
    punchRows,
    statusCount: statusRows.length,
    statusRange: statusRows.length ? [statusRows[0].attendance_date, statusRows[statusRows.length - 1].attendance_date] : null,
    statusRows,
  };
}

export async function forceRecompute(client, staffId, fromDate, toDate) {
  const { error } = await client.rpc("recompute_attendance_range", { p_staff_id: staffId, p_from: fromDate, p_to: toDate });
  if (error) throw error;
}

// Re-runs just the employee_id -> email -> staff_id bridge for ONE person,
// over whatever range their raw import actually covers - lets a stuck
// single person get fixed without re-running the whole month's backfill.
export async function retryBridgeForEmployee(client, employeeId, fromDate, toDate) {
  return bridgeToAttendancePipeline(client, [employeeId], fromDate, toDate);
}
