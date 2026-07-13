import { useEffect, useState, useCallback } from "react";
import { api } from "../api";

const CATEGORIES = ["Admin", "Curriculum", "Infrastructure", "HR", "DLP"];
const STATUSES = ["Open", "Needs immediate attention", "Closed"];

function statusClass(status) {
  if (status === "Closed") return "badge badge-closed";
  if (status === "Needs immediate attention") return "badge badge-attention";
  return "badge badge-open";
}

export default function TicketList({ token, onOpenTicket }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [reporter, setReporter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState("desc");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.listTickets(token, {
        category, status, reporter,
        date_from: dateFrom ? new Date(dateFrom).toISOString() : "",
        date_to: dateTo ? new Date(dateTo).toISOString() : "",
        sort,
      });
      setTickets(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, category, status, reporter, dateFrom, dateTo, sort]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="card list-card">
      <h2 className="card-heading">All Tickets</h2>

      <div className="filter-bar">
        <select className="field-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <select className="field-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <input
          className="field-input"
          placeholder="Search by reporter name/email"
          value={reporter}
          onChange={(e) => setReporter(e.target.value)}
        />

        <input className="field-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input className="field-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />

        <select className="field-input" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
      </div>

      {loading && <div className="empty-state">Loading…</div>}
      {error && <div className="form-error">{error}</div>}
      {!loading && !error && tickets.length === 0 && (
        <div className="empty-state">No tickets match these filters.</div>
      )}

      <div className="ticket-rows">
        {tickets.map((t) => (
          <div className="ticket-row" key={t.id} onClick={() => onOpenTicket(t.id)}>
            <div className="ticket-row-main">
              <span className="ticket-row-number">{t.ticket_number}</span>
              <span className="ticket-row-category">{t.category}</span>
              <span className="ticket-row-desc">{t.description}</span>
            </div>
            <div className="ticket-row-meta">
              <span className={statusClass(t.effective_status)}>{t.effective_status}</span>
              <span className="ticket-row-date">{new Date(t.created_at).toLocaleString()}</span>
              <span className="ticket-row-reporter">{t.reporter_name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
