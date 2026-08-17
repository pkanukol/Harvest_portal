// Simple modal listing every LOP entry (specific dates for sandwich / excess
// leave, plus per-month short-day groups). Opened from the "LOP: N" link beside
// the calendar.
export default function LopListPopover({ visible, onClose, entries, total }) {
  if (!visible) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
        <strong style={{ fontSize: 15 }}>Loss of Pay — {total} day{total === 1 ? "" : "s"} this year</strong>
        {entries.length === 0 ? (
          <p className="hint" style={{ marginTop: 10 }}>No LOP days.</p>
        ) : (
          <div style={{ marginTop: 10 }}>
            {entries.map((e, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 12.5 }}>{e.label}</span>
                {e.date ? <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{e.date}</span> : null}
              </div>
            ))}
          </div>
        )}
        <div className="modal-close-row">
          <button className="btn-link" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
