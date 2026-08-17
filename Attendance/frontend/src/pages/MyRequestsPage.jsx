import { useCallback, useEffect, useState } from "react";
import { fetchLeaveHistory, cancelLeaveRequest } from "../lib/leaveApi";
import { fetchMyRegularisationRequests, cancelRegularisationRequest } from "../lib/attendanceApi";
import { MONTH_NAMES } from "../lib/dateUtils";

const LEAVE_STATUS_LABEL = { pending: "Pending approval", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" };
const LEAVE_STATUS_COLOR = { pending: "#b7791f", approved: "#2e7d32", rejected: "#c0392b", cancelled: "#888" };
const REG_STATUS_LABEL = { pending: "Pending approval", approved: "Approved", auto_approved: "Auto-approved (bus)", rejected: "Rejected", cancelled: "Cancelled" };
const REG_STATUS_COLOR = { pending: "#b7791f", approved: "#2e7d32", auto_approved: "#3893C4", rejected: "#c0392b", cancelled: "#888" };

function monthLabel(dateStr) {
  const d = new Date(dateStr);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

// Both fetchLeaveHistory and fetchMyRegularisationRequests already order
// most-recent-first, so grouping consecutively while walking that order
// keeps months in the same sequence without a separate sort step.
function groupByMonth(requests, dateField) {
  const groups = [];
  let current = null;
  requests.forEach((r) => {
    const label = monthLabel(r[dateField]);
    if (!current || current.label !== label) {
      current = { label, items: [] };
      groups.push(current);
    }
    current.items.push(r);
  });
  return groups;
}

export default function MyRequestsPage({ client, staffRow }) {
  const [category, setCategory] = useState("leave"); // 'leave' | 'regularisation'
  const [leaveRequests, setLeaveRequests] = useState(null);
  const [regularisationRequests, setRegularisationRequests] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    fetchLeaveHistory(client, staffRow.id).then(setLeaveRequests);
    fetchMyRegularisationRequests(client, staffRow.id).then(setRegularisationRequests);
  }, [client, staffRow.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCancelLeave(id) {
    setCancellingId(id);
    setError(null);
    try {
      await cancelLeaveRequest(client, id);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setCancellingId(null);
    }
  }

  async function handleCancelRegularisation(id) {
    setCancellingId(id);
    setError(null);
    try {
      await cancelRegularisationRequest(client, id);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setCancellingId(null);
    }
  }

  if (leaveRequests === null || regularisationRequests === null) return <p className="hint">Loading…</p>;

  const leaveGroups = groupByMonth(leaveRequests, "from_date");
  const regGroups = groupByMonth(regularisationRequests, "attendance_date");

  return (
    <div>
      <div className="mode-toggle" style={{ maxWidth: 320 }}>
        <button className={category === "leave" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setCategory("leave")}>
          Leave ({leaveRequests.length})
        </button>
        <button className={category === "regularisation" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setCategory("regularisation")}>
          Regularisation ({regularisationRequests.length})
        </button>
      </div>

      {error ? <p className="error-text" style={{ marginTop: 10 }}>{error}</p> : null}

      {category === "leave" ? (
        leaveRequests.length === 0 ? (
          <p className="empty-text">You haven't applied for leave yet.</p>
        ) : (
          leaveGroups.map((group) => (
            <div key={group.label} style={{ marginTop: 16, marginBottom: 18 }}>
              <p className="hint" style={{ fontWeight: 700, marginBottom: 6 }}>{group.label}</p>
              {group.items.map((r) => (
                <div key={r.id} className="card" style={{ marginBottom: 10 }}>
                  <div className="field-columns">
                    <div>
                      <label className="field-label">Applied dates</label>
                      <div className="field-value">{r.from_date} → {r.to_date}</div>
                    </div>
                    <div>
                      <label className="field-label">Days</label>
                      <div className="field-value">{r.days_count}</div>
                    </div>
                    <div>
                      <label className="field-label">Approver</label>
                      <div className="field-value">{r.approver_name ?? "not set"}</div>
                    </div>
                    <div>
                      <label className="field-label">Status</label>
                      <div className="field-value" style={{ color: LEAVE_STATUS_COLOR[r.status] }}>
                        {LEAVE_STATUS_LABEL[r.status] ?? r.status}
                      </div>
                    </div>
                  </div>
                  {r.reason_text ? <p className="hint" style={{ fontStyle: "italic", marginTop: 6 }}>{r.reason_text}</p> : null}
                  {r.decision_note ? <p className="hint" style={{ marginTop: 6 }}>Note: {r.decision_note}</p> : null}
                  {r.status === "pending" || r.status === "approved" ? (
                    <button
                      className="btn-link"
                      style={{ marginTop: 8, color: "var(--red)" }}
                      disabled={cancellingId === r.id}
                      onClick={() => handleCancelLeave(r.id)}
                    >
                      {cancellingId === r.id ? "Cancelling…" : "Cancel this request"}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ))
        )
      ) : regularisationRequests.length === 0 ? (
        <p className="empty-text">You haven't submitted any regularisation requests yet.</p>
      ) : (
        regGroups.map((group) => (
          <div key={group.label} style={{ marginTop: 16, marginBottom: 18 }}>
            <p className="hint" style={{ fontWeight: 700, marginBottom: 6 }}>{group.label}</p>
            {group.items.map((r) => (
              <div key={r.id} className="card" style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <strong>{r.attendance_date}</strong>
                    <p className="hint" style={{ margin: "2px 0 0" }}>{r.reason_category}</p>
                  </div>
                  <span style={{ color: REG_STATUS_COLOR[r.status], fontWeight: 700, fontSize: 12 }}>
                    {REG_STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </div>
                {r.reason_text ? <p className="hint" style={{ fontStyle: "italic", marginTop: 6 }}>{r.reason_text}</p> : null}
                {r.decision_note ? <p className="hint" style={{ marginTop: 6 }}>Note: {r.decision_note}</p> : null}
                {/* Regularisation is only cancellable while still pending -
                    unlike leave, which stays cancellable after approval too. */}
                {r.status === "pending" ? (
                  <button
                    className="btn-link"
                    style={{ marginTop: 8, color: "var(--red)" }}
                    disabled={cancellingId === r.id}
                    onClick={() => handleCancelRegularisation(r.id)}
                  >
                    {cancellingId === r.id ? "Cancelling…" : "Cancel this request"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
