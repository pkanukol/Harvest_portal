import { useEffect, useState, useCallback } from "react";
import { api, API_ROOT } from "../api";
import { formatDateTime, formatDate } from "../dateFormat";

function statusClass(status) {
  if (status === "Closed") return "badge badge-closed";
  if (status === "Needs immediate attention") return "badge badge-attention";
  if (status === "Approved") return "badge badge-approved";
  if (status === "Ordered") return "badge badge-ordered";
  if (status === "Rejected") return "badge badge-rejected";
  return "badge badge-open";
}

// Images are served from our own API (auth-gated, same permission check as the
// ticket itself) rather than a public link - <img> can't send an Authorization
// header, so the token rides along as a query param instead.
function imageSrc(image, token) {
  return `${API_ROOT}${image.image_url}?token=${encodeURIComponent(token)}`;
}

function ImageThumb({ image, token }) {
  const [failed, setFailed] = useState(false);
  const src = imageSrc(image, token);
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="image-preview">
      {failed ? (
        <div className="image-broken">Preview unavailable</div>
      ) : (
        <img src={src} alt="attachment" onError={() => setFailed(true)} />
      )}
    </a>
  );
}

function contactList(contacts) {
  if (!contacts || contacts.length === 0) return "—";
  return contacts.map((c) => c.name).join(", ");
}

function OrderDetailsSection({ token, ticket, onUpdated }) {
  const hasOrder = Boolean(ticket.order_date);
  const [editing, setEditing] = useState(!hasOrder);
  const [orderDate, setOrderDate] = useState(ticket.order_date || "");
  const [vendorName, setVendorName] = useState(ticket.vendor_name || "");
  const [actualCost, setActualCost] = useState(ticket.order_actual_cost ?? "");
  const [deliveryDate, setDeliveryDate] = useState(ticket.delivery_date || "");
  const [trackingDetails, setTrackingDetails] = useState(ticket.tracking_details || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");
    if (!orderDate || !vendorName.trim() || actualCost === "") {
      setError("Order date, vendor name and actual cost are required.");
      return;
    }
    setSaving(true);
    try {
      const updated = await api.recordOrderDetails(token, ticket.id, {
        orderDate, vendorName: vendorName.trim(), actualCost: Number(actualCost),
        deliveryDate: deliveryDate || null, trackingDetails: trackingDetails.trim() || null,
      });
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="order-details-box">
        <div className="order-details-heading">
          Order Details
          {ticket.can_record_order && (
            <button type="button" className="btn btn-ghost btn-edit-order" onClick={() => setEditing(true)}>Edit</button>
          )}
        </div>
        <dl className="detail-grid">
          <dt>Vendor</dt><dd>{ticket.vendor_name}</dd>
          <dt>Order Date</dt><dd>{formatDate(ticket.order_date)}</dd>
          <dt>Actual Cost</dt><dd>₹{Number(ticket.order_actual_cost).toFixed(2)}</dd>
          {ticket.delivery_date && (<><dt>Delivery Date</dt><dd>{formatDate(ticket.delivery_date)}</dd></>)}
          {ticket.tracking_details && (<><dt>Tracking</dt><dd>{ticket.tracking_details}</dd></>)}
        </dl>
      </div>
    );
  }

  return (
    <form className="order-details-box order-details-form" onSubmit={handleSave}>
      <div className="order-details-heading">{hasOrder ? "Update Order Details" : "Record Order Details"}</div>

      <label className="field-label">Order Date</label>
      <input type="date" className="field-input" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />

      <label className="field-label">Vendor</label>
      <input type="text" className="field-input" placeholder="Vendor name" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />

      <label className="field-label">Actual Cost</label>
      <input type="number" min="0" step="0.01" className="field-input" placeholder="₹" value={actualCost} onChange={(e) => setActualCost(e.target.value)} />

      <label className="field-label">Delivery Date (optional)</label>
      <input type="date" className="field-input" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />

      <label className="field-label">Tracking Details (optional)</label>
      <textarea className="field-input" rows={2} placeholder="Tracking number / link, if available" value={trackingDetails} onChange={(e) => setTrackingDetails(e.target.value)} />

      {error && <div className="form-error">{error}</div>}
      <div className="approval-buttons">
        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save Order Details"}</button>
        {hasOrder && <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>Cancel</button>}
      </div>
    </form>
  );
}

function TicketComments({ token, userEmail, ticketId }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getComments(token, ticketId);
      setComments(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, ticketId]);

  useEffect(() => { load(); }, [load]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError("");
    try {
      const comment = await api.addComment(token, ticketId, message.trim());
      setComments((prev) => [...prev, comment]);
      setMessage("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="comments-section">
      <div className="comments-heading">Messages</div>
      {loading && <div className="empty-state">Loading…</div>}
      {!loading && comments.length === 0 && (
        <div className="empty-state">No messages yet — ask a question or add more detail below.</div>
      )}
      {!loading && comments.length > 0 && (
        <div className="comments-list">
          {comments.map((c) => (
            <div
              className={`comment-bubble${c.author_email.toLowerCase() === userEmail.toLowerCase() ? " comment-bubble-mine" : ""}`}
              key={c.id}
            >
              <div className="comment-meta">
                <span className="comment-author">{c.author_name}</span>
                <span className="comment-date">{formatDateTime(c.created_at)}</span>
              </div>
              <div className="comment-message">{c.message}</div>
            </div>
          ))}
        </div>
      )}
      <form className="comment-form" onSubmit={handleSend}>
        <textarea
          className="field-input"
          rows={2}
          placeholder="Ask for more details, or reply…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={sending || !message.trim()}>
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}

export default function TicketDetail({ token, user, ticketId, onBack }) {
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [remark, setRemark] = useState("");
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [routing, setRouting] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getTicket(token, ticketId);
      setTicket(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, ticketId]);

  useEffect(() => { load(); }, [load]);

  // Resolved from the ticket's own location (not the header's campus toggle) - this
  // view can be reached via an email deep-link for a ticket in either campus.
  useEffect(() => {
    if (!ticket?.location) return;
    api.getRouting(ticket.location).then(setRouting).catch(() => {});
  }, [ticket?.location]);

  const isStores = ticket?.category === "Stores";

  const runAction = async (fn) => {
    setActionError("");
    if (!remark.trim()) { setActionError("Please add a remark."); return; }
    setActing(true);
    try {
      const updated = await fn(token, ticketId, remark.trim());
      setTicket(updated);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActing(false);
    }
  };

  const handleClose = (e) => { e.preventDefault(); runAction(api.closeTicket); };
  const handleApprove = (e) => { e.preventDefault(); runAction(api.approveTicket); };
  const handleReject = (e) => { e.preventDefault(); runAction(api.rejectTicket); };

  if (loading) return <div className="card"><div className="empty-state">Loading…</div></div>;
  if (error) return <div className="card"><div className="form-error">{error}</div></div>;
  if (!ticket) return null;

  const canAct = ticket.can_act && ticket.status === "Open";

  return (
    <div className="card detail-card">
      <button className="btn btn-ghost btn-back" onClick={onBack}>← Back</button>

      <div className="detail-header">
        <div className="ticket-number-badge">{ticket.ticket_number}</div>
        <span className={statusClass(ticket.effective_status)}>{ticket.effective_status}</span>
      </div>

      <dl className="detail-grid">
        <dt>Category</dt><dd>{routing[ticket.category]?.label || ticket.category}</dd>
        <dt>Location</dt><dd>{ticket.location}</dd>
        <dt>Reported by</dt><dd>{ticket.reporter_name} ({ticket.reporter_email})</dd>
        <dt>Responsible</dt><dd>{contactList(ticket.responsible_to)}</dd>
        {ticket.responsible_cc.length > 0 && (<><dt>CC</dt><dd>{contactList(ticket.responsible_cc)}</dd></>)}
        <dt>Logged</dt><dd>{formatDateTime(ticket.created_at)}</dd>
        {ticket.closed_at && (
          <>
            <dt>{isStores ? "Decided" : "Closed"}</dt>
            <dd>
              {formatDateTime(ticket.closed_at)} by {ticket.closed_by_name}
              {ticket.approval_level ? ` (${ticket.approval_level})` : ""}
            </dd>
          </>
        )}
      </dl>

      {isStores ? (
        <dl className="detail-grid">
          <dt>Item</dt><dd>{ticket.item_name}</dd>
          <dt>Quantity</dt><dd>{ticket.quantity}</dd>
          <dt>Approx Cost</dt><dd>₹{Number(ticket.approx_cost).toFixed(2)} each</dd>
          <dt>Order By</dt><dd>{formatDate(ticket.order_by_date)}</dd>
          {ticket.specifications && (<><dt>Specifications</dt><dd>{ticket.specifications}</dd></>)}
        </dl>
      ) : (
        <div className="detail-description">{ticket.description}</div>
      )}

      {ticket.images.length > 0 && (
        <div className="image-preview-row">
          {ticket.images.map((img) => <ImageThumb key={img.id} image={img} token={token} />)}
        </div>
      )}

      {ticket.resolution_remark && (
        <div className="resolution-box">
          <strong>Remark:</strong> {ticket.resolution_remark}
        </div>
      )}

      {isStores && (ticket.status === "Ordered" || (ticket.status === "Approved" && ticket.can_record_order)) && (
        <OrderDetailsSection token={token} ticket={ticket} onUpdated={setTicket} />
      )}

      {canAct && isStores && (
        <form className="close-form">
          <label className="field-label">Approval remark</label>
          <textarea
            className="field-input"
            rows={3}
            placeholder="Reasoning for your decision"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
          {actionError && <div className="form-error">{actionError}</div>}
          <div className="approval-buttons">
            <button className="btn btn-primary" type="button" disabled={acting} onClick={handleApprove}>
              {acting ? "Submitting…" : "Approve"}
            </button>
            <button className="btn btn-reject" type="button" disabled={acting} onClick={handleReject}>
              {acting ? "Submitting…" : "Reject"}
            </button>
          </div>
        </form>
      )}

      {canAct && !isStores && (
        <form className="close-form" onSubmit={handleClose}>
          <label className="field-label">Closing remark</label>
          <textarea
            className="field-input"
            rows={3}
            placeholder="What was done to resolve this?"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
          {actionError && <div className="form-error">{actionError}</div>}
          <button className="btn btn-primary" type="submit" disabled={acting}>
            {acting ? "Closing…" : "Close Ticket"}
          </button>
        </form>
      )}

      <TicketComments token={token} userEmail={user.email} ticketId={ticket.id} />
    </div>
  );
}
import { useEffect, useState, useCallback } from "react";
import { api, API_ROOT } from "../api";
import { formatDateTime, formatDate } from "../dateFormat";

function statusClass(status) {
  if (status === "Closed") return "badge badge-closed";
  if (status === "Needs immediate attention") return "badge badge-attention";
  if (status === "Approved") return "badge badge-approved";
  if (status === "Ordered") return "badge badge-ordered";
  if (status === "Rejected") return "badge badge-rejected";
  return "badge badge-open";
}

// Images are served from our own API (auth-gated, same permission check as the
// ticket itself) rather than a public link - <img> can't send an Authorization
// header, so the token rides along as a query param instead.
function imageSrc(image, token) {
  return `${API_ROOT}${image.image_url}?token=${encodeURIComponent(token)}`;
}

function ImageThumb({ image, token }) {
  const [failed, setFailed] = useState(false);
  const src = imageSrc(image, token);
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="image-preview">
      {failed ? (
        <div className="image-broken">Preview unavailable</div>
      ) : (
        <img src={src} alt="attachment" onError={() => setFailed(true)} />
      )}
    </a>
  );
}

function contactList(contacts) {
  if (!contacts || contacts.length === 0) return "—";
  return contacts.map((c) => c.name).join(", ");
}

function OrderDetailsSection({ token, ticket, onUpdated }) {
  const hasOrder = Boolean(ticket.order_date);
  const [editing, setEditing] = useState(!hasOrder);
  const [orderDate, setOrderDate] = useState(ticket.order_date || "");
  const [vendorName, setVendorName] = useState(ticket.vendor_name || "");
  const [actualCost, setActualCost] = useState(ticket.order_actual_cost ?? "");
  const [deliveryDate, setDeliveryDate] = useState(ticket.delivery_date || "");
  const [trackingDetails, setTrackingDetails] = useState(ticket.tracking_details || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");
    if (!orderDate || !vendorName.trim() || actualCost === "") {
      setError("Order date, vendor name and actual cost are required.");
      return;
    }
    setSaving(true);
    try {
      const updated = await api.recordOrderDetails(token, ticket.id, {
        orderDate, vendorName: vendorName.trim(), actualCost: Number(actualCost),
        deliveryDate: deliveryDate || null, trackingDetails: trackingDetails.trim() || null,
      });
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="order-details-box">
        <div className="order-details-heading">
          Order Details
          {ticket.can_record_order && (
            <button type="button" className="btn btn-ghost btn-edit-order" onClick={() => setEditing(true)}>Edit</button>
          )}
        </div>
        <dl className="detail-grid">
          <dt>Vendor</dt><dd>{ticket.vendor_name}</dd>
          <dt>Order Date</dt><dd>{formatDate(ticket.order_date)}</dd>
          <dt>Actual Cost</dt><dd>₹{Number(ticket.order_actual_cost).toFixed(2)}</dd>
          {ticket.delivery_date && (<><dt>Delivery Date</dt><dd>{formatDate(ticket.delivery_date)}</dd></>)}
          {ticket.tracking_details && (<><dt>Tracking</dt><dd>{ticket.tracking_details}</dd></>)}
        </dl>
      </div>
    );
  }

  return (
    <form className="order-details-box order-details-form" onSubmit={handleSave}>
      <div className="order-details-heading">{hasOrder ? "Update Order Details" : "Record Order Details"}</div>

      <label className="field-label">Order Date</label>
      <input type="date" className="field-input" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />

      <label className="field-label">Vendor</label>
      <input type="text" className="field-input" placeholder="Vendor name" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />

      <label className="field-label">Actual Cost</label>
      <input type="number" min="0" step="0.01" className="field-input" placeholder="₹" value={actualCost} onChange={(e) => setActualCost(e.target.value)} />

      <label className="field-label">Delivery Date (optional)</label>
      <input type="date" className="field-input" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />

      <label className="field-label">Tracking Details (optional)</label>
      <textarea className="field-input" rows={2} placeholder="Tracking number / link, if available" value={trackingDetails} onChange={(e) => setTrackingDetails(e.target.value)} />

      {error && <div className="form-error">{error}</div>}
      <div className="approval-buttons">
        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save Order Details"}</button>
        {hasOrder && <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>Cancel</button>}
      </div>
    </form>
  );
}

function TicketComments({ token, userEmail, ticketId }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getComments(token, ticketId);
      setComments(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, ticketId]);

  useEffect(() => { load(); }, [load]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError("");
    try {
      const comment = await api.addComment(token, ticketId, message.trim());
      setComments((prev) => [...prev, comment]);
      setMessage("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="comments-section">
      <div className="comments-heading">Messages</div>
      {loading && <div className="empty-state">Loading…</div>}
      {!loading && comments.length === 0 && (
        <div className="empty-state">No messages yet — ask a question or add more detail below.</div>
      )}
      {!loading && comments.length > 0 && (
        <div className="comments-list">
          {comments.map((c) => (
            <div
              className={`comment-bubble${c.author_email.toLowerCase() === userEmail.toLowerCase() ? " comment-bubble-mine" : ""}`}
              key={c.id}
            >
              <div className="comment-meta">
                <span className="comment-author">{c.author_name}</span>
                <span className="comment-date">{formatDateTime(c.created_at)}</span>
              </div>
              <div className="comment-message">{c.message}</div>
            </div>
          ))}
        </div>
      )}
      <form className="comment-form" onSubmit={handleSend}>
        <textarea
          className="field-input"
          rows={2}
          placeholder="Ask for more details, or reply…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={sending || !message.trim()}>
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}

export default function TicketDetail({ token, user, ticketId, onBack }) {
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [remark, setRemark] = useState("");
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [routing, setRouting] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getTicket(token, ticketId);
      setTicket(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, ticketId]);

  useEffect(() => { load(); }, [load]);

  // Resolved from the ticket's own location (not the header's campus toggle) - this
  // view can be reached via an email deep-link for a ticket in either campus.
  useEffect(() => {
    if (!ticket?.location) return;
    api.getRouting(ticket.location).then(setRouting).catch(() => {});
  }, [ticket?.location]);

  const isStores = ticket?.category === "Stores";

  const runAction = async (fn) => {
    setActionError("");
    if (!remark.trim()) { setActionError("Please add a remark."); return; }
    setActing(true);
    try {
      const updated = await fn(token, ticketId, remark.trim());
      setTicket(updated);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActing(false);
    }
  };

  const handleClose = (e) => { e.preventDefault(); runAction(api.closeTicket); };
  const handleApprove = (e) => { e.preventDefault(); runAction(api.approveTicket); };
  const handleReject = (e) => { e.preventDefault(); runAction(api.rejectTicket); };

  if (loading) return <div className="card"><div className="empty-state">Loading…</div></div>;
  if (error) return <div className="card"><div className="form-error">{error}</div></div>;
  if (!ticket) return null;

  const canAct = ticket.can_act && ticket.status === "Open";

  return (
    <div className="card detail-card">
      <button className="btn btn-ghost btn-back" onClick={onBack}>← Back</button>

      <div className="detail-header">
        <div className="ticket-number-badge">{ticket.ticket_number}</div>
        <span className={statusClass(ticket.effective_status)}>{ticket.effective_status}</span>
      </div>

      <dl className="detail-grid">
        <dt>Category</dt><dd>{routing[ticket.category]?.label || ticket.category}</dd>
        <dt>Location</dt><dd>{ticket.location}</dd>
        <dt>Reported by</dt><dd>{ticket.reporter_name} ({ticket.reporter_email})</dd>
        <dt>Responsible</dt><dd>{contactList(ticket.responsible_to)}</dd>
        {ticket.responsible_cc.length > 0 && (<><dt>CC</dt><dd>{contactList(ticket.responsible_cc)}</dd></>)}
        <dt>Logged</dt><dd>{formatDateTime(ticket.created_at)}</dd>
        {ticket.closed_at && (
          <>
            <dt>{isStores ? "Decided" : "Closed"}</dt>
            <dd>
              {formatDateTime(ticket.closed_at)} by {ticket.closed_by_name}
              {ticket.approval_level ? ` (${ticket.approval_level})` : ""}
            </dd>
          </>
        )}
      </dl>

      {isStores ? (
        <dl className="detail-grid">
          <dt>Item</dt><dd>{ticket.item_name}</dd>
          <dt>Quantity</dt><dd>{ticket.quantity}</dd>
          <dt>Approx Cost</dt><dd>₹{Number(ticket.approx_cost).toFixed(2)} each</dd>
          <dt>Order By</dt><dd>{formatDate(ticket.order_by_date)}</dd>
          {ticket.specifications && (<><dt>Specifications</dt><dd>{ticket.specifications}</dd></>)}
        </dl>
      ) : (
        <div className="detail-description">{ticket.description}</div>
      )}

      {ticket.images.length > 0 && (
        <div className="image-preview-row">
          {ticket.images.map((img) => <ImageThumb key={img.id} image={img} token={token} />)}
        </div>
      )}

      {ticket.resolution_remark && (
        <div className="resolution-box">
          <strong>Remark:</strong> {ticket.resolution_remark}
        </div>
      )}

      {isStores && (ticket.status === "Ordered" || (ticket.status === "Approved" && ticket.can_record_order)) && (
        <OrderDetailsSection token={token} ticket={ticket} onUpdated={setTicket} />
      )}

      {canAct && isStores && (
        <form className="close-form">
          <label className="field-label">Approval remark</label>
          <textarea
            className="field-input"
            rows={3}
            placeholder="Reasoning for your decision"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
          {actionError && <div className="form-error">{actionError}</div>}
          <div className="approval-buttons">
            <button className="btn btn-primary" type="button" disabled={acting} onClick={handleApprove}>
              {acting ? "Submitting…" : "Approve"}
            </button>
            <button className="btn btn-reject" type="button" disabled={acting} onClick={handleReject}>
              {acting ? "Submitting…" : "Reject"}
            </button>
          </div>
        </form>
      )}

      {canAct && !isStores && (
        <form className="close-form" onSubmit={handleClose}>
          <label className="field-label">Closing remark</label>
          <textarea
            className="field-input"
            rows={3}
            placeholder="What was done to resolve this?"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
          {actionError && <div className="form-error">{actionError}</div>}
          <button className="btn btn-primary" type="submit" disabled={acting}>
            {acting ? "Closing…" : "Close Ticket"}
          </button>
        </form>
      )}

      <TicketComments token={token} userEmail={user.email} ticketId={ticket.id} />
    </div>
  );
}
