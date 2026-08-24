import { createContext, useContext, useMemo, useState } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  });

  const toUser = (ssoResponse) => ({
    name: ssoResponse.name,
    email: ssoResponse.email,
    designation: ssoResponse.designation,
    is_admin: ssoResponse.is_admin,
    can_manage_reviewers: ssoResponse.can_manage_reviewers,
    can_view_observations: ssoResponse.can_view_observations,
    can_view_overview: ssoResponse.can_view_overview,
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
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    // Never leave a parked session behind for the next person at this browser.
    localStorage.removeItem("own_token");
    localStorage.removeItem("own_user");
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
