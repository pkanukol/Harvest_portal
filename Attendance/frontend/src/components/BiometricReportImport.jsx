import { useEffect, useState } from "react";
import {
  parseBiometricReport,
  matchAgainstStaffMaster,
  importBiometricRecords,
  bridgeToAttendancePipeline,
  fetchLatestUploadedDate,
  fetchMissingDays,
} from "../lib/biometricReportImport";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function nextDayIso(iso) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export default function BiometricReportImport({ client, branch }) {
  const [latestDate, setLatestDate] = useState(undefined); // undefined=loading, null=none
  const [missingDays, setMissingDays] = useState([]);
  const [parsed, setParsed] = useState(null);
  const [matchInfo, setMatchInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const [backfillMonth, setBackfillMonth] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);
  const [backfillError, setBackfillError] = useState(null);

  // Show how far attendance data has been uploaded (for this branch) so the
  // admin knows which day to resume from. Refreshes after each import.
  useEffect(() => {
    let cancelled = false;
    setLatestDate(undefined);
    setMissingDays([]);
    fetchLatestUploadedDate(client, branch)
      .then((d) => !cancelled && setLatestDate(d))
      .catch(() => !cancelled && setLatestDate(null));
    fetchMissingDays(client, branch)
      .then((days) => !cancelled && setMissingDays(days))
      .catch(() => !cancelled && setMissingDays([]));
    return () => {
      cancelled = true;
    };
  }, [client, branch, done]);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setDone(null);
    setParsed(null);
    setMatchInfo(null);
    setLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const result = parseBiometricReport(buffer, file.name);
      setParsed(result);
      const codes = result.employees.map((e) => e.employeeCode);
      const match = await matchAgainstStaffMaster(client, codes);
      setMatchInfo(match);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  async function handleConfirmImport() {
    if (!parsed) return;
    setImporting(true);
    setError(null);
    try {
      await importBiometricRecords(client, parsed.records);
      const fromDate = `${parsed.year}-${pad2(parsed.month + 1)}-01`;
      const toDate = new Date(parsed.year, parsed.month + 1, 0);
      const toDateIso = `${parsed.year}-${pad2(parsed.month + 1)}-${pad2(toDate.getDate())}`;
      const employeeIds = parsed.employees.map((e) => e.employeeCode);
      const bridge = await bridgeToAttendancePipeline(client, employeeIds, fromDate, toDateIso);
      setDone({ recordCount: parsed.records.length, employeeCount: parsed.employees.length, bridge });
      setParsed(null);
      setMatchInfo(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleBackfill() {
    if (!backfillMonth) return;
    setBackfilling(true);
    setBackfillError(null);
    setBackfillResult(null);
    try {
      const [year, month] = backfillMonth.split("-").map(Number);
      const fromDate = `${year}-${pad2(month)}-01`;
      const toDate = new Date(year, month, 0);
      const toDateIso = `${year}-${pad2(month)}-${pad2(toDate.getDate())}`;

      const { data: rows, error: fetchError } = await client
        .from("employee_daily_attendance")
        .select("employee_id")
        .gte("attendance_date", fromDate)
        .lte("attendance_date", toDateIso);
      if (fetchError) throw fetchError;
      const employeeIds = [...new Set((rows ?? []).map((r) => r.employee_id))];

      const bridge = await bridgeToAttendancePipeline(client, employeeIds, fromDate, toDateIso);
      setBackfillResult(bridge);
    } catch (err) {
      setBackfillError(err.message);
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <div>
      <p className="hint">
        Upload the biometric software's "Basic Work Duration Report" (.xls){branch ? ` for ${branch}` : ""}. You can
        upload daily, weekly or monthly - rows are matched by employee + date, so it only adds/updates the days in the
        file.
      </p>

      <div className="warning-banner" style={{ fontSize: 12, background: "var(--brand-050)", color: "var(--ink)" }}>
        {latestDate === undefined ? (
          "Checking latest uploaded date…"
        ) : latestDate ? (
          <>
            Attendance uploaded through <strong>{latestDate}</strong>{branch ? ` for ${branch}` : ""} — import from{" "}
            <strong>{nextDayIso(latestDate)}</strong> onward.
          </>
        ) : (
          <>No attendance uploaded yet{branch ? ` for ${branch}` : ""} — start with your earliest month.</>
        )}
      </div>

      {missingDays.length > 0 ? (
        <div className="warning-banner" style={{ fontSize: 12 }}>
          <strong>{missingDays.length} missing day{missingDays.length > 1 ? "s" : ""}</strong> inside the uploaded span
          (no data, Sundays ignored): {missingDays.join(", ")}. Upload those days if they were working days.
        </div>
      ) : null}

      <input type="file" accept=".xls,.xlsx" onChange={handleFileChange} disabled={loading || importing} />

      {loading ? <p className="hint">Parsing…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {parsed ? (
        <div className="card" style={{ marginTop: 16 }}>
          <strong>{MONTH_NAMES[parsed.month]} {parsed.year}</strong>
          <p className="hint">
            {parsed.employees.length} employees · {parsed.records.length} rows parsed from the Excel (one row per
            employee per day).
          </p>
          {matchInfo ? (
            <>
              <p className="hint" style={{ color: "var(--green)" }}>{matchInfo.matchedCount} matched to staff_master by Employee ID.</p>
              {matchInfo.unmatchedCodes.length > 0 ? (
                <p className="hint" style={{ color: "#b7791f" }}>
                  {matchInfo.unmatchedCodes.length} employee code(s) not found in staff_master (imported anyway, just
                  won't show up anywhere yet): {matchInfo.unmatchedCodes.slice(0, 10).join(", ")}
                  {matchInfo.unmatchedCodes.length > 10 ? "…" : ""}
                </p>
              ) : null}
            </>
          ) : null}
          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={importing} onClick={handleConfirmImport}>
            {importing ? "Importing…" : `Import ${parsed.records.length} parsed rows`}
          </button>
          <p className="hint" style={{ marginTop: 6, fontStyle: "italic" }}>
            Rows are matched by employee + date, so re-uploading updates those days in place — it never duplicates or
            touches other dates.
          </p>
        </div>
      ) : null}

      {done ? (
        <div className="card" style={{ marginTop: 16 }}>
          <strong style={{ color: "var(--green)" }}>Import complete</strong>
          <p className="hint">
            {done.recordCount} rows for {done.employeeCount} employees saved (existing dates updated in place, not duplicated).
          </p>
          <p className="hint">
            {done.bridge.bridgedStaffCount} staff member(s) linked through to the calendar ({done.bridge.bridgedRecordCount} days
            recomputed). {done.bridge.noEmailInMasterCount} employee ID(s) aren't in staff_master yet - upload the staff
            list (or add them) and they'll link on the next re-link.
          </p>
          <p className="hint" style={{ fontStyle: "italic" }}>
            Note: a linked staff member still needs a schedule configured (Admin → Configure Staff Schedule) before
            their calendar shows anything for these dates - no schedule means nothing to compare the punch times
            against.
          </p>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <strong>Re-link already-imported data to the calendar</strong>
        <p className="hint">
          Use this to (re)build a month's calendar from an already-imported report - e.g. after uploading the staff
          list, or after configuring schedules. This is how July's calendar is rebuilt after the identity change.
        </p>
        <label className="field-label">Month</label>
        <input type="month" value={backfillMonth} onChange={(e) => setBackfillMonth(e.target.value)} style={{ maxWidth: 200 }} />
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={backfilling || !backfillMonth} onClick={handleBackfill}>
          {backfilling ? "Re-linking…" : "Re-link this month"}
        </button>
        {backfillError ? <p className="error-text">{backfillError}</p> : null}
        {backfillResult ? (
          <p className="hint" style={{ marginTop: 8 }}>
            {backfillResult.bridgedStaffCount} staff member(s) linked ({backfillResult.bridgedRecordCount} days recomputed).{" "}
            {backfillResult.noEmailInMasterCount} employee ID(s) not in staff_master.
          </p>
        ) : null}
      </div>
    </div>
  );
}
