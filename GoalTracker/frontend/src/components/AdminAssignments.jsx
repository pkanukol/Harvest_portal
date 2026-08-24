import { useEffect, useState } from "react";
import { api } from "../api";
import SearchablePersonSelect from "./SearchablePersonSelect";

export default function AdminAssignments({ token, onClose }) {
  const [people, setPeople] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingEmail, setSavingEmail] = useState(null);

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
              </thead>
              <tbody>
                {people.map((row) => (
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
