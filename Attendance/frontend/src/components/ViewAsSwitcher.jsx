import { useEffect, useState } from "react";
import { searchStaff } from "../lib/staffMaster";

// Testing/support convenience: lets a real admin preview the app as any
// other staff member without a separate login. Writes made while
// "viewing as" someone are attributed to THAT person (staffId/email are
// passed down as normal props everywhere else in the app, not derived from
// the actual auth token) - this is a deliberate testing feature, not a
// read-only preview, so use it carefully against real data.
export default function ViewAsSwitcher({ client, onSelect }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => searchStaff(client, query).then(setSuggestions), 250);
    return () => clearTimeout(timer);
  }, [query, client]);

  return (
    <div style={{ position: "relative" }}>
      <input
        type="search"
        placeholder="View as… (search staff)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ fontSize: 12, padding: "6px 10px", width: 220 }}
      />
      {suggestions.length > 0 ? (
        <div className="suggestion-list" style={{ position: "absolute", zIndex: 10, width: 220, background: "#fff" }}>
          {suggestions.map((item) => (
            <div
              key={item.id}
              className="suggestion-row"
              onClick={() => {
                onSelect(item);
                setQuery("");
                setSuggestions([]);
              }}
            >
              <strong style={{ fontSize: 12 }}>{item.name}</strong>
              <div className="hint" style={{ margin: 0, fontSize: 11 }}>{item.designation}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
