export default function Header({ user, view, onDashboard, onLogout }) {
  if (!user) return null;

  return (
    <div className="hdr">
      <div className="hdr-inner">
        <div className="hdr-left">
          <div className="hdr-title">📚 Curriculum Tracker</div>
        </div>
        <div className="hdr-right">
          <div className="user-badge">{user.name} ({user.role})</div>
          {view !== "dashboard" && (
            <button className="btn btn-ghost" onClick={onDashboard}>Dashboard</button>
          )}
          <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
        </div>
      </div>
    </div>
  );
}
