// Inline branch selector shown per section (instead of one global dropdown).
// value is a branch name, or "ALL" when includeAll is set (meaning all branches).
export default function BranchChips({ branches, value, onChange, includeAll = false, label = "Branch" }) {
  const opts = includeAll ? ["ALL", ...branches] : branches;
  if (opts.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      {label ? <label className="field-label" style={{ display: "inline", marginRight: 8 }}>{label}</label> : null}
      <div className="category-chips" style={{ display: "inline-flex", marginBottom: 0 }}>
        {opts.map((b) => (
          <button key={b} className={value === b ? "chip chip-active" : "chip"} onClick={() => onChange(b)}>
            {b === "ALL" ? "All" : b}
          </button>
        ))}
      </div>
    </div>
  );
}
