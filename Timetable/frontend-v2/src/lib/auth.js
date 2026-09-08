// Auth is handled by Supabase directly on Project B (see LoginView and the
// session-managing client in supabaseClients.js).
//
// The portal's ?sso=<access_token> handoff is gone. That token is signed with
// Project A's JWT secret and Project B's PostgREST will not verify it, so
// carrying it over would have failed on every request once this app's tables
// moved. Attendance removed the same handoff for the same reason.
//
// Nothing is read from sessionStorage any more either - the Supabase client
// owns session persistence and refresh.

export async function signOut(client) {
  try {
    await client.auth.signOut();
  } catch {
    /* ignore - onAuthStateChange still fires and the login screen returns */
  }
}
