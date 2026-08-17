// Date-specific calendar overrides: turn a specific Saturday on/off, move a
// holiday, or mark a working day as a holiday. Scope precedence (most specific
// wins): a person (staff_id/employee_id) > a category > all.

export async function fetchOverrides(client) {
  const { data, error } = await client.from("calendar_override").select("*").order("event_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Holiday-kind override reasons applicable to one person, for calendar labels.
export async function fetchOverrideLabelsForRange(client, fromIso, toIso, staffId, category, branch) {
  const { data, error } = await client
    .from("calendar_override")
    .select("event_date, staff_id, category, branch, kind, reason")
    .eq("kind", "holiday")
    .gte("event_date", fromIso)
    .lte("event_date", toIso);
  if (error) throw error;
  const map = {};
  (data ?? []).forEach((o) => {
    const applies =
      (o.staff_id == null || o.staff_id === staffId) &&
      (o.branch == null || o.branch === branch) &&
      (o.category == null || o.category === category);
    if (applies) map[o.event_date] = o.reason || "Holiday";
  });
  return map;
}

// Delete-then-insert so re-saving the same (date, scope) just replaces it
// (the DB has a unique index over date + coalesced scope).
export async function saveOverride(client, { eventDate, staffId, category, branch, kind, reason, createdBy }) {
  let del = client.from("calendar_override").delete().eq("event_date", eventDate);
  del = staffId ? del.eq("staff_id", staffId) : del.is("staff_id", null);
  del = branch ? del.eq("branch", branch) : del.is("branch", null);
  del = category ? del.eq("category", category) : del.is("category", null);
  const { error: delErr } = await del;
  if (delErr) throw delErr;

  const { error } = await client.from("calendar_override").insert({
    event_date: eventDate,
    staff_id: staffId || null,
    branch: branch || null,
    category: category || null,
    kind,
    reason: reason || null,
    created_by: createdBy || null,
  });
  if (error) throw error;
}

export async function deleteOverride(client, id) {
  const { error } = await client.from("calendar_override").delete().eq("id", id);
  if (error) throw error;
}

// Rebuild the affected calendars for a date after an override changes.
export async function recomputeOverride(client, { eventDate, category, staffId, branch }) {
  const { error } = await client.rpc("recompute_calendar_date", {
    p_date: eventDate,
    p_category: category || null,
    p_staff_id: staffId || null,
    p_branch: branch || null,
  });
  if (error) throw error;
}
