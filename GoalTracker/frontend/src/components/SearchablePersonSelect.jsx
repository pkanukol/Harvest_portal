import { useState } from "react";

// A plain <select> with 140+ people in it is unusable to scan/search, so
// this is a lightweight combobox: a text input that filters the directory
// as you type, with a click-to-select dropdown - no library, just enough to
// make picking one of ~140 names fast.
export default function SearchablePersonSelect({ value, options, onChange, disabled, placeholder }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.email === value);
  const displayValue = open ? query : selected ? `${selected.name} (${selected.designation})` : "";

  const filtered = query.trim()
    ? options.filter((o) => `${o.name} ${o.designation}`.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function select(email) {
    onChange(email);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="searchable-select">
      <input
        className="form-control"
        value={displayValue}
        placeholder={placeholder || "— none —"}
        disabled={disabled}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); e.target.blur(); } }}
      />
      {open && (
        <div className="searchable-select-options">
          <div className="searchable-select-option searchable-select-none" onMouseDown={() => select(null)}>
            — none —
          </div>
          {filtered.map((o) => (
            <div key={o.email} className="searchable-select-option" onMouseDown={() => select(o.email)}>
              {o.name} <span className="hint-text">({o.designation})</span>
            </div>
          ))}
          {filtered.length === 0 && <div className="searchable-select-option searchable-select-none">No match</div>}
        </div>
      )}
    </div>
  );
}
