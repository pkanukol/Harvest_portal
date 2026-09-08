import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_TIMETABLE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_TIMETABLE_SUPABASE_ANON_KEY;

// ONE client, one project.
//
// This app used to hold two: Project A for its own timetable tables (with the
// school portal's ?sso= access token pinned as a bearer header) and Project B
// read-only for staff_roles. Both halves now live in Project B, so there is a
// single client - and the portal token is gone with the second project.
//
// Why the token had to go: it is signed with PROJECT A's JWT secret, so
// Project B's PostgREST rejects it outright. Attendance hit exactly this and
// moved to Project B's own email+password login (see
// Attendance/frontend/src/lib/supabaseClients.js); Timetable now does the
// same. The client owns the session - persisted in the browser, refreshed
// automatically - and attaches a B-signed token to every request, so nothing
// downstream has to thread a token around any more.
//
// detectSessionInUrl MUST be true: Google OAuth returns to this app with the
// session in the URL fragment, and supabase-js only picks it up when this is
// on. It was false in an earlier revision out of a concern about the portal
// shell, which turns out not to apply - the portal navigates to this app with
// window.location.href (portal/index.html:748), it does not iframe it, so
// there is no parent fragment to misread.
let _client = null;

export function createTimetableClient() {
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return _client;
}

// staff_roles reads/writes go through the SECURITY DEFINER RPCs (see
// staff_roles_rpc.sql) rather than the table, but they run on this same
// client now. Kept as a named export so src/lib/staffRoles.js and
// src/lib/branches.js read the way they always did.
export function staffClient() {
  return createTimetableClient();
}
