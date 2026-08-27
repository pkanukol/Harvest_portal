import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useAuth } from "./context/AuthContext";
import { isPastWeek } from "./dateUtils";
import Header from "./components/Header";
import LoginView from "./components/LoginView";
import Dashboard from "./components/Dashboard";
import POWForm from "./components/POWForm";
import POWView from "./components/POWView";
import Progress from "./components/Progress";
import CurriculumOverview from "./components/CurriculumOverview";
import BranchCompare from "./components/BranchCompare";
import PlannerUpload from "./components/PlannerUpload";

const LOG = "[CurriculumTracker SSO]";

export default function App() {
  const { user, token, login, viewAs, resetToMe, refreshUser, realUser, isAuthenticated } = useAuth();
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

    // Always exchange when the portal hands us a token, even if one is already
    // stored. Skipping the exchange whenever localStorage held a token meant a
    // DEAD token (expired at the weekly reset, or signed with a SECRET_KEY the
    // backend no longer has) could never be replaced: arriving from the portal
    // kept the broken session and every call 401'd, with no way back in. One
    // extra exchange per portal launch is a cheap price for that.

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

  // A URL can open straight into a view, and ?embed=1 strips the app chrome so
  // the page can be dropped into a report or an iframe elsewhere - the
  // management dashboard shows the campus comparison this way.
  const deepLink = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("view");
    if (!target) return null;
    return {
      view: target,
      subject: params.get("subject") || "",
      embed: params.get("embed") === "1",
    };
  }, []);

  const [view, setView] = useState(deepLink ? deepLink.view : "dashboard");
  const [currentPowId, setCurrentPowId] = useState(null);
  const [implPrefillPow, setImplPrefillPow] = useState(null);
  const [loadError, setLoadError] = useState("");

  const isSME = user?.role === "SME";
  const isLeadership = user?.role === "Leadership";
  const isReadOnlyViewer = isSME || isLeadership;
  const canUploadCurriculum = Boolean(user?.can_upload_curriculum);
  // The week-by-week POW table across a grade — SMEs and Curriculum Heads.
  const canSeeOverview = Boolean(user?.can_see_overview);
  // Reviewing and teaching are not exclusive: Coordinators, HODs and some SMEs
  // teach their own classes, so POW authoring follows this flag rather than the
  // single resolved role.
  const canCreatePow = Boolean(user?.can_create_pow) || user?.role === "Teacher";

  // One campus selection for the whole app, remembered between visits. Blank
  // means "all campuses I'm allowed to see".
  const myBranches = user?.branches || [];
  const [branch, setBranch] = useState(() => localStorage.getItem("branch") || "");

  function chooseBranch(value) {
    setBranch(value);
    localStorage.setItem("branch", value);
  }

  // Drop a remembered campus this account may no longer view (e.g. after a
  // View as switch to someone on the other campus).
  useEffect(() => {
    if (branch && myBranches.length && !myBranches.includes(branch)) chooseBranch("");
  }, [user?.email, myBranches.join("|")]);

  const goDashboard = () => { setView("dashboard"); setLoadError(""); };

  const goNewPow = () => { setView("new-pow"); };

  const goProgress = () => { setView("progress"); };

  const goOverview = () => { setView("overview"); };

  const goCompare = () => { setView("compare"); };

  const goPlannerUpload = () => { setView("planner-upload"); };

  async function openPow(id) {
    setLoadError("");
    // Someone who teaches gets the past-week implementation form for their own
    // POWs, even if they also review.
    if (!canCreatePow) {
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
      {isAuthenticated && !deepLink?.embed && (
        <Header
          user={user}
          realUser={realUser}
          token={token}
          view={view}
          onDashboard={goDashboard}
          branch={branch}
          branches={myBranches}
          onBranchChange={chooseBranch}
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
                key={user.email}
                token={token}
                user={user}
                isReadOnlyViewer={isReadOnlyViewer}
                isLeadership={isLeadership}
                canUploadCurriculum={canUploadCurriculum}
                canCreatePow={canCreatePow}
                canSeeOverview={canSeeOverview}
                branch={branch}
                onNewPow={goNewPow}
                onProgress={goProgress}
                onOverview={goOverview}
                onCompare={goCompare}
                onPlannerUpload={goPlannerUpload}
                onOpenPow={openPow}
              />
            )}

            {view === "new-pow" && (
              <POWForm key={user.email} token={token} user={user} mode="new" onDone={goDashboard} onBack={goDashboard} />
            )}

            {view === "impl-form" && implPrefillPow && (
              <POWForm token={token} user={user} mode="impl_only" prefillPow={implPrefillPow} onDone={goDashboard} onBack={goDashboard} />
            )}

            {view === "pow-view" && currentPowId && (
              <POWView token={token} user={user} powId={currentPowId} onBack={goDashboard} onDone={goDashboard} />
            )}

            {view === "planner-upload" && canUploadCurriculum && (
              <PlannerUpload key={user.email} token={token} onBack={goDashboard} />
            )}

            {view === "compare" && isReadOnlyViewer && (
              <BranchCompare
                key={user.email}
                token={token}
                initialSubject={deepLink?.view === "compare" ? deepLink.subject : ""}
                embed={Boolean(deepLink?.embed)}
                onBack={goDashboard}
              />
            )}

            {view === "overview" && canSeeOverview && (
              <CurriculumOverview key={user.email} token={token} user={user} branch={branch} onBack={goDashboard} />
            )}

            {view === "progress" && (
              <Progress
                key={user.email}
                token={token}
                user={user}
                isReadOnlyViewer={isReadOnlyViewer}
                isLeadership={isLeadership}
                branch={branch}
                onBack={goDashboard}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
