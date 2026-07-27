import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./context/AuthContext";
import Header from "./components/Header";
import LoginView from "./components/LoginView";
import Dashboard from "./components/Dashboard";
import AdminAssignments from "./components/AdminAssignments";

const LOG = "[GoalTracker SSO]";

export default function App() {
  const { user, token, login, logout, isAuthenticated } = useAuth();
  const [ssoLoading, setSsoLoading] = useState(() => !!new URLSearchParams(window.location.search).get("sso"));
  const [ssoError, setSsoError] = useState("");

  // Same SSO-exchange-inside-React pattern as CurriculumTracker's App.jsx -
  // avoids a full page reload just so AuthContext notices the new token.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get("sso");
    if (!ssoToken) return;
    if (localStorage.getItem("token")) {
      window.history.replaceState({}, "", window.location.pathname);
      setSsoLoading(false);
      return;
    }

    function attemptExchange(attemptNumber) {
      console.log(LOG, "attempt", attemptNumber);
      return api.ssoLogin(ssoToken);
    }

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

  const handleLogout = () => {
    logout();
    const portalUrl = import.meta.env.VITE_PORTAL_URL || "http://localhost:3000/portal/login.html";
    window.location.href = portalUrl;
  };

  return (
    <>
      {isAuthenticated && <Header user={user} onLogout={handleLogout} onAdmin={() => setShowAdmin(true)} />}

      <div className="app-container">
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
          <Dashboard token={token} user={user} />
        )}
      </div>

      {showAdmin && <AdminAssignments token={token} onClose={() => setShowAdmin(false)} />}
    </>
  );
}
