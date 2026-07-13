import { useEffect, useState, useCallback } from "react";
import { api } from "../api";

function statusClass(status) {
  if (status === "Closed") return "badge badge-closed";
  if (status === "Needs immediate attention") return "badge badge-attention";
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

export default function TicketDetail({ token, user, ticketId, onBack }) {
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [remark, setRemark] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");

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

  const handleClose = async (e) => {
    e.preventDefault();
    setCloseError("");
    if (!remark.trim()) { setCloseError("Please add a closing remark."); return; }
    setClosing(true);
    try {
      const updated = await api.closeTicket(token, ticketId, remark.trim());
      setTicket(updated);
    } catch (err) {
      setCloseError(err.message);
    } finally {
      setClosing(false);
    }
  };

  if (loading) return <div className="card"><div className="empty-state">Loading…</div></div>;
  if (error) return <div className="card"><div className="form-error">{error}</div></div>;
  if (!ticket) return null;

  const canClose = user?.email?.toLowerCase() === ticket.responsible_email.toLowerCase() && ticket.status === "Open";

  return (
    <div className="card detail-card">
      <button className="btn btn-ghost btn-back" onClick={onBack}>← Back</button>

      <div className="detail-header">
        <div className="ticket-number-badge">{ticket.ticket_number}</div>
        <span className={statusClass(ticket.effective_status)}>{ticket.effective_status}</span>
      </div>

      <dl className="detail-grid">
        <dt>Category</dt><dd>{ticket.category}</dd>
        <dt>Reported by</dt><dd>{ticket.reporter_name} ({ticket.reporter_email})</dd>
        <dt>Responsible person</dt><dd>{ticket.responsible_name}</dd>
        <dt>Logged</dt><dd>{new Date(ticket.created_at).toLocaleString()}</dd>
        {ticket.closed_at && (<><dt>Closed</dt><dd>{new Date(ticket.closed_at).toLocaleString()} by {ticket.closed_by_name}</dd></>)}
      </dl>

      <div className="detail-description">{ticket.description}</div>

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
          <strong>Resolution:</strong> {ticket.resolution_remark}
        </div>
      )}

      {canClose && (
        <form className="close-form" onSubmit={handleClose}>
          <label className="field-label">Closing remark</label>
          <textarea
            className="field-input"
            rows={3}
            placeholder="What was done to resolve this?"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
          {closeError && <div className="form-error">{closeError}</div>}
          <button className="btn btn-primary" type="submit" disabled={closing}>
            {closing ? "Closing…" : "Close Ticket"}
          </button>
        </form>
      )}
    </div>
  );
}
