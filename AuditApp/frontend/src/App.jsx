import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import AlertPopup from "./components/AlertPopup";
import Dashboard from "./components/Dashboard";
import DetailDrawer from "./components/DetailDrawer";
import Header from "./components/Header";
import LoginView from "./components/LoginView";
import ObservationForm, { EMPTY_SCORES } from "./components/ObservationForm";
import SuccessView from "./components/SuccessView";
import TeacherView from "./components/TeacherView";
import { useAuth } from "./context/AuthContext";

export default function App() {
  const { user, token, login, logout, isAuthenticated } = useAuth();
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

  const loadTeachers = useCallback(async (loc) => {
    if (!token) return;
    try {
      const data = await api.getTeachers(token, loc);
      setTeachers(data);
    } catch (err) {
      console.error("Failed to load teachers:", err);
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
        window.location.href = import.meta.env.VITE_PORTAL_URL || "http://localhost:3000/portal/login.html";
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
    } else {
      setView("dashboard");
      loadTeachers("Kodathi");
    }
    loadAlerts();
  }, [isAuthenticated, user, loadTeacherReports, loadTeachers, loadAlerts]);

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
      if (!payload[key]) { setSubmitError("Please evaluate all rubrics before saving draft."); return; }
    }
    setSubmitting(true);
    try {
      const data = await api.createObservation(token, payload);
      if (selectedImages.length > 0) {
        await Promise.all(selectedImages.map((file) =>
          api.uploadImage(token, data.id, file).catch((err) =>
            console.warn("Failed to upload image:", file.name, err)
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

  // Open drawer with a specific observation ID
  const openDrawer = (obsId) => {
    setDrawerObsId(obsId);
    setDrawerOpen(true);
  };

  const headerSub = user?.role === "teacher" ? "My Observation Reports" : "Academic Quality Audit";
  const showDashboardNav = isAuthenticated && user?.role !== "teacher" && view !== "dashboard";

  return (
    <>
      {showAlert && <AlertPopup alerts={alerts} onClose={() => setShowAlert(false)} />}
      {isAuthenticated && (
        <Header
          user={user}
          headerSub={headerSub}
          showDashboardNav={showDashboardNav}
          onDashboard={() => setView("dashboard")}
          onLogout={handleLogout}
        />
      )}

      <div className="app-container">
        {!isAuthenticated ? (
          <LoginView onSuccess={handleLoginSuccess} />
        ) : (
          <>
            {view === "form" && (
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
            )}

            {view === "success" && (
              <SuccessView
                summary={successSummary}
                onDashboard={() => setView("dashboard")}
                onNewObservation={() => { resetForm(); setView("form"); }}
              />
            )}

            {view === "dashboard" && user.role !== "teacher" && (
              <Dashboard
                token={token}
                user={user}
                location={location}
                onLocationChange={setLocation}
                onNewObservation={() => { resetForm(); setView("form"); }}
                onOpenObs={openDrawer}
                refreshKey={dashboardRefreshKey}
              />
            )}

            {view === "teacher" && (
              <TeacherView
                userName={user.name}
                reports={teacherReports}
                loading={reportsLoading}
                error={reportsError}
                onOpenReport={(obsId) => openDrawer(obsId)}
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
    </>
  );
}
