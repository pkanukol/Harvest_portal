// Teacher-name matching needs to be more forgiving than exact-string-equality:
// real names come from two independently-maintained sources (Project A's
// teachers table and staff_roles) and commonly differ only by whitespace -
// "Ms Sankar devi" vs "Ms Sankardevi" is the same person. Stripping ALL
// whitespace (not just collapsing runs of it) catches that.
//
// Deliberately does NOT do fuzzy/substring matching (e.g. "Ms Shilpi" vs
// "Ms Shilpi Rastogi") - a false non-match just means the UI asks you to
// double check one more name, but a false match could silently point a real
// class at the wrong teacher. When in doubt, under-match.
export function normalizeTeacherName(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, "");
}
