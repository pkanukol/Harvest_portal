export default function ProgressBar({ completed, total, label, width }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="progress-bar-wrap" title={`${completed} of ${total} goal${total === 1 ? "" : "s"} completed`}>
      {label && <span className="progress-bar-caption">{label}</span>}
      <div className="progress-bar-track" style={width ? { width } : undefined}>
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress-bar-label">{completed}/{total}</span>
    </div>
  );
}
