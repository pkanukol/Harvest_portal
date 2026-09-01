import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

// HR oversight: everyone's goal and task status on one page, filterable and
// printable. Read-only by design - HR chases and reports; approving stays with
// the assigned reviewer.

const STATE_LABEL = {
  not_set: "Not set",
  awaiting_review: "Awaiting review",
  needs_acknowledgment: "Needs acknowledgment",
  approved: "Approved",
  complete: "Complete",
  struck_off: "Struck off",
};

const FILTERS = [
  { key: "all", label: "Everyone" },
  { key: "no_goals", label: "No goals set" },
  { key: "awaiting_review", label: "Awaiting review" },
  { key: "needs_acknowledgment", label: "Needs acknowledgment" },
  { key: "overdue", label: "Overdue" },
];

const GROUPS = [
  { key: "all", label: "All roles" },
  { key: "teacher", label: "Teachers" },
  { key: "sme", label: "SME / HOD" },
  { key: "auditor", label: "Leadership / Admin" },
];

function Slot({ slot }) {
  if (!slot) return null;
  const cls = slot.overdue ? "overdue" : slot.state;
  return (
    <span className={`hr-slot hr-slot-${cls}`} title={slot.title || "Nothing set"}>
      {STATE_LABEL[slot.state] || slot.state}
      {slot.overdue && " · overdue"}
      {slot.period_label && slot.period_label !== "This year" && (
        <span className="hr-slot-period"> {slot.period_label}</span>
      )}
      {/* More than one goal in this slot: the badge describes the one that
          most needs attention, so say how many there are. */}
      {slot.goal_count > 1 && <span className="hr-slot-period"> +{slot.goal_count - 1} more</span>}
    </span>
  );
}

export default function HrReport({ token, onClose }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [group, setGroup] = useState("all");
  const [location, setLocation] = useState("all");
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setReport(await api.getHrReport(token));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const people = useMemo(() => {
    if (!report) return [];
    const q = query.trim().toLowerCase();
    return report.people.filter((p) => {
      if (group !== "all" && p.role !== group) return false;
      if (location !== "all") {
        const loc = (p.location || "").toLowerCase();
        if (loc !== location.toLowerCase() && loc !== "both") return false;
      }
      if (q && !p.name.toLowerCase().includes(q) && !(p.designation || "").toLowerCase().includes(q)) return false;
      if (filter === "no_goals") return p.role_goal.state === "not_set" && p.org_goal.state === "not_set";
      if (filter === "awaiting_review") return [p.role_goal.state, p.org_goal.state].includes("awaiting_review");
      if (filter === "needs_acknowledgment") return [p.role_goal.state, p.org_goal.state].includes("needs_acknowledgment");
      if (filter === "overdue") return p.role_goal.overdue || p.org_goal.overdue || p.overdue_tasks > 0;
      return true;
    });
  }, [report, filter, group, location, query]);

  const t = report ? report.totals : null;

  return (
    <div className="hr-overlay">
      <div className="hr-bar no-print">
        <span className="hr-bar-title">HR report</span>
        <span className="hint-text" style={{ marginBottom: 0 }}>
          Read-only. Approving and editing stay with each person's reviewer.
        </span>
        <button className="btn btn-ghost btn-sm" disabled={sending} onClick={async () => {
          if (!window.confirm("Email everyone whose goals or tasks are overdue and haven't moved for over a day?")) return;
          setSending(true); setSent(null);
          try { setSent(await api.runFlagCheck(token)); }
          catch (err) { setError(err.message); }
          finally { setSending(false); }
        }}>{sending ? "Sending…" : "✉️ Send reminders"}</button>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>🖨 Print</button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>

      <div className="hr-body">
        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="loading-spinner">Loading…</div>
        ) : report && (
          <>
            <div className="hr-head">
              <h2 className="hr-title">Goals and tasks — {report.period_key}</h2>
              <div className="hint-text">Generated {report.generated_on}</div>
            </div>

            {sent && (
              <div className="hr-sent no-print">
                Sent <b>{sent.overdue_goal_emails}</b> overdue-goal warning{sent.overdue_goal_emails === 1 ? "" : "s"} and{" "}
                <b>{sent.pending_task_emails}</b> pending-task reminder{sent.pending_task_emails === 1 ? "" : "s"}.
                {sent.sent > 0 && <> Plus <b>{sent.sent}</b> “no goal set” reminder{sent.sent === 1 ? "" : "s"}.</>}
                {sent.skipped_recently_chased > 0 && <> {sent.skipped_recently_chased} skipped — already chased recently.</>}
              </div>
            )}

            <div className="hr-tiles">
              <div className="hr-tile"><b>{t.people}</b><span>people</span></div>
              <div className="hr-tile alert"><b>{t.no_goals}</b><span>no goals set</span></div>
              <div className="hr-tile warn"><b>{t.awaiting_review}</b><span>awaiting review</span></div>
              <div className="hr-tile warn"><b>{t.needs_acknowledgment}</b><span>needs acknowledgment</span></div>
              <div className="hr-tile ok"><b>{t.approved}</b><span>approved</span></div>
              <div className="hr-tile"><b>{t.struck_off}</b><span>struck off</span></div>
              <div className="hr-tile alert"><b>{t.overdue_goals}</b><span>overdue goals</span></div>
              <div className="hr-tile alert"><b>{t.overdue_tasks}</b><span>overdue tasks</span></div>
              <div className="hr-tile"><b>{t.open_tasks}</b><span>open tasks</span></div>
            </div>

            <div className="hr-filters no-print">
              {FILTERS.map((f) => (
                <button key={f.key} className={`cadence-tab ${filter === f.key ? "active" : ""}`} onClick={() => setFilter(f.key)}>
                  {f.label}
                </button>
              ))}
              <select className="form-control form-control-sm" style={{ maxWidth: 170 }} value={group} onChange={(e) => setGroup(e.target.value)}>
                {GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
              </select>
              <select className="form-control form-control-sm" style={{ maxWidth: 150 }} value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="all">All locations</option>
                <option value="Kodathi">Kodathi</option>
                <option value="Attibele">Attibele</option>
              </select>
              <input className="form-control form-control-sm" style={{ maxWidth: 180 }} placeholder="Search name…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>

            <div className="hint-text print-only">
              {FILTERS.find((f) => f.key === filter)?.label}
              {group !== "all" && ` · ${GROUPS.find((g) => g.key === group)?.label}`}
              {location !== "all" && ` · ${location}`}
            </div>

            <div className="hr-count">{people.length} of {report.people.length} people</div>

            <div className="scroll">
              <table className="hr-table">
                <thead>
                  <tr>
                    <th>Name</th><th>Designation</th><th>Reviewer</th>
                    <th>Role goal</th><th>Organisation goal</th><th>Tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.email}>
                      <td><b>{p.name}</b><div className="hr-sub">{p.location}</div></td>
                      <td>{p.designation}</td>
                      <td>{p.reviewer_name || <span className="hr-sub">none assigned</span>}</td>
                      <td><Slot slot={p.role_goal} /></td>
                      <td><Slot slot={p.org_goal} /></td>
                      <td className="hr-tasks">
                        {p.open_tasks} open
                        {p.overdue_tasks > 0 && <span className="hr-late"> · {p.overdue_tasks} overdue</span>}
                        <div className="hr-sub">{p.completed_tasks} done</div>
                      </td>
                    </tr>
                  ))}
                  {people.length === 0 && (
                    <tr><td colSpan={6} className="empty-msg">Nobody matches these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
