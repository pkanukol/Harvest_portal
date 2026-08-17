import { useState } from "react";
import { parseFestivalHolidayXlsx, importFestivalHolidays } from "../lib/festivalHolidayImport";

const CATEGORY_LABELS = { STUDENTS_CBSE: "Students_CBSE", CBSE: "CBSE", ACAD: "Acad Admin", ADMIN: "Admin", CURR: "Curriculum Team" };

export default function FestivalHolidayImport({ client, currentUserEmail, branch }) {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setDone(null);
    setRows(null);
    setLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseFestivalHolidayXlsx(buffer);
      if (parsed.length === 0) throw new Error("No holiday rows found in this file.");
      setRows(parsed.sort((a, b) => a.holidayDate.localeCompare(b.holidayDate)));
      setFileName(file.name);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  async function handleConfirmImport() {
    if (!rows) return;
    setImporting(true);
    setError(null);
    try {
      const result = await importFestivalHolidays(client, rows, currentUserEmail, branch || null);
      setDone(result);
      setRows(null);
      setFileName(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <p className="hint">
        Upload the festival holiday list (S.No / Festival / Day / Month / Date, plus a Yes/No column per category -
        Date is read as a full dd-mm-yyyy date). IB and Mont columns are ignored for now - CBSE, Students_CBSE, Acad
        Admin, Admin and Curriculum Team are all imported. A "Yes" for a staff category gives every matching staff
        member (by staff_master category) that day off on their calendar; Students_CBSE is stored for reference
        only, it has no staff to apply to. "Sunday" counts as Yes for every category (already a holiday for
        everyone). A row with every category marked "No" is not a holiday - it's skipped, not imported.
      </p>

      <input type="file" accept=".xls,.xlsx,.csv" onChange={handleFileChange} disabled={loading || importing} style={{ marginTop: 10 }} />

      {loading ? <p className="hint">Parsing…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {rows ? (
        <div className="card" style={{ marginTop: 16 }}>
          <strong>{fileName}</strong>
          {(() => {
            const importCount = rows.filter((r) => Object.values(r.categories).some(Boolean)).length;
            const skipCount = rows.length - importCount;
            return (
              <p className="hint">
                {rows.length} rows found - {importCount} will be imported
                {skipCount > 0 ? `, ${skipCount} not a holiday and will be skipped` : ""}. Check below before
                importing.
              </p>
            );
          })()}
          <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 8 }}>
            {rows.map((r, idx) => {
              const activeCategories = Object.entries(r.categories).filter(([, v]) => v).map(([k]) => CATEGORY_LABELS[k]);
              return (
                <div key={idx} className="list-row" style={{ paddingTop: 6, paddingBottom: 6 }}>
                  <div>
                    <strong style={{ fontSize: 13 }}>{r.holidayDate}</strong>
                    <span className="hint" style={{ margin: 0, marginLeft: 8 }}>{r.dayName} · {r.festivalName}</span>
                  </div>
                  <span className="hint" style={{ margin: 0, fontSize: 11 }}>
                    {activeCategories.length > 0 ? activeCategories.join(", ") : "not a holiday - skipped"}
                  </span>
                </div>
              );
            })}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={importing} onClick={handleConfirmImport}>
            {importing ? "Importing…" : "Import holidays"}
          </button>
        </div>
      ) : null}

      {done ? (
        <div className="card" style={{ marginTop: 16 }}>
          <strong style={{ color: "var(--green)" }}>Import complete</strong>
          <p className="hint">
            {done.festivalRowCount} festival rows saved. {done.staffHolidayCount} staff-holiday day(s) applied across{" "}
            {done.staffCount} staff member(s) - their calendars are already recomputed.
          </p>
        </div>
      ) : null}
    </div>
  );
}
