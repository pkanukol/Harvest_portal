import { useEffect, useState } from "react";
import { createAttendanceClient } from "./lib/supabaseClients";
import { resolveAccessToken, clearAccessToken, goToPortal } from "./lib/auth";
import { resolveCurrentStaff } from "./lib/currentUser";
import { fetchRoleConfig, computeCapabilities, ATTENDANCE_AUDIT_EMPLOYEE_IDS } from "./lib/rolesApi";
import MonthCalendar from "./components/MonthCalendar";
import AttendanceAuditPanel from "./components/AttendanceAuditPanel";
import AdminPage from "./pages/AdminPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import ReportsPage from "./pages/ReportsPage";
import MyRequestsPage from "./pages/MyRequestsPage";
import ViewAsSwitcher from "./components/ViewAsSwitcher";

const EMPTY_CAPS = {
  isOrgLeader: false, isOrgApprover: false, approverBranches: [], adminBranches: [],
  reportBranches: [], adminBranchesAllowed: [], canSeeReports: false, canSeeAdmin: false, canSeeApprovals: false,
};

export default function App() {
  const [client, setClient] = useState(null);
  const [realStaffRow, setRealStaffRow] = useState(undefined); // undefined = loading, null = not in staff_master
  const [roleConfig, setRoleConfig] = useState(undefined);
  const [viewAsStaffRow, setViewAsStaffRow] = useState(null); // admin testing override - see ViewAsSwitcher
  const [tab, setTab] = useState("mine");
  const [viewingStaff, setViewingStaff] = useState(null); // drill-down from Reports "View calendar"

  useEffect(() => {
    const token = resolveAccessToken();
    if (!token) {
      goToPortal();
      return;
    }
    const c = createAttendanceClient(token);
    setClient(c);
    resolveCurrentStaff(c, token)
      .then(async (row) => {
        setRealStaffRow(row);
        try {
          setRoleConfig(await fetchRoleConfig(c));
        } catch {
          setRoleConfig(null);
        }
      })
      .catch(() => {
        // Token rejected (expired/invalid) - bounce to the portal for a fresh login.
        clearAccessToken();
        goToPortal();
      });
  }, []);

  if (!client || realStaffRow === undefined || roleConfig === undefined) {
    return (
      <div className="sso-loading-screen">
        <div>Loading your attendance…</div>
      </div>
    );
  }

  // Capabilities/tabs follow the effective person (whoever you're previewing as,
  // else you) so "View as" can preview an approver's Approvals etc. Only the
  // View-as switcher itself is gated on the REAL user (realCaps).
  const staffRow = viewAsStaffRow ?? realStaffRow;
  const caps = staffRow && roleConfig ? computeCapabilities(staffRow, roleConfig) : EMPTY_CAPS;
  const realCaps = realStaffRow && roleConfig ? computeCapabilities(realStaffRow, roleConfig) : EMPTY_CAPS;
  const canAudit = ATTENDANCE_AUDIT_EMPLOYEE_IDS.includes(staffRow?.id);

  const TABS = [
    { key: "mine", label: "My Attendance" },
    { key: "myrequests", label: "My Requests" },
    ...(caps.canSeeApprovals ? [{ key: "approvals", label: "Approvals" }] : []),
    ...(caps.canSeeReports ? [{ key: "reports", label: "Team Reports" }] : []),
    ...(caps.canSeeAdmin ? [{ key: "admin", label: "Admin" }] : []),
    ...(canAudit ? [{ key: "audit", label: "Attendance Check" }] : []),
  ];

  function openCalendarFor(person) {
    setViewingStaff(person);
  }

  const isCalendarView = !!viewingStaff || tab === "mine";

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Harvest Attendance</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {realCaps.canSeeReports || realCaps.canSeeAdmin ? (
            <ViewAsSwitcher
              client={client}
              onSelect={(person) => {
                setViewAsStaffRow(person);
                setViewingStaff(null);
                setTab("mine");
              }}
            />
          ) : null}
          <span className="user-badge">{staffRow ? staffRow.name : "Unknown staff"}</span>
        </div>
      </header>

      {viewAsStaffRow ? (
        <div className="warning-banner" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>
            Previewing as <strong>{viewAsStaffRow.name}</strong> ({viewAsStaffRow.designation}) - actions taken now are
            attributed to them, not you.
          </span>
          <button className="btn-link" onClick={() => setViewAsStaffRow(null)}>Reset to me</button>
        </div>
      ) : null}

      {!staffRow ? (
        <div className="warning-banner">
          Your login email isn't in the staff directory yet - ask HR/IT to add you to staff_master.
        </div>
      ) : (
        <div className={isCalendarView ? "app-body app-body-centered" : "app-body"}>
          <nav className="app-sidebar">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={t.key === tab ? "app-tab app-tab-active" : "app-tab"}
                onClick={() => {
                  setViewingStaff(null);
                  setTab(t.key);
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <main
            className={
              (isCalendarView ? "app-main app-main-fit" : "app-main") +
              (!viewingStaff && ["myrequests", "approvals", "reports", "admin", "audit"].includes(tab) ? " page-compact" : "")
            }
          >
            {viewingStaff ? (
              <div>
                <button className="btn-link" onClick={() => setViewingStaff(null)}>
                  ← Back
                </button>
                <MonthCalendar
                  client={client}
                  currentUserEmail={realStaffRow?.email}
                  staffId={viewingStaff.id}
                  staffName={viewingStaff.name}
                  staffEmail={viewingStaff.email}
                  staffCategory={viewingStaff.category}
                  isSelf={false}
                />
              </div>
            ) : (
              <>
                {tab === "mine" && (
                  <MonthCalendar
                    client={client}
                    currentUserEmail={staffRow.email}
                    staffId={staffRow.id}
                    staffName={staffRow.name}
                    staffEmail={staffRow.email}
                    staffCategory={staffRow.category}
                    isSelf
                  />
                )}
                {tab === "myrequests" && <MyRequestsPage client={client} staffRow={staffRow} />}
                {tab === "approvals" && caps.canSeeApprovals && (
                  <ApprovalsPage client={client} staffRow={staffRow} roleConfig={roleConfig} isOrgApprover={caps.isOrgApprover} branches={caps.approverBranches} />
                )}
                {tab === "reports" && caps.canSeeReports && (
                  <ReportsPage client={client} staffRow={staffRow} branches={caps.reportBranches} onViewCalendar={openCalendarFor} />
                )}
                {tab === "admin" && caps.canSeeAdmin && (
                  <AdminPage client={client} staffRow={staffRow} branches={caps.adminBranchesAllowed} />
                )}
                {tab === "audit" && canAudit && <AttendanceAuditPanel client={client} />}
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
