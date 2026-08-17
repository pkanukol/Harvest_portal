import { toIsoDate } from "./dateUtils";

// Vacations are marked for a board (CBSE or PT) and expanded into category-scoped
// calendar_override 'holiday' rows (tagged with vacation_id) so they show on the
// calendar and compute as off - reusing Phase D's override machinery. ACAD & CURR
// get 50% of a CBSE vacation (rounded down) minus the holidays already common to
// the span; the admin picks those specific dates, also stored as tagged overrides.

function rangeDates(fromIso, toIso) {
  const out = [];
  let d = new Date(fromIso + "T00:00:00");
  const end = new Date(toIso + "T00:00:00");
  while (d <= end) {
    out.push(toIsoDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export async function fetchVacations(client) {
  const { data, error } = await client.from("vacation_period").select("*").order("from_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function saveVacation(client, { name, board, fromDate, toDate, branch, createdBy }) {
  const { data, error } = await client
    .from("vacation_period")
    .insert({ name, board, from_date: fromDate, to_date: toDate, branch: branch || null, created_by: createdBy || null })
    .select()
    .single();
  if (error) throw error;
  const vacation = data;

  const overrides = rangeDates(fromDate, toDate).map((d) => ({
    event_date: d,
    category: board,
    branch: branch || null,
    kind: "holiday",
    reason: name,
    vacation_id: vacation.id,
    created_by: createdBy || null,
  }));
  const { error: ovErr } = await client.from("calendar_override").insert(overrides);
  if (ovErr) throw ovErr;

  const { error: rcErr } = await client.rpc("recompute_calendar_range", { p_from: fromDate, p_to: toDate, p_category: board, p_branch: branch || null });
  if (rcErr) throw rcErr;
  return vacation;
}

export async function deleteVacation(client, vacation) {
  // FK on delete cascade removes the tagged calendar_override rows (board + any
  // ACAD/CURR derived), then recompute the span to revert.
  const { error } = await client.from("vacation_period").delete().eq("id", vacation.id);
  if (error) throw error;
  const { error: rcErr } = await client.rpc("recompute_calendar_range", { p_from: vacation.from_date, p_to: vacation.to_date, p_category: null, p_branch: vacation.branch || null });
  if (rcErr) throw rcErr;
}

// Holidays already common to the span for a target category (Sundays + that
// category's festival holidays + all-scope calendar overrides).
export async function computeCommonHolidays(client, fromIso, toIso, category) {
  const dates = new Set();
  rangeDates(fromIso, toIso).forEach((d) => {
    if (new Date(d + "T00:00:00").getDay() === 0) dates.add(d);
  });

  const [fest, ov] = await Promise.all([
    client.from("festival_holiday").select("holiday_date").eq("category", category).gte("holiday_date", fromIso).lte("holiday_date", toIso),
    client.from("calendar_override").select("event_date").eq("kind", "holiday").is("category", null).is("staff_id", null).gte("event_date", fromIso).lte("event_date", toIso),
  ]);
  if (fest.error) throw fest.error;
  if (ov.error) throw ov.error;
  (fest.data ?? []).forEach((r) => dates.add(r.holiday_date));
  (ov.data ?? []).forEach((r) => dates.add(r.event_date));
  return dates.size;
}

// entitlement = floor(cbseDays/2) - commonHolidays (min 0).
export async function computeDerivedEntitlement(client, vacation, category) {
  const cbseDays = rangeDates(vacation.from_date, vacation.to_date).length;
  const common = await computeCommonHolidays(client, vacation.from_date, vacation.to_date, category);
  return { cbseDays, common, entitlement: Math.max(0, Math.floor(cbseDays / 2) - common) };
}

export async function fetchDerivedDays(client, vacationId, category) {
  const { data, error } = await client
    .from("calendar_override")
    .select("event_date")
    .eq("vacation_id", vacationId)
    .eq("category", category)
    .order("event_date");
  if (error) throw error;
  return (data ?? []).map((r) => r.event_date);
}

export async function saveDerivedDays(client, { vacation, category, dates, createdBy }) {
  // Replace this vacation+category's derived days.
  const { error: delErr } = await client.from("calendar_override").delete().eq("vacation_id", vacation.id).eq("category", category);
  if (delErr) throw delErr;
  if (dates.length > 0) {
    const rows = dates.map((d) => ({
      event_date: d,
      category,
      branch: vacation.branch || null,
      kind: "holiday",
      reason: vacation.name,
      vacation_id: vacation.id,
      created_by: createdBy || null,
    }));
    const { error } = await client.from("calendar_override").insert(rows);
    if (error) throw error;
  }
  const { error: rcErr } = await client.rpc("recompute_calendar_range", { p_from: vacation.from_date, p_to: vacation.to_date, p_category: category, p_branch: vacation.branch || null });
  if (rcErr) throw rcErr;
}

export function datesInRange(fromIso, toIso) {
  return rangeDates(fromIso, toIso);
}
