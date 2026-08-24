import ProgressBar from "./ProgressBar";

const STATUS_LABEL = {
  not_set: "Not set",
  pending: "Pending",
  approved: "Approved",
};

function statusCell(status, progress) {
  return (
    <div className="status-cell">
      <span>{status === "pending" ? <><span className="flag-dot" /> Pending</> : (STATUS_LABEL[status] || status)}</span>
      {progress.total > 0 && <ProgressBar completed={progress.completed} total={progress.total} />}
    </div>
  );
}

export default function TeamOverview({ team, onSelectMember }) {
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
              <th>Role goal</th>
              <th>Organisation goal</th>
            </tr>
          </thead>
          <tbody>
            {team.reviewees.map((m) => (
              <tr className="team-row" key={m.email} onClick={() => onSelectMember(m.email, m.name)}>
                <td>{m.name}</td>
                <td>{m.designation}</td>
                <td>{statusCell(m.mid_term_status, m.mid_term_progress)}</td>
                <td>{statusCell(m.annual_status, m.annual_progress)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
