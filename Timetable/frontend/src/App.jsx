import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./context/AuthContext";
import ImportView from "./components/ImportView";
import GenerateView from "./components/GenerateView";
import TimetableGrid from "./components/TimetableGrid";
import TeacherWeekView from "./components/TeacherWeekView";
import TeacherTimetableView from "./components/TeacherTimetableView";
import TeachersAdminView from "./components/TeachersAdminView";

const LOCATIONS = ["Kodathi", "Attibele"];

export default function App() {
  const { user, token, logout, isAuthenticated } = useAuth();
  const ssoInFlight = !!new URLSearchParams(window.location.search).get("sso");

  const [location, setLocation] = useState(() => localStorage.getItem("location") || "Kodathi");
  const [activeYear, setActiveYear] = useState(null);
  const [yearLoading, setYearLoading] = useState(true);

  const changeLocation = (loc) => {
    localStorage.setItem("location", loc);
    setLocation(loc);
  };

  const loadActiveYear = useCallback(async () => {
    if (!token) return;
    setYearLoading(true);
    try {
      const year = await api.getActiveYear(token, location);
      setActiveYear(year);
    } catch (err) {
      console.error("Failed to load active year:", err);
    } finally {
      setYearLoading(false);
    }
  }, [token, location]);

  useEffect(() => {
    loadActiveYear();
  }, [loadActiveYear]);

  if (!isAuthenticated) {
    return (
      <div className="centered-message">
        {ssoInFlight ? (
          <>
            <h2>Loading your workspace…</h2>
            <p>Signing you in via the school portal.</p>
          </>
        ) : (
          <>
            <h2>Please open Timetable from the school portal</h2>
            <p>This app doesn't support direct login — go to the portal and open Timetable from there.</p>
            <a
              className="btn"
              href={
                import.meta.env.VITE_PORTAL_URL ||
                (["localhost", "127.0.0.1"].includes(window.location.hostname)
                  ? "http://localhost:3000/portal/login.html"
                  : "https://harvest-portal.onrender.com/portal/login.html")
              }
            >
              Go to portal
            </a>
          </>
        )}
      </div>
    );
  }

  const isLeadership = user.access_level === "leadership";

  return (
    <div className="app-shell">
      <TopBar user={user} onLogout={logout} location={location} onChangeLocation={changeLocation} />
      {isLeadership ? (
        <LeadershipApp
          token={token} location={location} activeYear={activeYear} yearLoading={yearLoading}
          onImportCommitted={loadActiveYear}
        />
      ) : (
        <ViewOnlyApp token={token} user={user} activeYear={activeYear} yearLoading={yearLoading} />
      )}
    </div>
  );
}

const LEADERSHIP_TABS = [
  { key: "import", label: "1. Import" },
  { key: "generate", label: "2. Generate" },
  { key: "timetable", label: "3. Timetable" },
  { key: "teachers", label: "Teachers" },
];

function LeadershipApp({ token, location, activeYear, yearLoading, onImportCommitted }) {
  // Always default to Timetable - it already just fetches the saved data (never
  // re-generates) and shows its own "no data yet" prompt if nothing's imported.
  const [tab, setTab] = useState("timetable");

  return (
    <>
      <div className="tabs">
        {LEADERSHIP_TABS.map((t) => (
          <button key={t.key} className={`tab-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="page">
        {tab === "import" && (
          <ImportView
            token={token}
            location={location}
            activeYear={activeYear}
            onCommitted={onImportCommitted}
            onNext={() => setTab("generate")}
          />
        )}
        {tab === "generate" && (
          <GenerateView
            token={token} activeYear={activeYear}
            onNext={() => setTab("timetable")}
            onGoToImport={() => setTab("import")}
          />
        )}
        {tab === "teachers" && <TeachersAdminView token={token} location={location} activeYear={activeYear} />}
        {tab === "timetable" && (
          <BrowseTimetable
            token={token} location={location} activeYear={activeYear} yearLoading={yearLoading}
            readOnly={false} allowTeacherView
          />
        )}
      </div>
    </>
  );
}

function ViewOnlyApp({ token, user, activeYear, yearLoading }) {
  const [tab, setTab] = useState(user.teacher_id ? "my-week" : "browse");

  return (
    <>
      <div className="tabs">
        {user.teacher_id && (
          <button className={`tab-btn ${tab === "my-week" ? "active" : ""}`} onClick={() => setTab("my-week")}>
            My Week
          </button>
        )}
        <button className={`tab-btn ${tab === "browse" ? "active" : ""}`} onClick={() => setTab("browse")}>
          Browse Timetable
        </button>
      </div>
      <div className="page">
        {tab === "my-week" && (
          yearLoading ? <p>Loading…</p> : !activeYear ? <p>No timetable has been published yet.</p> :
          <TeacherWeekView token={token} academicYearId={activeYear.id} />
        )}
        {tab === "browse" && (
          <BrowseTimetable token={token} activeYear={activeYear} yearLoading={yearLoading} readOnly={true} />
        )}
      </div>
    </>
  );
}

function BrowseTimetable({ token, location, activeYear, yearLoading, readOnly, allowTeacherView }) {
  const [selectedGradeId, setSelectedGradeId] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [viewMode, setViewMode] = useState("section"); // "section" | "teacher"

  useEffect(() => {
    // Re-initialize (not just on first load) whenever the active year itself
    // changes - e.g. switching location to a different academic year, or one
    // with no data yet - so a stale grade/section from the previous location
    // never lingers.
    if (activeYear && activeYear.grades.length) {
      setSelectedGradeId(activeYear.grades[0].id);
      setSelectedSectionId(activeYear.grades[0].sections[0]?.id || "");
    } else {
      setSelectedGradeId("");
      setSelectedSectionId("");
    }
  }, [activeYear?.id]);

  if (yearLoading) return <p>Loading…</p>;
  if (!activeYear) return <p>No timetable data yet.</p>;

  const grade = activeYear.grades.find((g) => String(g.id) === String(selectedGradeId));

  return (
    <>
      {allowTeacherView && (
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button className={`tab-btn ${viewMode === "section" ? "active" : ""}`} onClick={() => setViewMode("section")}>
            By Section
          </button>
          <button className={`tab-btn ${viewMode === "teacher" ? "active" : ""}`} onClick={() => setViewMode("teacher")}>
            By Teacher
          </button>
        </div>
      )}

      {viewMode === "teacher" && allowTeacherView ? (
        <TeacherTimetableView
          token={token}
          academicYearId={activeYear.id}
          location={location}
          timing={activeYear.timing}
        />
      ) : (
        <>
          <div className="card" style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <label>
              Grade{" "}
              <select
                className="select"
                value={selectedGradeId}
                onChange={(e) => {
                  setSelectedGradeId(e.target.value);
                  const g = activeYear.grades.find((gr) => String(gr.id) === e.target.value);
                  setSelectedSectionId(g?.sections[0]?.id || "");
                }}
              >
                {activeYear.grades.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>
            <label>
              Section{" "}
              <select className="select" value={selectedSectionId} onChange={(e) => setSelectedSectionId(e.target.value)}>
                {grade?.sections.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          </div>
          {selectedSectionId && (
            <TimetableGrid
              token={token}
              academicYearId={activeYear.id}
              sectionId={selectedSectionId}
              timing={activeYear.timing}
              readOnly={readOnly}
            />
          )}
        </>
      )}
    </>
  );
}

function TopBar({ user, onLogout, location, onChangeLocation }) {
  return (
    <div className="top-bar">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <img src="/logo.png" alt="Harvest International School" className="top-bar-logo" />
        <div className="top-bar-title">Harvest Timetable</div>
        <div className="location-toggle">
          {LOCATIONS.map((loc) => (
            <button
              key={loc}
              className={`location-btn ${location === loc ? "active" : ""}`}
              onClick={() => onChangeLocation(loc)}
            >
              {loc}
            </button>
          ))}
        </div>
      </div>
      <div className="top-bar-user">
        {user.name} ({user.designation || user.role}){" "}
        <button className="btn secondary" style={{ marginLeft: 10 }} onClick={onLogout}>Log out</button>
      </div>
    </div>
  );
}
