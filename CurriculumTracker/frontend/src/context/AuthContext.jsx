import { createContext, useContext, useMemo, useState } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
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
      location: ssoResponse.location,
    };
    setToken(ssoResponse.access_token);
    setUser(nextUser);
    localStorage.setItem("token", ssoResponse.access_token);
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
