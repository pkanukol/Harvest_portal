// In local dev, VITE_API_URL is empty -> requests go to "/" -> Vite proxy forwards to localhost:8001
// In production (Render), VITE_API_URL is set to the backend Render URL
const API_BASE = (import.meta.env.VITE_API_URL || "") + "/api";

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = "GET", token, body, formData } = {}) {
  const headers = { ...authHeaders(token) };
  const options = { method, headers };

  if (formData) {
    options.body = formData;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }

  return data;
}

export const api = {
  ssoLogin: (supabaseToken) =>
    request("/auth/sso", { method: "POST", body: { supabase_token: supabaseToken } }),

  getCategories: () => request("/categories"),

  createTicket: (token, { category, description, imageLinks }) =>
    request("/tickets", {
      method: "POST",
      token,
      body: { category, description, image_links: imageLinks },
    }),

  listTickets: (token, filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const qs = params.toString();
    return request(`/tickets${qs ? `?${qs}` : ""}`, { token });
  },

  getTicket: (token, id) => request(`/tickets/${id}`, { token }),

  closeTicket: (token, id, remark) =>
    request(`/tickets/${id}/close`, { method: "POST", token, body: { remark } }),
};
