import { useEffect, useState } from "react";
import { fetchHourPermissionForMonth, applyHourPermission } from "../lib/hourPermissionApi";
import { toIsoDate } from "../lib/dateUtils";

const TODAY_ISO = toIsoDate(new Date());

// One 1-hour permission per calendar month. The DB enforces the cap and the
// Saturday-emergency rule; this just shows the current month's status and inserts.
export default function HourPermissionModal({ client, visible, onClose, staffRow, onSubmitted }) {
  const [existing, setExisting] = useState(null);
  const [permissionDate, setPermissionDate] = useState(TODAY_ISO);
  const [reason, setReason] = useState("");
  const [isEmergency, setIsEmergency] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible || !staffRow) return;
    setPermissionDate(TODAY_ISO);
    setReason("");
    setIsEmergency(false);
    setError(null);
    setLoading(true);
    const d = new Date();
    fetchHourPermissionForMonth(client, staffRow.id, d.getFullYear(), d.getMonth())
      .then((rows) => setExisting(rows[0] ?? null))
      .finally(() => setLoading(false));
  }, [visible, staffRow, client]);

  if (!visible) return null;

  async function submit() {
    setError(null);
    if (!permissionDate) return setError("Pick a date");
    if (!reason.trim()) return setError("Reason is required");
    setSubmitting(true);
    try {
      await applyHourPermission(client, {
        staffId: staffRow.id,
        staffEmail: staffRow.email,
        permissionDate,
        reason,
        isEmergency,
        appliedBy: staffRow.email,
      });
      onSubmitted?.();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <strong style={{ fontSize: 16 }}>1-hour permission</strong>

        {loading ? (
          <p className="hint">Loading…</p>
        ) : existing ? (
          <p className="hint" style={{ marginTop: 10 }}>
            You've already used this month's 1-hour permission ({existing.permission_date}
            {existing.reason ? ` — ${existing.reason}` : ""}). Only one is allowed per calendar month.
          </p>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 8 }}>One permission per calendar month. Saturdays are for emergencies only.</p>
            <label className="field-label">Date</label>
            <input type="date" value={permissionDate} onChange={(e) => setPermissionDate(e.target.value)} />
            <label className="field-label">Reason *</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" />
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13 }}>
              <input type="checkbox" checked={isEmergency} onChange={(e) => setIsEmergency(e.target.checked)} style={{ width: "auto" }} />
              Emergency (needed for a Saturday)
            </label>

            {error ? <p className="error-text">{error}</p> : null}

            <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={submitting} onClick={submit}>
              {submitting ? "Submitting…" : "Apply for permission"}
            </button>
          </>
        )}

        <div className="modal-close-row">
          <button className="btn-link" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
