export default function LoginView({ error }) {
  const portalUrl = import.meta.env.VITE_PORTAL_URL || "http://localhost:3000/portal/login.html";

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="brand-section">
          <div className="brand-title">🎯 GoalTracker</div>
          <div className="brand-tagline">Harvest International School</div>
        </div>
        <p className="login-copy">Please sign in through the school portal to access GoalTracker.</p>
        {error && <div className="form-error">Sign-in failed: {error}</div>}
        <a href={portalUrl} className="btn btn-primary btn-block">
          Go to School Portal →
        </a>
      </div>
    </div>
  );
}
