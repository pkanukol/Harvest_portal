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

export function nextWeekDates() {
  const today = new Date();
  const day = today.getDay();
  let daysToMon = day === 0 ? 1 : 8 - day;
  const mon = new Date(today);
  mon.setDate(today.getDate() + daysToMon);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  return { mon, fri };
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
