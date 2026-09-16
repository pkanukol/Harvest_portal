export default function Header({ user, showDashboardNav, onDashboard, showSpaNav, onSpaDashboard, showMyReportsNav, onMyReports, showRoleFitmentNav, onRoleFitment, onLogout, headerSub }) {
  if (!user) return null;

  return (
    <div className="hdr">
      <div className="hdr-inner">
        <div className="hdr-left">
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
          {showMyReportsNav && (
            <button className="btn btn-dashboard" onClick={onMyReports}>
              &#128203; My Reports
            </button>
          )}
          {showRoleFitmentNav && (
            <button className="btn btn-dashboard" onClick={onRoleFitment}>
              &#128101; Role Fitment
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
