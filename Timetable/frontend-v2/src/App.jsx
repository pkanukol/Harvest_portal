import { useEffect, useState } from "react";
import { createTimetableClient } from "./lib/supabaseClients";
import { signOut } from "./lib/auth";
import LoginView from "./components/LoginView";
import { fetchCurrentStaff } from "./lib/staffRoles";
import { canEditTimetable } from "./lib/accessLevel";
import BranchPicker from "./components/BranchPicker";
import BuildNewTimetable from "./components/BuildNewTimetable";
import TimetablePanel from "./components/TimetablePanel";
import SubstitutionPreview from "./components/SubstitutionPreview";

// leadershipOnly tabs are the v1 "Import/Generate" surface - hidden entirely
// from read-only users rather than shown-and-disabled, since there is nothing
// useful for them on those screens.
const TABS = [
  { key: "build", label: "Build new", leadershipOnly: true },
  { key: "timetable", label: "Timetable" },
  { key: "substitution", label: "Substitution" },
];

export default function App() {
  const [client] = useState(createTimetableClient);
  // undefined = still checking stored session, null = signed out.
  const [session, setSession] = useState(undefined);
  // undefined = still resolving, null = signed in but no staff_roles row
  // (read-only - see accessLevel.js).
  const [staffRow, setStaffRow] = useState(undefined);
  const [branch, setBranch] = useState(null);
  const [tab, setTab] = useState("timetable");
  // Set by a successful Upload/Build New commit (either tab) so the user
  // lands straight on that year's timetable instead of hunting for it -
  // confirmed by the user 2026-08-04. Always a FRESH object (not just the
  // raw id) so committing to the SAME academic year twice in one session
  // still triggers navigation - React bails out of re-running an effect
  // keyed on a primitive prop that didn't change value, which silently
  // broke this the first time it shipped (committing again to the same
  // year produced no visible navigation at all).
  const [pendingView, setPendingView] = useState(null);

  // Track the Project B session. onAuthStateChange fires on sign-in, sign-out
  // and token refresh, so this is the single source of truth for "are we
  // logged in" - there is no portal token to resolve any more.
  useEffect(() => {
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = client.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [client]);

  // Resolve the signed-in user's staff_roles row to decide their access tier.
  // A failure here must NOT lock the app: fall back to read-only, which is
  // what the database will enforce anyway.
  useEffect(() => {
    if (!session) {
      setStaffRow(undefined);
      return;
    }
    let cancelled = false;
    fetchCurrentStaff()
      .then((row) => {
        if (!cancelled) setStaffRow(row);
      })
      .catch(() => {
        if (!cancelled) setStaffRow(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  function handleCommitted(academicYearId) {
    setPendingView({ academicYearId });
    setTab("timetable");
  }

  if (session === undefined) {
    return (
      <div className="auth-screen">
        <div>Loading…</div>
      </div>
    );
  }

  if (!session) return <LoginView client={client} />;

  if (staffRow === undefined) {
    return (
      <div className="auth-screen">
        <div>Loading…</div>
      </div>
    );
  }

  const canEdit = canEditTimetable(staffRow);
  const visibleTabs = TABS.filter((t) => !t.leadershipOnly || canEdit);
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : "timetable";

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Harvest Timetable</h1>
        <BranchPicker value={branch} onChange={setBranch} />
        <div className="app-user no-print">
          <span>{session.user?.email}</span>
          <span className="access-badge">{canEdit ? "Editor" : "View only"}</span>
          <button type="button" className="link-btn" onClick={() => signOut(client)}>
            Sign out
          </button>
        </div>
      </header>
      <nav className="app-tabs no-print">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            className={t.key === activeTab ? "app-tab app-tab-active" : "app-tab"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="app-main">
        {activeTab === "build" && canEdit && (
          <BuildNewTimetable client={client} branch={branch} onCommitted={handleCommitted} />
        )}
        {activeTab === "timetable" && (
          <TimetablePanel
            client={client}
            branch={branch}
            canEdit={canEdit}
            pendingView={pendingView}
            onCommitted={handleCommitted}
          />
        )}
        {activeTab === "substitution" && (
          <SubstitutionPreview client={client} branch={branch} canEdit={canEdit} />
        )}
      </main>
    </div>
  );
}
