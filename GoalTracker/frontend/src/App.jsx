import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./context/AuthContext";
import Header from "./components/Header";
import LoginView from "./components/LoginView";
import Dashboard from "./components/Dashboard";
import AdminAssignments from "./components/AdminAssignments";
import GoalsHeatmap from "./components/GoalsHeatmap";
import ViewAsPerson from "./components/ViewAsPerson";
import HrReport from "./components/HrReport";
import ActingAsBanner from "./components/ActingAsBanner";

const LOG = "[GoalTracker SSO]";

export default function App() {
  const { user, token, login, switchTo, switchBack, actingAs, isAuthenticated } = useAuth();
  const [ssoLoading, setSsoLoading] = useState(() => !!new URLSearchParams(window.location.search).get("sso"));
  const [ssoError, setSsoError] = useState("");

  // Same SSO-exchange-inside-React pattern as CurriculumTracker's App.jsx -
  // avoids a full page reload just so AuthContext notices the new token.
  //
  // A fresh ?sso= param ALWAYS re-authenticates, even when a token is already
  // cached (the rule AuditApp's index.html already follows). Short-circuiting
  // on a cached token meant a stale session could never be replaced - it kept
  // serving an old identity, and a `user` object saved before is_admin /
  // can_manage_reviewers existed silently hid every leadership button. With
  // Logout now owned by the portal, this is the only way back to a good state.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get("sso");
    if (!ssoToken) return;

    function attemptExchange(attemptNumber) {
      console.log(LOG, "attempt", attemptNumber);
      return api.ssoLogin(ssoToken);
    }

    localStorage.removeItem("own_token");
    localStorage.removeItem("own_user");

    attemptExchange(1)
      .catch((firstErr) => {
        console.warn(LOG, "attempt 1 failed:", firstErr.message, "— retrying once");
        return new Promise((resolve) => setTimeout(resolve, 800)).then(() => attemptExchange(2));
      })
      .then((data) => {
        window.history.replaceState({}, "", window.location.pathname);
        login(data);
      })
      .catch((err) => {
        console.error(LOG, "exchange failed after retry:", err);
        window.history.replaceState({}, "", window.location.pathname);
        setSsoError(err.message || "Unknown error");
        setSsoLoading(false);
      });
  }, []);

  const [showAdmin, setShowAdmin] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showViewAs, setShowViewAs] = useState(false);
  const [showHr, setShowHr] = useState(false);
  const [switchError, setSwitchError] = useState("");

  async function enterAs(person) {
    setSwitchError("");
    try {
      const data = await api.actAs(token, person.email);
      setShowViewAs(false);
      switchTo(data);
    } catch (err) {
      setSwitchError(err.message);
    }
  }

  return (
    <>
      {isAuthenticated && actingAs && (
        <ActingAsBanner user={user} onReturn={switchBack} />
      )}

      {isAuthenticated && (
        <Header user={user} onAdmin={() => setShowAdmin(true)} onHeatmap={() => setShowHeatmap(true)} onViewAs={() => setShowViewAs(true)} onHrReport={() => setShowHr(true)} />
      )}

      <div className="app-container">
        {switchError && <div className="form-error">{switchError}</div>}
        {!isAuthenticated ? (
          ssoLoading ? (
            <div className="sso-loading-screen">
              <div className="sso-loading-text">Loading your workspace…</div>
              <div className="sso-loading-sub">Signing you in via the school portal</div>
            </div>
          ) : (
            <LoginView error={ssoError} />
          )
        ) : (
          <Dashboard key={user.email} token={token} user={user} />
        )}
      </div>

      {showAdmin && <AdminAssignments token={token} onClose={() => setShowAdmin(false)} />}
      {showHeatmap && <GoalsHeatmap token={token} user={user} onClose={() => setShowHeatmap(false)} />}
      {showHr && <HrReport token={token} onClose={() => setShowHr(false)} />}
      {showViewAs && <ViewAsPerson token={token} canActAs={Boolean(user && user.can_act_as)} onEnterAs={enterAs} onClose={() => setShowViewAs(false)} />}
    </>
  );
}
