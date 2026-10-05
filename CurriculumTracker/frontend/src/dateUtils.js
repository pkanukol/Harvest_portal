// Ported verbatim (not "simplified") from Session_Tracker/JS.html — the IST
// offset arithmetic is fragile in general but currently correct for this
// school's IST-based staff/devices; changing the approach risks shifting
// Monday boundaries by a day. See the migration plan's business-logic notes.

export function nowIST() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 5.5 * 3600000);
}

export function thisMonday() {
  const t = nowIST();
  const day = t.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(t);
  mon.setDate(t.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

export function isPastWeek(weekStartISO) {
  if (!weekStartISO) return false;
  const mon = thisMonday();
  const ws = new Date(weekStartISO + "T00:00:00");
  return ws < mon;
}

export function nextWeekDates(today = new Date()) {
  const day = today.getDay();
  let daysToMon = day === 0 ? 1 : 8 - day;
  const mon = new Date(today);
  mon.setDate(today.getDate() + daysToMon);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  return { mon, fri };
}

/** A date as YYYY-MM-DD from its own calendar day - toISO reads it in UTC, which
 *  in India puts a Monday before 5:30 am on the Sunday. */
export function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The weeks a POW can be written for: next week and the three after it
 * (the APM, Oct 2026 - a teacher plans ahead, not only for next week).
 * Monday to Friday, as YYYY-MM-DD.
 */
export function upcomingWeeks(count = 4, today = new Date()) {
  const { mon: first } = nextWeekDates(today);
  return Array.from({ length: count }, (_, i) => {
    const mon = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 7 * i);
    const fri = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 4);
    return { start: isoLocal(mon), end: isoLocal(fri) };
  });
}

export function toISO(d) {
  return d.toISOString().slice(0, 10);
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
