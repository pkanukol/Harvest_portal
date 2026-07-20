import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./context/AuthContext";
import Header from "./components/Header";
import LoginView from "./components/LoginView";
import TicketForm from "./components/TicketForm";
import SuccessView from "./components/SuccessView";
import TicketList from "./components/TicketList";
import TicketDetail from "./components/TicketDetail";

export default function App() {
  const { user, token, login, logout, isAuthenticated } = useAuth();
  const [ssoLoading, setSsoLoading] = useState(() =>
    !!new URLSearchParams(window.location.search).get("sso")
  );
  const [view, setView] = useState("list");
  const [location, setLocation] = useState(() => user?.home_location || "Kodathi");
  const [categories, setCategories] = useState([]);
  const [routing, setRouting] = useState({});
  const [activeTicketId, setActiveTicketId] = useState(null);
  const [successTicket, setSuccessTicket] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Handle SSO token from portal (?sso=<supabase_token>)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get("sso");
    if (!ssoToken) return;
    if (localStorage.getItem("token")) {
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    api.ssoLogin(ssoToken)
      .then((data) => {
        localStorage.setItem("token", data.access_token);
        localStorage.setItem("user", JSON.stringify({
          name: data.name, email: data.email, views: data.views || [], home_location: data.home_location || null,
        }));
        params.delete("sso");
        const qs = params.toString();
        window.location.replace(window.location.pathname + (qs ? `?${qs}` : ""));
      })
      .catch(() => setSsoLoading(false));
  }, []);

  // Lock the campus to the user's home location once known (e.g. SSO resolves after mount)
  useEffect(() => {
    if (user?.home_location) setLocation(user.home_location);
  }, [user?.home_location]);

  // Fetch categories once (alphabetically sorted by the backend)
  useEffect(() => {
    if (!isAuthenticated) return;
    api.getCategories().then(setCategories).catch(() => {});
  }, [isAuthenticated]);

  // Routing (labels + who each category is sent to) is per-location, so refetch
  // whenever the campus toggle changes.
  useEffect(() => {
    if (!isAuthenticated) return;
    api.getRouting(location).then(setRouting).catch(() => {});
  }, [isAuthenticated, location]);

  // Deep link: ?ticket=<id> opens that ticket directly once authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    const params = new URLSearchParams(window.location.search);
    const ticketId = params.get("ticket");
    if (ticketId) {
      setActiveTicketId(Number(ticketId));
      setView("detail");
    }
  }, [isAuthenticated]);

  const handleLogout = () => {
    logout();
    const portalUrl = import.meta.env.VITE_PORTAL_URL || "http://localhost:3000/portal/index.html";
    window.location.href = portalUrl;
  };

  const goList = () => {
    window.history.replaceState({}, "", window.location.pathname);
    setView("list");
  };

  const goNew = () => {
    window.history.replaceState({}, "", window.location.pathname);
    setSubmitError("");
    setView("new");
  };

  const openTicket = (id) => {
    setActiveTicketId(id);
    setView("detail");
  };

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const ticket = await api.createTicket(token, { ...payload, location });
      setSuccessTicket(ticket);
      setView("success");
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {isAuthenticated && (
        <Header
          user={user}
          view={view}
          location={location}
          onLocationChange={setLocation}
          onList={goList}
          onLogout={handleLogout}
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
            <LoginView />
          )
        ) : (
          <>
            {view === "list" && (
              <TicketList token={token} user={user} location={location} routing={routing} onOpenTicket={openTicket} onNew={goNew} />
            )}

            {view === "new" && (
              <TicketForm
                categories={categories}
                routing={routing}
                onSubmit={handleSubmit}
                submitting={submitting}
                submitError={submitError}
              />
            )}

            {view === "success" && (
              <SuccessView
                ticket={successTicket}
                onViewTicket={openTicket}
                onNewTicket={goNew}
                onAllTickets={goList}
              />
            )}

            {view === "detail" && activeTicketId && (
              <TicketDetail token={token} user={user} ticketId={activeTicketId} onBack={goList} />
            )}
          </>
        )}
      </div>
    </>
  );
}
