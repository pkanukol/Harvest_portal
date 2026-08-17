import { useEffect, useState } from "react";
import { fetchStaybackOverrides, addStaybackOverride, removeStaybackOverride, WEEKDAY_LABELS } from "../lib/scheduleApi";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export default function StaybackOverride({ client, staff }) {
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weekday, setWeekday] = useState(1);
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setOverrides(await fetchStaybackOverrides(client, staff.id));
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff.id]);

  async function add() {
    setError(null);
    if (!TIME_RE.test(time)) {
      setError("Stay-back checkout time must be HH:MM (24h)");
      return;
    }
    setSaving(true);
    try {
      await addStaybackOverride(client, { staffId: staff.id, weekday, staybackCheckOutTime: time, reason });
      setTime("");
      setReason("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    await removeStaybackOverride(client, id);
    await load();
  }

  return (
    <div>
      <p className="hint">
        Stay-back days extend the checkout time for {staff.name} on specific weekdays (e.g. 4:00pm instead of
        2:10pm), without changing their normal schedule for other days.
      </p>

      <div className="card">
        <label className="field-label">Weekday</label>
        <div className="category-chips">
          {WEEKDAY_LABELS.map((label, i) => (
            <button key={i} className={i === weekday ? "chip chip-active" : "chip"} onClick={() => setWeekday(i)}>
              {label}
            </button>
          ))}
        </div>
        <label className="field-label">Stay-back checkout time</label>
        <input type="text" placeholder="16:00" value={time} onChange={(e) => setTime(e.target.value)} />
        <label className="field-label">Reason (optional)</label>
        <input type="text" placeholder="e.g. Class 10 remedial" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error ? <p className="error-text">{error}</p> : null}
        <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={saving} onClick={add}>
          Add stay-back day
        </button>
      </div>

      {loading ? (
        <p className="hint">Loading…</p>
      ) : (
        <div style={{ marginTop: 12 }}>
          {overrides.map((item) => (
            <div key={item.id} className="list-row">
              <div>
                <strong>{WEEKDAY_LABELS[item.weekday]}</strong> - until {item.stayback_check_out_time.slice(0, 5)}
                {item.reason ? <div className="hint" style={{ margin: 0 }}>{item.reason}</div> : null}
              </div>
              <button className="btn-link" onClick={() => remove(item.id)}>Remove</button>
            </div>
          ))}
          {overrides.length === 0 ? <p className="empty-text">No stay-back days configured.</p> : null}
        </div>
      )}
    </div>
  );
}
