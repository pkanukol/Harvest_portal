import { MONTH_NAMES, toIsoDate } from "./dateUtils";

// Loss-of-Pay (LOP) is computed live from a person's leaves + daily statuses for
// a fiscal year (Apr 1 - Mar 31), rather than stored in a ledger table. Three
// sources:
//   - sandwich   : a leave that bridges a weekend/holiday block (leave on the
//                  working days on BOTH sides), or a lone leave day with an off
//                  day on both calendar sides -> those days are LOP.
//   - excess_cl  : leave days beyond the person's remaining balance (lop_days on
//                  the leave_request, set at apply time) that aren't already LOP
//                  from the sandwich rule.
//   - short_group: every 3 "short" (early-exit) days in a calendar month = 1 LOP.
// The calendar overlays the specific LOP dates (sandwich + excess); short-group
// LOP has no single date, so it only contributes to the total + the list.

function isoToDate(iso) {
  return new Date(iso + "T00:00:00");
}
function shiftIso(iso, deltaDays) {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + deltaDays);
  return toIsoDate(d);
}
function rangeDates(fromIso, toIso) {
  const out = [];
  let d = isoToDate(fromIso);
  const end = isoToDate(toIso);
  while (d <= end) {
    out.push(toIsoDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
function monthLabelFromYm(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// Fiscal year (Apr-Mar) start-year for a given calendar year+month (0-indexed).
export function fiscalYearOf(year, month) {
  return month >= 3 ? year : year - 1;
}

// Builds an isOff(iso) predicate: a day is "off" if it's Sunday, an academic
// holiday (a 'holiday' status row, incl. computed Saturdays-off and festivals),
// or a scheduled non-working weekday/occurrence (so future Saturdays with no
// computed status row are still recognised as off). Days with no schedule and
// no holiday are treated as working (not off), so they don't create false bridges.
function buildIsOff(holidayDates, scheduleRows) {
  const byWeekday = new Map();
  (scheduleRows ?? []).forEach((r) => {
    if (!byWeekday.has(r.weekday)) byWeekday.set(r.weekday, []);
    byWeekday.get(r.weekday).push(r);
  });
  const scheduleOff = (iso) => {
    const d = isoToDate(iso);
    const rows = byWeekday.get(d.getDay());
    if (!rows || rows.length === 0) return null;
    const occ = Math.floor((d.getDate() - 1) / 7) + 1;
    let chosen = rows.find((r) => Array.isArray(r.week_occurrence) && r.week_occurrence.includes(occ));
    if (!chosen) chosen = rows.find((r) => !r.week_occurrence);
    if (!chosen) return null;
    return chosen.is_working_day === false;
  };
  return (iso) => isoToDate(iso).getDay() === 0 || holidayDates.has(iso) || scheduleOff(iso) === true;
}

// Shared sandwich detection over a set of leave dates and an isOff(iso) predicate.
// Returns a Set of ISO dates that are LOP by the sandwich rule.
function detectSandwich(leaveDates, isOff) {
  const sandwich = new Set();
  leaveDates.forEach((iso) => {
    // Pattern A: a lone leave day with an off day on both sides.
    if (isOff(shiftIso(iso, -1)) && isOff(shiftIso(iso, 1))) sandwich.add(iso);

    // Pattern B: an off-run immediately after this leave day that is closed on
    // the far side by another leave day -> the whole bridge (offs + both leave
    // days) is LOP. e.g. Fri leave + Sat/Sun off + Mon leave.
    let cur = shiftIso(iso, 1);
    const run = [];
    while (isOff(cur)) {
      run.push(cur);
      cur = shiftIso(cur, 1);
    }
    if (run.length > 0 && leaveDates.has(cur)) {
      run.forEach((r) => sandwich.add(r));
      sandwich.add(iso);
      sandwich.add(cur);
    }
  });
  return sandwich;
}

export async function computeLop(client, staffId, fiscalStartYear) {
  const from = `${fiscalStartYear}-04-01`;
  const to = `${fiscalStartYear + 1}-03-31`;

  const [leaveRes, statusRes, scheduleRes] = await Promise.all([
    client
      .from("leave_request")
      .select("from_date,to_date,lop_days,status")
      .eq("staff_id", staffId)
      .in("status", ["approved", "pending"])
      .lte("from_date", to)
      .gte("to_date", from),
    client
      .from("attendance_daily_status")
      .select("attendance_date,status")
      .eq("staff_id", staffId)
      .gte("attendance_date", from)
      .lte("attendance_date", to),
    client
      .from("staff_schedule")
      .select("weekday,is_working_day,week_occurrence")
      .eq("staff_id", staffId)
      .is("effective_to", null),
  ]);
  if (leaveRes.error) throw leaveRes.error;
  if (statusRes.error) throw statusRes.error;
  if (scheduleRes.error) throw scheduleRes.error;

  const leaves = leaveRes.data ?? [];
  const leaveDates = new Set();
  leaves.forEach((l) => rangeDates(l.from_date, l.to_date).forEach((d) => leaveDates.add(d)));

  const holidayDates = new Set();
  const shortDates = [];
  (statusRes.data ?? []).forEach((s) => {
    if (s.status === "holiday") holidayDates.add(s.attendance_date);
    // The calendar shows both 'late' (came late) and 'short' (left early) as one
    // amber "Short" dot, so both count toward the short-day alert and the 3->1 LOP.
    if (s.status === "short" || s.status === "late") shortDates.push(s.attendance_date);
  });
  const isOff = buildIsOff(holidayDates, scheduleRes.data);

  const sandwich = detectSandwich(leaveDates, isOff);

  // excess_cl: the last lop_days dates of each leave, minus any already sandwiched.
  const excess = new Set();
  leaves.forEach((l) => {
    const n = l.lop_days || 0;
    if (n <= 0) return;
    const dates = rangeDates(l.from_date, l.to_date);
    dates.slice(Math.max(0, dates.length - n)).forEach((d) => {
      if (!sandwich.has(d)) excess.add(d);
    });
  });

  // short_group: every 3 shorts in a calendar month = 1 LOP.
  const shortsByMonth = {};
  shortDates.forEach((iso) => {
    const ym = iso.slice(0, 7);
    shortsByMonth[ym] = (shortsByMonth[ym] || 0) + 1;
  });
  const shortGroups = Object.entries(shortsByMonth)
    .map(([ym, count]) => ({ ym, count, lopDays: Math.floor(count / 3) }))
    .filter((g) => g.lopDays > 0)
    .sort((a, b) => a.ym.localeCompare(b.ym));
  const shortLopTotal = shortGroups.reduce((s, g) => s + g.lopDays, 0);

  const entries = [];
  [...sandwich].sort().forEach((d) => entries.push({ date: d, source: "sandwich", label: "Sandwich leave (bridged holiday/weekend)" }));
  [...excess].sort().forEach((d) => entries.push({ date: d, source: "excess_cl", label: "Beyond leave balance" }));
  shortGroups.forEach((g) =>
    entries.push({ date: null, source: "short_group", label: `${g.count} short days in ${monthLabelFromYm(g.ym)} → ${g.lopDays} LOP`, days: g.lopDays })
  );

  return {
    total: sandwich.size + excess.size + shortLopTotal,
    entries,
    lopDates: new Set([...sandwich, ...excess]), // specific dates to overlay on the calendar
    shortDates: new Set(shortDates),
  };
}

// Apply-time preview: would a prospective leave (fromIso..toIso) trigger the
// sandwich rule? Looks at existing approved/pending leaves + holidays in a small
// window around the request. Returns { isSandwich, dates: [] }.
export async function previewSandwich(client, staffId, fromIso, toIso) {
  const windowFrom = shiftIso(fromIso, -4);
  const windowTo = shiftIso(toIso, 4);

  const [leaveRes, statusRes, scheduleRes] = await Promise.all([
    client
      .from("leave_request")
      .select("from_date,to_date,status")
      .eq("staff_id", staffId)
      .in("status", ["approved", "pending"])
      .lte("from_date", windowTo)
      .gte("to_date", windowFrom),
    client
      .from("attendance_daily_status")
      .select("attendance_date,status")
      .eq("staff_id", staffId)
      .eq("status", "holiday")
      .gte("attendance_date", windowFrom)
      .lte("attendance_date", windowTo),
    client
      .from("staff_schedule")
      .select("weekday,is_working_day,week_occurrence")
      .eq("staff_id", staffId)
      .is("effective_to", null),
  ]);
  if (leaveRes.error) throw leaveRes.error;
  if (statusRes.error) throw statusRes.error;
  if (scheduleRes.error) throw scheduleRes.error;

  const leaveDates = new Set(rangeDates(fromIso, toIso)); // include the prospective leave
  (leaveRes.data ?? []).forEach((l) => rangeDates(l.from_date, l.to_date).forEach((d) => leaveDates.add(d)));
  const holidayDates = new Set((statusRes.data ?? []).map((s) => s.attendance_date));
  const isOff = buildIsOff(holidayDates, scheduleRes.data);

  const sandwich = detectSandwich(leaveDates, isOff);
  const requested = rangeDates(fromIso, toIso);
  // Warn only if the request itself participates in a sandwich (one of its dates
  // is flagged) - not just any pre-existing sandwich in the window.
  const isSandwich = requested.some((d) => sandwich.has(d));
  return { isSandwich, dates: [...sandwich].sort() };
}
