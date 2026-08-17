import { useEffect, useState } from "react";
import { fetchLeavePolicies, upsertLeavePolicy } from "../lib/leaveApi";

const MONTHS = [
  { v: 4, label: "April" },
  { v: 5, label: "May" },
  { v: 6, label: "June" },
  { v: 7, label: "July" },
];

// Admin editor for category_leave_policy - the CL/EL counts and the month CL
// accrual starts, per category. Seeded ADMIN 12 CL / 15 EL (accrues from April),
// everyone else 10 CL / 0 EL (accrues from June).
export default function LeavePolicyConfig({ client, currentUserEmail }) {
  const [rows, setRows] = useState(null);
  const [savingCat, setSavingCat] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchLeavePolicies(client)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [client]);

  function updateField(category, field, value) {
    setRows((prev) => prev.map((r) => (r.category === category ? { ...r, [field]: value } : r)));
  }

  async function save(row) {
    setSavingCat(row.category);
    setMessage(null);
    setError(null);
    try {
      await upsertLeavePolicy(client, {
        category: row.category,
        clAnnual: parseInt(row.cl_annual, 10) || 0,
        elAnnual: parseInt(row.el_annual, 10) || 0,
        clStartMonth: parseInt(row.cl_start_month, 10) || 6,
        updatedBy: currentUserEmail,
      });
      setMessage(`${row.category} saved.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingCat(null);
    }
  }

  if (error && !rows) return <p className="error-text">{error}</p>;
  if (!rows) return <p className="hint">Loading policy…</p>;

  return (
    <div>
      <p className="hint">
        Casual (CL) and Earned (EL) leaves per category. CL accrues +1 each month from the start month; EL is a flat
        annual grant (only where set, and only after 1 year of service).
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e4e7ec" }}>
              <th style={{ padding: "8px 6px" }}>Category</th>
              <th style={{ padding: "8px 6px" }}>CL / yr</th>
              <th style={{ padding: "8px 6px" }}>EL / yr</th>
              <th style={{ padding: "8px 6px" }}>CL starts</th>
              <th style={{ padding: "8px 6px" }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category} style={{ borderBottom: "1px solid #f0f1f3" }}>
                <td style={{ padding: "6px", fontWeight: 600 }}>{row.category}</td>
                <td style={{ padding: "6px" }}>
                  <input type="number" min="0" value={row.cl_annual} style={{ width: 64 }} onChange={(e) => updateField(row.category, "cl_annual", e.target.value)} />
                </td>
                <td style={{ padding: "6px" }}>
                  <input type="number" min="0" value={row.el_annual} style={{ width: 64 }} onChange={(e) => updateField(row.category, "el_annual", e.target.value)} />
                </td>
                <td style={{ padding: "6px" }}>
                  <select value={row.cl_start_month} onChange={(e) => updateField(row.category, "cl_start_month", e.target.value)}>
                    {MONTHS.map((m) => (
                      <option key={m.v} value={m.v}>{m.label}</option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: "6px" }}>
                  <button className="btn btn-primary" disabled={savingCat === row.category} onClick={() => save(row)}>
                    {savingCat === row.category ? "Saving…" : "Save"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {message ? <p className="hint" style={{ color: "var(--green)" }}>{message}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
