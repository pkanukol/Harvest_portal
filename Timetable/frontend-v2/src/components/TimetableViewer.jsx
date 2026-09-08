import { useEffect, useMemo, useRef, useState } from "react";
import { listAcademicYears, fetchGeneratorInputs } from "../lib/timetableData";
import { fetchStaffByBranch, appendTeachingSections } from "../lib/staffRoles";
import { gradeSectionToken, withAppendedEntry, teacherTeachesSubjectInSection } from "../lib/teachingSectionsSync";
import { detectClashesForCell, getOrCreateSST, checkBifurcationForSection } from "../lib/timetableEdits";
import { normalizeTeacherName } from "../lib/teacherName";
import { isTeachingDesignation } from "../lib/staffDesignation";
import { loadIgnoredWarnings, ignoreWarning, warningKey } from "../lib/ignoredWarnings";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// initialYearId: set right after a successful Upload/Build New commit so the
// user lands straight on that year's timetable (Grade 1 first, since grades
// load ordered by order_index) instead of an empty "Select" dropdown -
// confirmed by the user 2026-08-04: "if saved [the] control goes to view
// timetable automatically with grade 1 timetables where these warnings are
// shown." This component always fully unmounts/remounts on navigation (see
// TimetablePanel's mode switch), so seeding yearId's initial state directly
// from the prop (rather than via a separate effect) is enough - no need to
// fight the user's own subsequent picks since those never touch this prop.
// A previous version used an effect + ref-guard instead, which broke under
// React StrictMode's dev-only double-effect-invocation: the branch-loading
// effect below (which unconditionally reset yearId to "") re-ran a second
// time as part of that simulation, but the ref-guard blocked the
// initialYearId effect from re-applying "26" on ITS second invocation -
// net result, yearId ended up "" even though the ref showed the value had
// been "applied." Confirmed live by walking the mounted fiber's hook list.
export default function TimetableViewer({ client, branch, canEdit, initialYearId }) {
  const [academicYears, setAcademicYears] = useState([]);
  const [yearId, setYearId] = useState(() => (initialYearId ? String(initialYearId) : ""));
  const [ignoredWarnings, setIgnoredWarnings] = useState(() => loadIgnoredWarnings());
  const [inputs, setInputs] = useState(null);
  const [staffRolesRows, setStaffRolesRows] = useState([]);
  const [gradeId, setGradeId] = useState("");
  const [sectionId, setSectionId] = useState(""); // "" = all sections of the grade
  // Exactly one cell can be edited at a time - clicking a cell opens it,
  // clicking Save/Cancel (or another cell) closes it. editingKey is
  // "sectionId|day|period"; draftPairs holds that cell's in-progress edit.
  const [editingKey, setEditingKey] = useState(null);
  const [draftPairs, setDraftPairs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Tracks the last branch this effect actually saw, so a StrictMode dev
  // double-invocation (same branch value, called again right after) is
  // distinguishable from a genuine branch switch - comparing VALUES stays
  // consistent across a same-value repeat call, unlike a plain "have I run
  // yet" ref/flag (which flips after the first call and so behaves
  // differently the second time, which is what broke the earlier version of
  // this seeding logic).
  const lastBranchRef = useRef(undefined);

  useEffect(() => {
    if (!branch) return;
    const isGenuineBranchSwitch = lastBranchRef.current !== undefined && lastBranchRef.current !== branch;
    lastBranchRef.current = branch;
    // A pre-seeded initialYearId (landing here right after a commit) should
    // survive this effect's first run(s) for the SAME branch - only a real
    // switch to a different branch clears it.
    if (isGenuineBranchSwitch || !initialYearId) {
      setYearId("");
      setInputs(null);
    }
    listAcademicYears(client, branch).then(setAcademicYears).catch((e) => setError(e.message));
    // staff_roles is the whole teacher list - there is no second table to
    // reconcile it against, and nothing to auto-provision. A person added to
    // staff_roles is immediately selectable here.
    fetchStaffByBranch(branch)
      .then(setStaffRolesRows)
      .catch((e) => setError(e.message));
  }, [client, branch]);

  function loadInputs() {
    setInputs(null);
    setLoading(true);
    return fetchGeneratorInputs(client, yearId)
      .then((data) => {
        setInputs(data);
        setGradeId((prev) => (prev ? prev : data.grades.length ? String(data.grades[0].id) : ""));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!yearId) return;
    setGradeId("");
    setSectionId("");
    setEditingKey(null);
    setDraftPairs([]);
    loadInputs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, yearId]);

  // staff_roles is the ONLY source for the teacher picker - a name not
  // listed there can't be newly assigned, on the user's explicit
  // instruction. Its `id` IS the teacher id this app stores, so every row is
  // directly selectable; the old "no teacher record" disabled state is gone
  // along with the Project A teachers table that caused it.
  // Pure admin/leadership designations (Principal, Chairman, IT Manager, ...)
  // are excluded entirely - confirmed by the user 2026-08-03 that only
  // people who actually teach/coach should ever appear here (HOD and
  // Coordinator kept in - they do teach).
  const teacherOptions = useMemo(() => {
    return staffRolesRows
      .filter((r) => isTeachingDesignation(r.designation))
      .map((r) => ({ name: r.name, teacherId: r.id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staffRolesRows]);

  const staffRowByNormalizedName = useMemo(
    () => new Map(staffRolesRows.map((r) => [normalizeTeacherName(r.name), r])),
    [staffRolesRows]
  );

  // The picker for a given subject+grade+section only suggests teachers
  // staff_roles actually records teaching THAT combination, plus anyone
  // staff_roles hasn't recorded any teaching_sections for yet - narrows the
  // list instead of showing every teacher for every subject/grade.
  function teacherOptionsForSubject(subjectRawName, gradeSection) {
    return teacherOptions.filter((t) => {
      const staffRow = staffRowByNormalizedName.get(normalizeTeacherName(t.name));
      return teacherTeachesSubjectInSection(staffRow, subjectRawName, gradeSection);
    });
  }

  const teacherNameById = useMemo(
    () => new Map(staffRolesRows.map((r) => [r.id, r.name])),
    [staffRolesRows]
  );

  // Names an uploaded workbook assigned that have no staff_roles row at all.
  // They live on section_subject_teachers.unmatched_teacher_name now; the old
  // version of this read "rows in Project A's teachers table that staff_roles
  // doesn't know about", which cannot exist any more since there is only one
  // teacher table. Still not selectable going forward, but a cell already
  // pointing at one must show the real name (never silently blank it) and
  // must survive an untouched save.
  const nonStaffRolesTeacherByName = useMemo(() => {
    if (!inputs) return new Map();
    const map = new Map();
    for (const sst of inputs.sectionSubjectTeachers) {
      if (sst.unmatched_teacher_name) {
        map.set(normalizeTeacherName(sst.unmatched_teacher_name), { name: sst.unmatched_teacher_name });
      }
    }
    return map;
  }, [inputs]);

  const missingFromStaffRoles = useMemo(
    () => [...nonStaffRolesTeacherByName.values()].map((t) => t.name).sort((a, b) => a.localeCompare(b)),
    [nonStaffRolesTeacherByName]
  );

  // "1A" -> teacher name, from staff_roles.class_sections - drives both the
  // "no class teacher recorded" warning and the class-teacher banner shown
  // above each grade+section's timetable.
  const classTeacherNameByToken = useMemo(() => {
    const map = new Map();
    for (const r of staffRolesRows) {
      const cs = r.class_sections;
      const tokens = Array.isArray(cs) ? cs : cs ? [cs] : [];
      for (const tok of tokens) map.set(String(tok).trim().toUpperCase(), r.name);
    }
    return map;
  }, [staffRolesRows]);

  // A slot's teacher name: the staff_roles id first, falling back to the
  // SST's unmatched_teacher_name. Declared as a plain function so it can use
  // sstById, which is defined further down.
  function slotTeacherName(slot) {
    if (slot.teacher_id != null) return teacherNameById.get(slot.teacher_id) || null;
    const sst = sstById.get(slot.section_subject_teacher_id);
    return sst?.unmatched_teacher_name || null;
  }

  const gspSubjectById = useMemo(() => {
    if (!inputs) return new Map();
    return new Map(inputs.gradeSubjectPeriods.map((g) => [g.id, g.subject.raw_name]));
  }, [inputs]);

  const sstById = useMemo(() => {
    if (!inputs) return new Map();
    return new Map(inputs.sectionSubjectTeachers.map((s) => [s.id, s]));
  }, [inputs]);

  const visibleSections = useMemo(() => {
    if (!inputs || !gradeId) return [];
    const sections = inputs.sections.filter((s) => String(s.grade_id) === String(gradeId));
    return sectionId ? sections.filter((s) => String(s.id) === String(sectionId)) : sections;
  }, [inputs, gradeId, sectionId]);

  // Returns an array of {gspId, teacherName, sstId} pairs for a cell -
  // usually one, but a combo/parallel period (Hindi/Sanskrit,
  // Dance/Music/Theatre, ...) has one pair per teacher covering it.
  // sstId is the section_subject_teacher this pair currently comes from
  // (null for a freshly-added pair, or once the subject is changed away
  // from what that row represents) - saveCell() uses it to tell "just
  // changing who teaches this existing subject" (propagate to every other
  // period of that subject) apart from "placing a different subject in
  // this one slot" (that slot only).
  function cellPairs(sectionIdNum, day, period) {
    const slots = inputs.allSlots.filter(
      (s) => String(s.section_id) === String(sectionIdNum) && s.day_of_week === day && s.period_number === period
    );
    return slots.map((slot) => {
      const sst = sstById.get(slot.section_subject_teacher_id);
      return {
        gspId: sst?.grade_subject_period_id ?? null,
        teacherName: slotTeacherName(slot),
        sstId: slot.section_subject_teacher_id ?? null,
      };
    });
  }

  function startEditingCell(sectionIdNum, day, period) {
    // Read-only users can look at every cell but never open the editor. The
    // database enforces this too (the RLS write policy needs a leadership
    // designation), so this is the courteous half of the gate, not the whole
    // of it.
    if (!canEdit) return;
    setError(null);
    setEditingKey(`${sectionIdNum}|${day}|${period}`);
    setDraftPairs(cellPairs(sectionIdNum, day, period));
  }

  function cancelEditingCell() {
    setEditingKey(null);
    setDraftPairs([]);
    setError(null);
  }

  function updateDraftPairs(updater) {
    setDraftPairs((current) => updater(current));
  }

  async function saveCell() {
    if (!editingKey) return;
    setError(null);

    const [sectionIdStr, dayStr, periodStr] = editingKey.split("|");
    const sectionIdNum = Number(sectionIdStr);
    const day = Number(dayStr);
    const period = Number(periodStr);

    const clashes = detectClashesForCell(day, period, draftPairs, inputs.allSlots, slotTeacherName, sectionIdNum);
    if (clashes.length) {
      const lines = clashes
        .map((c) => `${c.teacherName} is already teaching ${c.sectionIds.length} other section(s) at this period`)
        .join("\n");
      // eslint-disable-next-line no-alert
      if (!window.confirm(`Teacher clash(es) found:\n\n${lines}\n\nSave anyway?`)) return;
    }

    setSaving(true);
    try {
      const existingSlots = inputs.allSlots.filter(
        (s) => String(s.section_id) === String(sectionIdNum) && s.day_of_week === day && s.period_number === period
      );
      const validPairs = draftPairs.filter((p) => p.gspId);

      // sstId -> {teacherId} - a pair that keeps its original subject
      // (sstId carried over unchanged) means the user is only changing WHO
      // teaches it, which should apply to every period that subject/section
      // combo occupies all week, not just the edited cell.
      const sstTeacherUpdates = new Map();
      const createdSSTCache = new Map(); // avoids duplicate SST rows within this one cell's save

      // Resolve each staged pair to a concrete section_subject_teacher +
      // teacher_id before touching timetable_slots, so a bad teacher name
      // aborts before any partial write for this cell.
      const resolved = [];
      for (const pair of validPairs) {
        let teacherId = null;
        let unmatchedName = null;
        if (pair.teacherName) {
          const option = teacherOptions.find((t) => t.name === pair.teacherName);
          if (option) {
            teacherId = option.teacherId;
          } else {
            // Not a staff_roles name - only acceptable if it's an untouched
            // pre-existing assignment carried on the SST's
            // unmatched_teacher_name, never a newly picked value. It keeps
            // being stored as a name, since there is no id to point at.
            const grandfathered = nonStaffRolesTeacherByName.get(normalizeTeacherName(pair.teacherName));
            if (!grandfathered) {
              throw new Error(
                `"${pair.teacherName}" isn't in staff_roles for ${branch} - add them there first.`
              );
            }
            unmatchedName = grandfathered.name;
          }
        }

        const subjectRawName = gspSubjectById.get(pair.gspId) || "";

        let sstId;
        if (pair.sstId) {
          // Same subject as before, just a different teacher (or
          // unchanged) - reuse the existing SST and queue it for the
          // whole-week propagation pass below, instead of splitting this
          // one period off onto a brand new SST row.
          sstId = pair.sstId;
          sstTeacherUpdates.set(sstId, { teacherId, unmatchedName });
        } else {
          // A freshly-added pair, or the subject in this slot was changed
          // to something else - a one-off assignment for this slot only.
          const cacheKey = `${pair.gspId}|${teacherId}|${unmatchedName || ""}`;
          sstId = createdSSTCache.get(cacheKey);
          if (!sstId) {
            sstId = await getOrCreateSST(
              client, inputs.sectionSubjectTeachers, sectionIdNum, pair.gspId, teacherId, subjectRawName, unmatchedName
            );
            createdSSTCache.set(cacheKey, sstId);
          }
        }
        resolved.push({ teacherId, unmatchedName, sstId, subjectRawName, teacherName: pair.teacherName, gspId: pair.gspId, isNewPair: !pair.sstId });
      }

      // Reuse existing rows in place for as many pairs as line up, delete
      // any excess existing rows, insert any shortfall.
      const reuseCount = Math.min(existingSlots.length, resolved.length);
      for (let i = 0; i < reuseCount; i++) {
        const { error: updError } = await client
          .from("tt_timetable_slots")
          .update({
            section_subject_teacher_id: resolved[i].sstId,
            teacher_id: resolved[i].teacherId,
            is_manual_override: true,
          })
          .eq("id", existingSlots[i].id);
        if (updError) throw updError;
      }
      for (let i = reuseCount; i < existingSlots.length; i++) {
        const { error: delError } = await client.from("tt_timetable_slots").delete().eq("id", existingSlots[i].id);
        if (delError) throw delError;
      }
      for (let i = reuseCount; i < resolved.length; i++) {
        const { error: insError } = await client.from("tt_timetable_slots").insert({
          academic_year_id: Number(yearId),
          section_id: sectionIdNum,
          day_of_week: day,
          period_number: period,
          section_subject_teacher_id: resolved[i].sstId,
          teacher_id: resolved[i].teacherId,
          is_manual_override: true,
        });
        if (insError) throw insError;
      }

      // A freshly-added pair (no original sstId - either "+ Add another X
      // teacher" or a brand new pair) whose subject this section ALREADY
      // teaches in other periods this week means the user is adding another
      // simultaneous teacher for that whole combo subject (e.g. SPA with 2
      // teachers) - propagate the addition to every other occurrence of
      // that subject for this section, not just the edited cell, symmetric
      // to how changing an EXISTING teacher already propagates whole-week.
      // A subject placed here for the first time has nothing else to
      // propagate to, so this is a no-op for a genuinely new placement.
      for (const r of resolved) {
        if (!r.isNewPair) continue;
        const otherSlotsBySlot = new Map(); // "day|period" -> [slot, ...]
        for (const s of inputs.allSlots) {
          if (String(s.section_id) !== String(sectionIdNum)) continue;
          if (s.day_of_week === day && s.period_number === period) continue; // this cell, already handled above
          const sst = sstById.get(s.section_subject_teacher_id);
          if (sst?.grade_subject_period_id !== r.gspId) continue;
          const key = `${s.day_of_week}|${s.period_number}`;
          if (!otherSlotsBySlot.has(key)) otherSlotsBySlot.set(key, []);
          otherSlotsBySlot.get(key).push(s);
        }
        for (const [key, slots] of otherSlotsBySlot.entries()) {
          if (slots.some((s) => s.section_subject_teacher_id === r.sstId)) continue; // already has this teacher there
          const [otherDay, otherPeriod] = key.split("|").map(Number);
          const { error: propError } = await client.from("tt_timetable_slots").insert({
            academic_year_id: Number(yearId),
            section_id: sectionIdNum,
            day_of_week: otherDay,
            period_number: otherPeriod,
            section_subject_teacher_id: r.sstId,
            teacher_id: r.teacherId,
            is_manual_override: true,
          });
          if (propError) throw propError;
        }
      }

      for (const r of resolved) {
        if (!r.teacherName) continue;
        const staffRow = staffRolesRows.find((row) => normalizeTeacherName(row.name) === normalizeTeacherName(r.teacherName));
        if (staffRow) {
          const section = inputs.sections.find((s) => s.id === sectionIdNum);
          const grade = inputs.grades.find((g) => g.id === section?.grade_id);
          const gradeSection = gradeSectionToken(grade?.name || "", section?.name || "");
          const updatedSections = withAppendedEntry(staffRow, r.subjectRawName, gradeSection);
          if (updatedSections !== staffRow.teaching_sections) {
            await appendTeachingSections(staffRow.id, updatedSections);
          }
        }
      }

      // Propagate each changed teacher-on-existing-subject to every other
      // period that section_subject_teacher covers this week, not just the
      // period(s) actually edited.
      for (const [sstId, { teacherId, unmatchedName }] of sstTeacherUpdates.entries()) {
        const { error: sstError } = await client
          .from("tt_section_subject_teachers")
          .update({ teacher_id: teacherId, unmatched_teacher_name: unmatchedName })
          .eq("id", sstId);
        if (sstError) throw sstError;
        const { error: slotsError } = await client
          .from("tt_timetable_slots")
          .update({ teacher_id: teacherId, is_manual_override: true })
          .eq("section_subject_teacher_id", sstId);
        if (slotsError) throw slotsError;
      }

      setEditingKey(null);
      setDraftPairs([]);
      await loadInputs();
    } catch (e) {
      setError([e.message, e.details, e.hint].filter(Boolean).join(" — "));
    } finally {
      setSaving(false);
    }
  }

  if (!branch) return <p>Select a branch above.</p>;

  return (
    <section>
      <div className="no-print">
        <label>
          Academic year:{" "}
          <select value={yearId} onChange={(e) => setYearId(e.target.value)}>
            <option value="">Select</option>
            {academicYears.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label} {y.is_active ? "(active)" : ""}
              </option>
            ))}
          </select>
        </label>

        {loading && <p>Loading...</p>}
        {error && <p className="error-text">{error}</p>}

        {inputs && (
          <>
            {" "}
            <label>
              Grade:{" "}
              <select
                value={gradeId}
                onChange={(e) => {
                  setGradeId(e.target.value);
                  setSectionId("");
                }}
              >
                {inputs.grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>{" "}
            <label>
              Section:{" "}
              <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                <option value="">All sections</option>
                {inputs.sections
                  .filter((s) => String(s.grade_id) === String(gradeId))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>{" "}
            <button onClick={() => window.print()}>Print</button>
            <p>
              <small>Click any period cell below to edit just that period.</small>
            </p>
          </>
        )}

        {missingFromStaffRoles.length > 0 && (
          <p className="error-text">
            Not in staff_roles for {branch} (existing assignments still shown, but can't be newly picked until added
            there): {missingFromStaffRoles.join(", ")}
          </p>
        )}
      </div>

      {inputs &&
        visibleSections.map((section) => {
          const grade = inputs.grades.find((g) => g.id === section.grade_id);
          const mismatches = checkBifurcationForSection(
            section.id,
            inputs.allSlots,
            sstById,
            gspSubjectById,
            inputs.gradeSubjectPeriods,
            section.grade_id
          ).filter((m) => !ignoredWarnings.has(warningKey(yearId, section.id, m.subject)));
          const classTeacherToken = gradeSectionToken(grade?.name || "", section.name).toUpperCase();
          const classTeacherName = classTeacherNameByToken.get(classTeacherToken);
          return (
            <div key={section.id}>
              <h3>
                {grade?.name} {section.name}
                {classTeacherName && <small> &mdash; Class Teacher: {classTeacherName}</small>}
              </h3>
              {!classTeacherName && (
                <p className="no-print error-text">No class teacher recorded in staff_roles for this section.</p>
              )}
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    {inputs.schedule.map((col, i) => (
                      <th key={i}>
                        {col.type === "period" ? `P${col.number}` : col.label || "Break"}
                        <br />
                        <small>
                          {col.start}&ndash;{col.end}
                        </small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAY_LABELS.map((dayLabel, day) => (
                    <tr key={dayLabel}>
                      <td>{dayLabel}</td>
                      {inputs.schedule.map((col, i) => {
                        if (col.type !== "period") {
                          return (
                            <td key={i} className="break-cell">
                              &mdash;
                            </td>
                          );
                        }
                        const cellKey = `${section.id}|${day}|${col.number}`;
                        const isEditingThis = editingKey === cellKey;

                        if (!isEditingThis) {
                          const pairs = cellPairs(section.id, day, col.number);
                          return (
                            <td
                              key={i}
                              className={canEdit ? "no-print editable-cell" : "no-print"}
                              onClick={canEdit ? () => startEditingCell(section.id, day, col.number) : undefined}
                              title={canEdit ? "Click to edit this period" : undefined}
                            >
                              {pairs.map((p, idx) =>
                                p.gspId ? (
                                  <div key={idx} className="cell-pair">
                                    {col.number === 0 ? "CT" : gspSubjectById.get(p.gspId)}
                                    <br />
                                    <small>{p.teacherName || ""}</small>
                                  </div>
                                ) : null
                              )}
                            </td>
                          );
                        }

                        return (
                          <td key={i} className="editing-cell">
                            {draftPairs.map((p, idx) => (
                              <div key={idx} className="cell-pair cell-pair-row">
                                <select
                                  value={p.gspId || ""}
                                  onChange={(e) => {
                                    const gspId = e.target.value ? Number(e.target.value) : null;
                                    updateDraftPairs((arr) =>
                                      arr.map((pp, ii) =>
                                        ii === idx
                                          ? {
                                              gspId,
                                              teacherName: gspId ? pp.teacherName : null,
                                              // Changing the subject means this pair no longer represents
                                              // its original section_subject_teacher - it needs a fresh
                                              // one, not a whole-week teacher change on the old subject.
                                              sstId: gspId === pp.gspId ? pp.sstId : null,
                                            }
                                          : pp
                                      )
                                    );
                                  }}
                                >
                                  <option value="">&mdash; none &mdash;</option>
                                  {inputs.gradeSubjectPeriods
                                    .filter((g) => String(g.grade_id) === String(section.grade_id))
                                    .map((g) => (
                                      <option key={g.id} value={g.id}>
                                        {g.subject.raw_name}
                                      </option>
                                    ))}
                                </select>
                                {p.gspId && (
                                  <>
                                    <input
                                      type="text"
                                      list={`teacher-list-${section.id}-${day}-${col.number}-${idx}`}
                                      value={p.teacherName || ""}
                                      placeholder="Search teacher..."
                                      onChange={(e) =>
                                        updateDraftPairs((arr) =>
                                          arr.map((pp, ii) =>
                                            ii === idx
                                              ? { gspId: pp.gspId, teacherName: e.target.value || null, sstId: pp.sstId }
                                              : pp
                                          )
                                        )
                                      }
                                    />
                                    <datalist id={`teacher-list-${section.id}-${day}-${col.number}-${idx}`}>
                                      {teacherOptionsForSubject(
                                        gspSubjectById.get(p.gspId),
                                        gradeSectionToken(grade?.name || "", section.name)
                                      ).map((t) => (
                                        <option key={t.name} value={t.name} />
                                      ))}
                                    </datalist>
                                    {p.teacherName && !teacherOptions.some((t) => t.name === p.teacherName) && (
                                      <small title="Not in staff_roles">&#9888;</small>
                                    )}
                                    {/* For combo periods (SPA, PE, ...) that need more than one
                                        teacher covering the same subject - prefills the new pair's
                                        subject so its teacher search is immediately filtered right,
                                        instead of making the user re-pick the subject from scratch. */}
                                    <button
                                      type="button"
                                      className="icon-btn"
                                      title={`Add another ${gspSubjectById.get(p.gspId)} teacher`}
                                      aria-label={`Add another ${gspSubjectById.get(p.gspId)} teacher`}
                                      onClick={() =>
                                        updateDraftPairs((arr) => [...arr, { gspId: p.gspId, teacherName: null, sstId: null }])
                                      }
                                    >
                                      +
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  className="icon-btn danger"
                                  title="Remove"
                                  aria-label="Remove"
                                  onClick={() => updateDraftPairs((arr) => arr.filter((_, ii) => ii !== idx))}
                                >
                                  &times;
                                </button>
                              </div>
                            ))}
                            <div className="cell-pair-row">
                              <button
                                type="button"
                                className="icon-btn"
                                title="Add subject"
                                aria-label="Add subject"
                                onClick={() =>
                                  updateDraftPairs((arr) => {
                                    // Defaults to whatever subject is already in this cell
                                    // (the common case is adding another teacher to a combo
                                    // period like SPORTS/SPA) instead of leaving the subject
                                    // blank - a blank-subject pair silently gets dropped on
                                    // save, which is exactly what made "only 1 teacher saved"
                                    // happen: this button and the per-teacher "+" above look
                                    // identical, so picking this one by mistake lost data
                                    // instead of just adding a second SPORTS teacher. Only
                                    // stays blank when the cell is empty or already mixes more
                                    // than one distinct subject (genuinely ambiguous).
                                    const distinctGspIds = new Set(arr.map((p) => p.gspId).filter(Boolean));
                                    const defaultGspId = distinctGspIds.size === 1 ? [...distinctGspIds][0] : null;
                                    return [...arr, { gspId: defaultGspId, teacherName: null, sstId: null }];
                                  })
                                }
                              >
                                +
                              </button>
                              <button
                                type="button"
                                className="icon-btn"
                                title={saving ? "Saving..." : "Save"}
                                aria-label="Save"
                                onClick={saveCell}
                                disabled={saving}
                              >
                                &#10003;
                              </button>
                              <button
                                type="button"
                                className="icon-btn danger"
                                title="Cancel"
                                aria-label="Cancel"
                                onClick={cancelEditingCell}
                                disabled={saving}
                              >
                                &#10005;
                              </button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {mismatches.length > 0 && (
                <div className="no-print">
                  {mismatches.map((m, i) => (
                    <p key={i} className="error-text">
                      {m.subject}: {m.placed} period(s)/week placed, subject bifurcation expects {m.expected}.{" "}
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setIgnoredWarnings(ignoreWarning(yearId, section.id, m.subject))}
                      >
                        Ignore
                      </button>
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
    </section>
  );
}
