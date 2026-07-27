export default function Header({ user, onLogout, onAdmin }) {
  if (!user) return null;

  return (
    <div className="hdr">
      <div className="hdr-inner">
        <div className="hdr-left">
          <div className="hdr-title">🎯 GoalTracker</div>
        </div>
        <div className="hdr-right">
          <div className="user-badge">{user.name} ({user.designation})</div>
          {user.is_admin && (
            <button className="btn btn-ghost" onClick={onAdmin}>Reviewer assignments</button>
          )}
          <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
        </div>
      </div>
    </div>
  );
}
