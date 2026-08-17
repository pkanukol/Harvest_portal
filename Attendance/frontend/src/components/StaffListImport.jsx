import { useEffect, useState } from "react";
import { parseStaffListWorkbook, importStaffList } from "../lib/staffListImport";
import { distinctBranches } from "../lib/rolesApi";

const KNOWN_BRANCHES = ["Kodathi", "Attibele"];

// Admin uploader for the staff_list workbook (one sheet per category). You pick
// the BRANCH first; it's stamped on every row in the uploaded file. Populates
// staff_master - the identity table everything else keys off by employee_id.
export default function StaffListImport({ client }) {
  const [branchOptions, setBranchOptions] = useState(KNOWN_BRANCHES);
  const [branch, setBranch] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [parsed, setParsed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    distinctBranches(client)
      .then((bs) => setBranchOptions([...new Set([...KNOWN_BRANCHES, ...bs])]))
      .catch(() => {});
  }, [client]);

  const chosenBranch = (newBranch.trim() || branch).trim();

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setDone(null);
    setParsed(null);
    setLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const result = parseStaffListWorkbook(buffer);
      if (result.rows.length === 0) {
        throw new Error("No staff rows found. Expected one sheet per category (CBSE, ADMIN, IB, …) with an 'Employee ID' column.");
      }
      setParsed(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  async function handleConfirm() {
    if (!parsed) return;
    setImporting(true);
    setError(null);
    try {
      const { upserted } = await importStaffList(client, parsed.rows, chosenBranch);
      setDone({ upserted, branch: chosenBranch });
      setParsed(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <p className="hint">
        Pick the <strong>branch</strong>, then upload that branch's <strong>staff_list</strong> workbook (one sheet per
        category: CBSE, CURRICULUM TEAM, PARTTIME, ACAD-ADMIN, ADMIN, IB, MONT). The chosen branch is stamped on every
        row. Matched to staff_master by Employee ID - existing updated, new added, nobody deleted.
      </p>

      <label className="field-label">Branch</label>
      <div className="category-chips">
        {branchOptions.map((b) => (
          <button
            key={b}
            className={!newBranch.trim() && branch === b ? "chip chip-active" : "chip"}
            onClick={() => { setBranch(b); setNewBranch(""); }}
          >
            {b}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="…or type a new branch name"
        value={newBranch}
        onChange={(e) => setNewBranch(e.target.value)}
        style={{ maxWidth: 260, marginBottom: 10 }}
      />

      {chosenBranch ? (
        <p className="hint" style={{ marginTop: 0 }}>Uploading for branch: <strong>{chosenBranch}</strong></p>
      ) : (
        <p className="hint" style={{ marginTop: 0, color: "#b7791f" }}>Choose a branch first.</p>
      )}

      <input type="file" accept=".xls,.xlsx" onChange={handleFileChange} disabled={!chosenBranch || loading || importing} />

      {loading ? <p className="hint">Parsing…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {parsed ? (
        <div className="card" style={{ marginTop: 16 }}>
          <strong>{parsed.rows.length} staff members parsed</strong>
          <p className="hint">
            {Object.entries(parsed.perCategory)
              .map(([cat, n]) => `${cat}: ${n}`)
              .join(" · ")}
          </p>
          {parsed.skippedSheets.length > 0 ? (
            <p className="hint" style={{ color: "#b7791f" }}>
              Sheets skipped (unknown category): {parsed.skippedSheets.join(", ")}
            </p>
          ) : null}
          {parsed.warnings.length > 0 ? (
            <details style={{ marginTop: 6 }}>
              <summary className="hint" style={{ color: "#b7791f", cursor: "pointer" }}>
                {parsed.warnings.length} warning(s)
              </summary>
              <ul className="hint" style={{ marginTop: 4 }}>
                {parsed.warnings.slice(0, 30).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {parsed.warnings.length > 30 ? <li>…</li> : null}
              </ul>
            </details>
          ) : null}
          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={importing} onClick={handleConfirm}>
            {importing ? "Importing…" : `Import ${parsed.rows.length} staff members`}
          </button>
        </div>
      ) : null}

      {done ? (
        <div className="card" style={{ marginTop: 16 }}>
          <strong style={{ color: "var(--green)" }}>Staff list imported</strong>
          <p className="hint">{done.upserted} staff members written to staff_master for branch <strong>{done.branch}</strong>.</p>
        </div>
      ) : null}
    </div>
  );
}
