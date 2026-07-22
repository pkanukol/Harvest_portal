function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function POWCard({ card, onClick }) {
  const badgeClass =
    card.status === "Closed" ? "badge-approved" :
    card.status === "Reviewed" ? "badge-reviewed" :
    card.status === "To be Reviewed" ? "badge-pending" : "badge-created";

  return (
    <div className={`pow-card${card.tbs_mom_missing ? " pow-card-warning" : ""}`} onClick={() => onClick(card.id)}>
      <div className="pow-card-header">
        <span>{card.subject} · Grade {card.grade}</span>
        <span className={`badge ${badgeClass}`}>{card.status}</span>
      </div>
      <div className="pow-card-body">
        <div className="pow-card-meta">{fmtDate(card.week_start)} – {fmtDate(card.week_end)}</div>
        <div className="pow-card-topic">{card.topic || "—"}</div>
        {card.tbs_mom_missing && <div className="pow-card-warning-text">⚠ TBS MOM not filled in</div>}
      </div>
    </div>
  );
}
