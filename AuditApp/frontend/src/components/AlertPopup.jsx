export default function AlertPopup({ alerts, onClose }) {
  if (!alerts || alerts.items.length === 0) return null;

  const isDraft = alerts.type === "auditor";
  const isTeacher = alerts.type === "teacher";

  const title = isDraft
    ? `${alerts.items.length} Draft Observation${alerts.items.length > 1 ? "s" : ""} Pending Finalisation`
    : `${alerts.items.length} Report${alerts.items.length > 1 ? "s" : ""} Awaiting Your Remarks`;

  const icon = isDraft ? "📋" : "✏️";
  const color = isDraft ? "var(--accent-amber, #e6a817)" : "var(--accent-teal, #2D9A8A)";

  return (
    <div className="alert-popup-overlay" onClick={onClose}>
      <div className="alert-popup" onClick={(e) => e.stopPropagation()}>
        <div className="alert-popup-header" style={{ borderColor: color }}>
          <span className="alert-popup-icon">{icon}</span>
          <span className="alert-popup-title">{title}</span>
          <button className="alert-popup-close" onClick={onClose}>✕</button>
        </div>
        <ul className="alert-popup-list">
          {alerts.items.map((item) => (
            <li key={item.id} className="alert-popup-item">
              <span className="alert-item-subject">{item.subject}</span>
              {item.teacher_name && (
                <span className="alert-item-teacher">👤 {item.teacher_name}</span>
              )}
              <span className="alert-item-date">📅 {item.date}</span>
            </li>
          ))}
        </ul>
        {isDraft && (
          <p className="alert-popup-hint">Open a teacher's record to review and finalise the draft.</p>
        )}
        {isTeacher && (
          <p className="alert-popup-hint">Open the report below to add your remarks.</p>
        )}
        <button className="alert-popup-dismiss" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
