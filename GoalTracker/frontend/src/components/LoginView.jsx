import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

// Local-testing-only shortcut, restricted to a fixed allowlist. import.meta.env.DEV
// is false in any `vite build` production bundle regardless of environment,
// and the backend (/api/dev/login) independently 404s for any email not in
// its own allowlist and unless it's running against the local SQLite DB - so
// these buttons are inert three ways over, not just hidden, once deployed or
// used by anyone else. Kept in sync with DEV_LOGIN_ALLOWED_EMAILS in
// GoalTracker/backend/app/config.py.
const DEV_TEST_USERS = [
  { label: "Pavani (APM)", email: "pavani.k@harvestinternationalschool.in" },
  { label: "Principal", email: "principal.kodathi@harvestinternationalschool.in" },
  { label: "Abhinav (MD)", email: "abhinav_g@harvestinternationalschool.in" },
  { label: "Coordinator", email: "sumathi@harvestinternationalschool.in" },
  { label: "SME / HOD", email: "timsy.thomas@harvestinternationalschool.in" },
  { label: "Curriculum Head", email: "chitra@harvestinternationalschool.in" },
];

export default function LoginView({ error }) {
  const portalUrl = import.meta.env.VITE_PORTAL_URL || "https://his-academy360.netlify.app";
  const { login } = useAuth();
  const [devError, setDevError] = useState("");
  const [loggingInAs, setLoggingInAs] = useState(null);

  async function handleDevLogin(email) {
    setLoggingInAs(email);
    setDevError("");
    try {
      const data = await api.devLogin(email);
      login(data);
    } catch (err) {
      setDevError(err.message);
    } finally {
      setLoggingInAs(null);
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="brand-section">
          <div className="brand-title">🎯 Goal Tracker</div>
          <div className="brand-tagline">Harvest International School</div>
        </div>
        <p className="login-copy">Please sign in through the school portal to access GoalTracker.</p>
        {error && <div className="form-error">Sign-in failed: {error}</div>}
        <a href={portalUrl} className="btn btn-primary btn-block">
          Go to School Portal →
        </a>

        {import.meta.env.DEV && (
          <div className="dev-login-panel">
            <div className="hint-text" style={{ marginTop: 20, marginBottom: 8 }}>
              Local testing only - skips real sign-in:
            </div>
            {devError && <div className="form-error">{devError}</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {DEV_TEST_USERS.map((u) => (
                <button
                  key={u.email}
                  className="btn btn-ghost btn-sm"
                  disabled={loggingInAs === u.email}
                  onClick={() => handleDevLogin(u.email)}
                >
                  {loggingInAs === u.email ? "Signing in…" : `Test as ${u.label}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
