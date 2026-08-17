const STORAGE_KEY = "attendance_access_token";

// Mirrors Timetable/frontend-v2's SSO handoff exactly: the portal appends
// ?sso=<access_token> to the link it gives the user. Stashed in
// sessionStorage (tab lifetime only) so it survives client-side navigation
// without living in the URL bar, then stripped from the URL.
export function resolveAccessToken() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("sso");

  if (fromUrl) {
    sessionStorage.setItem(STORAGE_KEY, fromUrl);
    params.delete("sso");
    const rest = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
    return fromUrl;
  }

  return sessionStorage.getItem(STORAGE_KEY);
}

export function clearAccessToken() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function goToPortal() {
  window.location.href = import.meta.env.VITE_PORTAL_URL;
}
