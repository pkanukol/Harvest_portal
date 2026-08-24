import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const LOCATIONS = [
  { value: "", label: "All locations" },
  { value: "Kodathi", label: "Kodathi" },
  { value: "Attibele", label: "Attibele" },
];

// Async version of SearchablePersonSelect - queries staff_roles (a separate
// Supabase project the backend proxies to) as you type instead of filtering
// an already-fetched local list, since the staff directory is far larger
// than GoalTracker's own user table and isn't preloaded anywhere.
export default function StaffSearchSelect({ token, value, onChange, disabled, placeholder }) {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const staff = await api.searchStaff(token, query, location);
        setResults(staff);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, location, open]);

  const displayValue = open ? query : value ? `${value.name}` : "";

  function select(staff) {
    onChange(staff ? { email: staff.email, name: staff.name } : null);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="searchable-select">
      <div className="staff-search-row">
        <input
          className="form-control"
          value={displayValue}
          placeholder={placeholder || "Search by name…"}
          disabled={disabled}
          onFocus={() => { setOpen(true); setQuery(""); }}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); e.target.blur(); } }}
        />
        <select
          className="form-control staff-search-location"
          value={location}
          disabled={disabled}
          onChange={(e) => setLocation(e.target.value)}
          onFocus={() => setOpen(true)}
        >
          {LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>
      {open && (
        <div className="searchable-select-options" onMouseDown={(e) => e.preventDefault()}>
          {loading ? (
            <div className="searchable-select-option searchable-select-none">Searching…</div>
          ) : results.length === 0 ? (
            <div className="searchable-select-option searchable-select-none">No match</div>
          ) : (
            results.map((s) => (
              <div key={s.email} className="searchable-select-option" onClick={() => select(s)}>
                {s.name} <span className="hint-text">({s.designation || "—"}{s.branches?.length ? `, ${s.branches.join("/")}` : ""})</span>
              </div>
            ))
          )}
          <div className="searchable-select-option searchable-select-none" onClick={() => setOpen(false)}>Close</div>
        </div>
      )}
    </div>
  );
}
