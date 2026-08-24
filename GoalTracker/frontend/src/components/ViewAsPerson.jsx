import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import GoalPanels from "./GoalPanels";
import TeamOverview from "./TeamOverview";
import TaskTracker from "./TaskTracker";

// Leadership preview of someone else's page, for checking the flow actually
// works for a given role. It redraws the real dashboard - same tabs, same
// flag banner, same goal panels, same weekly task view with carried-over
// tasks - from data resolved against THEIR visibility, not the viewer's.
//
// Strictly read-only: no token is minted for them, so any write would run as
// the real caller. Every child gets readOnly so no control is even offered.
export default function ViewAsPerson({ token, canActAs, onEnterAs, onClose }) {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const [view, setView] = useState(null); // full /view-as payload
  const [viewLoading, setViewLoading] = useState(false);
  const [tab, setTab] = useState("goals");

  // The reviewer queue that opens behind their "Goals I review" button, and
  // the one reviewee drilled into - both read-only.
  const [showQueue, setShowQueue] = useState(false);
  const [queuePerson, setQueuePerson] = useState(null);
  const [queueGoals, setQueueGoals] = useState([]);
  const [queuePeriod, setQueuePeriod] = useState("");
  const [queueLoading, setQueueLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setPeople(await api.getOrgPeople(token));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people.slice(0, 12);
    return people
      .filter((p) => p.name.toLowerCase().includes(q) || (p.designation || "").toLowerCase().includes(q))
      .slice(0, 30);
  }, [people, query]);

  async function openQueuePerson(email, name) {
    setQueuePerson({ email, name });
    setQueueLoading(true);
    try {
      const data = await api.getMemberGoals(token, email);
      setQueueGoals(data.goals);
      setQueuePeriod(data.period_key);
    } catch (err) {
      setError(err.message);
    } finally {
      setQueueLoading(false);
    }
  }

  async function pick(p) {
    setShowQueue(false);
    setQueuePerson(null);
    setViewLoading(true);
    setError("");
    setTab("goals");
    try {
      setView(await api.viewAs(token, p.email));
    } catch (err) {
      setError(err.message);
    } finally {
      setViewLoading(false);
    }
  }

  const person = view && view.person;
  const flags = view ? view.flags : null;

  return (
    <div className="preview-overlay">
      <div className="preview-shell">
        <div className="preview-bar">
          <span className="preview-eye">👁</span>
          <span className="preview-bar-text">
            {person ? <>Previewing as <strong>{person.name}</strong> · {person.designation}</> : "Preview someone's page"}
            <span className="preview-ro">read-only</span>
          </span>
          {person && canActAs && (
            <button className="btn btn-primary btn-sm" onClick={() => onEnterAs(person)}>Enter as {person.name} →</button>
          )}
          {person && (
            <button className="btn btn-ghost btn-sm" onClick={() => setView(null)}>← Someone else</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Exit preview</button>
        </div>

        <div className="preview-body">
          {error && <div className="form-error">{error}</div>}

          {!person ? (
            <>
              <p className="hint-text">
                Pick anyone to see their GoalTracker page as they see it - their goals, their
                tasks, their buttons. Useful for checking the flow works for a role.
              </p>
              <input
                className="form-control"
                placeholder="Search by name or designation…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              {loading || viewLoading ? (
                <div className="loading-spinner">Loading…</div>
              ) : (
                <div className="viewas-list">
                  {matches.map((p) => (
                    <div className="viewas-row" key={p.email}>
                      <span className="viewas-name">{p.name}</span>
                      <span className="viewas-desig">{p.designation}</span>
                      <span className="viewas-status">{p.location || ""}</span>
                      <span className="viewas-row-actions">
                        {/* Preview = look only. Enter as = actually become them,
                            so it stays a separate, deliberate click. */}
                        <button className="btn btn-ghost btn-sm" onClick={() => pick(p)}>Preview</button>
                        {canActAs && (
                          <button className="btn btn-primary btn-sm" onClick={() => onEnterAs(p)}>Enter as →</button>
                        )}
                      </span>
                    </div>
                  ))}
                  {matches.length === 0 && <div className="empty-msg">No one matches "{query}".</div>}
                </div>
              )}
            </>
          ) : (
            <>
              {/* The header they'd see - which buttons a role actually gets is
                  usually the thing being checked. */}
              <div className="preview-hdr">
                <span className="hdr-title">🎯 GoalTracker</span>
                <span className="user-badge">{person.name} ({person.designation})</span>
                <span className="preview-hdr-btns">
                  {person.is_admin && <span className="preview-fake-btn">Goals overview</span>}
                  {person.is_admin && <span className="preview-fake-btn">View as…</span>}
                  {person.can_manage_reviewers && <span className="preview-fake-btn">Reviewer assignments</span>}
                  <span className="preview-fake-btn">Logout</span>
                </span>
              </div>

              <div className="cadence-tabs" style={{ marginBottom: 16 }}>
                <button className={`cadence-tab ${tab === "goals" ? "active" : ""}`} onClick={() => setTab("goals")}>Goals</button>
                <button className={`cadence-tab ${tab === "tasks" ? "active" : ""}`} onClick={() => setTab("tasks")}>Tasks</button>
              </div>

              {tab === "goals" ? (
                <>
                  {(flags.mid_term_missing || flags.annual_missing) && (
                    <div className="flag-banner">
                      <span className="flag-dot" />
                      {flags.mid_term_missing && flags.annual_missing
                        ? "They haven't set a Role goal yet, and have no Organisation goal."
                        : flags.mid_term_missing
                          ? "They haven't set a Role goal yet."
                          : "They have no Organisation goal set."}
                    </div>
                  )}

                  <div className="dashboard-actions preview-actions">
                    <span className="preview-fake-btn preview-fake-primary" title="Preview only - switch in with 'Enter as' to add a goal">
                      + Add goal
                    </span>
                    {person.reviewee_count > 0 && (
                      <button
                        className={`btn btn-sm ${showQueue ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => { setShowQueue(!showQueue); setQueuePerson(null); }}
                      >
                        Goals I review ({person.reviewee_count}) {showQueue ? "▴" : "▾"}
                      </button>
                    )}
                  </div>

                  {showQueue && !queuePerson && (
                    <div className="preview-queue">
                      <div className="preview-queue-head">
                        This is the page {person.name} gets. Clicking a row opens that person's goals.
                      </div>
                      <TeamOverview team={{ reviewees: view.reviewees }} onSelectMember={openQueuePerson} />
                    </div>
                  )}

                  {queuePerson && (
                    <div className="preview-queue">
                      <div className="preview-queue-head">
                        <button className="btn btn-ghost btn-sm" onClick={() => setQueuePerson(null)}>← Back to the list</button>
                        <span>{person.name} reviewing <strong>{queuePerson.name}</strong></span>
                      </div>
                      {queueLoading ? (
                        <div className="loading-spinner">Loading…</div>
                      ) : (
                        <GoalPanels
                          goals={queueGoals}
                          periodKey={queuePeriod}
                          token={token}
                          myGoals={[]}
                          reviewMode
                          readOnly
                          emptyMessage="They have set nothing yet."
                        />
                      )}
                    </div>
                  )}
                  <div className="preview-note">
                    {person.reviewee_count > 0
                      ? `Click "Goals I review" above to see the queue ${person.name} gets. Controls are shown but inert - use "Enter as" to actually approve or modify.`
                      : `${person.name} reviews nobody, so no "Goals I review" button appears for them.`}
                  </div>

                  <div className="section-title" style={{ marginTop: 0 }}>My goals</div>
                  <GoalPanels
                    goals={view.goals}
                    periodKey={view.period_key}
                    token={token}
                    myGoals={[]}
                    readOnly
                    emptyMessage="Nothing set yet."
                  />
                </>
              ) : (
                <TaskTracker
                  token={token}
                  user={{ email: person.email, name: person.name }}
                  myGoals={view.goals}
                  tasksOverride={view.tasks}
                  readOnly
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
