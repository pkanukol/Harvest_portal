import { useEffect, useState } from "react";
import { cachedBranches, listBranches } from "../lib/branches";

export default function BranchPicker({ value, onChange }) {
  // Seeded from the last known list so the picker is populated on first
  // paint instead of after a round-trip; listBranches() then refreshes it.
  const [branches, setBranches] = useState(() => cachedBranches() || []);
  const [error, setError] = useState(null);

  useEffect(() => {
    listBranches()
      .then(setBranches)
      .catch((e) => {
        // A cached list is still usable - only surface the failure if we have
        // nothing to show, otherwise the user sees an error over a working picker.
        if (!cachedBranches()) setError(e.message);
      });
  }, []);

  if (error) return <p className="error-text">{error}</p>;

  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select branch</option>
      {branches.map((b) => (
        <option key={b} value={b}>
          {b}
        </option>
      ))}
    </select>
  );
}
