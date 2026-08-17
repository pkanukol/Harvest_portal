import { useCallback, useEffect, useState } from "react";
import { fetchLeaveRequestsByStatus, decideLeaveRequest } from "../lib/leaveApi";
import { fetchRegularisationRequestsByStatus, decideRegularisationRequest } from "../lib/attendanceApi";
import { fetchStaffByIds, searchStaff } from "../lib/staffMaster";
import { MONTH_NAMES } from "../lib/dateUtils";
import BranchChips from "../components/BranchChips";

const STATUS_TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
];

function monthLabel(dateStr) {
  const d = new Date(dateStr);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

// The single approver (Principal Lakshmi Nayar) reviews both request types for
// everyone - branch scoping was removed with the staff_roles/Project B cutover.
// The only filter is "not my own request"; staff names are resolved from
// staff_master by staff_id.
export default function ApprovalsPage({ client, staffRow, roleConfig, isOrgApprover, branches = [] }) {
  const [branch, setBranch] = useState(branches[0] || null);
  const now = new Date();
  const [monthCursor, setMonthCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [statusFilter, setStatusFilter] = useState("pending");
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [regularisationRequests, setRegularisationRequests] = useState([]);
  const [staffById, setStaffById] = useState({});
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState(null);
  const [error, setError] = useState(null);

  const [nameQuery, setNameQuery] = useState("");
  const [nameSuggestions, setNameSuggestions] = useState([]);
  const [selectedPerson, setSelectedPerson] = useState(null);

  useEffect(() => {
    if (!nameQuery.trim() || selectedPerson) {
      setNameSuggestions([]);
      return;
    }
    const timer = setTimeout(() => searchStaff(client, nameQuery, branch).then(setNameSuggestions), 250);
    return () => clearTimeout(timer);
  }, [nameQuery, selectedPerson]);

  const load = useCallback(async () => {
    setLoading(true);
    const regularisationStatuses = statusFilter === "approved" ? ["approved", "auto_approved"] : statusFilter;
    const [leave, regularisation] = await Promise.all([
      fetchLeaveRequestsByStatus(client, statusFilter),
      fetchRegularisationRequestsByStatus(client, regularisationStatuses),
    ]);

    const staffIds = [...new Set([...leave, ...regularisation].map((r) => r.staff_id))];
    let byId = {};
    if (staffIds.length > 0) {
      const rows = await fetchStaffByIds(client, staffIds);
      rows.forEach((s) => {
        byId[s.id] = s;
      });
    }

    // A request is mine to act on if I'm its resolved approver: a branch
    // approver sees their branch's staff/admin requests; an org approver sees
    // the branch approvers' own requests.
    const branchApproverIds = new Set(Object.values(roleConfig?.branchApprover ?? {}));
    const myId = staffRow?.id;
    function scoped(list) {
      return list.filter((r) => {
        if (r.staff_id === myId) return false; // never your own
        const requester = byId[r.staff_id];
        if (!requester) return false;
        if (branchApproverIds.has(r.staff_id)) return !!isOrgApprover; // approver's own request -> org approvers
        return (roleConfig?.branchApprover ?? {})[requester.branch] === myId; // normal -> their branch approver
      });
    }

    setStaffById(byId);
    setLeaveRequests(scoped(leave));
    setRegularisationRequests(scoped(regularisation));
    setLoading(false);
  }, [client, staffRow, statusFilter, roleConfig, isOrgApprover]);

  useEffect(() => {
    load();
  }, [load]);

  function goMonth(delta) {
    const d = new Date(monthCursor.year, monthCursor.month + delta, 1);
    setMonthCursor({ year: d.getFullYear(), month: d.getMonth() });
  }

  async function decideLeave(request, status) {
    setDecidingId(request.id);
    setError(null);
    try {
      await decideLeaveRequest(client, { id: request.id, status, decidedBy: staffRow?.email });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setDecidingId(null);
    }
  }

  async function decideRegularisation(request, status) {
    setDecidingId(request.id);
    setError(null);
    try {
      await decideRegularisationRequest(client, { id: request.id, status, decidedBy: staffRow?.email });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setDecidingId(null);
    }
  }

  const sections = [
    { title: "Leave requests", data: leaveRequests, kind: "leave", dateField: "from_date" },
    { title: "Regularisation requests", data: regularisationRequests, kind: "regularisation", dateField: "attendance_date" },
  ];

  const currentMonthLabel = `${MONTH_NAMES[monthCursor.month]} ${monthCursor.year}`;

  // Pending items always show regardless of month - they need action NOW,
  // and hiding one behind a month arrow (e.g. a regularisation for an
  // imported past month) risks it just never getting seen. The month filter
  // only makes sense for reviewing already-decided history.
  function applyFilters(list, dateField) {
    return list.filter((r) => {
      if (statusFilter !== "pending" && monthLabel(r[dateField]) !== currentMonthLabel) return false;
      if (selectedPerson && r.staff_id !== selectedPerson.id) return false;
      return true;
    });
  }

  if (loading) return <p className="hint">Loading…</p>;

  return (
    <div>
      <h3 style={{ fontSize: 16, marginBottom: 4 }}>Requests to review</h3>
      <BranchChips branches={branches} value={branch} onChange={setBranch} label="Branch" />

      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div className="category-chips" style={{ margin: 0 }}>
          {STATUS_TABS.map((t) => (
            <button key={t.key} className={t.key === statusFilter ? "chip chip-active" : "chip"} onClick={() => setStatusFilter(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ width: 220, maxWidth: 220, position: "relative" }}>
          <label className="field-label">Filter by name</label>
          {selectedPerson ? (
            <div className="list-row" style={{ paddingTop: 6, paddingBottom: 6 }}>
              <strong style={{ fontSize: 13 }}>{selectedPerson.name}</strong>
              <button
                className="btn-link"
                onClick={() => {
                  setSelectedPerson(null);
                  setNameQuery("");
                }}
              >
                Clear
              </button>
            </div>
          ) : (
            <>
              <input type="search" placeholder="Staff name" value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} />
              {nameSuggestions.length > 0 ? (
                <div className="suggestion-list" style={{ position: "absolute", zIndex: 10, width: "100%", background: "#fff" }}>
                  {nameSuggestions.map((s) => (
                    <div
                      key={s.id}
                      className="suggestion-row"
                      onClick={() => {
                        setSelectedPerson(s);
                        setNameSuggestions([]);
                      }}
                    >
                      <strong style={{ fontSize: 13 }}>{s.name}</strong>
                      <div className="hint" style={{ margin: 0, fontSize: 11 }}>{s.designation}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {sections.map((section) => {
        const filtered = applyFilters(section.data, section.dateField);
        return (
          <div key={section.kind} style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, marginBottom: 8 }}>
              {section.title} ({filtered.length})
            </h3>
            {filtered.length === 0 ? (
              <p className="empty-text">
                Nothing {statusFilter}{statusFilter !== "pending" ? ` for ${currentMonthLabel.toLowerCase()}` : ""}.
              </p>
            ) : (
              filtered.map((request) => {
                const staffInfo = staffById[request.staff_id];
                return (
                  <div key={request.id} className="card" style={{ marginBottom: 10 }}>
                    <strong>{staffInfo?.name ?? request.staff_email}</strong>
                    {section.kind === "leave" ? (
                      <p className="hint">
                        {request.from_date} → {request.to_date} ({request.days_count} day{request.days_count > 1 ? "s" : ""})
                      </p>
                    ) : (
                      <p className="hint">
                        {request.attendance_date} - {request.reason_category}
                      </p>
                    )}
                    {request.reason_text ? <p className="hint" style={{ fontStyle: "italic" }}>{request.reason_text}</p> : null}
                    {request.status !== "pending" ? (
                      <p className="hint" style={{ marginTop: 4 }}>
                        {request.status}{request.decided_by ? ` by ${request.decided_by}` : ""}
                      </p>
                    ) : null}
                    {request.status === "pending" ? (
                      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                        <button
                          className="btn btn-success"
                          disabled={decidingId === request.id}
                          onClick={() => (section.kind === "leave" ? decideLeave(request, "approved") : decideRegularisation(request, "approved"))}
                        >
                          Approve
                        </button>
                        <button
                          className="btn btn-danger"
                          disabled={decidingId === request.id}
                          onClick={() => (section.kind === "leave" ? decideLeave(request, "rejected") : decideRegularisation(request, "rejected"))}
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}
