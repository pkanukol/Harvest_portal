// Persists which bifurcation-mismatch warnings (TimetableViewer's per-
// grade+section "N period(s)/week placed, expected M" list) the user has
// dismissed as not worth acting on right now - confirmed by the user
// 2026-08-04: "Allow to ignore the warning too. Once ignored, do not show it
// again." No backend table for this (the warnings themselves are computed
// live, not stored rows), so this is plain localStorage, scoped per browser -
// good enough for a single-admin workflow, not meant to sync across devices.
const STORAGE_KEY = "timetable_ignored_warnings";

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function writeAll(set) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage unavailable (private browsing, quota, ...) - ignoring
    // just won't persist across reloads, not worth surfacing as an error.
  }
}

export function warningKey(academicYearId, sectionId, subject) {
  return `${academicYearId}|${sectionId}|${subject}`;
}

export function loadIgnoredWarnings() {
  return readAll();
}

export function ignoreWarning(academicYearId, sectionId, subject) {
  const set = readAll();
  set.add(warningKey(academicYearId, sectionId, subject));
  writeAll(set);
  return set;
}
