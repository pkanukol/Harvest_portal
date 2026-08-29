import { PORTAL_URL } from "../portal";

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
