import { createContext, useContext, useMemo, useState } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem("user");
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    // A cached user from before the `views`/`home_location` fields existed has no
    // `views` array at all (as opposed to a legitimately empty one, which the backend
    // never returns) - treat that as a stale session and force a fresh SSO login
    // rather than silently rendering a dashboard with no visible tickets or tabs.
    if (!Array.isArray(parsed.views)) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      return null;
    }
    return parsed;
  });

  const login = (authData) => {
    const nextUser = {
      name: authData.name,
      email: authData.email,
      views: authData.views || [],
      home_location: authData.home_location || null,
    };
    setToken(authData.access_token);
    setUser(nextUser);
    localStorage.setItem("token", authData.access_token);
    localStorage.setItem("user", JSON.stringify(nextUser));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  };

  const value = useMemo(
    () => ({ token, user, login, logout, isAuthenticated: Boolean(token && user) }),
    [token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
