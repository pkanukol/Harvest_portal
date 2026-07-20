export default function Header({ user, showDashboardNav, onDashboard, showSpaNav, onSpaDashboard, onLogout, headerSub }) {
  if (!user) return null;

  return (
    <div className="hdr">
      <div className="hdr-inner">
        <div className="hdr-left">
          <img src="/logo.png" alt="Harvest International School" className="hdr-logo-img" />
          <div className="hdr-sub" style={{ marginTop: 0 }}>{headerSub}</div>
        </div>
        <div className="hdr-right">
          <div className="user-badge">
            {user.name} ({user.role.toUpperCase()})
          </div>
          {showDashboardNav && (
            <button className="btn btn-dashboard" onClick={onDashboard}>
              &#128202; Dashboard
            </button>
          )}
          {showSpaNav && (
            <button className="btn btn-dashboard" onClick={onSpaDashboard}>
              &#127942; SPA Observation
            </button>
          )}
          <button className="btn btn-logout" onClick={onLogout}>
            &#9211; Logout
          </button>
        </div>
      </div>
    </div>
  );
}
