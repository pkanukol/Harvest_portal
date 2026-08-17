// Work-from-home marking. Only ACAD / ADMIN / CURR can WFH. A WFH day computes
// as present ('wfh' status). Markable by the person (self) and by an admin
// (By Person). No approval.

export const WFH_CATEGORIES = ["ACAD", "ADMIN", "CURR"];

export function canWfh(category) {
  return WFH_CATEGORIES.includes(category);
}

export async function fetchWfhForRange(client, staffId, fromIso, toIso) {
  const { data, error } = await client
    .from("wfh_day")
    .select("wfh_date, reason")
    .eq("staff_id", staffId)
    .gte("wfh_date", fromIso)
    .lte("wfh_date", toIso)
    .order("wfh_date");
  if (error) throw error;
  return data ?? [];
}

export async function markWfh(client, { staffId, wfhDate, reason, createdBy }) {
  const { error } = await client
    .from("wfh_day")
    .upsert({ staff_id: staffId, wfh_date: wfhDate, reason: reason || null, created_by: createdBy || null }, { onConflict: "staff_id,wfh_date" });
  if (error) throw error;
  // Recompute that day so the calendar shows it as present (wfh).
  const { error: rerr } = await client.rpc("compute_attendance_status", { p_staff_id: staffId, p_date: wfhDate });
  if (rerr) throw rerr;
}

export async function unmarkWfh(client, staffId, wfhDate) {
  const { error } = await client.from("wfh_day").delete().eq("staff_id", staffId).eq("wfh_date", wfhDate);
  if (error) throw error;
  const { error: rerr } = await client.rpc("compute_attendance_status", { p_staff_id: staffId, p_date: wfhDate });
  if (rerr) throw rerr;
}
