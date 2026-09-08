import { staffClient } from "./supabaseClients";

// Branches (Kodathi, Attibele, ...) live entirely in staff_roles.branches -
// confirmed by the user, so Timetable doesn't own or create branch records
// itself. This just derives the distinct list from real staff data.
//
// The unrolling that used to happen here (branches is a JSON array per row,
// so single-branch, multi-branch and empty-array rows all had to be
// flatMapped rather than mapped) now happens inside the RPC - see
// staff_roles_rpc.sql. Same result, one column of text instead of every
// active row's branches array over the wire.
const CACHE_KEY = "timetable_v2_branches";

// The branch list is the very first thing the app needs, and it changes only
// when staff move campus - so render instantly from the last known list and
// refresh in the background. A stale-by-one-session branch list is harmless;
// a blank branch picker on every cold open is not.
export function cachedBranches() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.every((b) => typeof b === "string")
      ? parsed
      : null;
  } catch {
    return null; // private mode / disabled storage / corrupt value - just skip the cache
  }
}

export async function listBranches() {
  const { data, error } = await staffClient().rpc("timetable_branches");
  if (error) throw error;

  const branches = (data || []).filter(Boolean);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(branches));
  } catch {
    // Cache is an optimisation only - a write failure must not break the app.
  }
  return branches;
}
