const CASUAL_LEAVE_DAYS_PER_YEAR = 10; // matches leave_balance() in the DB - kept in sync manually for now

// One batched query per data source (not one query per staff) so this stays
// fast even for a large category like "Teacher" (~120 people) - aggregation
// happens client-side over the batch instead of N round trips.
export async function fetchStatsForStaffIds(client, staffIds, year) {
  const stats = {};
  staffIds.forEach((id) => {
    stats[id] = { lateCount: 0, shortCount: 0, leavesTaken: 0, leaveBalance: CASUAL_LEAVE_DAYS_PER_YEAR };
  });
  if (staffIds.length === 0) return stats;

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [statusResult, leaveResult] = await Promise.all([
    client
      .from("attendance_daily_status")
      .select("staff_id, status")
      .in("staff_id", staffIds)
      .gte("attendance_date", yearStart)
      .lte("attendance_date", yearEnd),
    client
      .from("leave_request")
      .select("staff_id, days_count, from_date")
      .in("staff_id", staffIds)
      .eq("status", "approved")
      .gte("from_date", yearStart)
      .lte("from_date", yearEnd),
  ]);
  if (statusResult.error) throw statusResult.error;
  if (leaveResult.error) throw leaveResult.error;

  (statusResult.data ?? []).forEach((row) => {
    const entry = stats[row.staff_id];
    if (!entry) return;
    if (row.status === "late") entry.lateCount += 1;
    if (row.status === "short") entry.shortCount += 1;
  });

  (leaveResult.data ?? []).forEach((row) => {
    const entry = stats[row.staff_id];
    if (!entry) return;
    entry.leavesTaken += row.days_count;
    entry.leaveBalance -= row.days_count;
  });

  return stats;
}
