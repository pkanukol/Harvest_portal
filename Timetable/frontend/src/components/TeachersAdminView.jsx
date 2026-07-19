import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Spinner } from "./TimetableGrid";

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

// Strips a leading honorific so "Ms Aarti" and "Aarti" group together as the
// same likely person - the exact kind of duplicate a hand-edited workbook
// (or importing the same real teacher via two differently-spelled sources)
// tends to produce.
function coreName(name) {
  return (name || "").trim().toLowerCase().replace(/^(ms|mr|mrs|dr|miss)\.?\s+/, "").replace(/\s+/g, " ");
}

function completenessScore(t) {
  return (t.linked_email ? 2 : 0) + (t.periods_per_week > 0 ? 1 : 0) + t.class_teacher_of.length;
}

export default function TeachersAdminView({ token, location, activeYear }) {
  const [teachers, setTeachers] = useState([]);
  const [emailDrafts, setEmailDrafts] = useState({});
  const [nameDrafts, setNameDrafts] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [mergeRowId, setMergeRowId] = useState(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [keepChoice, setKeepChoice] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [showSubjects, setShowSubjects] = useState(false);

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

  const duplicateGroups = useMemo(() => {
    const groups = {};
    teachers.forEach((t) => {
      const key = coreName(t.name);
      (groups[key] = groups[key] || []).push(t);
    });
    return Object.entries(groups)
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => ({ key, list }));
  }, [teachers]);

  const defaultKeepId = (list) => [...list].sort((a, b) => completenessScore(b) - completenessScore(a))[0].id;

  const addTeacher = async () => {
    if (!newName.trim()) { setError("Name is required."); return; }
    setAdding(true);
    setError("");
    setNotice("");
    try {
      await api.createTeacher(token, location, newName.trim(), newEmail.trim() || null);
      setNewName("");
      setNewEmail("");
      setNotice("Added.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

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

  // Saves the name only if it actually changed, then closes the Modify panel
  // either way - one button ("Save") does both, instead of a separate
  // save-name action plus a Done button.
  const closeAndSaveName = async (teacher) => {
    const draft = (nameDrafts[teacher.id] ?? teacher.name).trim();
    if (!draft || draft === teacher.name) {
      setEditingId(null);
      return;
    }
    setBusyId(teacher.id);
    setError("");
    try {
      await api.renameTeacher(token, teacher.id, draft);
      await load();
      setEditingId(null);
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

  const mergeInto = async (teacherId, targetId) => {
    setBusyId(teacherId);
    setError("");
    setNotice("");
    try {
      await api.deleteTeacher(token, teacherId, targetId);
      setNotice("Merged.");
      setMergeRowId(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const mergeGroup = async (list, keepId) => {
    setBusyId(keepId);
    setError("");
    setNotice("");
    try {
      for (const t of list) {
        if (t.id !== keepId) await api.deleteTeacher(token, t.id, keepId);
      }
      setNotice("Merged.");
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

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" }}>
        <label>
          New teacher name<br />
          <input
            className="input" placeholder="e.g. Mr Senthil, Ms Priya" value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </label>
        <label>
          Email — optional<br />
          <input
            className="input" placeholder="name@harvestinternationalschool.in" value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
        </label>
        <button className="btn" onClick={addTeacher} disabled={adding}>
          {adding ? <><Spinner /> Adding…</> : "Add Teacher"}
        </button>
      </div>

      <p style={{ marginBottom: 16 }}>
        <button className="btn secondary" onClick={() => setShowSubjects((v) => !v)}>
          {showSubjects ? "Hide subjects" : "Rename or add a subject…"}
        </button>
      </p>
      {showSubjects && <SubjectsPanel token={token} activeYear={activeYear} />}

      {duplicateGroups.length > 0 && (
        <div className="card" style={{ background: "var(--gray)", marginBottom: 16 }}>
          <h3>Possible duplicate teachers ({duplicateGroups.length})</h3>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            These look like the same person under slightly different names (e.g. with/without "Ms"/"Mr"). Pick
            which record to keep — merging moves all class-teacher and subject assignments onto it and deletes
            the others.
          </p>
          {duplicateGroups.map(({ key, list }) => {
            const keepId = keepChoice[key] ?? defaultKeepId(list);
            return (
              <div
                key={key}
                style={{
                  display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap",
                  padding: "8px 0", borderTop: "1px solid #ddd",
                }}
              >
                {list.map((t) => (
                  <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                    <input
                      type="radio" name={`keep-${key}`} checked={keepId === t.id}
                      onChange={() => setKeepChoice((prev) => ({ ...prev, [key]: t.id }))}
                    />
                    {t.name}{t.linked_email ? ` (${t.linked_email})` : ""} — {t.periods_per_week} periods/wk
                  </label>
                ))}
                <button className="btn secondary" onClick={() => mergeGroup(list, keepId)} disabled={busyId === keepId}>
                  {busyId === keepId ? <Spinner /> : "Merge into selected"}
                </button>
              </div>
            );
          })}
        </div>
      )}

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
                      disabled={busyId === t.id}
                      onClick={() => {
                        if (editingId === t.id) {
                          closeAndSaveName(t);
                        } else {
                          setNameDrafts((d) => ({ ...d, [t.id]: t.name }));
                          setEditingId(t.id);
                        }
                      }}
                    >
                      {editingId === t.id ? (busyId === t.id ? <Spinner /> : "Save") : "Modify"}
                    </button>
                    <button
                      className="btn secondary"
                      onClick={() => { setMergeRowId(mergeRowId === t.id ? null : t.id); setMergeTargetId(""); }}
                    >
                      {mergeRowId === t.id ? "Cancel" : "Merge…"}
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
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                      <strong style={{ fontSize: 13 }}>Name</strong>
                      <input
                        className="input" style={{ width: 220 }}
                        value={nameDrafts[t.id] ?? t.name}
                        placeholder="e.g. Mr Senthil, Ms Priya"
                        onChange={(e) => setNameDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                      />
                    </div>
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
              {mergeRowId === t.id && (
                <tr>
                  <td colSpan={7}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", background: "var(--gray)", padding: 8, borderRadius: 8 }}>
                      <span style={{ fontSize: 13 }}>Merge <strong>{t.name}</strong> into:</span>
                      <select className="select" value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}>
                        <option value="">Select teacher…</option>
                        {teachers.filter((o) => o.id !== t.id).map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                      <button
                        className="btn secondary"
                        disabled={!mergeTargetId || busyId === t.id}
                        onClick={() => mergeInto(t.id, Number(mergeTargetId))}
                      >
                        {busyId === t.id ? <Spinner /> : "Merge"}
                      </button>
                    </div>
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
  const [renameDraft, setRenameDraft] = useState("");
  const [showNewSubject, setShowNewSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectPeriods, setNewSubjectPeriods] = useState("");
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
    setShowNewSubject(false);
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

  const selectedSlot = slots.find((s) => String(s.sst_id) === slotId);

  const renameSelectedSubject = async () => {
    if (!selectedSlot || !renameDraft.trim()) return;
    setBusy(true);
    try {
      await api.renameSubject(token, selectedSlot.subject_id, renameDraft.trim());
      await loadSlots(slotSectionId);
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const createNewSubject = async () => {
    if (!newSubjectName.trim()) { onError("Subject name is required."); return; }
    setBusy(true);
    try {
      await api.addSubjectSlot(token, slotSectionId, {
        subjectName: newSubjectName.trim(),
        periodsPerWeek: newSubjectPeriods ? Number(newSubjectPeriods) : null,
        teacherId: teacher.id,
      });
      setNewSubjectName("");
      setNewSubjectPeriods("");
      setShowNewSubject(false);
      await loadSlots(slotSectionId);
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
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <select className="select" value={slotSectionId} onChange={(e) => loadSlots(e.target.value)}>
            <option value="">Section…</option>
            {allSections.map((s) => (
              <option key={s.section_id} value={s.section_id}>{s.code}</option>
            ))}
          </select>
          <select
            className="select" value={slotId} disabled={!slots.length}
            onChange={(e) => {
              setSlotId(e.target.value);
              const slot = slots.find((s) => String(s.sst_id) === e.target.value);
              setRenameDraft(slot ? slot.subject : "");
            }}
          >
            <option value="">Subject slot…</option>
            {slots.map((s) => (
              <option key={s.sst_id} value={s.sst_id}>
                {s.subject}{s.component_label !== s.subject ? ` (${s.component_label})` : ""}
                {s.teacher_name ? ` — ${s.teacher_name}` : " — unassigned"}
              </option>
            ))}
          </select>
          <button className="btn secondary" onClick={addSubjectAssignment} disabled={busy || !slotId}>Assign</button>
          {slotSectionId && (
            <button className="btn secondary" onClick={() => setShowNewSubject((v) => !v)} disabled={busy}>
              {showNewSubject ? "Cancel" : "+ New subject"}
            </button>
          )}
        </div>

        {selectedSlot && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Rename this subject:</span>
            <input
              className="input" style={{ width: 180 }} value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
            />
            <button
              className="btn secondary" disabled={busy || !renameDraft.trim() || renameDraft.trim() === selectedSlot.subject}
              onClick={renameSelectedSubject}
            >
              Rename
            </button>
          </div>
        )}

        {showNewSubject && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
            <input
              className="input" style={{ width: 160 }} placeholder="Subject name, e.g. Skating"
              value={newSubjectName} onChange={(e) => setNewSubjectName(e.target.value)}
            />
            <input
              className="input" style={{ width: 90 }} type="number" min="1" placeholder="Periods/wk"
              value={newSubjectPeriods} onChange={(e) => setNewSubjectPeriods(e.target.value)}
            />
            <button className="btn secondary" onClick={createNewSubject} disabled={busy || !newSubjectName.trim()}>
              Create & Assign to {teacher.name}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SubjectsPanel({ token, activeYear }) {
  const [subjects, setSubjects] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!activeYear?.id) return;
    try {
      setSubjects(await api.listSubjects(token, activeYear.id));
    } catch (err) {
      setError(err.message);
    }
  }, [token, activeYear?.id]);

  useEffect(() => { load(); }, [load]);

  const rename = async (subjectId, currentName) => {
    const draft = (drafts[subjectId] ?? currentName).trim();
    if (!draft || draft === currentName) return;
    setBusyId(subjectId);
    setError("");
    try {
      await api.renameSubject(token, subjectId, draft);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (!activeYear) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3>Subjects — {activeYear.label}</h3>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Fix a subject name here directly (e.g. an import artifact like "History / Civics Senthil" instead of
        "History / Civics") — it corrects every grade and section already using it in one go, no need to hunt
        through a teacher's Modify panel.
      </p>
      {error && <div className="status-banner error">{error}</div>}
      {!subjects ? (
        <p><Spinner /> Loading…</p>
      ) : subjects.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No subjects yet.</p>
      ) : (
        <table className="teacher-table">
          <thead><tr><th>Subject</th><th>Taught in</th><th>Rename to</th><th></th></tr></thead>
          <tbody>
            {subjects.map((s) => (
              <tr key={s.id}>
                <td>{s.raw_name}</td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>
                  {s.grades.map((g) => `${g.grade_name} (${g.periods_per_week}/wk)`).join(", ") || "—"}
                </td>
                <td>
                  <input
                    className="input" style={{ width: 220 }}
                    value={drafts[s.id] ?? s.raw_name}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                  />
                </td>
                <td>
                  <button
                    className="btn secondary"
                    disabled={busyId === s.id || (drafts[s.id] ?? s.raw_name).trim() === s.raw_name}
                    onClick={() => rename(s.id, s.raw_name)}
                  >
                    {busyId === s.id ? <Spinner /> : "Rename"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
