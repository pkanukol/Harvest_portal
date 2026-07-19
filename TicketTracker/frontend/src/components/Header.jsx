const LOCATIONS = ["Kodathi", "Attibele"];

export default function Header({ user, view, location, onLocationChange, onList, onLogout }) {
  if (!user) return null;

  return (
    <div className="hdr">
      <div className="hdr-inner">
        <div className="hdr-left">
          <img src="/logo.png" alt="Harvest International School" className="hdr-logo-img" />
          <div className="hdr-title">🎫 Ticket Tracker</div>
          {user.home_location ? (
            <div className="location-badge-locked" title="Your campus is set based on your account">
              {user.home_location} Campus
            </div>
          ) : (
            <div className="location-toggle" role="group" aria-label="Campus location">
              {LOCATIONS.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  className={`location-toggle-btn${loc === location ? " active" : ""}`}
                  onClick={() => onLocationChange(loc)}
                >
                  {loc} Campus
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="hdr-right">
          <div className="user-badge">{user.name}</div>
          {view !== "list" && (
            <button className="btn btn-ghost" onClick={onList}>All Tickets</button>
          )}
          <button className="btn btn-ghost hdr-logout" onClick={onLogout}>Logout</button>
        </div>
      </div>
    </div>
  );
}
