import { createTimetableClient } from "./supabaseClients";

// public.subjects is the school-wide subject catalogue, maintained by another
// app. Timetable READS it and never writes to it. It is keyed on `code` (text)
// and has no id column, which is why every reference in the tt_ tables is a
// `subject_code text` rather than a numeric FK.
//
// Timetable's own subject rows are gone. A tt_grade_subject_periods row now
// carries `subject_label` (what the workbook called it - always populated, so
// the grid can render without resolving anything) plus an optional
// `subject_code` linking it to the catalogue, or an optional `combo_id`.

export async function fetchSubjectCatalogue() {
  const { data, error } = await createTimetableClient()
    .from("subjects")
    .select("code, name, min_grade, max_grade")
    .eq("active", true);
  if (error) throw error;
  return data || [];
}

export async function fetchSubjectAliases() {
  const { data, error } = await createTimetableClient()
    .from("tt_subject_aliases")
    .select("workbook_name, subject_code");
  if (error) throw error;
  return data || [];
}

function norm(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Resolves a workbook's subject spelling to a catalogue `code`, or null.
//
// Order matters: an explicit alias wins over any guess, because an alias is
// something a person confirmed. Only then do we try the catalogue's own name
// and code. Deliberately NO fuzzy matching - the catalogue contains genuinely
// distinct rows that differ by a word ("Hindi" HIN vs "Hindi II Lang" HIN 2 vs
// "Hindi III Lang" HI1), so a near-match would silently point a class at the
// wrong subject. Same reasoning as normalizeTeacherName's refusal to do
// substring matching on teacher names.
//
// Returns null for anything unresolved, including "EVS" (the catalogue only
// has SCI "Science") - the caller decides whether that is a warning or a
// prompt to map it.
export function resolveSubjectCode(workbookName, catalogue, aliases) {
  const key = norm(workbookName);
  if (!key) return null;

  const alias = aliases.find((a) => norm(a.workbook_name) === key);
  if (alias) return alias.subject_code; // may be null: "deliberately not a catalogue subject"

  const byName = catalogue.find((s) => norm(s.name) === key);
  if (byName) return byName.code;

  const byCode = catalogue.find((s) => norm(s.code) === key);
  if (byCode) return byCode.code;

  return null;
}

// True when a workbook subject name looks like a combo - several subjects
// sharing one period, written with slashes:
//   "Hindi/Kannada/ Sanskrit (Lang II)"
export function looksLikeCombo(workbookName) {
  return (workbookName || "").includes("/");
}

// Splits a combo string into its parts and a trailing qualifier, for the
// import-time "we think this is a combo, confirm the matches" step.
//
//   "Hindi/Kannada/ Sanskrit (Lang II)"
//     -> { parts: ["Hindi", "Kannada", "Sanskrit"], qualifier: "Lang II" }
//
// The qualifier matters: none of the bare parts is a catalogue name on its own
// (the catalogue distinguishes Hindi / Hindi II Lang / Hindi III Lang), so it
// has to be read as applying to EVERY part to land on HIN 2 / KAN2 / SAN.
// That is an inference, which is exactly why the user confirms rather than
// having it applied silently.
export function splitComboName(workbookName) {
  const raw = (workbookName || "").trim();
  const qualifierMatch = raw.match(/\(([^)]*)\)\s*$/);
  const qualifier = qualifierMatch ? qualifierMatch[1].trim() : null;
  const body = qualifierMatch ? raw.slice(0, qualifierMatch.index) : raw;
  const parts = body
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  return { parts, qualifier };
}

// Candidate catalogue codes for one part of a combo, best first. With the
// qualifier applied ("Hindi" + "Lang II") an exact hit is usually available;
// without one this falls back to every catalogue row whose name starts with
// the part, so the confirm step has something to offer rather than nothing.
export function comboPartCandidates(part, qualifier, catalogue) {
  const p = norm(part);
  const withQualifier = qualifier ? norm(`${part} ${qualifier}`) : null;

  const out = [];
  const push = (s) => {
    if (s && !out.some((o) => o.code === s.code)) out.push(s);
  };

  if (withQualifier) push(catalogue.find((s) => norm(s.name) === withQualifier));
  push(catalogue.find((s) => norm(s.name) === p));
  for (const s of catalogue) if (norm(s.name).startsWith(p)) push(s);
  return out;
}

// Combos already defined for this academic year, keyed by the exact workbook
// spelling that produced them - so a re-upload of the same file resolves
// silently instead of asking again. See tt_subject_combos.workbook_name.
export async function fetchCombosByWorkbookName(academicYearId) {
  const { data, error } = await createTimetableClient()
    .from("tt_subject_combos")
    .select("id, label, workbook_name")
    .eq("academic_year_id", academicYearId);
  if (error) throw error;
  const map = new Map();
  for (const c of data || []) {
    if (c.workbook_name) map.set(norm(c.workbook_name), c);
  }
  return map;
}
