export default function Header({ user, onAdmin, onHeatmap, onViewAs }) {
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
            <button className="btn btn-ghost" onClick={onHeatmap}>Goals overview</button>
          )}
          {user.is_admin && (
            <button className="btn btn-ghost" onClick={onViewAs}>View as…</button>
          )}
          {user.can_manage_reviewers && (
            <button className="btn btn-ghost" onClick={onAdmin}>Reviewer assignments</button>
          )}
        </div>
      </div>
    </div>
  );
}
