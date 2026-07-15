import { useEffect, useState, useCallback } from "react";
import { api } from "../api";

function statusClass(status) {
  if (status === "Closed") return "badge badge-closed";
  if (status === "Needs immediate attention") return "badge badge-attention";
  if (status === "Approved") return "badge badge-approved";
  if (status === "Ordered") return "badge badge-ordered";
  if (status === "Rejected") return "badge badge-rejected";
  return "badge badge-open";
}

// Google Drive share links (".../file/d/<id>/view") don't render as <img src>
// directly — this rewrites them to the direct-content export URL that does.
function driveEmbedUrl(link) {
  const match = link?.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return `https://drive.google.com/uc?export=view&id=${match[1]}`;
  return link;
}

function ImageThumb({ image }) {
  const [failed, setFailed] = useState(false);
  return (
    <a href={image.image_path} target="_blank" rel="noopener noreferrer" className="image-preview">
      {failed ? (
        <div className="image-broken">Preview unavailable</div>
      ) : (
        <img src={driveEmbedUrl(image.image_path)} alt="attachment" onError={() => setFailed(true)} />
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
          <dt>Order Date</dt><dd>{ticket.order_date}</dd>
          <dt>Actual Cost</dt><dd>₹{Number(ticket.order_actual_cost).toFixed(2)}</dd>
          {ticket.delivery_date && (<><dt>Delivery Date</dt><dd>{ticket.delivery_date}</dd></>)}
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

export default function TicketDetail({ token, user, ticketId, onBack }) {
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [remark, setRemark] = useState("");
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");

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
        <dt>Category</dt><dd>{ticket.category}</dd>
        <dt>Location</dt><dd>{ticket.location}</dd>
        <dt>Reported by</dt><dd>{ticket.reporter_name} ({ticket.reporter_email})</dd>
        <dt>Responsible</dt><dd>{contactList(ticket.responsible_to)}</dd>
        {ticket.responsible_cc.length > 0 && (<><dt>CC</dt><dd>{contactList(ticket.responsible_cc)}</dd></>)}
        <dt>Logged</dt><dd>{new Date(ticket.created_at).toLocaleString()}</dd>
        {ticket.closed_at && (
          <>
            <dt>{isStores ? "Decided" : "Closed"}</dt>
            <dd>
              {new Date(ticket.closed_at).toLocaleString()} by {ticket.closed_by_name}
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
          <dt>Order By</dt><dd>{ticket.order_by_date}</dd>
          {ticket.specifications && (<><dt>Specifications</dt><dd>{ticket.specifications}</dd></>)}
        </dl>
      ) : (
        <div className="detail-description">{ticket.description}</div>
      )}

      {ticket.images.length > 0 && (
        <>
          <div className="image-preview-row">
            {ticket.images.map((img) => <ImageThumb key={img.id} image={img} />)}
          </div>
          <div className="help-text">
            If a photo doesn't load, it may not be shared with "Anyone with the link" yet.
          </div>
        </>
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
    </div>
  );
}
