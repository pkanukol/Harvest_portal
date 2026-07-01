import { formatDateStr, ratingClass, scoreColorClass } from "../utils/helpers";

export default function TeacherView({ userName, reports, loading, error, onOpenReport }) {
  return (
    <div style={{ paddingTop: "24px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "28px" }}>Hello, {userName}!</h1>
        <p style={{ color: "var(--text-gray)", fontSize: "14px", marginTop: "4px" }}>
          Here are your classroom observation audit reports.
        </p>
      </div>

      <div
        style={{
          fontSize: "11px",
          fontWeight: 700,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "1px",
          marginBottom: "12px",
        }}
      >
        Finalised Reports
      </div>

      {loading && (
        <div className="msg">
          <span className="spinner"></span>Loading observation logs...
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}

      {!loading && !error && reports.length === 0 && (
        <div className="card text-center" style={{ padding: "40px" }}>
          <h3 style={{ color: "var(--text-muted)", marginBottom: "8px" }}>No Reports Available</h3>
          <p style={{ fontSize: "14px", color: "var(--text-gray)" }}>
            Your observation reports will show here once reviewed and finalised by your auditor.
          </p>
        </div>
      )}

      <div className="audit-grid">
        {reports.map((obs) => (
          <div key={obs.id} className="teacher-card" onClick={() => onOpenReport(obs.id)}>
            <div className="card-left">
              <div className="tc-name">Observation Summary</div>
              <div className="tc-meta">
                <span className="meta-tag subj">{obs.subject}</span>
                <span className="meta-tag obs">{formatDateStr(obs.date_time)}</span>
                <span className={`meta-rating ${ratingClass(obs.rating)}`}>{obs.rating}</span>
              </div>
              <div className="tc-obs-meta">
                {obs.auditor?.name && (
                  <span className="tc-obs-auditor">&#128100; {obs.auditor.name}</span>
                )}
              </div>
              <div style={{ marginTop: "8px" }}>
                {obs.remarks_saved ? (
                  <span className="remarks-status-badge saved">&#10003; Remarks Saved</span>
                ) : (
                  <span className="remarks-status-badge pending">&#9998; Remarks to be Added</span>
                )}
              </div>
            </div>
            <div className="tc-score-block">
              <div className={`tc-score-val ${scoreColorClass(obs.rating)}`}>{obs.overall_score}</div>
              <div className="tc-score-lbl">Total Score</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
