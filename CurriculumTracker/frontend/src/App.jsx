import { useState } from "react";
import { api } from "./api";
import { useAuth } from "./context/AuthContext";
import { isPastWeek } from "./dateUtils";
import Header from "./components/Header";
import LoginView from "./components/LoginView";
import Dashboard from "./components/Dashboard";
import POWForm from "./components/POWForm";
import POWView from "./components/POWView";
import Progress from "./components/Progress";

export default function App() {
  const { user, token, logout, isAuthenticated } = useAuth();
  const [ssoLoading] = useState(() => !!new URLSearchParams(window.location.search).get("sso"));

  const [view, setView] = useState("dashboard");
  const [currentPowId, setCurrentPowId] = useState(null);
  const [implPrefillPow, setImplPrefillPow] = useState(null);
  const [mappedTeachers, setMappedTeachers] = useState([]);
  const [loadError, setLoadError] = useState("");

  const isSME = user?.role === "SME";
  const isLeadership = user?.role === "Leadership";
  const isReadOnlyViewer = isSME || isLeadership;

  const handleLogout = () => {
    logout();
    const portalUrl = import.meta.env.VITE_PORTAL_URL || "http://localhost:3000/portal/login.html";
    window.location.href = portalUrl;
  };

  const goDashboard = () => { setView("dashboard"); setLoadError(""); };

  const goNewPow = () => { setView("new-pow"); };

  const goProgress = () => { setView("progress"); };

  async function openPow(id) {
    setLoadError("");
    if (isReadOnlyViewer) {
      setCurrentPowId(id);
      setView("pow-view");
      return;
    }
    try {
      const res = await api.getPow(token, id);
      if (isPastWeek(res.pow.week_start)) {
        setImplPrefillPow(res.pow);
        setView("impl-form");
      } else {
        setCurrentPowId(id);
        setView("pow-view");
      }
    } catch (err) {
      setLoadError(err.message);
    }
  }

  return (
    <>
      {isAuthenticated && (
        <Header user={user} view={view} onDashboard={goDashboard} onLogout={handleLogout} />
      )}

      <div className="app-container">
        {!isAuthenticated ? (
          ssoLoading ? (
            <div className="sso-loading-screen">
              <div className="sso-loading-text">Loading your workspace…</div>
              <div className="sso-loading-sub">Signing you in via the school portal</div>
            </div>
          ) : (
            <LoginView />
          )
        ) : (
          <>
            {loadError && <div className="form-error">{loadError}</div>}

            {view === "dashboard" && (
              <Dashboard
                token={token}
                isReadOnlyViewer={isReadOnlyViewer}
                onNewPow={goNewPow}
                onProgress={goProgress}
                onOpenPow={openPow}
                onTeachersLoaded={setMappedTeachers}
              />
            )}

            {view === "new-pow" && (
              <POWForm token={token} user={user} mode="new" onDone={goDashboard} onBack={goDashboard} />
            )}

            {view === "impl-form" && implPrefillPow && (
              <POWForm token={token} user={user} mode="impl_only" prefillPow={implPrefillPow} onDone={goDashboard} onBack={goDashboard} />
            )}

            {view === "pow-view" && currentPowId && (
              <POWView token={token} user={user} powId={currentPowId} onBack={goDashboard} onDone={goDashboard} />
            )}

            {view === "progress" && (
              <Progress token={token} user={user} isReadOnlyViewer={isReadOnlyViewer} mappedTeachers={mappedTeachers} onBack={goDashboard} />
            )}
          </>
        )}
      </div>
    </>
  );
}
