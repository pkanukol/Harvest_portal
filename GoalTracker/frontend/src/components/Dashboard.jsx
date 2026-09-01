import { useEffect, useState } from "react";
import { api } from "../api";
import GoalForm from "./GoalForm";
import GoalPanels from "./GoalPanels";
import RepeatPrompt from "./RepeatPrompt";
import TeamOverview from "./TeamOverview";
import TaskTracker from "./TaskTracker";
import { getWeekStart, collectOverdue, flattenTasks } from "../taskUtils";

export default function Dashboard({ token, user }) {
  const [mainTab, setMainTab] = useState("goals");
  const [goals, setGoals] = useState([]);
  const [periodKey, setPeriodKey] = useState("");
  const [flags, setFlags] = useState({ mid_term_missing: false, annual_missing: false, mid_term_set: false, annual_set: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);
  const [activeCadence, setActiveCadence] = useState("mid_term");
  const [showReview, setShowReview] = useState(false);

  // Held here, not inside TaskTracker, so the Tasks tab can carry an overdue
  // count while you're still looking at the Goals tab - the count was useless
  // living inside the tab you had to open to see it.
  const [tasks, setTasks] = useState([]);

  const [team, setTeam] = useState({ reviewees: [], goals_to_review: 0 });
  const [teamLoading, setTeamLoading] = useState(true);

  const [selectedMember, setSelectedMember] = useState(null); // { email, name }
  const [memberGoals, setMemberGoals] = useState([]);
  const [memberPeriodKey, setMemberPeriodKey] = useState("");
  const [memberLoading, setMemberLoading] = useState(false);

  async function loadMyGoals() {
    setLoading(true);
    setError("");
    try {
      const data = await api.getMyGoals(token);
      setGoals(data.goals);
      setFlags(data.flags);
      setPeriodKey(data.period_key);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTasks() {
    try {
      setTasks(await api.getTasks(token));
    } catch {
      // Non-critical: the Tasks tab loads and reports its own errors.
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
    loadTasks();
  }, []);

  async function openMember(email, name) {
    setSelectedMember({ email, name });
    setMemberLoading(true);
    try {
      const data = await api.getMemberGoals(token, email);
      setMemberGoals(data.goals);
      setMemberPeriodKey(data.period_key);
    } catch (err) {
      setError(err.message);
    } finally {
      setMemberLoading(false);
    }
  }

  async function refreshMember() {
    if (!selectedMember) return;
    try {
      const data = await api.getMemberGoals(token, selectedMember.email);
      setMemberGoals(data.goals);
      setMemberPeriodKey(data.period_key);
    } catch (err) {
      setError(err.message);
    }
    loadTeam();
  }

  function handleEditGoal(goal) {
    setEditingGoal(goal);
    setShowForm(true);
  }

  async function handleDeleteGoal(goal) {
    // Deleting a goal now removes the tasks that made up its plan, so say so
    // before it happens rather than leaving people to notice work vanish.
    let linked = 0;
    try {
      linked = flattenTasks(await api.getTasksForGoal(token, goal.id))
        .filter((t) => t.goal_id === goal.id).length;
    } catch {
      // Can't count them - the warning below stays generic rather than wrong.
    }
    const alsoTasks = linked
      ? ` Its ${linked} linked task${linked === 1 ? "" : "s"} will be deleted too.`
      : "";
    if (!window.confirm(`Delete "${goal.title}"?${alsoTasks} This can't be undone.`)) return;
    setError("");
    try {
      await api.deleteGoal(token, goal.id);
      loadMyGoals();
      loadTasks();
    } catch (err) {
      setError(err.message);
    }
  }

  const overdueCount = collectOverdue(tasks, getWeekStart(new Date())).length;

  return (
    <>
      <div className="cadence-tabs" style={{ marginBottom: 16 }}>
        <button className={`cadence-tab ${mainTab === "goals" ? "active" : ""}`} onClick={() => setMainTab("goals")}>Goals</button>
        <button className={`cadence-tab ${mainTab === "tasks" ? "active" : ""}`} onClick={() => setMainTab("tasks")}>
          Tasks
          {overdueCount > 0 && <span className="tab-alert-count" title={`${overdueCount} still open from earlier weeks`}>{overdueCount}</span>}
        </button>
      </div>

      {mainTab === "tasks" ? (
        <TaskTracker token={token} user={user} myGoals={goals} onTasksChanged={loadTasks} />
      ) : (
      <>
      {(flags.mid_term_missing || flags.annual_missing) && (
        <div className="flag-banner">
          <span className="flag-dot" />
          {flags.mid_term_missing && flags.annual_missing
            ? "You haven't set your Role goal yet, and you have no Organisation goal."
            : flags.mid_term_missing
              ? "You haven't set your Role goal yet."
              : "You have no Organisation goal set."}
        </div>
      )}

      {team.reviewees.length > 0 && (
        <div className="dashboard-actions">
          <button className="btn btn-ghost" onClick={() => setShowReview(true)}>
            Goals to review
            {team.goals_to_review > 0
              ? <span className="review-count">{team.goals_to_review}</span>
              : <span className="review-count-clear">nothing waiting</span>}
          </button>
        </div>
      )}

      <RepeatPrompt token={token} onAdded={loadMyGoals} />

      <div className="section-title" style={{ marginTop: 0 }}>My goals</div>

      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <div className="loading-spinner">Loading…</div>
      ) : (
        <GoalPanels
          goals={goals}
          periodKey={periodKey}
          token={token}
          user={user}
          myGoals={goals}
          isOwner={true}
          onEditGoal={handleEditGoal}
          onDeleteGoal={handleDeleteGoal}
          onAddGoal={(cadence) => { setActiveCadence(cadence); setEditingGoal(null); setShowForm(true); }}
          onChanged={loadMyGoals}
        />
      )}

      {showForm && (
        <GoalForm
          token={token}
          editingGoal={editingGoal}
          defaultCadence={activeCadence}
          onCancel={() => { setShowForm(false); setEditingGoal(null); }}
          onDone={() => { setShowForm(false); setEditingGoal(null); loadMyGoals(); }}
        />
      )}

      {showReview && (
        <div className="modal-overlay" onClick={() => setShowReview(false)}>
          <div className="modal-box" style={{ maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
            <div className="section-title" style={{ marginTop: 0 }}>Goals to review</div>
            {teamLoading ? (
              <div className="loading-spinner">Loading…</div>
            ) : team.reviewees.length > 0 ? (
              <TeamOverview team={team} onSelectMember={openMember} />
            ) : (
              <div className="empty-msg">No one has you assigned as their reviewer yet.</div>
            )}
            <div className="form-actions" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setShowReview(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {selectedMember && (
        <div className="modal-overlay" onClick={() => setSelectedMember(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="section-title" style={{ marginTop: 0 }}>{selectedMember.name}'s goals</div>
            {memberLoading ? (
              <div className="loading-spinner">Loading…</div>
            ) : (
              <GoalPanels
                goals={memberGoals}
                periodKey={memberPeriodKey}
                token={token}
                user={user}
                myGoals={goals}
                reviewMode={true}
                onChanged={refreshMember}
                emptyMessage="No goals set yet."
              />
            )}
            <div className="form-actions" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setSelectedMember(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      </>
      )}
    </>
  );
}
