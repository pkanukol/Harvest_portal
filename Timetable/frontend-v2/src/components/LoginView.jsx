import { useState } from "react";

// Sign-in against Project B's Supabase Auth.
//
// Google is the primary route, because it is the only one anybody at the
// school actually has: the portal is Google-OAuth-only
// (portal/login.html:196), so staff have never set a password anywhere.
// Attempting signInWithPassword with a work email therefore fails with
// "Invalid login credentials" - not a wrong password, but no password.
//
// `hd` restricts the Google account chooser to the school domain, same as the
// portal does. It is a convenience, not a security control - the real gate is
// that a signed-in user still needs a matching staff_roles row to be an
// editor.
//
// Email+password is kept as a fallback for any account an admin creates by
// hand in the dashboard.
//
// This is a separate sign-in from the portal's, and deliberately so: the
// portal authenticates against Project A and Timetable's data now lives in
// Project B, whose PostgREST cannot verify an A-signed token. Same as
// Attendance. The session persists per browser, so it is once, not per visit.
const SCHOOL_DOMAIN = "harvestinternationalschool.in";

export default function LoginView({ client }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(null); // null | "google" | "password"
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  async function signInWithGoogle() {
    setError(null);
    setBusy("google");
    try {
      const { error: oauthError } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          // Back to this app, not the portal. Must also be listed under
          // Authentication -> URL Configuration in the Supabase dashboard, or
          // Google returns here and Supabase refuses the redirect.
          redirectTo: window.location.origin,
          queryParams: { hd: SCHOOL_DOMAIN },
        },
      });
      if (oauthError) throw oauthError;
      // Success navigates away; no state to clear.
    } catch (err) {
      setError(err.message || "Google sign-in failed");
      setBusy(null);
    }
  }

  async function submitPassword(e) {
    e.preventDefault();
    setError(null);
    setBusy("password");
    try {
      const { error: signInError } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      // Deliberately no reset here: the session change unmounts this
      // component, and clearing busy first would flash the form back to life.
    } catch (err) {
      setError(err.message || "Sign-in failed");
      setBusy(null);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Harvest Timetable</h1>
        <p className="auth-hint">Sign in with your school Google account.</p>

        <button type="button" onClick={signInWithGoogle} disabled={busy !== null}>
          {busy === "google" ? "Redirecting…" : "Sign in with Google"}
        </button>

        {error ? <p className="error-text">{error}</p> : null}

        {showPassword ? (
          <form onSubmit={submitPassword} className="auth-password">
            <label className="field-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <label className="field-label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <button type="submit" disabled={busy !== null || !email || !password}>
              {busy === "password" ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <button type="button" className="link-btn" onClick={() => setShowPassword(true)}>
            Use email and password instead
          </button>
        )}
      </div>
    </div>
  );
}
