import { useEffect, useState } from "react";
import { searchStaff } from "../lib/staffMaster";

export default function StaffSearchPicker({ client, branch, onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      searchStaff(client, query, branch).then((rows) => {
        setResults(rows);
        setLoading(false);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, client, branch]);

  return (
    <div>
      <input
        type="search"
        placeholder="Search name, email, or designation"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading ? <p className="hint">Searching…</p> : null}
      <div className="suggestion-list">
        {results.map((item) => (
          <div key={item.id} className="suggestion-row" onClick={() => onSelect(item)}>
            <strong>{item.name}</strong>
            <div className="hint" style={{ margin: 0 }}>
              {item.designation} · {item.email}
            </div>
          </div>
        ))}
        {!loading && results.length === 0 ? <p className="empty-text">No staff found.</p> : null}
      </div>
    </div>
  );
}
