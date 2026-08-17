import { useEffect, useState } from "react";
import { fetchDistinctCategoryValues } from "../lib/staffMaster";
import StaffSearchPicker from "./StaffSearchPicker";
import { fetchOverrides, saveOverride, deleteOverride, recomputeOverride } from "../lib/calendarOverrideApi";

// Admin editor for one-off calendar overrides. Scope precedence: a specific
// person beats a category beats everyone. kind='holiday' turns the day off
// (Saturday off, or a working day made a holiday-with-reason); kind='working'
// forces a normally-off day (e.g. a Saturday) to be a working day.
export default function CalendarOverrideConfig({ client, currentUserEmail, branchScope }) {
  const [overrides, setOverrides] = useState([]);
  const [categories, setCategories] = useState([]);
  const [scope, setScope] = useState("all"); // 'all' | 'category' | 'person'
  const [category, setCategory] = useState("");
  const [person, setPerson] = useState(null);
  const [eventDate, setEventDate] = useState("");
  const [kind, setKind] = useState("holiday");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  async function reload() {
    setOverrides(await fetchOverrides(client));
  }

  useEffect(() => {
    fetchDistinctCategoryValues(client).then(setCategories).catch(() => {});
    reload().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  function scopeArgs() {
    if (scope === "person") return { staffId: person?.id || null, category: null };
    if (scope === "category") return { staffId: null, category: category || null };
    return { staffId: null, category: null };
  }

  async function save() {
    setError(null);
    setMessage(null);
    if (!eventDate) return setError("Pick a date");
    if (scope === "category" && !category) return setError("Pick a category");
    if (scope === "person" && !person) return setError("Pick a person");
    const args = scopeArgs();
    setSaving(true);
    try {
      await saveOverride(client, { eventDate, ...args, branch: branchScope || null, kind, reason, createdBy: currentUserEmail });
      await recomputeOverride(client, { eventDate, ...args, branch: branchScope || null });
      setMessage("Override saved.");
      setReason("");
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(o) {
    setError(null);
    setMessage(null);
    try {
      await deleteOverride(client, o.id);
      await recomputeOverride(client, { eventDate: o.event_date, category: o.category, staffId: o.staff_id, branch: o.branch });
      await reload();
    } catch (e) {
      setError(e.message);
    }
  }

  function scopeLabel(o) {
    if (o.staff_id) return `Person ${o.staff_id}`;
    if (o.category) return o.category;
    return "Everyone";
  }

  return (
    <div>
      <p className="hint">
        Override a specific date: mark it <strong>off</strong> (Saturday off, or a working day made a holiday with a
        reason) or <strong>working</strong> (force a normally-off Saturday on). A person-scoped override beats a
        category one, which beats everyone.
      </p>

      <label className="field-label">Applies to</label>
      <div className="category-chips">
        <button className={scope === "all" ? "chip chip-active" : "chip"} onClick={() => setScope("all")}>Everyone</button>
        <button className={scope === "category" ? "chip chip-active" : "chip"} onClick={() => setScope("category")}>By category</button>
        <button className={scope === "person" ? "chip chip-active" : "chip"} onClick={() => setScope("person")}>By person</button>
      </div>

      {scope === "category" ? (
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Select category…</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      ) : null}

      {scope === "person" ? (
        person ? (
          <div className="list-row" style={{ paddingTop: 6, paddingBottom: 6 }}>
            <strong>{person.name} ({person.id})</strong>
            <button className="btn-link" onClick={() => setPerson(null)}>Change</button>
          </div>
        ) : (
          <StaffSearchPicker client={client} onSelect={setPerson} />
        )
      ) : null}

      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="field-label">Date</label>
          <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="field-label">Make it</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="holiday">Off / Holiday</option>
            <option value="working">Working day</option>
          </select>
        </div>
      </div>

      <label className="field-label">Reason (shows on the calendar)</label>
      <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Diwali, swapped Saturday" />

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="hint" style={{ color: "var(--green)" }}>{message}</p> : null}

      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={saving} onClick={save}>
        {saving ? "Saving…" : "Save override"}
      </button>

      <div style={{ marginTop: 18 }}>
        <strong>Existing overrides</strong>
        {overrides.length === 0 ? (
          <p className="empty-text">None yet.</p>
        ) : (
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Date</th><th>Scope</th><th>Kind</th><th>Reason</th><th></th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={o.id}>
                  <td>{o.event_date}</td>
                  <td>{scopeLabel(o)}</td>
                  <td>{o.kind === "holiday" ? "Off" : "Working"}</td>
                  <td>{o.reason || "—"}</td>
                  <td><button className="btn-link" style={{ color: "var(--red)" }} onClick={() => remove(o)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
