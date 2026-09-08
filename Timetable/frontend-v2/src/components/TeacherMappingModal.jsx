import { useState } from "react";
import { appendTeachingSections } from "../lib/staffRoles";
import { withAppendedEntry } from "../lib/teachingSectionsSync";

// Shown only when an uploaded timetable's parsed teacher-subject-grade-section
// assignments don't already match what's recorded in staff_roles.teaching_sections.
// Saving here is the one place Timetable writes to staff_roles (owned by a
// different app) - scoped to UPDATE only, appending to teaching_sections on
// an existing row, never creating/removing a staff_roles row.
export default function TeacherMappingModal({ unmatched, staffRows, onClose, onSaved }) {
  // Keyed by name (not id) so the field can be a plain searchable text
  // input - resolved back to a staff_roles row by exact name at save time.
  // Typing something that doesn't match any real name is treated as "leave
  // unmapped" (skip), same as leaving it blank.
  const [mappings, setMappings] = useState(() =>
    Object.fromEntries(unmatched.map((a, i) => [i, a.suggestedStaffRow?.name ?? ""]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function setMapping(i, name) {
    setMappings((prev) => ({ ...prev, [i]: name }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      // Reported back to the caller so the actual commit can resolve THESE
      // specific uploaded-file spellings to the right teacher too - just
      // writing teaching_sections here doesn't do that on its own (root
      // cause of a real bug found 2026-08-04: a confirmed mapping here
      // silently had zero effect on which teacher_id actually got assigned).
      const confirmedMappings = [];
      for (let i = 0; i < unmatched.length; i++) {
        const name = mappings[i];
        if (!name) continue; // left unmapped - skip, don't write
        const staffRow = staffRows.find((r) => r.name === name);
        if (!staffRow) continue; // typed text isn't a real staff_roles name - skip rather than guess
        confirmedMappings.push({ uploadedName: unmatched[i].teacherName, staffRow });
        const updated = withAppendedEntry(staffRow, unmatched[i].subject, unmatched[i].gradeSection);
        if (updated === staffRow.teaching_sections) continue; // already present, nothing to write
        await appendTeachingSections(staffRow.id, updated);
      }
      onSaved(confirmedMappings);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <h3>Some teacher assignments aren't recorded in staff_roles yet</h3>
        <p>
          Map each one to the correct teacher, then Save to add it to staff_roles.teaching_sections. Leave a row
          blank to skip it.
        </p>
        {error && <p className="error-text">{error}</p>}
        <table>
          <thead>
            <tr>
              <th>Grade/Section</th>
              <th>Subject</th>
              <th>Uploaded teacher name</th>
              <th>Map to staff_roles teacher</th>
            </tr>
          </thead>
          <tbody>
            {unmatched.map((a, i) => (
              <tr key={i}>
                <td>{a.gradeSection}</td>
                <td>{a.subject}</td>
                <td>{a.teacherName}</td>
                <td>
                  <input
                    type="text"
                    list={`staff-mapping-list-${i}`}
                    value={mappings[i]}
                    placeholder="Search teacher, or leave blank to skip"
                    onChange={(e) => setMapping(i, e.target.value)}
                  />
                  <datalist id={`staff-mapping-list-${i}`}>
                    {staffRows.map((r) => (
                      <option key={r.id} value={r.name} />
                    ))}
                  </datalist>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={handleSave} disabled={saving}>
          Save
        </button>{" "}
        <button onClick={onClose} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
