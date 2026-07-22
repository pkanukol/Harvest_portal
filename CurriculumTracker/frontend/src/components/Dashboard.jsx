import { useEffect, useState } from "react";
import { api } from "../api";
import POWCard from "./POWCard";
import { fmtDate } from "../dateUtils";

export default function Dashboard({ token, isReadOnlyViewer, onNewPow, onProgress, onOpenPow, onTeachersLoaded }) {
  const [cards, setCards] = useState(null);
  const [error, setError] = useState("");
  const [missingTbsMomPopup, setMissingTbsMomPopup] = useState(null); // array of cards, or null when dismissed/not applicable

  useEffect(() => {
    let cancelled = false;
    api.getPowCards(token)
      .then((res) => {
        if (cancelled) return;
        const list = res.cards || [];
        setCards(list);
        onTeachersLoaded?.(res.teachers || []);
        // Nag every time the dashboard loads (i.e. every login), not just once —
        // recomputed fresh from the server each time, so it keeps appearing
        // until TBS MOM is actually filled in.
        if (!isReadOnlyViewer) {
          const missing = list.filter((c) => c.tbs_mom_missing);
          if (missing.length > 0) setMissingTbsMomPopup(missing);
        }
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [token]);

  // Grouped by teacher for every role now — Teacher dashboards are shared
  // across every teacher of the same subject (see crud.get_pow_cards), so a
  // flat grid would no longer distinguish whose POW is whose.
  const grouped = {};
  const order = [];
  (cards || []).forEach((c) => {
    if (!grouped[c.teacher_email]) { grouped[c.teacher_email] = []; order.push(c.teacher_email); }
    grouped[c.teacher_email].push(c);
  });

  return (
    <div>
      {missingTbsMomPopup && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="section-title">⚠ TBS MOM missing</div>
            <p className="hint-text">
              {missingTbsMomPopup.length === 1
                ? "1 POW is finalized but still missing its TBS MOM:"
                : `${missingTbsMomPopup.length} POWs are finalized but still missing TBS MOM:`}
            </p>
            <div className="checkbox-list" style={{ marginBottom: 16 }}>
              {missingTbsMomPopup.map((c) => (
                <div
                  key={c.id}
                  className="pow-card-meta"
                  style={{ cursor: "pointer" }}
                  onClick={() => { setMissingTbsMomPopup(null); onOpenPow(c.id); }}
                >
                  • {c.subject} · Grade {c.grade} — {c.topic || "—"} ({fmtDate(c.week_start)} – {fmtDate(c.week_end)})
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={() => setMissingTbsMomPopup(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <div className="dashboard-actions">
        {!isReadOnlyViewer && <button className="btn btn-primary" onClick={onNewPow}>+ New POW</button>}
        {isReadOnlyViewer && <button className="btn btn-warning btn-sm" onClick={onProgress}>Progress Check</button>}
      </div>

      {error && <div className="form-error">{error}</div>}
      {!cards && !error && <div className="loading-spinner">Loading…</div>}

      {cards && cards.length === 0 && (
        <div className="empty-msg">No POWs to show yet.</div>
      )}

      {cards && cards.length > 0 && order.map((email) => {
        const teacherCards = grouped[email];
        const name = teacherCards[0].teacher_name || email;
        const subject = teacherCards[0].subject || "";
        return (
          <div className="teacher-group" key={email}>
            <div className="teacher-group-title">👤 {name}{subject ? ` · ${subject}` : ""}</div>
            <div className="cards-grid">
              {teacherCards.map((c) => <POWCard key={c.id} card={c} onClick={onOpenPow} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
