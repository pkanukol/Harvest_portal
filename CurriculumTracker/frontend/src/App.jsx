import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./context/AuthContext";
import { isPastWeek } from "./dateUtils";
import Header from "./components/Header";
import LoginView from "./components/LoginView";
import Dashboard from "./components/Dashboard";
import POWForm from "./components/POWForm";
import POWView from "./components/POWView";
import Progress from "./components/Progress";
import PlannerUpload from "./components/PlannerUpload";

const LOG = "[CurriculumTracker SSO]";

export default function App() {
  const { user, token, login, logout, viewAs, resetToMe, refreshUser, realUser, isAuthenticated } = useAuth();
  const [ssoLoading, setSsoLoading] = useState(() => !!new URLSearchParams(window.location.search).get("sso"));
  const [ssoError, setSsoError] = useState("");

  // Exchange the portal's Supabase token for a Curriculum Tracker JWT inside
  // React, instead of a pre-mount <script> + full page reload — the reload
  // was the single biggest avoidable chunk of the "Loading your workspace…"
  // wait, since it re-fetched and re-parsed the whole JS bundle a second time
  // just so AuthContext would notice the token. login() now updates state
  // directly, so the Dashboard can render the moment the exchange resolves.
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

  // Refresh capabilities for whatever session is already stored — cheap, and
  // it's what lets a change like "SMEs can now upload" reach an open session.
  useEffect(() => {
    if (!token) return;
    api.getMe(token).then(refreshUser).catch(() => {});
  }, [token]);

  const [view, setView] = useState("dashboard");
  const [currentPowId, setCurrentPowId] = useState(null);
  const [implPrefillPow, setImplPrefillPow] = useState(null);
  const [loadError, setLoadError] = useState("");

  const isSME = user?.role === "SME";
  const isLeadership = user?.role === "Leadership";
  const isReadOnlyViewer = isSME || isLeadership;
  const canUploadCurriculum = Boolean(user?.can_upload_curriculum);

  const handleLogout = () => {
    logout();
    const portalUrl = import.meta.env.VITE_PORTAL_URL || "https://his-academy360.netlify.app";
    window.location.href = portalUrl;
  };

  const goDashboard = () => { setView("dashboard"); setLoadError(""); };

  const goNewPow = () => { setView("new-pow"); };

  const goProgress = () => { setView("progress"); };

  const goPlannerUpload = () => { setView("planner-upload"); };

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
        <Header
          user={user}
          realUser={realUser}
          token={token}
          view={view}
          onDashboard={goDashboard}
          onLogout={handleLogout}
          onViewAs={(res) => { viewAs(res); setView("dashboard"); }}
          onResetToMe={() => { resetToMe(); setView("dashboard"); }}
        />
      )}

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
          <>
            {loadError && <div className="form-error">{loadError}</div>}

            {view === "dashboard" && (
              <Dashboard
                token={token}
                user={user}
                isReadOnlyViewer={isReadOnlyViewer}
                isLeadership={isLeadership}
                canUploadCurriculum={canUploadCurriculum}
                onNewPow={goNewPow}
                onProgress={goProgress}
                onPlannerUpload={goPlannerUpload}
                onOpenPow={openPow}
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

            {view === "planner-upload" && canUploadCurriculum && (
              <PlannerUpload token={token} onBack={goDashboard} />
            )}

            {view === "progress" && (
              <Progress token={token} user={user} isReadOnlyViewer={isReadOnlyViewer} onBack={goDashboard} />
            )}
          </>
        )}
      </div>
    </>
  );
}
