import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import SearchablePersonSelect from "./SearchablePersonSelect";

export default function AdminAssignments({ token, onClose }) {
  const [people, setPeople] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingEmail, setSavingEmail] = useState(null);
  // Filters apply as you type. With 139 rows, scrolling to find one person is
  // the slow part of this screen.
  const [nameFilter, setNameFilter] = useState("");
  const [designationFilter, setDesignationFilter] = useState("");
  const [reviewerFilter, setReviewerFilter] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api.getReviewerAssignments(token);
      setPeople(data.people);
      setDirectory(data.directory);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const n = nameFilter.trim().toLowerCase();
    const d = designationFilter.trim().toLowerCase();
    const r = reviewerFilter.trim().toLowerCase();
    return people.filter((p) => {
      if (n && !(p.person_name || "").toLowerCase().includes(n)) return false;
      if (d && !(p.designation || "").toLowerCase().includes(d)) return false;
      if (r) {
        // "none" finds the people nobody reviews yet - the rows worth fixing.
        if (r === "none") return !p.reviewer_email;
        if (!(p.reviewer_name || "").toLowerCase().includes(r)) return false;
      }
      return true;
    });
  }, [people, nameFilter, designationFilter, reviewerFilter]);

  async function saveRow(row, value) {
    const updated = { ...row, reviewer_email: value || null };
    setPeople((prev) => prev.map((p) => (p.person_email === row.person_email ? updated : p)));
    setSavingEmail(row.person_email);
    try {
      await api.putReviewerAssignment(token, {
        person_email: row.person_email,
        reviewer_email: updated.reviewer_email,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingEmail(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
        <div className="section-title" style={{ marginTop: 0 }}>Reviewer assignments</div>
        <p className="hint-text">Reviewer = who reviews this person's own goals.</p>
        {error && <div className="form-error">{error}</div>}
        {!loading && (
          <div className="hint-text">
            Showing {filtered.length} of {people.length} people.
            {(nameFilter || designationFilter || reviewerFilter) && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}
                      onClick={() => { setNameFilter(""); setDesignationFilter(""); setReviewerFilter(""); }}>
                Clear filters
              </button>
            )}
          </div>
        )}
        {loading ? (
          <div className="loading-spinner">Loading…</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Designation</th>
                  <th>Reviewer</th>
                </tr>
                <tr className="filter-row">
                  <th>
                    <input className="form-control form-control-sm" placeholder="Filter name…"
                           value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} />
                  </th>
                  <th>
                    <input className="form-control form-control-sm" placeholder="Filter designation…"
                           value={designationFilter} onChange={(e) => setDesignationFilter(e.target.value)} />
                  </th>
                  <th>
                    <input className="form-control form-control-sm" placeholder="Filter reviewer, or 'none'…"
                           value={reviewerFilter} onChange={(e) => setReviewerFilter(e.target.value)} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.person_email}>
                    <td>{row.person_name}</td>
                    <td>{row.designation}</td>
                    <td>
                      {row.can_edit ? (
                        <SearchablePersonSelect
                          value={row.reviewer_email}
                          options={directory.filter((d) => d.email !== row.person_email)}
                          disabled={savingEmail === row.person_email}
                          onChange={(email) => saveRow(row, email)}
                        />
                      ) : (
                        row.reviewer_name || "-"
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={3} className="empty-msg">Nobody matches these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="form-actions" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
