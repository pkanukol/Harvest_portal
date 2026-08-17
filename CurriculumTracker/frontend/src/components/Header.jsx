import ViewAsSwitcher from "./ViewAsSwitcher";

export default function Header({ user, realUser, token, view, onDashboard, onLogout, onViewAs, onResetToMe }) {
  if (!user) return null;

  const isViewingAs = Boolean(realUser);
  // The switcher is offered on the previewer's own allowlist flag, never the
  // previewed user's — a previewed session must not be able to switch onward.
  const canSwitch = !isViewingAs && user.can_view_as;

  return (
    <>
      <div className="hdr">
        <div className="hdr-inner">
          <div className="hdr-left">
            <div className="hdr-title">📚 Curriculum Tracker</div>
          </div>
          <div className="hdr-right">
            {canSwitch && <ViewAsSwitcher token={token} onPicked={onViewAs} />}
            <div className="user-badge">{user.name} ({user.role})</div>
            {view !== "dashboard" && (
              <button className="btn btn-ghost" onClick={onDashboard}>Dashboard</button>
            )}
            <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
          </div>
        </div>
      </div>

      {isViewingAs && (
        <div className="view-as-banner">
          <span>
            Previewing as <strong>{user.name}</strong> ({user.role}
            {user.subject ? ` · ${user.subject}` : ""}) — anything you save now is recorded as them, not as {realUser.name}.
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onResetToMe}>Reset to me</button>
        </div>
      )}
    </>
  );
}
