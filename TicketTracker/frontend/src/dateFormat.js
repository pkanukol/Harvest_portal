// Displays timestamps/dates as dd/mm/yyyy per the school's convention, rather than
// the browser's default locale format (which for en-US is mm/dd/yyyy).

export function formatDateTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${dd}/${mm}/${d.getFullYear()}, ${time}`;
}

// For plain "YYYY-MM-DD" strings (from <input type="date">) - split directly rather
// than going through `new Date()`, which parses date-only strings as UTC midnight and
// can shift a day off in negative-offset timezones.
export function formatDate(isoDateString) {
  if (!isoDateString) return "";
  const [yyyy, mm, dd] = isoDateString.split("-");
  if (!yyyy || !mm || !dd) return isoDateString;
  return `${dd}/${mm}/${yyyy}`;
}
