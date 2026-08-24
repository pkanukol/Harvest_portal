import { useEffect, useState } from "react";
import { fetchDefaultSchedules, upsertDefaultSchedule, deleteDefaultSchedule, ALL_CATEGORIES } from "../lib/defaultScheduleApi";

const OCCS = [1, 2, 3, 4, 5];
const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

// Editable per-category default working week. Drives the calendar when a person
// has no explicit schedule (the normal case). Mon-Fri use the weekday timing;
// Saturdays are working only on the ticked occurrences; Sundays are always off.
export default function DefaultScheduleConfig({ client, currentUserEmail }) {
  const [rows, setRows] = useState(null);
  const [addCat, setAddCat] = useState("");
  const [savingCat, setSavingCat] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function reload() {
    const data = await fetchDefaultSchedules(client);
    setRows(
      data.map((r) => ({
        ...r,
        weekday_check_in: hhmm(r.weekday_check_in),
        weekday_check_out: hhmm(r.weekday_check_out),
        sat_check_in: hhmm(r.sat_check_in),
        sat_check_out: hhmm(r.sat_check_out),
        sat_working_occurrences: r.sat_working_occurrences || [],
      }))
    );
  }
  useEffect(() => {
    reload().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  function patch(cat, field, value) {
    setRows((prev) => prev.map((r) => (r.category === cat ? { ...r, [field]: value } : r)));
  }
  function toggleOcc(cat, occ) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.category !== cat) return r;
        const has = r.sat_working_occurrences.includes(occ);
        return { ...r, sat_working_occurrences: has ? r.sat_working_occurrences.filter((o) => o !== occ) : [...r.sat_working_occurrences, occ].sort() };
      })
    );
  }

  async function save(row) {
    setSavingCat(row.category);
    setMessage(null);
    setError(null);
    try {
      await upsertDefaultSchedule(client, { ...row, updated_by: currentUserEmail });
      setMessage(`${row.category} saved.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingCat(null);
    }
  }

  async function remove(cat) {
    setError(null);
    try {
      await deleteDefaultSchedule(client, cat);
      await reload();
    } catch (e) {
      setError(e.message);
    }
  }

  async function addCategory() {
    if (!addCat) return;
    setRows((prev) => [
      ...prev,
      { category: addCat, weekday_check_in: "08:00", weekday_check_out: "14:10", grace_minutes: 7, sat_check_in: "09:00", sat_check_out: "14:45", sat_working_occurrences: [1, 3] },
    ]);
    setAddCat("");
  }

  if (error && !rows) return <p className="error-text">{error}</p>;
  if (!rows) return <p className="hint">Loading defaults…</p>;

  const missing = ALL_CATEGORIES.filter((c) => !rows.some((r) => r.category === c));

  return (
    <div>
      <p className="hint">
        The default working week per category, used when a person has no custom schedule (the normal case). Mon–Fri
        use the weekday timing; Saturdays are working only on the ticked occurrences (1st–5th); Sundays are always off.
        A per-person schedule, a calendar override, a vacation or WFH still overrides this.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "6px 6px" }}>Category</th>
              <th>Wkday in</th><th>Wkday out</th><th>Grace</th>
              <th>Sat in</th><th>Sat out</th><th>Working Saturdays</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.category} style={{ borderBottom: "1px solid #f0f1f3" }}>
                <td style={{ padding: "6px", fontWeight: 600 }}>{r.category}</td>
                <td><input type="time" value={r.weekday_check_in} onChange={(e) => patch(r.category, "weekday_check_in", e.target.value)} style={{ width: 110 }} /></td>
                <td><input type="time" value={r.weekday_check_out} onChange={(e) => patch(r.category, "weekday_check_out", e.target.value)} style={{ width: 110 }} /></td>
                <td><input type="number" min="0" value={r.grace_minutes} onChange={(e) => patch(r.category, "grace_minutes", e.target.value)} style={{ width: 56 }} /></td>
                <td><input type="time" value={r.sat_check_in} onChange={(e) => patch(r.category, "sat_check_in", e.target.value)} style={{ width: 110 }} /></td>
                <td><input type="time" value={r.sat_check_out} onChange={(e) => patch(r.category, "sat_check_out", e.target.value)} style={{ width: 110 }} /></td>
                <td>
                  <div style={{ display: "flex", gap: 3 }}>
                    {OCCS.map((o) => (
                      <button key={o} className={r.sat_working_occurrences.includes(o) ? "chip chip-active" : "chip"} style={{ padding: "3px 7px", fontSize: 11 }} onClick={() => toggleOcc(r.category, o)}>
                        {o}
                      </button>
                    ))}
                  </div>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn btn-primary btn-sm" disabled={savingCat === r.category} onClick={() => save(r)}>
                    {savingCat === r.category ? "…" : "Save"}
                  </button>
                  <button className="btn-link" style={{ color: "var(--red)", marginLeft: 6 }} onClick={() => remove(r.category)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {missing.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <select value={addCat} onChange={(e) => setAddCat(e.target.value)} style={{ width: "auto" }}>
            <option value="">Add a category…</option>
            {missing.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button className="btn-link" style={{ marginLeft: 8 }} onClick={addCategory}>+ Add (then Save)</button>
        </div>
      ) : null}

      {message ? <p className="hint" style={{ color: "var(--green)" }}>{message}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
