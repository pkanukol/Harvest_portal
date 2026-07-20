// In local dev, VITE_API_URL is empty -> requests go to "/" -> Vite proxy forwards to localhost:8001
// In production (Render), VITE_API_URL is set to the backend Render URL
export const API_ROOT = import.meta.env.VITE_API_URL || "";
const API_BASE = API_ROOT + "/api";

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
  getLocations: () => request("/locations"),
  getRouting: (location) => request(`/routing?location=${encodeURIComponent(location)}`),

  createTicket: (token, { category, location, description, images, itemName, approxCost, quantity, specifications, orderByDate }) => {
    const formData = new FormData();
    formData.append("category", category);
    formData.append("location", location);
    formData.append("description", description || "");
    if (itemName != null) formData.append("item_name", itemName);
    if (approxCost != null) formData.append("approx_cost", approxCost);
    if (quantity != null) formData.append("quantity", quantity);
    if (specifications != null) formData.append("specifications", specifications);
    if (orderByDate != null) formData.append("order_by_date", orderByDate);
    (images || []).forEach((file) => formData.append("images", file));
    return request("/tickets", { method: "POST", token, formData });
  },

  listTickets: (token, filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const qs = params.toString();
    return request(`/tickets${qs ? `?${qs}` : ""}`, { token });
  },

  getTicket: (token, id) => request(`/tickets/${id}`, { token }),

  getComments: (token, id) => request(`/tickets/${id}/comments`, { token }),

  addComment: (token, id, message) =>
    request(`/tickets/${id}/comments`, { method: "POST", token, body: { message } }),

  closeTicket: (token, id, remark) =>
    request(`/tickets/${id}/close`, { method: "POST", token, body: { remark } }),

  approveTicket: (token, id, remark) =>
    request(`/tickets/${id}/approve`, { method: "POST", token, body: { remark } }),

  rejectTicket: (token, id, remark) =>
    request(`/tickets/${id}/reject`, { method: "POST", token, body: { remark } }),

  recordOrderDetails: (token, id, { orderDate, vendorName, actualCost, deliveryDate, trackingDetails }) =>
    request(`/tickets/${id}/order-details`, {
      method: "POST",
      token,
      body: {
        order_date: orderDate, vendor_name: vendorName, actual_cost: actualCost,
        delivery_date: deliveryDate, tracking_details: trackingDetails,
      },
    }),
};
