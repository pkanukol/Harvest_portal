import { useEffect, useRef, useState } from "react";
import { api } from "../api";

/**
 * Lets an allowlisted account preview the app as any other staff member,
 * without a separate login — the quickest way to check what a teacher or an
 * SME actually sees.
 *
 * This is a real session, not a read-only peek: anything saved while
 * previewing is attributed to THAT person (same trade-off as the Attendance
 * app's View as switcher), which is why the banner in Header stays on screen
 * for the whole preview. The backend allowlists who may do this and logs
 * every switch with both identities.
 */
export default function ViewAsSwitcher({ token, onPicked }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef(null);

  // Debounced so typing a name doesn't fire a request per keystroke.
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      api.searchStaff(token, query)
        .then((res) => { setResults(res.staff || []); setError(""); })
        .catch((err) => setError(err.message));
    }, 250);
    return () => clearTimeout(handle);
  }, [token, query, open]);

  useEffect(() => {
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function pick(staff) {
    setOpen(false);
    setQuery("");
    try {
      onPicked(await api.viewAs(token, staff.email));
    } catch (err) {
      setError(err.message);
      setOpen(true);
    }
  }

  return (
    <div className="view-as" ref={boxRef}>
      <input
        className="form-control view-as-input"
        placeholder="View as… (search staff)"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      />
      {open && (
        <div className="view-as-menu">
          {error && <div className="view-as-error">{error}</div>}
          {!error && results.length === 0 && <div className="view-as-empty">No staff found.</div>}
          {results.map((s) => (
            <button key={s.email} className="view-as-item" onClick={() => pick(s)}>
              <div className="view-as-item-name">{s.name}</div>
              <div className="view-as-item-meta">
                {s.role} · {s.subject || "no subject"} · {s.designation}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
