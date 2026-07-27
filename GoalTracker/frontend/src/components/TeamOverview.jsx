import { useState } from "react";
import { api } from "../api";

function midTermCell(flags) {
  if (flags.mid_term_set) return "Set";
  if (flags.mid_term_missing) return (<span><span className="flag-dot" /> Missing</span>);
  return <span className="hint-text">Not due yet</span>;
}

export default function TeamOverview({ team, token, onSelectMember, onChanged }) {
  const [ackingId, setAckingId] = useState(null);
  const [error, setError] = useState("");

  async function submitUpperAck(goalId, actionId) {
    setAckingId(actionId);
    setError("");
    try {
      await api.upperAck(token, goalId, actionId);
      onChanged && onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setAckingId(null);
    }
  }

  return (
    <>
      <div className="section-title">People whose goals you review</div>
      {team.reviewees.length === 0 ? (
        <div className="empty-msg">No one has you assigned as their reviewer yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Designation</th>
              <th>Mid Term goal</th>
              <th>Annual goal</th>
            </tr>
          </thead>
          <tbody>
            {team.reviewees.map((m) => (
              <tr className="team-row" key={m.email} onClick={() => onSelectMember(m.email, m.name)}>
                <td>{m.name}</td>
                <td>{m.designation}</td>
                <td>{midTermCell(m.flags)}</td>
                <td>{m.flags.annual_set ? "Set" : (<span><span className="flag-dot" /> Missing</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="section-title">Reviews pending your acknowledgment</div>
      {error && <div className="form-error">{error}</div>}
      {team.pending_acknowledgments.length === 0 ? (
        <div className="empty-msg">Nothing pending your acknowledgment.</div>
      ) : (
        team.pending_acknowledgments.map((p) => (
          <div className="card" style={{ padding: 14, marginBottom: 12 }} key={p.action.id}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.goal.title}</div>
            <div className="hint-text" style={{ marginBottom: 6 }}>
              Owner: {p.owner_name} — reviewed by {p.reviewed_by_name} — action: {p.action.action_type}
            </div>
            {p.action.reason && <div className="hint-text" style={{ marginBottom: 6 }}>Reason: {p.action.reason}</div>}
            <button
              className="btn btn-primary btn-sm"
              disabled={ackingId === p.action.id}
              onClick={() => submitUpperAck(p.goal.id, p.action.id)}
            >
              Acknowledge
            </button>
          </div>
        ))
      )}
    </>
  );
}
