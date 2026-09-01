import { createContext, useContext, useMemo, useState } from "react";

const AuthContext = createContext(null);

// Arriving with ?sso= means the portal is handing over a fresh identity, so
// any stored session is stale by definition. Dropping it BEFORE React reads it
// matters: otherwise the dashboard and /api/me fire with the old token while
// the exchange is still in flight, and a 401 from those would bounce to the
// portal mid-exchange — the app and the portal then ping-pong forever.
function clearStaleSessionOnSsoArrival() {
  if (!new URLSearchParams(window.location.search).get("sso")) return;
  ["token", "user", "real_token", "real_user"].forEach((k) => localStorage.removeItem(k));
}

export function AuthProvider({ children }) {
  clearStaleSessionOnSsoArrival();

  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  });

  // Called once the SSO exchange resolves — updates React state directly so
  // the app can move straight to the Dashboard without a full page reload
  // (the previous index.html-script approach forced a second full page load
  // just to get React to notice the token, which was the biggest avoidable
  // chunk of the "Loading your workspace…" wait).
  const login = (ssoResponse) => {
    const nextUser = {
      name: ssoResponse.name,
      email: ssoResponse.email,
      role: ssoResponse.role,
      designation: ssoResponse.designation,
      subject: ssoResponse.subject,
      subjects: ssoResponse.subjects || (ssoResponse.subject ? [ssoResponse.subject] : []),
      location: ssoResponse.location,
      can_view_as: Boolean(ssoResponse.can_view_as),
      can_upload_curriculum: Boolean(ssoResponse.can_upload_curriculum),
      can_see_lagging: Boolean(ssoResponse.can_see_lagging),
      can_create_pow: Boolean(ssoResponse.can_create_pow),
      can_see_overview: Boolean(ssoResponse.can_see_overview),
      can_mark_coverage: Boolean(ssoResponse.can_mark_coverage),
      can_oversee: Boolean(ssoResponse.can_oversee),
      branches: ssoResponse.branches || [],
    };
    setToken(ssoResponse.access_token);
    setUser(nextUser);
    localStorage.setItem("token", ssoResponse.access_token);
    localStorage.setItem("user", JSON.stringify(nextUser));
  };

  // Capabilities are recomputed server-side (GET /api/me) and merged into the
  // cached user, so a session created before a capability existed doesn't keep
  // a stale copy of it until the next portal login.
  const refreshUser = (me) => {
    setUser((prev) => {
      const next = { ...(prev || {}), ...me };
      localStorage.setItem("user", JSON.stringify(next));
      return next;
    });
  };

  // "View as": the previewer's own token/user are parked under real_* keys so
  // resetting never needs another SSO round trip. Stashed only on the first
  // switch — switching straight from one previewed person to another must not
  // overwrite the real identity with a previewed one.
  const [realUser, setRealUser] = useState(() => {
    const stored = localStorage.getItem("real_user");
    return stored ? JSON.parse(stored) : null;
  });

  const viewAs = (ssoResponse) => {
    if (!localStorage.getItem("real_token")) {
      localStorage.setItem("real_token", token);
      localStorage.setItem("real_user", JSON.stringify(user));
      setRealUser(user);
    }
    login(ssoResponse);
  };

  const resetToMe = () => {
    const realToken = localStorage.getItem("real_token");
    const stored = localStorage.getItem("real_user");
    if (!realToken || !stored) return;
    const me = JSON.parse(stored);
    localStorage.setItem("token", realToken);
    localStorage.setItem("user", stored);
    localStorage.removeItem("real_token");
    localStorage.removeItem("real_user");
    setToken(realToken);
    setUser(me);
    setRealUser(null);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setRealUser(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("real_token");
    localStorage.removeItem("real_user");
  };

  const value = useMemo(
    () => ({
      token, user, login, logout, viewAs, resetToMe, refreshUser, realUser,
      isViewingAs: Boolean(realUser),
      isAuthenticated: Boolean(token && user),
    }),
    [token, user, realUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
