import { useEffect, useState } from "react";
import { runAttendanceDiagnostics, forceRecompute, retryBridgeForEmployee } from "../lib/diagnosticsApi";

export default function AttendanceDiagnostics({ client, staff }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMessage, setRecomputeMessage] = useState(null);

  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await runAttendanceDiagnostics(client, staff.id, staff.email);
      setResult(r);
      const range = r.punchRange ?? r.rawRange;
      if (range) {
        setFromDate(range[0]);
        setToDate(range[1]);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff.id]);

  async function handleRecompute() {
    setRecomputing(true);
    setRecomputeMessage(null);
    setError(null);
    try {
      await forceRecompute(client, staff.id, fromDate, toDate);
      await load();
      setRecomputeMessage(`Recomputed ${fromDate} → ${toDate}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setRecomputing(false);
    }
  }

  async function handleRetryBridge() {
    if (!result?.employeeId || !result?.rawRange) return;
    setRetrying(true);
    setRetryMessage(null);
    setError(null);
    try {
      const bridge = await retryBridgeForEmployee(client, result.employeeId, result.rawRange[0], result.rawRange[1]);
      await load();
      if (bridge.bridgedStaffCount > 0) {
        setRetryMessage(`Linked - ${bridge.bridgedRecordCount} day(s) written and recomputed.`);
      } else if (bridge.noEmailInMasterCount > 0) {
        setRetryMessage("Still stuck: staff_master has no email for this Employee ID.");
      } else if (bridge.noStaffRolesAccountCount > 0) {
        setRetryMessage("Still stuck: that email has no matching staff_roles account.");
      } else {
        setRetryMessage("Ran, but nothing matched - check the Employee ID / email chain manually.");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setRetrying(false);
    }
  }

  if (loading) return <p className="hint">Checking…</p>;
  if (error) return <p className="error-text">{error}</p>;
  if (!result) return null;

  return (
    <div>
      <p className="hint">
        Walks the same chain the calendar depends on, for {staff.name} - use this instead of asking me to run SQL
        when a calendar looks wrong.
      </p>

      <div className="card">
        <strong>1. Category & festival holidays</strong>
        <p className="hint" style={{ color: result.staffMasterCategory ? "var(--green)" : "var(--red)" }}>
          {result.staffMasterCategory
            ? `staff_master category: ${result.staffMasterCategory}.`
            : `No staff_master row for ${staff.email} - festival holiday imports match by category via this row, so without it, no category-wide holiday can ever apply to this person.`}
        </p>
        <p className="hint" style={{ color: result.holidayCount > 0 ? "var(--green)" : "var(--red)" }}>
          {result.holidayCount > 0
            ? `${result.holidayCount} holiday day(s) recorded in staff_holiday.`
            : "No staff_holiday rows at all - either no festival list has been imported for this category yet, or this person's category/email didn't match during import."}
        </p>
        {result.holidayCount > 0 ? (
          <div style={{ overflowX: "auto", marginTop: 8, maxHeight: 160, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Label</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {result.holidayRows.map((row) => (
                  <tr key={row.holiday_date}>
                    <td>{row.holiday_date}</td>
                    <td>{row.label ?? "-"}</td>
                    <td>{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {result.holidayCount > 0 && result.scheduleRowCount === 0 ? (
          <p className="hint" style={{ color: "#b7791f" }}>
            Holidays are recorded, but there's no schedule (step 2 below) - compute_attendance_status needs a
            schedule row for that weekday to write anything at all, holiday included. Configure a schedule, then use
            "Recompute" at the bottom of this page.
          </p>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <strong>2. Schedule</strong>
        <p className="hint" style={{ color: result.scheduleRowCount > 0 ? "var(--green)" : "var(--red)" }}>
          {result.scheduleRowCount > 0
            ? `${result.scheduleRowCount} schedule row(s) configured.`
            : "No schedule configured - this is almost always why a calendar is blank. Set one up in the Schedule tab."}
        </p>
        {result.scheduleRowCount > 0 ? (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Weekday</th>
                  <th>Working?</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Occurrence</th>
                  <th>Effective from</th>
                </tr>
              </thead>
              <tbody>
                {result.scheduleRows.map((row) => (
                  <tr key={row.id}>
                    <td>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][row.weekday]}</td>
                    <td>{row.is_working_day ? "Yes" : "No"}</td>
                    <td>{row.check_in_time ?? "-"}</td>
                    <td>{row.check_out_time ?? "-"}</td>
                    <td>{row.week_occurrence ? row.week_occurrence.join(",") : "all"}</td>
                    <td>{row.effective_from}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <strong>3. Raw biometric import (employee_daily_attendance)</strong>
        {result.employeeId ? (
          <p className="hint" style={{ color: result.rawCount > 0 ? "var(--green)" : "var(--red)" }}>
            Employee ID {result.employeeId} -{" "}
            {result.rawCount > 0
              ? `${result.rawCount} day(s) imported, ${result.rawRange[0]} → ${result.rawRange[1]}.`
              : "no rows at all under this Employee ID - the import either didn't include them, or was uploaded before this Employee ID existed in staff_master."}
          </p>
        ) : (
          <p className="hint" style={{ color: "var(--red)" }}>
            No staff_master row for {staff.email} - can't even look this person up by Employee ID.
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <strong>4. Linked to this staff account (punch_record_daily)</strong>
        <p className="hint" style={{ color: result.punchCount > 0 ? "var(--green)" : "var(--red)" }}>
          {result.punchCount > 0
            ? `${result.punchCount} day(s) linked, ${result.punchRange[0]} → ${result.punchRange[1]}.`
            : "Not linked yet."}
        </p>
        {result.punchCount > 0 ? (
          <div style={{ overflowX: "auto", marginTop: 8, maxHeight: 200, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>In</th>
                  <th>Out</th>
                </tr>
              </thead>
              <tbody>
                {result.punchRows.map((row) => (
                  <tr key={row.attendance_date}>
                    <td>{row.attendance_date}</td>
                    <td>{row.first_in_time ?? "-"}</td>
                    <td>{row.last_out_time ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {result.rawCount > 0 && result.punchCount === 0 ? (
          <>
            <p className="hint" style={{ color: "#b7791f" }}>
              The raw import has data (step 2) but it never got linked through to this staff account - this is the
              actual break. Retry just this person below instead of re-uploading the whole file.
            </p>
            <button className="btn btn-primary" disabled={retrying} onClick={handleRetryBridge}>
              {retrying ? "Retrying…" : `Retry link for ${result.rawRange[0]} → ${result.rawRange[1]}`}
            </button>
            {retryMessage ? <p className="hint" style={{ marginTop: 8 }}>{retryMessage}</p> : null}
          </>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <strong>5. Computed status (what the calendar reads)</strong>
        <p className="hint" style={{ color: result.statusCount > 0 ? "var(--green)" : "var(--red)" }}>
          {result.statusCount > 0
            ? `${result.statusCount} day(s) computed, ${result.statusRange[0]} → ${result.statusRange[1]}.`
            : "Nothing computed yet."}
        </p>
        {result.scheduleRowCount > 0 && result.punchCount > 0 && result.statusCount === 0 ? (
          <p className="hint" style={{ color: "#b7791f" }}>
            Schedule and linked punch data both exist, but nothing's been computed - use "Recompute" below.
          </p>
        ) : null}
        {result.statusCount > 0 ? (
          <div style={{ overflowX: "auto", marginTop: 8, maxHeight: 200, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {result.statusRows.map((row) => (
                  <tr key={row.attendance_date}>
                    <td>{row.attendance_date}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <strong>Recompute a date range</strong>
        <p className="hint">
          Re-runs the calculation for this person over a range, using whatever schedule/punch data exists right now.
          Safe to run as many times as you like.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={recomputing || !fromDate || !toDate} onClick={handleRecompute}>
          {recomputing ? "Recomputing…" : "Recompute"}
        </button>
        {recomputeMessage ? <p className="hint" style={{ color: "var(--green)", marginTop: 8 }}>{recomputeMessage}</p> : null}
      </div>
    </div>
  );
}
