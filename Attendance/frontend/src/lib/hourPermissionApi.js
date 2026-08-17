// 1-hour permission: once per calendar month per person. The DB trigger
// enforces the monthly cap and the "Saturday only for emergencies" rule, so the
// UI just inserts and surfaces any thrown message.

export async function fetchHourPermissionForMonth(client, staffId, year, month) {
  const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const toDate = new Date(year, month + 1, 0);
  const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(toDate.getDate()).padStart(2, "0")}`;
  const { data, error } = await client
    .from("hour_permission")
    .select("*")
    .eq("staff_id", staffId)
    .gte("permission_date", from)
    .lte("permission_date", to);
  if (error) throw error;
  return data ?? [];
}

export async function applyHourPermission(client, { staffId, staffEmail, permissionDate, reason, isEmergency, appliedBy }) {
  const { error } = await client.from("hour_permission").insert({
    staff_id: staffId,
    staff_email: staffEmail || null,
    permission_date: permissionDate,
    reason: reason || null,
    is_emergency: !!isEmergency,
    applied_by: appliedBy || null,
  });
  if (error) throw error; // trigger messages (monthly cap / Saturday) surface here
}
