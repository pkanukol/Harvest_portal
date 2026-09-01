export default function Header({ user, onAdmin, onHeatmap, onViewAs, onHrReport }) {
  if (!user) return null;

  return (
    <div className="hdr">
      <div className="hdr-inner">
        <div className="hdr-left">
          <div className="hdr-title">🎯 Goal Tracker</div>
        </div>
        <div className="hdr-right">
          <div className="user-badge">{user.name} ({user.designation})</div>
          {user.can_view_overview && (
            <button className="btn btn-ghost" onClick={onHeatmap}>Goals overview</button>
          )}
          {user.is_hr && (
            <button className="btn btn-ghost" onClick={onHrReport}>HR report</button>
          )}
          {user.can_view_as && (
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
