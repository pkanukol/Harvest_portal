import { useEffect, useState } from "react";
import { fetchWfhForRange, markWfh, unmarkWfh, canWfh } from "../lib/wfhApi";
import { fiscalYearOf } from "../lib/lopApi";
import { toIsoDate } from "../lib/dateUtils";

const TODAY_ISO = toIsoDate(new Date());

// Inline WFH editor for one person (this fiscal year). Used both by the person
// (self, in a modal) and by an admin (By Person tab). Only ACAD/ADMIN/CURR.
export default function WfhManager({ client, staffRow, currentUserEmail, onChange }) {
  const [rows, setRows] = useState(null);
  const [date, setDate] = useState(TODAY_ISO);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const now = new Date();
  const fy = fiscalYearOf(now.getFullYear(), now.getMonth());
  const from = `${fy}-04-01`;
  const to = `${fy + 1}-03-31`;

  async function reload() {
    setRows(await fetchWfhForRange(client, staffRow.id, from, to));
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, staffRow?.id]);

  if (!canWfh(staffRow?.category)) {
    return <p className="hint">Work-from-home is only available for ACAD, ADMIN and CURR staff.</p>;
  }

  async function add() {
    setError(null);
    if (!date) return setError("Pick a date");
    setBusy(true);
    try {
      await markWfh(client, { staffId: staffRow.id, wfhDate: date, reason, createdBy: currentUserEmail });
      setReason("");
      await reload();
      onChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(d) {
    setError(null);
    setBusy(true);
    try {
      await unmarkWfh(client, staffRow.id, d);
      await reload();
      onChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="hint">Mark work-from-home days ({fy}-{fy + 1}). A WFH day counts as present.</p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label className="field-label">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 170 }} />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="field-label">Reason</label>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="optional" />
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={add}>Add</button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div style={{ marginTop: 12 }}>
        {rows == null ? (
          <p className="hint">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="empty-text">No WFH days marked.</p>
        ) : (
          rows.map((r) => (
            <div key={r.wfh_date} className="list-row">
              <span>{r.wfh_date}{r.reason ? ` — ${r.reason}` : ""}</span>
              <button className="btn-link" style={{ color: "var(--red)" }} disabled={busy} onClick={() => remove(r.wfh_date)}>Remove</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
