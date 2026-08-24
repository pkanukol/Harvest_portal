// Always-visible reminder that this session is someone else's, with the way
// back. Deliberately loud and fixed: the danger of an "act as" session is
// forgetting you are in one and doing real work as another person.
export default function ActingAsBanner({ user, onReturn, returning }) {
  return (
    <div className="acting-banner">
      <span className="acting-banner-dot" />
      <span className="acting-banner-text">
        You are acting as <strong>{user.name}</strong>
        {user.designation ? ` (${user.designation})` : ""}. Anything you do here is recorded as them.
      </span>
      <button className="btn btn-sm acting-banner-btn" onClick={onReturn} disabled={returning}>
        {returning ? "Returning…" : "Return to my account"}
      </button>
    </div>
  );
}
