import { useEffect, useState } from "react";
import { fetchLeaveEntitlement, findApproverForStaff, submitLeaveRequest } from "../lib/leaveApi";
import { previewSandwich } from "../lib/lopApi";
import { toIsoDate } from "../lib/dateUtils";

const TODAY_ISO = toIsoDate(new Date());
const MAX_CONTINUOUS_DAYS = 3;

export default function ApplyLeaveModal({ client, visible, onClose, staffRow, onSubmitted }) {
  const [ent, setEnt] = useState(null);
  const [approver, setApprover] = useState(null);
  const [leaveType, setLeaveType] = useState("CL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [sandwich, setSandwich] = useState(null);

  // Live sandwich check as the dates change - warns that a bridged weekend/
  // holiday will be marked LOP.
  useEffect(() => {
    if (!visible || !staffRow || !fromDate || !toDate || toDate < fromDate) {
      setSandwich(null);
      return;
    }
    let cancelled = false;
    previewSandwich(client, staffRow.id, fromDate, toDate)
      .then((r) => !cancelled && setSandwich(r))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible, client, staffRow, fromDate, toDate]);

  useEffect(() => {
    if (!visible || !staffRow) return;
    setFromDate("");
    setToDate("");
    setReasonText("");
    setLeaveType("CL");
    setError(null);
    setLoading(true);
    Promise.all([fetchLeaveEntitlement(client, staffRow.id), findApproverForStaff(client, staffRow)])
      .then(([entitlement, appr]) => {
        setEnt(entitlement);
        setApprover(appr);
      })
      .finally(() => setLoading(false));
  }, [visible, staffRow, client]);

  if (!visible) return null;

  const hasEL = !!ent && ent.el_annual > 0; // category grants EL at all (ADMIN)
  const elAvailable = !!ent && ent.el_entitled > 0; // ...and past the 1-year service gate
  const clRemaining = ent ? ent.cl_remaining : 0;
  const elRemaining = ent ? ent.el_remaining : 0;
  const remainingForType = leaveType === "EL" ? elRemaining : clRemaining;

  const daysRequested = fromDate && toDate ? (new Date(toDate) - new Date(fromDate)) / 86400000 + 1 : 0;
  const isSandwichLop = !!sandwich?.isSandwich;
  const excessLop = daysRequested > 0 ? Math.max(0, daysRequested - Math.max(0, remainingForType)) : 0;
  // A sandwiched leave is entirely LOP (so it doesn't consume CL); otherwise only
  // the days beyond the remaining balance are LOP.
  const lopDays = isSandwichLop ? daysRequested : excessLop;

  async function submit() {
    setError(null);
    if (!fromDate || !toDate) return setError("Pick both from and to dates");
    if (fromDate < TODAY_ISO) return setError("From date can't be in the past");
    if (toDate < fromDate) return setError("To date must be on or after from date");
    if (daysRequested > MAX_CONTINUOUS_DAYS) {
      return setError(`You can't take more than ${MAX_CONTINUOUS_DAYS} continuous days of leave in one request.`);
    }
    if (leaveType === "EL" && !elAvailable) {
      return setError("Earned Leave isn't available yet (needs 1 year of service).");
    }
    if (!reasonText.trim()) return setError("Reason is required");
    setSubmitting(true);
    try {
      // Recompute LOP fresh at submit so a sandwich is caught even if the live
      // check hadn't resolved yet - a sandwiched leave is fully LOP.
      const sw = await previewSandwich(client, staffRow.id, fromDate, toDate).catch(() => ({ isSandwich: false }));
      const finalLopDays = sw.isSandwich ? daysRequested : excessLop;
      await submitLeaveRequest(client, {
        staffId: staffRow.id,
        staffEmail: staffRow.email,
        fromDate,
        toDate,
        leaveType,
        lopDays: finalLopDays,
        reasonText,
        approverStaffId: approver?.id,
        approverName: approver?.name,
        requestedBy: staffRow.email,
      });
      onSubmitted?.();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <strong style={{ fontSize: 16 }}>Apply for leave</strong>

        {loading ? (
          <p className="hint">Loading…</p>
        ) : !ent ? (
          <p className="error-text">Couldn't load your leave balance. You may not be in the staff list yet.</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
              <span style={{ color: "var(--green)", fontWeight: 600 }}>
                {Math.max(0, clRemaining)} CL left
              </span>
              {hasEL ? (
                <span style={{ color: elAvailable ? "var(--green)" : "var(--muted)", fontWeight: 600 }}>
                  {Math.max(0, elRemaining)} EL left{elAvailable ? "" : " (after 1 yr)"}
                </span>
              ) : null}
            </div>
            <p className="hint" style={{ marginTop: 2 }}>
              {ent.category} · {ent.cl_accrued} CL accrued so far this year · Approver: {approver?.name ?? "not set"}
            </p>

            {hasEL ? (
              <>
                <label className="field-label">Leave type</label>
                <div className="category-chips">
                  <button className={leaveType === "CL" ? "chip chip-active" : "chip"} onClick={() => setLeaveType("CL")}>
                    Casual (CL)
                  </button>
                  <button
                    className={leaveType === "EL" ? "chip chip-active" : "chip"}
                    onClick={() => elAvailable && setLeaveType("EL")}
                    disabled={!elAvailable}
                    title={elAvailable ? "" : "Available after 1 year of service"}
                  >
                    Earned (EL)
                  </button>
                </div>
              </>
            ) : null}

            <label className="field-label">From date</label>
            <input
              type="date"
              value={fromDate}
              min={TODAY_ISO}
              onChange={(e) => {
                setFromDate(e.target.value);
                if (toDate && toDate < e.target.value) setToDate(e.target.value);
              }}
            />
            <label className="field-label">To date</label>
            <input type="date" value={toDate} min={fromDate || TODAY_ISO} onChange={(e) => setToDate(e.target.value)} />

            {daysRequested > MAX_CONTINUOUS_DAYS ? (
              <p className="error-text">More than {MAX_CONTINUOUS_DAYS} continuous days isn't allowed.</p>
            ) : !isSandwichLop && excessLop > 0 ? (
              <p className="hint" style={{ color: "#b7791f", fontWeight: 600 }}>
                {daysRequested} day(s) requested but only {Math.max(0, remainingForType)} {leaveType} left —{" "}
                {excessLop} day(s) will be marked Loss of Pay (LOP).
              </p>
            ) : null}

            {sandwich?.isSandwich ? (
              <p className="hint" style={{ color: "#b7791f", fontWeight: 600 }}>
                Sandwich leave: this bridges a weekend/holiday, so all bridged days will be marked LOP
                {sandwich.dates.length ? ` (${sandwich.dates.join(", ")})` : ""}.
              </p>
            ) : null}

            <label className="field-label">Reason *</label>
            <textarea value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="Reason for leave (required)" />

            {error ? <p className="error-text">{error}</p> : null}

            <button
              className="btn btn-primary"
              style={{ width: "100%", marginTop: 14 }}
              disabled={submitting || !fromDate || !toDate || daysRequested > MAX_CONTINUOUS_DAYS}
              onClick={submit}
            >
              {submitting
                ? "Submitting…"
                : daysRequested > MAX_CONTINUOUS_DAYS
                ? `Max ${MAX_CONTINUOUS_DAYS} continuous days`
                : lopDays > 0
                ? "Submit (with LOP)"
                : "Submit request"}
            </button>
          </>
        )}

        <div className="modal-close-row">
          <button className="btn-link" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
