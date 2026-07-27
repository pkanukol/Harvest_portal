import { useEffect, useState } from "react";
import { api } from "../api";
import GoalCard from "./GoalCard";
import GoalForm from "./GoalForm";
import TeamOverview from "./TeamOverview";

export default function Dashboard({ token, user }) {
  const [goals, setGoals] = useState([]);
  const [flags, setFlags] = useState({ mid_term_missing: false, annual_missing: false, mid_term_set: false, annual_set: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);

  const [team, setTeam] = useState({ reviewees: [], pending_acknowledgments: [] });
  const [teamLoading, setTeamLoading] = useState(true);

  const [selectedMember, setSelectedMember] = useState(null); // { email, name }
  const [memberGoals, setMemberGoals] = useState([]);
  const [memberLoading, setMemberLoading] = useState(false);

  async function loadMyGoals() {
    setLoading(true);
    setError("");
    try {
      const data = await api.getMyGoals(token);
      setGoals(data.goals);
      setFlags(data.flags);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTeam() {
    setTeamLoading(true);
    try {
      const data = await api.getTeam(token);
      setTeam(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setTeamLoading(false);
    }
  }

  useEffect(() => {
    loadMyGoals();
    loadTeam();
  }, []);

  async function openMember(email, name) {
    setSelectedMember({ email, name });
    setMemberLoading(true);
    try {
      const data = await api.getMemberGoals(token, email);
      setMemberGoals(data.goals);
    } catch (err) {
      setError(err.message);
    } finally {
      setMemberLoading(false);
    }
  }

  function refreshMember() {
    if (selectedMember) openMember(selectedMember.email, selectedMember.name);
    loadTeam();
  }

  const hasReviewees = team.reviewees.length > 0;

  return (
    <>
      {(flags.mid_term_missing || flags.annual_missing) && (
        <div className="flag-banner">
          <span className="flag-dot" />
          {flags.mid_term_missing && flags.annual_missing
            ? "You haven't set your Mid Term goal yet, and you have no Annual goal."
            : flags.mid_term_missing
              ? "You haven't set your Mid Term goal yet."
              : "You have no Annual goal set."}
        </div>
      )}

      <div className="dashboard-actions">
        <button className="btn btn-primary" onClick={() => { setEditingGoal(null); setShowForm(true); }}>+ Add goal</button>
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>My goals</div>

      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <div className="loading-spinner">Loading…</div>
      ) : goals.length === 0 ? (
        <div className="empty-msg">No goals yet.</div>
      ) : (
        goals.map((g) => (
          <GoalCard
            key={g.id}
            goal={g}
            token={token}
            isOwner={true}
            onChanged={loadMyGoals}
            onEdit={(goal) => { setEditingGoal(goal); setShowForm(true); }}
          />
        ))
      )}

      {teamLoading ? (
        <div className="loading-spinner">Loading…</div>
      ) : (hasReviewees || team.pending_acknowledgments.length > 0) ? (
        <TeamOverview team={team} token={token} onSelectMember={openMember} onChanged={loadTeam} />
      ) : null}

      {showForm && (
        <GoalForm
          token={token}
          editingGoal={editingGoal}
          onCancel={() => { setShowForm(false); setEditingGoal(null); }}
          onDone={() => { setShowForm(false); setEditingGoal(null); loadMyGoals(); }}
        />
      )}

      {selectedMember && (
        <div className="modal-overlay" onClick={() => setSelectedMember(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="section-title" style={{ marginTop: 0 }}>{selectedMember.name}'s goals</div>
            {memberLoading ? (
              <div className="loading-spinner">Loading…</div>
            ) : memberGoals.length === 0 ? (
              <div className="empty-msg">No goals set yet.</div>
            ) : (
              memberGoals.map((g) => (
                <GoalCard key={g.id} goal={g} token={token} isOwner={false} reviewMode={true} onChanged={refreshMember} />
              ))
            )}
            <div className="form-actions" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setSelectedMember(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
