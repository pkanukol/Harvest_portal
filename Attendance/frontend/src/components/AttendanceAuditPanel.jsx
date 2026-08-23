import { useState } from "react";
import { fetchAttendanceNotRead } from "../lib/biometricReportImport";

function monthBounds(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const p2 = (n) => String(n).padStart(2, "0");
  return [`${y}-${p2(m)}-01`, `${y}-${p2(m)}-${p2(last)}`];
}

// Audit: which staff have NO attendance read for a month (weren't in the
// uploaded biometric file). Visible only to the audit allowlist (see App).
export default function AttendanceAuditPanel({ client }) {
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      const [from, to] = monthBounds(ym);
      setRows(await fetchAttendanceNotRead(client, from, to, null));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Group by branch for a readable list.
  const byBranch = {};
  (rows ?? []).forEach((r) => {
    (byBranch[r.branch] = byBranch[r.branch] || []).push(r);
  });

  return (
    <div>
      <h3 style={{ fontSize: 15, marginBottom: 4 }}>Attendance check — who wasn't read</h3>
      <p className="hint">
        Staff with <strong>no attendance data</strong> for the chosen month — i.e. they weren't in the uploaded
        biometric file (or it hasn't been imported). Handy after a partial / half-month upload.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div>
          <label className="field-label">Month</label>
          <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} style={{ maxWidth: 170 }} />
        </div>
        <button className="btn btn-primary" onClick={run} disabled={loading}>
          {loading ? "Checking…" : "Check"}
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {rows != null ? (
        rows.length === 0 ? (
          <p className="hint" style={{ color: "var(--green)", marginTop: 12 }}>
            Everyone (branch-assigned) has attendance for this month.
          </p>
        ) : (
          <div style={{ marginTop: 12 }}>
            <p className="hint" style={{ fontWeight: 600 }}>{rows.length} staff with no attendance read:</p>
            {Object.entries(byBranch).map(([branch, list]) => (
              <div key={branch} style={{ marginTop: 8 }}>
                <strong>{branch} ({list.length})</strong>
                <table style={{ marginTop: 4 }}>
                  <thead>
                    <tr><th>Employee ID</th><th>Name</th><th>Category</th></tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.employee_id}>
                        <td>{r.employee_id}</td>
                        <td>{r.employee_name}</td>
                        <td>{r.category}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
