import { Fragment, useCallback, useEffect, useState } from "react";
import { api } from "../api";

function flattenSections(activeYear) {
  if (!activeYear) return [];
  const out = [];
  for (const g of activeYear.grades) {
    for (const s of g.sections) {
      out.push({ section_id: s.id, code: `${g.name.replace(/\D/g, "")}${s.name}`, class_teacher_name: s.class_teacher_name });
    }
  }
  return out.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export default function TeachersAdminView({ token, location, activeYear }) {
  const [teachers, setTeachers] = useState([]);
  const [emailDrafts, setEmailDrafts] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const allSections = flattenSections(activeYear);

  const load = useCallback(async () => {
    try {
      const list = await api.listTeachers(token, location);
      setTeachers(list);
    } catch (err) {
      setError(err.message);
    }
  }, [token, location]);

  useEffect(() => { load(); }, [load]);

  const saveEmail = async (teacherId) => {
    setBusyId(teacherId);
    setError("");
    try {
      await api.linkTeacherEmail(token, teacherId, emailDrafts[teacherId] ?? "");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const deleteTeacher = async (teacherId) => {
    if (!window.confirm("Delete this teacher? This can't be undone.")) return;
    setBusyId(teacherId);
    setError("");
    setNotice("");
    try {
      await api.deleteTeacher(token, teacherId);
      setNotice("Deleted.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card">
      <h2>Teachers — {location}</h2>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Click <strong>Modify</strong> to link a school email (only if one isn't set yet), and to add or remove
        which grade+sections they're the class teacher of or which subject slots they teach.
      </p>
      {error && <div className="status-banner error">{error}</div>}
      {notice && <div className="status-banner ok">{notice}</div>}
      <table className="teacher-table">
        <thead>
          <tr>
            <th>Name</th><th>Linked email</th><th>Class Teacher</th><th>Assignments</th>
            <th>Subject</th><th>Periods/week</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {teachers.map((t) => (
            <Fragment key={t.id}>
              <tr>
                <td>{t.name}</td>
                <td>
                  {editingId === t.id && !t.linked_email ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <input
                        className="input" style={{ width: 200 }}
                        placeholder="name@harvestinternationalschool.in"
                        value={emailDrafts[t.id] ?? ""}
                        onChange={(e) => setEmailDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                      />
                      <button className="btn secondary" onClick={() => saveEmail(t.id)} disabled={busyId === t.id}>
                        Save
                      </button>
                    </div>
                  ) : (t.linked_email || <span style={{ color: "#bbb" }}>—</span>)}
                </td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>
                  {t.class_teacher_of.length ? t.class_teacher_of.map((c) => c.code).join(" ") : "—"}
                </td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>
                  {t.subject_assignments.length ? t.subject_assignments.map((a) => a.code).join(" ") : "—"}
                </td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>
                  {t.subjects.length ? t.subjects.join(", ") : "—"}
                </td>
                <td style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
                  {t.periods_per_week || "—"}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="btn secondary"
                      onClick={() => setEditingId(editingId === t.id ? null : t.id)}
                    >
                      {editingId === t.id ? "Done" : "Modify"}
                    </button>
                    <button className="btn danger" onClick={() => deleteTeacher(t.id)} disabled={busyId === t.id}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
              {editingId === t.id && (
                <tr>
                  <td colSpan={7}>
                    <AssignmentEditor
                      token={token}
                      teacher={t}
                      allSections={allSections}
                      onChanged={() => { setError(""); load(); }}
                      onError={setError}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssignmentEditor({ token, teacher, allSections, onChanged, onError }) {
  const [addSectionId, setAddSectionId] = useState("");
  const [slotSectionId, setSlotSectionId] = useState("");
  const [slots, setSlots] = useState([]);
  const [slotId, setSlotId] = useState("");
  const [busy, setBusy] = useState(false);

  const removeClassTeacher = async (sectionId) => {
    setBusy(true);
    try {
      await api.setClassTeacher(token, sectionId, null);
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addClassTeacher = async () => {
    if (!addSectionId) return;
    const target = allSections.find((s) => String(s.section_id) === addSectionId);
    if (target?.class_teacher_name && !window.confirm(
      `${target.code} already has a class teacher (${target.class_teacher_name}). Replace with ${teacher.name}?`
    )) return;
    setBusy(true);
    try {
      await api.setClassTeacher(token, addSectionId, teacher.id);
      setAddSectionId("");
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeSubjectAssignment = async (sstId) => {
    setBusy(true);
    try {
      await api.setSstTeacher(token, sstId, null);
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const loadSlots = async (sectionId) => {
    setSlotSectionId(sectionId);
    setSlotId("");
    setSlots([]);
    if (!sectionId) return;
    try {
      const result = await api.getSectionSubjectSlots(token, sectionId);
      setSlots(result);
    } catch (err) {
      onError(err.message);
    }
  };

  const addSubjectAssignment = async () => {
    if (!slotId) return;
    const slot = slots.find((s) => String(s.sst_id) === slotId);
    if (slot?.teacher_name && !window.confirm(
      `This slot is currently taught by ${slot.teacher_name}. Replace with ${teacher.name}?`
    )) return;
    setBusy(true);
    try {
      await api.setSstTeacher(token, slotId, teacher.id);
      setSlotId("");
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: "var(--gray)", borderRadius: 8, padding: 12, display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div>
        <strong style={{ fontSize: 13 }}>Class Teacher of</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
          {teacher.class_teacher_of.map((c) => (
            <span key={c.section_id} className="option-row" style={{ margin: 0 }}>
              {c.code}
              <button className="btn secondary" style={{ padding: "2px 8px", marginLeft: 6 }} onClick={() => removeClassTeacher(c.section_id)} disabled={busy}>×</button>
            </span>
          ))}
          {!teacher.class_teacher_of.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>None</span>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <select className="select" value={addSectionId} onChange={(e) => setAddSectionId(e.target.value)}>
            <option value="">Add section…</option>
            {allSections.map((s) => (
              <option key={s.section_id} value={s.section_id}>
                {s.code}{s.class_teacher_name ? ` (currently ${s.class_teacher_name})` : ""}
              </option>
            ))}
          </select>
          <button className="btn secondary" onClick={addClassTeacher} disabled={busy || !addSectionId}>Assign</button>
        </div>
      </div>

      <div>
        <strong style={{ fontSize: 13 }}>Subject Assignments</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
          {teacher.subject_assignments.map((a) => (
            <span key={a.sst_id} className="option-row" style={{ margin: 0 }}>
              {a.code} {a.subject}
              <button className="btn secondary" style={{ padding: "2px 8px", marginLeft: 6 }} onClick={() => removeSubjectAssignment(a.sst_id)} disabled={busy}>×</button>
            </span>
          ))}
          {!teacher.subject_assignments.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>None</span>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <select className="select" value={slotSectionId} onChange={(e) => loadSlots(e.target.value)}>
            <option value="">Section…</option>
            {allSections.map((s) => (
              <option key={s.section_id} value={s.section_id}>{s.code}</option>
            ))}
          </select>
          <select className="select" value={slotId} onChange={(e) => setSlotId(e.target.value)} disabled={!slots.length}>
            <option value="">Subject slot…</option>
            {slots.map((s) => (
              <option key={s.sst_id} value={s.sst_id}>
                {s.subject}{s.component_label !== s.subject ? ` (${s.component_label})` : ""}
                {s.teacher_name ? ` — ${s.teacher_name}` : " — unassigned"}
              </option>
            ))}
          </select>
          <button className="btn secondary" onClick={addSubjectAssignment} disabled={busy || !slotId}>Assign</button>
        </div>
      </div>
    </div>
  );
}
