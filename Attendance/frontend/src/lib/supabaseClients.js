import { createClient } from "@supabase/supabase-js";

const ATTENDANCE_URL = import.meta.env.VITE_ATTENDANCE_SUPABASE_URL;
const ATTENDANCE_ANON_KEY = import.meta.env.VITE_ATTENDANCE_SUPABASE_ANON_KEY;

// Project A - the SAME Supabase project the portal issues SSO access_tokens
// for (also Timetable's own project). Attendance's own domain tables
// (staff_schedule, punch_record_daily, attendance_daily_status,
// regularisation_request, leave_request, ...) live here too, NOT in a
// separate project - a token issued by a different Supabase project would
// fail PostgREST's JWT verification here, so "no custom backend, just pin
// the portal's token as the bearer header" (Timetable's pattern) only works
// when the domain tables and the token-issuing auth live in the same project.
export function createAttendanceClient(accessToken) {
  return createClient(ATTENDANCE_URL, ATTENDANCE_ANON_KEY, {
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
    auth: { persistSession: false },
  });
}

// Project B (staff_roles) is no longer read from this app. Identity, category
// and the leave approver now all come from staff_master on Project A via the
// authenticated client above - see src/lib/staffMaster.js and currentUser.js.
// The VITE_STAFF_SUPABASE_* env vars are consequently unused and can be removed
// from .env whenever convenient.
