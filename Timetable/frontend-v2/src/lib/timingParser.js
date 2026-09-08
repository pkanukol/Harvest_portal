// Port of Timetable/backend/app/excel_import.py::parse_timing_text.
// Parses the timing.txt shape:
//   "1\tClass teacher's Time   8.00am-8.10am"
//   "2\tPeriod 1\t8.10 am- 8.50 am"
//   "3\tBREAK\t8.50am-9.05am"
// Re-uploadable at any time (not just initial setup), so timing can be
// corrected without touching placed timetable data.

const TIME_RANGE_RE =
  /(\d{1,2}[:.]\d{2}\s*[ap]m)\s*-\s*(\d{1,2}[:.]\d{2}\s*[ap]m)/i;

function normalizeTime(raw) {
  const cleaned = raw.toLowerCase().replace(/\s+/g, "");
  const m = cleaned.match(/^(\d{1,2})[:.](\d{2})(am|pm)$/);
  if (!m) return cleaned;
  let hour = parseInt(m[1], 10);
  const minute = m[2];
  const ampm = m[3];
  if (ampm === "pm" && hour !== 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

export function parseTimingText(text) {
  const schedule = [];
  let classTeacherStart = null;
  let classTeacherEnd = null;
  let periodCount = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const m = line.match(TIME_RANGE_RE);
    if (!m) continue;

    const start = normalizeTime(m[1]);
    const end = normalizeTime(m[2]);
    const label = line.slice(0, m.index).trim() || line;
    const lowerLabel = label.toLowerCase();

    if (lowerLabel.includes("class teacher")) {
      classTeacherStart = start;
      classTeacherEnd = end;
    } else if (lowerLabel.includes("break")) {
      schedule.push({ type: "break", label, start, end });
    } else {
      periodCount += 1;
      const numMatch = label.match(/\d+/);
      schedule.push({
        type: "period",
        number: numMatch ? parseInt(numMatch[0], 10) : periodCount,
        start,
        end,
      });
    }
  }

  return {
    classTeacherStart: classTeacherStart || "08:00",
    classTeacherEnd: classTeacherEnd || "08:10",
    periodsPerDay: periodCount,
    schedule,
  };
}
