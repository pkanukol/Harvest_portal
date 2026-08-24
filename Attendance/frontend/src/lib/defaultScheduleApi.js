// Per-category default working schedule (Phase H). When a person has no explicit
// staff_schedule row, compute_attendance_status falls back to this: Mon-Fri
// working with the weekday timing, Saturdays working on sat_working_occurrences,
// Sundays off. Categories not present here (e.g. IB/MONT) stay blank.

export const ALL_CATEGORIES = ["CBSE", "ACAD", "CURR", "PT", "ADMIN", "IB", "MONT"];

export async function fetchDefaultSchedules(client) {
  const { data, error } = await client.from("category_default_schedule").select("*").order("category");
  if (error) throw error;
  return data ?? [];
}

export async function upsertDefaultSchedule(client, row) {
  const { error } = await client.from("category_default_schedule").upsert(
    {
      category: row.category,
      weekday_check_in: row.weekday_check_in || null,
      weekday_check_out: row.weekday_check_out || null,
      grace_minutes: Number(row.grace_minutes) || 0,
      sat_check_in: row.sat_check_in || null,
      sat_check_out: row.sat_check_out || null,
      sat_working_occurrences: row.sat_working_occurrences || [],
      updated_at: new Date().toISOString(),
      updated_by: row.updated_by || null,
    },
    { onConflict: "category" }
  );
  if (error) throw error;
}

export async function deleteDefaultSchedule(client, category) {
  const { error } = await client.from("category_default_schedule").delete().eq("category", category);
  if (error) throw error;
}
