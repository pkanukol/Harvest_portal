// The school portal is where every session starts: the Curriculum Tracker has
// no login of its own, only the SSO handoff from there. Hard-coded rather than
// read from VITE_PORTAL_URL, because a build that shipped without that variable
// sent an expired session to a page that cannot sign anyone back in.
const PORTAL_URL = "https://his-academy360.netlify.app";

export default function LoginView({ error }) {
  return (
    <div className="login-container">
      <div className="login-card">
        <div className="brand-section">
          <div className="brand-title">📚 Curriculum Tracker</div>
          <div className="brand-tagline">Harvest International School</div>
        </div>
        <p className="login-copy">
          Your login has expired. Sign in again through the school portal to get back to the
          Curriculum Tracker.
        </p>
        {error && <div className="form-error">Sign-in failed: {error}</div>}
        <a href={PORTAL_URL} className="btn btn-primary btn-block">
          Login expired — Relogin →
        </a>
      </div>
    </div>
  );
}
