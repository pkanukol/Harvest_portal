function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// isSME only decides what the button on a waiting card is CALLED - the page it
// opens decides what may actually be done there, from the server's own flags.
export default function POWCard({ card, onClick, isSME = false }) {
  const badgeClass =
    card.status === "Closed" ? "badge-approved" :
    card.status === "Reviewed" ? "badge-reviewed" :
    card.status === "To be Reviewed" ? "badge-pending" :
    card.awaiting_approval ? "badge-waiting" : "badge-created";

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
        {card.awaiting_approval && (
          <>
            <div className="pow-card-waiting-text">
              ⏳ Implementation opens once the SME approves this plan
            </div>
            {/* The card already opens the POW; this says so out loud, because a
                plan waiting on somebody is the one card that needs an
                instruction rather than just a status. */}
            <button
              className="btn btn-primary btn-sm pow-card-action"
              onClick={(e) => { e.stopPropagation(); onClick(card.id); }}
            >
              {isSME ? "Approve plan" : "Edit plan"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
