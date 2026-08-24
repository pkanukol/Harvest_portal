import ViewAsSwitcher from "./ViewAsSwitcher";

// No logout control here by design — this app is embedded in the school
// portal shell, which owns signing out (same as AuditApp).
export default function Header({ user, realUser, token, view, onDashboard, onViewAs, onResetToMe, branch, branches = [], onBranchChange }) {
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
            {/* Campus selector, for every role. A single-campus account has
                nothing to choose, so it reads as a label instead. */}
            {branches.length > 1 ? (
              <select
                className="form-control hdr-branch"
                value={branch}
                onChange={(e) => onBranchChange(e.target.value)}
              >
                <option value="">All branches</option>
                {branches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            ) : branches.length === 1 ? (
              <div className="user-badge">{branches[0]}</div>
            ) : null}
            {canSwitch && <ViewAsSwitcher token={token} onPicked={onViewAs} />}
            <div className="user-badge">{user.name} ({user.role})</div>
            {view !== "dashboard" && (
              <button className="btn btn-ghost" onClick={onDashboard}>Dashboard</button>
            )}
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
