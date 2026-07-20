import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import AlertPopup from "./components/AlertPopup";
import Dashboard from "./components/Dashboard";
import DetailDrawer from "./components/DetailDrawer";
import Header from "./components/Header";
import LoginView from "./components/LoginView";
import ObservationForm, { EMPTY_SCORES } from "./components/ObservationForm";
import SpaDashboard from "./components/SpaDashboard";
import SpaDetailDrawer from "./components/SpaDetailDrawer";
import SpaObservationForm from "./components/SpaObservationForm";
import SuccessView from "./components/SuccessView";
import TeacherView from "./components/TeacherView";
import { useAuth } from "./context/AuthContext";

export default function App() {
  const { user, token, login, logout, isAuthenticated } = useAuth();
  const [ssoLoading, setSsoLoading] = useState(() =>
    !!new URLSearchParams(window.location.search).get("sso")
  );
  const [view, setView] = useState("login");
  const [location, setLocation] = useState("Kodathi");
  const [teachers, setTeachers] = useState([]);
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [teacherReports, setTeacherReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [formScores, setFormScores] = useState({ ...EMPTY_SCORES });
  const [timestampedNotes, setTimestampedNotes] = useState([]);
  const [selectedImages, setSelectedImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successSummary, setSuccessSummary] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerObsId, setDrawerObsId] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [showAlert, setShowAlert] = useState(false);

  // SPA (Sports / Performing Arts) observation state
  const [formType, setFormType] = useState("classroom"); // "classroom" | "spa"
  const [coaches, setCoaches] = useState([]);
  const [spaDashboardRefreshKey, setSpaDashboardRefreshKey] = useState(0);
  const [spaSubmitting, setSpaSubmitting] = useState(false);
  const [spaSubmitError, setSpaSubmitError] = useState("");
  const [spaDrawerOpen, setSpaDrawerOpen] = useState(false);
  const [spaDrawerObsId, setSpaDrawerObsId] = useState(null);
  const [spaTeacherReports, setSpaTeacherReports] = useState([]);
  const [spaReportsLoading, setSpaReportsLoading] = useState(false);
  const [spaReportsError, setSpaReportsError] = useState("");

  const loadTeachers = useCallback(async (loc) => {
    if (!token) return;
    try {
      const data = await api.getTeachers(token, loc);
      setTeachers(data);
    } catch (err) {
      console.error("Failed to load teachers:", err);
    }
  }, [token]);

  const loadCoaches = useCallback(async (loc) => {
    if (!token) return;
    try {
      const data = await api.getTeachers(token, loc, "SPA");
      setCoaches(data);
    } catch (err) {
      console.error("Failed to load SPA coaches:", err);
    }
  }, [token]);

  const loadTeacherReports = useCallback(async () => {
    if (!token || !user) return;
    setReportsLoading(true);
    setReportsError("");
    try {
      const data = await api.getTeacherObservations(token, user.id);
      setTeacherReports(data);
    } catch (err) {
      setReportsError(err.message);
    } finally {
      setReportsLoading(false);
    }
  }, [token, user]);

  const loadSpaTeacherReports = useCallback(async () => {
    if (!token || !user) return;
    setSpaReportsLoading(true);
    setSpaReportsError("");
    try {
      const data = await api.getTeacherSpaObservations(token, user.id);
      setSpaTeacherReports(data);
    } catch (err) {
      setSpaReportsError(err.message);
    } finally {
      setSpaReportsLoading(false);
    }
  }, [token, user]);

  const loadAlerts = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.getAlerts(token);
      if (data.items && data.items.length > 0) {
        setAlerts(data);
        setShowAlert(true);
      }
    } catch {
      // non-critical
    }
  }, [token]);

  // Handle SSO token from portal (?sso=<supabase_token>)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get("sso");
    if (!ssoToken) return;
    // Write directly to localStorage then reload — avoids React state timing issues
    if (localStorage.getItem("token")) {
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    api.ssoLogin(ssoToken)
      .then((data) => {
        localStorage.setItem("token", data.access_token);
        localStorage.setItem("user", JSON.stringify({
          id: data.id, name: data.name, email: data.email,
          role: data.role, designation: data.designation, location: data.location,
        }));
        window.location.replace(window.location.pathname);
      })
      .catch(() => {
        setSsoLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      const params = new URLSearchParams(window.location.search);
      if (!params.get("sso")) {
        setView("login");
      }
      return;
    }
    if (user.role === "teacher") {
      setView("teacher");
      loadTeacherReports();
      loadSpaTeacherReports();
    } else {
      setView("dashboard");
      loadTeachers("Kodathi");
      loadCoaches("Kodathi");
    }
    loadAlerts();
  }, [isAuthenticated, user, loadTeacherReports, loadSpaTeacherReports, loadTeachers, loadCoaches, loadAlerts]);

  const resetForm = () => {
    setFormScores({ ...EMPTY_SCORES });
    setTimestampedNotes([]);
    setSelectedImages([]);
    setSubmitError("");
  };

  const handleLoginSuccess = (role) => setView(role === "teacher" ? "teacher" : "dashboard");

  const handleLogout = () => {
    logout();
    setDrawerOpen(false);
    // Opened as a new window from portal — close it and return to portal
    const portalUrl = import.meta.env.VITE_PORTAL_URL || "http://localhost:3000/portal/index.html";
    if (window.opener) {
      window.close();
    } else {
      window.location.href = portalUrl;
    }
  };

  const handleObservationSubmit = async (payload) => {
    setSubmitError("");
    if (!payload.teacher_id) { setSubmitError("Please select a teacher."); return; }
    for (const key of Object.keys(EMPTY_SCORES)) {
      if (key === "p34" && payload.p34_na) continue;
      if (!payload[key]) { setSubmitError("Please evaluate all rubrics before saving draft."); return; }
    }
    setSubmitting(true);
    try {
      const data = await api.createObservation(token, payload);
      if (selectedImages.length > 0) {
        await Promise.all(selectedImages.map((link) =>
          api.addImageLink(token, data.id, link).catch((err) =>
            console.warn("Failed to save image link:", link, err)
          )
        ));
      }
      setSuccessSummary({
        teacherName: data.teacher.name,
        rating: data.rating,
        overallScore: data.overall_score,
        domain1Score: data.domain1_score,
        domain2Score: data.domain2_score,
        domain3Score: data.domain3_score,
      });
      setView("success");
      resetForm();
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Creates the draft on first save, then updates that same record on every subsequent
  // save — lets the auditor keep saving as a draft repeatedly before finalising.
  const handleSpaSaveDraft = async (payload, existingId) => {
    setSpaSubmitError("");
    if (!payload.teacher_id) { setSpaSubmitError("Please select a coach."); return null; }
    if (!payload.activity) { setSpaSubmitError("Please enter the activity."); return null; }
    const missing = Object.values(payload.criteria_scores).some((c) => c.score === null || c.score === undefined);
    if (missing) { setSpaSubmitError("Please rate every criterion before saving draft."); return null; }
    setSpaSubmitting(true);
    try {
      const obs = existingId
        ? await api.updateSpaDraft(token, existingId, payload)
        : await api.createSpaObservation(token, payload);
      setSpaDashboardRefreshKey((k) => k + 1);
      return obs;
    } catch (err) {
      setSpaSubmitError(err.message);
      return null;
    } finally {
      setSpaSubmitting(false);
    }
  };

  const handleSpaFinaliseFromForm = async (id, signoffPayload) => {
    setSpaSubmitError("");
    setSpaSubmitting(true);
    try {
      await api.finaliseSpaObservation(token, id, signoffPayload);
      setSpaDashboardRefreshKey((k) => k + 1);
      setView("spa-dashboard");
    } catch (err) {
      setSpaSubmitError(err.message);
    } finally {
      setSpaSubmitting(false);
    }
  };

  // Open drawer with a specific observation ID
  const openDrawer = (obsId) => {
    setDrawerObsId(obsId);
    setDrawerOpen(true);
  };

  const openSpaDrawer = (obsId) => {
    setSpaDrawerObsId(obsId);
    setSpaDrawerOpen(true);
  };

  const headerSub = user?.role === "teacher" ? "My Observation Reports"
    : view === "spa-dashboard" ? "SPA / Performing Arts Observation"
    : "Academic Quality Audit";
  const showDashboardNav = isAuthenticated && user?.role !== "teacher" && view !== "dashboard";
  const showSpaNav = isAuthenticated && user?.role !== "teacher" && view !== "spa-dashboard";

  return (
    <>
      {showAlert && <AlertPopup alerts={alerts} onClose={() => setShowAlert(false)} />}
      {isAuthenticated && (
        <Header
          user={user}
          headerSub={headerSub}
          showDashboardNav={showDashboardNav}
          onDashboard={() => setView("dashboard")}
          showSpaNav={showSpaNav}
          onSpaDashboard={() => setView("spa-dashboard")}
          onLogout={handleLogout}
        />
      )}

      <div className="app-container">
        {!isAuthenticated ? (
          ssoLoading ? (
            <div className="sso-loading-screen">
              <img src="/logo.png" alt="Harvest" className="sso-loading-logo" />
              <div className="sso-loading-text">Loading your workspace…</div>
              <div className="sso-loading-sub">Signing you in via the school portal</div>
            </div>
          ) : (
            <LoginView onSuccess={handleLoginSuccess} />
          )
        ) : (
          <>
            {view === "form" && (
              <>
                <div className="form-type-toggle">
                  <button
                    className={`form-type-btn${formType === "classroom" ? " active" : ""}`}
                    onClick={() => setFormType("classroom")}
                  >
                    Classroom Observation
                  </button>
                  <button
                    className={`form-type-btn${formType === "spa" ? " active" : ""}`}
                    onClick={() => setFormType("spa")}
                  >
                    SPA / Performing Arts
                  </button>
                </div>
                {formType === "classroom" ? (
                  <ObservationForm
                    token={token}
                    teachers={teachers}
                    formScores={formScores}
                    setFormScores={setFormScores}
                    timestampedNotes={timestampedNotes}
                    setTimestampedNotes={setTimestampedNotes}
                    selectedImages={selectedImages}
                    setSelectedImages={setSelectedImages}
                    onSubmit={handleObservationSubmit}
                    submitting={submitting}
                    submitError={submitError}
                    onSchoolChange={(loc) => loadTeachers(loc)}
                  />
                ) : (
                  <SpaObservationForm
                    user={user}
                    coaches={coaches}
                    onSaveDraft={handleSpaSaveDraft}
                    onFinalise={handleSpaFinaliseFromForm}
                    submitting={spaSubmitting}
                    submitError={spaSubmitError}
                    onSchoolChange={(loc) => loadCoaches(loc)}
                  />
                )}
              </>
            )}

            {view === "success" && (
              <SuccessView
                summary={successSummary}
                onDashboard={() => setView("dashboard")}
                onNewObservation={() => { resetForm(); setFormType("classroom"); setView("form"); }}
              />
            )}

            {view === "dashboard" && user.role !== "teacher" && (
              <Dashboard
                token={token}
                user={user}
                location={location}
                onLocationChange={setLocation}
                onNewObservation={() => { resetForm(); setFormType("classroom"); setView("form"); }}
                onOpenObs={openDrawer}
                refreshKey={dashboardRefreshKey}
              />
            )}

            {view === "spa-dashboard" && user.role !== "teacher" && (
              <SpaDashboard
                token={token}
                user={user}
                location={location}
                onLocationChange={setLocation}
                onNewObservation={() => { setSpaSubmitError(""); setFormType("spa"); setView("form"); }}
                onOpenObs={openSpaDrawer}
                refreshKey={spaDashboardRefreshKey}
              />
            )}

            {view === "teacher" && (
              <TeacherView
                userName={user.name}
                reports={teacherReports}
                loading={reportsLoading}
                error={reportsError}
                onOpenReport={(obsId) => openDrawer(obsId)}
                spaReports={spaTeacherReports}
                spaReportsLoading={spaReportsLoading}
                spaReportsError={spaReportsError}
                onOpenSpaReport={(obsId) => openSpaDrawer(obsId)}
              />
            )}
          </>
        )}
      </div>

      <DetailDrawer
        open={drawerOpen}
        token={token}
        user={user}
        obsId={drawerObsId}
        onClose={() => setDrawerOpen(false)}
        onUpdated={() => {
          if (user?.role === "teacher") {
            loadTeacherReports();
          } else {
            setDashboardRefreshKey((k) => k + 1);
          }
        }}
      />

      <SpaDetailDrawer
        open={spaDrawerOpen}
        token={token}
        user={user}
        obsId={spaDrawerObsId}
        onClose={() => setSpaDrawerOpen(false)}
        onUpdated={() => {
          if (user?.role === "teacher") {
            loadSpaTeacherReports();
          } else {
            setSpaDashboardRefreshKey((k) => k + 1);
          }
        }}
      />
    </>
  );
}
