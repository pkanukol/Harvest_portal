// Postgres EXTRACT(DOW) and JS Date#getDay() both use 0=Sunday..6=Saturday,
// so no re-indexing is needed anywhere in this app (unlike Timetable, which
// uses a Monday=0 convention for its own unrelated reasons).

export function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// Returns a flat array of 42 cells (6 weeks) for a month grid: nulls for
// leading/trailing days outside the month, otherwise { day, iso }.
export function monthGridCells(year, monthIndex) {
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const total = daysInMonth(year, monthIndex);
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= total; day++) {
    cells.push({ day, iso: toIsoDate(new Date(year, monthIndex, day)) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function formatTime(timeStr) {
  if (!timeStr) return "--:--";
  const [h, m] = timeStr.split(":");
  const hour = parseInt(h, 10);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${m} ${suffix}`;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
