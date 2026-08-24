import { useEffect, useState } from "react";
import { api } from "../api";
import GoalPanels from "./GoalPanels";
import ObservationCards from "./ObservationCards";
import ProgressBar from "./ProgressBar";

const GROUPS = [
  { key: "sme", label: "SME / HOD" },
  { key: "auditor", label: "Leadership / Admin" },
  { key: "teacher", label: "Teachers" },
];
const STATUS_LABEL = { not_set: "Not set", pending: "Pending", approved: "Approved" };
const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "not_set", label: "Not set" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
];

function matchesLocation(personLocation, filter) {
  if (filter === "all") return true;
  const loc = (personLocation || "").trim().toLowerCase();
  if (filter === "both") return loc === "both";
  return loc === filter.toLowerCase() || loc === "both";
}

function statusCell(status, progress) {
  return (
    <div className="status-cell">
      <span>{status === "pending" ? <><span className="flag-dot" /> Pending</> : (STATUS_LABEL[status] || status)}</span>
      {progress.total > 0 && <ProgressBar completed={progress.completed} total={progress.total} />}
    </div>
  );
}

function SummaryRow({ label, counts }) {
  const total = counts.not_set + counts.pending + counts.approved;
  return (
    <div className="heatmap-summary-row">
      <span className="heatmap-summary-label">{label}</span>
      <span className="heatmap-summary-stat status-approved-text">{counts.approved} approved</span>
      <span className="heatmap-summary-stat status-pending-text">{counts.pending} pending</span>
      <span className="heatmap-summary-stat status-not_set-text">{counts.not_set} not set</span>
      <span className="hint-text">({total} people)</span>
    </div>
  );
}

export default function GoalsHeatmap({ token, user, onClose }) {
  const [people, setPeople] = useState([]);
  const [midTermSummary, setMidTermSummary] = useState({ not_set: 0, pending: 0, approved: 0 });
  const [annualSummary, setAnnualSummary] = useState({ not_set: 0, pending: 0, approved: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeGroup, setActiveGroup] = useState("sme");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [nameFilter, setNameFilter] = useState("");
  const [designationFilter, setDesignationFilter] = useState("");
  const [midTermFilter, setMidTermFilter] = useState("all");
  const [annualFilter, setAnnualFilter] = useState("all");

  const [selectedPerson, setSelectedPerson] = useState(null); // { email, name }
  const [personGoals, setPersonGoals] = useState([]);
  const [personPeriodKey, setPersonPeriodKey] = useState("");
  const [personLoading, setPersonLoading] = useState(false);

  const [observationsFor, setObservationsFor] = useState(null); // { email, name }
  const [myGoals, setMyGoals] = useState([]);

  // "Email everyone flagged" - manual stand-in for the daily cron
  const [nudgeConfirming, setNudgeConfirming] = useState(false);
  const [nudgeSending, setNudgeSending] = useState(false);
  const [nudgeResult, setNudgeResult] = useState(null);
  const [nudgeError, setNudgeError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.getGoalsOverview(token);
        setPeople(data.people);
        setMidTermSummary(data.mid_term_summary);
        setAnnualSummary(data.annual_summary);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
    (async () => {
      try {
        const data = await api.getMyGoals(token);
        setMyGoals(data.goals);
      } catch {
        // non-critical - only affects the "link to goal" picker inside a drilled-down goal's task view
      }
    })();
  }, []);

  async function sendNudges() {
    setNudgeConfirming(false);
    setNudgeSending(true);
    setNudgeError("");
    setNudgeResult(null);
    try {
      setNudgeResult(await api.runFlagCheck(token));
    } catch (err) {
      setNudgeError(err.message);
    } finally {
      setNudgeSending(false);
    }
  }

  async function openPerson(person) {
    setSelectedPerson(person);
    setPersonLoading(true);
    try {
      const data = await api.getMemberGoals(token, person.email);
      setPersonGoals(data.goals);
      setPersonPeriodKey(data.period_key);
    } catch (err) {
      setError(err.message);
    } finally {
      setPersonLoading(false);
    }
  }

  const groupPeople = people.filter((p) => p.role === activeGroup);
  const isTeacherGroup = activeGroup === "teacher";
  const subjects = isTeacherGroup
    ? [...new Set(groupPeople.map((p) => p.subject).filter(Boolean))].sort()
    : [];
  const filteredPeople = groupPeople.filter((p) => {
    if (isTeacherGroup && subjectFilter !== "all" && p.subject !== subjectFilter) return false;
    if (!matchesLocation(p.location, locationFilter)) return false;
    if (nameFilter.trim() && !p.name.toLowerCase().includes(nameFilter.trim().toLowerCase())) return false;
    if (designationFilter.trim() && !(p.designation || "").toLowerCase().includes(designationFilter.trim().toLowerCase())) return false;
    if (midTermFilter !== "all" && p.mid_term_status !== midTermFilter) return false;
    if (annualFilter !== "all" && p.annual_status !== annualFilter) return false;
    return true;
  });
  const showObservations = isTeacherGroup && user.can_view_observations;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
        <div className="section-title" style={{ marginTop: 0 }}>Goals overview</div>
        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="loading-spinner">Loading…</div>
        ) : (
          <>
            <SummaryRow label="Role" counts={midTermSummary} />
            <SummaryRow label="Organisation" counts={annualSummary} />

            <div className="nudge-bar">
              {!nudgeConfirming && !nudgeSending && (
                <button className="btn btn-ghost" onClick={() => { setNudgeConfirming(true); setNudgeResult(null); setNudgeError(""); }}>
                  ✉️ Email everyone flagged
                </button>
              )}
              {nudgeConfirming && (
                <>
                  <span className="hint-text">
                    Emails a reminder to everyone whose Role or Organisation goal is still missing
                    past its cutoff. Anyone already reminded in the last week is skipped.
                  </span>
                  <button className="btn btn-primary" onClick={sendNudges}>Send reminders</button>
                  <button className="btn btn-ghost" onClick={() => setNudgeConfirming(false)}>Cancel</button>
                </>
              )}
              {nudgeSending && <span className="hint-text">Sending reminders…</span>}
            </div>

            {nudgeError && <div className="form-error">{nudgeError}</div>}

            {nudgeResult && (
              <div className="nudge-result">
                <div>
                  <strong>{nudgeResult.sent}</strong> reminder{nudgeResult.sent === 1 ? "" : "s"} sent
                  {" "}· {nudgeResult.checked} people checked
                  {nudgeResult.skipped_recent > 0 && (
                    <> · {nudgeResult.skipped_recent} skipped (already reminded within {nudgeResult.renotify_days} days)</>
                  )}
                  {nudgeResult.failed > 0 && <> · <span className="status-not_set-text">{nudgeResult.failed} failed to send</span></>}
                </div>
                {nudgeResult.recipients.length > 0 && (
                  <ul className="nudge-recipients">
                    {nudgeResult.recipients.map((r) => (
                      <li key={`${r.email}-${r.flag_type}`}>{r.name} <span className="hint-text">— {r.flag_label}</span></li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="cadence-tabs" style={{ marginTop: 16 }}>
              {GROUPS.map((g) => (
                <button
                  key={g.key}
                  className={`cadence-tab ${activeGroup === g.key ? "active" : ""}`}
                  onClick={() => {
                    setActiveGroup(g.key);
                    setSubjectFilter("all");
                    setNameFilter("");
                    setDesignationFilter("");
                    setMidTermFilter("all");
                    setAnnualFilter("all");
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>

            <div className="form-group" style={{ maxWidth: 200, marginTop: 10 }}>
              <select className="form-control" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                <option value="all">All locations</option>
                <option value="Kodathi">Kodathi</option>
                <option value="Attibele">Attibele</option>
                <option value="both">Both (leadership)</option>
              </select>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Designation</th>
                    {isTeacherGroup && <th>Subject</th>}
                    <th>Role</th>
                    <th>Organisation</th>
                    {showObservations && <th>Observations</th>}
                  </tr>
                  <tr className="filter-row">
                    <th>
                      <input className="form-control form-control-sm" placeholder="Filter name…" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} />
                    </th>
                    <th>
                      <input className="form-control form-control-sm" placeholder="Filter…" value={designationFilter} onChange={(e) => setDesignationFilter(e.target.value)} />
                    </th>
                    {isTeacherGroup && (
                      <th>
                        <select className="form-control form-control-sm" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
                          <option value="all">All</option>
                          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </th>
                    )}
                    <th>
                      <select className="form-control form-control-sm" value={midTermFilter} onChange={(e) => setMidTermFilter(e.target.value)}>
                        {STATUS_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </th>
                    <th>
                      <select className="form-control form-control-sm" value={annualFilter} onChange={(e) => setAnnualFilter(e.target.value)}>
                        {STATUS_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </th>
                    {showObservations && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredPeople.map((p) => (
                    <tr className="team-row" key={p.email} onClick={() => openPerson(p)}>
                      <td>{p.name}</td>
                      <td>{p.designation}</td>
                      {isTeacherGroup && <td>{p.subject || "-"}</td>}
                      <td>{statusCell(p.mid_term_status, p.mid_term_progress)}</td>
                      <td>{statusCell(p.annual_status, p.annual_progress)}</td>
                      {showObservations && (
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => { e.stopPropagation(); setObservationsFor(p); }}
                          >
                            {p.observation_average != null ? `${p.observation_average} avg` : "No data"}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {filteredPeople.length === 0 && (
                    <tr><td colSpan={6} className="empty-msg">No one in this group yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="form-actions" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>

      {selectedPerson && (
        <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); setSelectedPerson(null); }}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="section-title" style={{ marginTop: 0 }}>{selectedPerson.name}'s goals</div>
            {personLoading ? (
              <div className="loading-spinner">Loading…</div>
            ) : (
              <GoalPanels
                goals={personGoals}
                periodKey={personPeriodKey}
                token={token}
                user={user}
                myGoals={myGoals}
                emptyMessage="No goals set yet."
              />
            )}
            <div className="form-actions" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setSelectedPerson(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {observationsFor && (
        <ObservationCards token={token} person={observationsFor} onClose={() => setObservationsFor(null)} />
      )}
    </div>
  );
}
