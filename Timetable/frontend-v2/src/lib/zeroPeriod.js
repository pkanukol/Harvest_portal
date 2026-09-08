// Computes a special bell-schedule variant with an inserted "Zero Period"
// for a chosen position (morning/noon/last), compressing every regular
// teaching period to 30 minutes while keeping breaks at their original
// duration and relative position. New logic, no Python original.
//
// This is a planning/reference schedule only - it does not touch
// timing_configs or timetable_slots. Existing period numbers are kept as-is
// (only their clock times shift) so this schedule still reads naturally
// alongside the regular subject/teacher grid, which is keyed by period
// number, not by clock time.

const PERIOD_MINUTES = 30;
const ZERO_PERIOD_MINUTES = 60;

// baseSchedule times are stored as "HH:MM" on a 12-hour clock with no am/pm
// marker (e.g. "12:40" then "01:25") - candidate is interpreted relative to
// the previous entry's end so the day's real elapsed time is always
// increasing, regardless of the 12-hour wraparound in the raw strings.
function toRunningMinutes(hhmm, prevMinutes) {
  const [h, m] = hhmm.split(":").map(Number);
  let candidate = (h % 12) * 60 + m;
  if (prevMinutes == null) return candidate;
  while (candidate < prevMinutes) candidate += 12 * 60;
  return candidate;
}

function formatClock(totalMinutes) {
  const dayMinutes = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  let h = Math.floor(dayMinutes / 60) % 12;
  if (h === 0) h = 12;
  const m = dayMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function computeZeroPeriodSchedule(baseSchedule, zeroType) {
  if (!baseSchedule.length) return [];

  const normalized = [];
  let prevEnd = null;
  for (const col of baseSchedule) {
    const start = toRunningMinutes(col.start, prevEnd);
    const end = toRunningMinutes(col.end, start);
    normalized.push({ ...col, runStart: start, runEnd: end });
    prevEnd = end;
  }

  const dayStart = normalized[0].runStart;

  let lunchIdx = -1;
  let lunchDuration = -1;
  normalized.forEach((col, i) => {
    if (col.type === "break") {
      const duration = col.runEnd - col.runStart;
      if (duration > lunchDuration) {
        lunchDuration = duration;
        lunchIdx = i;
      }
    }
  });

  const out = [];
  let clock = dayStart;

  function pushZero(atClock) {
    out.push({ type: "zero", label: "Zero Period", start: formatClock(atClock), end: formatClock(atClock + ZERO_PERIOD_MINUTES) });
  }

  // Starts exactly at the school's own P0 start time, not 60 minutes before
  // it - confirmed by the user 2026-08-05 ("should start from the school P0
  // start time. Not before that"). It uses up part of the time freed by
  // compressing every regular period to 30 minutes, rather than tacking an
  // extra hour onto the front of the day: for a real schedule (9 periods
  // including CT, at 30 min each, plus original break durations), inserting
  // the 60-min zero period right at dayStart and running everything else
  // immediately after lands the last period's end exactly at 2:30pm, same
  // as the noon/last variants (which were already correct - they only ever
  // insert the zero block later in the day, never before its start).
  if (zeroType === "morning") {
    pushZero(clock);
    clock += ZERO_PERIOD_MINUTES;
  }

  normalized.forEach((col, i) => {
    const duration = col.type === "period" ? PERIOD_MINUTES : col.runEnd - col.runStart;
    const start = clock;
    const end = start + duration;
    out.push({
      type: col.type,
      number: col.number,
      label: col.label,
      start: formatClock(start),
      end: formatClock(end),
    });
    clock = end;

    if (zeroType === "noon" && i === lunchIdx) {
      pushZero(clock);
      clock += ZERO_PERIOD_MINUTES;
    }
  });

  if (zeroType === "last") {
    pushZero(clock);
  }

  return out;
}

export const ZERO_PERIOD_TYPES = [
  { value: "morning", label: "Morning zero period" },
  { value: "noon", label: "Noon zero period" },
  { value: "last", label: "Last zero period" },
];
