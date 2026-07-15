export default function SuccessView({ ticket, onViewTicket, onNewTicket, onAllTickets }) {
  if (!ticket) return null;

  const responsibleNames = (ticket.responsible_to || []).map((c) => c.name).join(", ") || "the responsible team";

  return (
    <div className="card success-card">
      <div className="success-icon">✅</div>
      <h2 className="card-heading">Ticket Logged</h2>
      <div className="ticket-number-badge">{ticket.ticket_number}</div>
      <p className="success-copy">
        Your <strong>{ticket.category}</strong> ticket has been logged and {responsibleNames} has been
        notified by email.
      </p>

      <div className="whatsapp-actions">
        {ticket.share_whatsapp && (
          <a className="btn btn-ghost" href={ticket.share_whatsapp} target="_blank" rel="noopener noreferrer">
            Share via WhatsApp
          </a>
        )}
      </div>

      <div className="success-buttons">
        <button className="btn btn-primary" onClick={() => onViewTicket(ticket.id)}>View Ticket</button>
        <button className="btn btn-ghost" onClick={onNewTicket}>Log Another</button>
        <button className="btn btn-ghost" onClick={onAllTickets}>All Tickets</button>
      </div>
    </div>
  );
}
