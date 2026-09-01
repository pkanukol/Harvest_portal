import { createContext, useContext, useMemo, useState } from "react";

const AuthContext = createContext(null);

// Every permission flag the current build reads off `user`. A session saved
// by an older build predates whichever flags were added since, so those read
// as `undefined` - falsy - and the buttons they gate silently vanish. That is
// not a permissions problem but it looks exactly like one, and with Logout
// owned by the portal there is no way for someone to clear it themselves.
//
// So: a stored session missing ANY of these is treated as stale and dropped,
// which sends the user back through SSO and re-mints it complete. Add new
// flags to this list when you add them to the login response.
const REQUIRED_USER_FIELDS = [
  "is_admin",
  "can_manage_reviewers",
  "can_view_observations",
  "can_view_overview",
  "can_view_as",
  "can_act_as",
  "is_hr",
];

function clearStoredSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("own_token");
  localStorage.removeItem("own_user");
}

function readStoredSession() {
  const rawUser = localStorage.getItem("user");
  const token = localStorage.getItem("token");
  if (!rawUser || !token) {
    if (rawUser || token) clearStoredSession();  // half a session is no session
    return { token: null, user: null };
  }
  try {
    const user = JSON.parse(rawUser);
    if (REQUIRED_USER_FIELDS.some((f) => user[f] === undefined)) {
      console.warn("[GoalTracker] stored session is from an older build - signing out to refresh it");
      clearStoredSession();
      return { token: null, user: null };
    }
    return { token, user };
  } catch {
    clearStoredSession();
    return { token: null, user: null };
  }
}

export function AuthProvider({ children }) {
  const initial = readStoredSession();
  const [token, setToken] = useState(initial.token);
  const [user, setUser] = useState(initial.user);

  const toUser = (ssoResponse) => ({
    name: ssoResponse.name,
    email: ssoResponse.email,
    designation: ssoResponse.designation,
    is_admin: ssoResponse.is_admin,
    can_manage_reviewers: ssoResponse.can_manage_reviewers,
    can_view_observations: ssoResponse.can_view_observations,
    can_view_overview: ssoResponse.can_view_overview,
    can_view_as: ssoResponse.can_view_as,
    is_hr: ssoResponse.is_hr,
    location: ssoResponse.location,
    can_act_as: ssoResponse.can_act_as,
    impersonated_by: ssoResponse.impersonated_by,
  });

  const login = (ssoResponse) => {
    const nextUser = toUser(ssoResponse);
    setToken(ssoResponse.access_token);
    setUser(nextUser);
    localStorage.setItem("token", ssoResponse.access_token);
    localStorage.setItem("user", JSON.stringify(nextUser));
  };

  // "Act as" switching. The real session is parked under separate keys rather
  // than overwritten, so getting back is a local restore - no re-login, and no
  // way to end up stranded in someone else's account if the network drops.
  const switchTo = (ssoResponse) => {
    const own = localStorage.getItem("token");
    const ownUser = localStorage.getItem("user");
    if (own && ownUser && !localStorage.getItem("own_token")) {
      localStorage.setItem("own_token", own);
      localStorage.setItem("own_user", ownUser);
    }
    login(ssoResponse);
  };

  const switchBack = () => {
    const own = localStorage.getItem("own_token");
    const ownUser = localStorage.getItem("own_user");
    if (!own || !ownUser) return false;
    localStorage.setItem("token", own);
    localStorage.setItem("user", ownUser);
    localStorage.removeItem("own_token");
    localStorage.removeItem("own_user");
    setToken(own);
    setUser(JSON.parse(ownUser));
    return true;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    clearStoredSession();
  };

  const value = useMemo(
    () => ({
      token,
      user,
      login,
      logout,
      switchTo,
      switchBack,
      actingAs: user && user.impersonated_by ? user.impersonated_by : null,
      isAuthenticated: Boolean(token && user),
    }),
    [token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
