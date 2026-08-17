import { useEffect, useState } from "react";
import {
  fetchVacations,
  saveVacation,
  deleteVacation,
  computeDerivedEntitlement,
  fetchDerivedDays,
  saveDerivedDays,
  datesInRange,
} from "../lib/vacationApi";

// Derived-days editor for ACAD or CURR under one CBSE vacation.
function DerivedEditor({ client, vacation, category, currentUserEmail }) {
  const [info, setInfo] = useState(null); // { cbseDays, common, entitlement }
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([computeDerivedEntitlement(client, vacation, category), fetchDerivedDays(client, vacation.id, category)])
      .then(([i, days]) => {
        setInfo(i);
        setSelected(new Set(days));
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, vacation.id, category]);

  if (error) return <p className="error-text">{error}</p>;
  if (!info) return <p className="hint">Loading {category}…</p>;

  const dates = datesInRange(vacation.from_date, vacation.to_date);

  function toggle(d) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else if (next.size < info.entitlement) next.add(d);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      await saveDerivedDays(client, { vacation, category, dates: [...selected], createdBy: currentUserEmail });
      setMsg(`${category} vacation days saved.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: "2px solid var(--border)" }}>
      <p className="hint" style={{ marginBottom: 6 }}>
        <strong>{category}</strong>: entitled <strong>{info.entitlement}</strong> day(s) (½ of {info.cbseDays} = {Math.floor(info.cbseDays / 2)} − {info.common} common).
        Pick {info.entitlement} date{info.entitlement === 1 ? "" : "s"} — selected {selected.size}.
      </p>
      <div className="category-chips">
        {dates.map((d) => (
          <button
            key={d}
            className={selected.has(d) ? "chip chip-active" : "chip"}
            onClick={() => toggle(d)}
            disabled={!selected.has(d) && selected.size >= info.entitlement}
            style={{ fontSize: 11 }}
          >
            {d.slice(5)}
          </button>
        ))}
      </div>
      <button className="btn btn-primary btn-sm" style={{ marginTop: 6 }} disabled={busy} onClick={save}>
        {busy ? "Saving…" : `Save ${category} days`}
      </button>
      {msg ? <span className="hint" style={{ color: "var(--green)", marginLeft: 8 }}>{msg}</span> : null}
    </div>
  );
}

export default function VacationConfig({ client, currentUserEmail, branch }) {
  const [vacations, setVacations] = useState([]);
  const [name, setName] = useState("");
  const [board, setBoard] = useState("CBSE");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  async function reload() {
    setVacations(await fetchVacations(client));
  }
  useEffect(() => {
    reload().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  async function save() {
    setError(null);
    setMessage(null);
    if (!name.trim()) return setError("Name the vacation");
    if (!fromDate || !toDate) return setError("Pick both dates");
    if (toDate < fromDate) return setError("To date must be on or after from date");
    setSaving(true);
    try {
      await saveVacation(client, { name, board, fromDate, toDate, branch: branch || null, createdBy: currentUserEmail });
      setMessage("Vacation saved.");
      setName("");
      setFromDate("");
      setToDate("");
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(v) {
    setError(null);
    try {
      await deleteVacation(client, v);
      await reload();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <p className="hint">
        Mark a <strong>CBSE</strong> or <strong>PT</strong> vacation (Dussehra / Winter / Summer). ACAD & CURR get 50%
        of a CBSE vacation (rounded down, minus common holidays) — mark those specific days below. ADMIN gets none.
      </p>

      <label className="field-label">Vacation name</label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dussehra Vacation" />
      <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
        <div style={{ minWidth: 120 }}>
          <label className="field-label">Board</label>
          <select value={board} onChange={(e) => setBoard(e.target.value)}>
            <option value="CBSE">CBSE</option>
            <option value="PT">PT</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label className="field-label">From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label className="field-label">To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="hint" style={{ color: "var(--green)" }}>{message}</p> : null}

      <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={saving} onClick={save}>
        {saving ? "Saving…" : "Save vacation"}
      </button>

      <div style={{ marginTop: 18 }}>
        <strong>Vacations</strong>
        {vacations.length === 0 ? (
          <p className="empty-text">None yet.</p>
        ) : (
          vacations.map((v) => (
            <div key={v.id} className="card" style={{ marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  <strong>{v.name}</strong> · {v.board} · {v.from_date} → {v.to_date}
                </span>
                <div style={{ display: "flex", gap: 10 }}>
                  {v.board === "CBSE" ? (
                    <button className="btn-link" onClick={() => setExpanded(expanded === v.id ? null : v.id)}>
                      {expanded === v.id ? "Hide ACAD/CURR" : "Set ACAD/CURR"}
                    </button>
                  ) : null}
                  <button className="btn-link" style={{ color: "var(--red)" }} onClick={() => remove(v)}>Remove</button>
                </div>
              </div>
              {expanded === v.id && v.board === "CBSE" ? (
                <div style={{ marginTop: 8 }}>
                  <DerivedEditor client={client} vacation={v} category="ACAD" currentUserEmail={currentUserEmail} />
                  <DerivedEditor client={client} vacation={v} category="CURR" currentUserEmail={currentUserEmail} />
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
