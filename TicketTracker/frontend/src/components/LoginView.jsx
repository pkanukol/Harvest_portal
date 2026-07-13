export default function LoginView() {
  const portalUrl = import.meta.env.VITE_PORTAL_URL || "http://localhost:3000/portal/login.html";

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="brand-section">
          <div className="brand-title">🎫 Ticket Tracker</div>
          <div className="brand-tagline">Harvest International School</div>
        </div>
        <p className="login-copy">Please sign in through the school portal to log or track a ticket.</p>
        <a href={portalUrl} className="btn btn-primary btn-block">
          Go to School Portal →
        </a>
      </div>
    </div>
  );
}
