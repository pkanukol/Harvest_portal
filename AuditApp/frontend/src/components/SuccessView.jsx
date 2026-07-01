export default function SuccessView({ summary, onDashboard, onNewObservation }) {
  if (!summary) return null;

  return (
    <div className="text-center" style={{ padding: "60px 20px", animation: "fadeInUp 0.4s ease" }}>
      <div
        style={{
          width: "80px",
          height: "80px",
          background: "linear-gradient(135deg, var(--harvest-green), var(--harvest-green-light))",
          borderRadius: "50%",
          fontSize: "36px",
          margin: "0 auto 24px",
          boxShadow: "0 8px 30px rgba(45,106,45,0.4)",
        }}
        className="flex-center"
      >
        ✓
      </div>
      <h1 style={{ fontSize: "32px", marginBottom: "8px" }}>Observation Draft Saved</h1>
      <p style={{ color: "var(--text-gray)", marginBottom: "30px", fontSize: "15px" }}>
        The observation details and AI feedback have been successfully saved. You can finalise the draft from the dashboard.
      </p>

      <div className="card" style={{ maxWidth: "480px", margin: "0 auto 30px", textAlign: "left" }}>
        <h3 style={{ marginBottom: "14px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "6px" }}>
          Audit Summary
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "10px", fontSize: "14px" }}>
          <div>Teacher:</div>
          <div style={{ fontWeight: 700 }}>{summary.teacherName}</div>
          <div>Rating:</div>
          <div style={{ fontWeight: 700, color: "var(--harvest-blue)" }}>{summary.rating}</div>
          <div>Score:</div>
          <div style={{ fontWeight: 700 }}>{summary.overallScore} / 28</div>
          <div>Domain 1 (Planning):</div>
          <div style={{ fontWeight: 700 }}>{summary.domain1Score} / 8</div>
          <div>Domain 2 (Classroom):</div>
          <div style={{ fontWeight: 700 }}>{summary.domain2Score} / 4</div>
          <div>Domain 3 (Instruction):</div>
          <div style={{ fontWeight: 700 }}>{summary.domain3Score} / 16</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
        <button className="btn btn-dashboard" style={{ padding: "12px 24px", fontSize: "13px" }} onClick={onDashboard}>
          Go to Dashboard
        </button>
        <button className="btn-timestamp" style={{ padding: "12px 24px", fontSize: "13px" }} onClick={onNewObservation}>
          New Observation
        </button>
      </div>
    </div>
  );
}
