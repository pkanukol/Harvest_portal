export default function Header({ user, view, onList, onNew, onLogout }) {
  if (!user) return null;

  return (
    <div className="hdr">
      <div className="hdr-inner">
        <div className="hdr-left">
          <img src="/logo.png" alt="Harvest International School" className="hdr-logo-img" />
          <div className="hdr-title">🎫 Ticket Tracker</div>
        </div>
        <div className="hdr-right">
          <div className="user-badge">{user.name}</div>
          {view !== "list" && (
            <button className="btn btn-ghost" onClick={onList}>All Tickets</button>
          )}
          {view !== "new" && (
            <button className="btn btn-primary" onClick={onNew}>+ New Ticket</button>
          )}
          <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
        </div>
      </div>
    </div>
  );
}
