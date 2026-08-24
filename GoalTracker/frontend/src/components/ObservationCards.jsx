import { useEffect, useState } from "react";
import { api } from "../api";

export default function ObservationCards({ token, person, onClose }) {
  const [average, setAverage] = useState(null);
  const [observations, setObservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.getObservations(token, person.email);
        setAverage(data.average_score);
        setObservations(data.observations);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [person.email]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="section-title" style={{ marginTop: 0 }}>{person.name}'s classroom observations</div>
        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="loading-spinner">Loading…</div>
        ) : observations.length === 0 ? (
          <div className="empty-msg">No finalised observations yet.</div>
        ) : (
          <>
            <div className="hint-text" style={{ marginBottom: 12 }}>
              Average score: <strong>{average}</strong> across {observations.length} finalised observation{observations.length === 1 ? "" : "s"}
            </div>
            {observations.map((o) => (
              <div className="observation-card" key={o.id}>
                <div className="observation-card-header">
                  <span>{o.subject} · Grade {o.grade}{o.section}</span>
                  <span className="badge badge-category">{o.rating}</span>
                </div>
                <div className="observation-card-body">
                  <span className="hint-text">{o.date_time ? o.date_time.slice(0, 10) : ""}{o.observation_type ? ` · ${o.observation_type}` : ""}</span>
                  {o.auditor_name && <span className="hint-text"> · Observed by {o.auditor_name}</span>}
                  <div className="observation-card-score">{o.overall_score}</div>
                </div>
              </div>
            ))}
          </>
        )}
        <div className="form-actions" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
