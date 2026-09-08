import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { parseSubBifurcationWorkbook } from "../lib/subjectBifurcationParser";
import { parseWorkAllotmentWorkbook } from "../lib/workAllotmentParser";
import { buildTimetableInputsFromWorkAllotment } from "../lib/workAllotmentCrossReference";
import { generate } from "../lib/scheduler";
import { fetchStaffByBranch } from "../lib/staffRoles";
import { listAcademicYears, getOrCreateAcademicYear, fetchTimingConfig, saveTimingConfig } from "../lib/timetableData";
import { commitGeneratedToAcademicYear, ensureClassTeacherPeriod } from "../lib/uploadCommit";
import TimetableGrid from "./TimetableGrid";
import TimingSetup from "./TimingSetup";

function findSheetName(sheetNames, preferredExact, containsRe) {
  const exact = sheetNames.find((n) => n.trim().toLowerCase() === preferredExact);
  if (exact) return exact;
  return sheetNames.find((n) => containsRe.test(n)) || null;
}

export default function BuildNewTimetable({ client, branch, onCommitted }) {
  const [bifurcation, setBifurcation] = useState(null);
  const [workAllotment, setWorkAllotment] = useState(null);
  const [timing, setTiming] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [inputs, setInputs] = useState(null);
  const [sectionId, setSectionId] = useState("");
  const [staffRows, setStaffRows] = useState([]);

  const [academicYears, setAcademicYears] = useState([]);
  const [targetYearId, setTargetYearId] = useState("");
  const [newYearLabel, setNewYearLabel] = useState("");
  const [resolvingLabel, setResolvingLabel] = useState(false);
  const [labelResolution, setLabelResolution] = useState(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState(null);
  const [existingTimingConfig, setExistingTimingConfig] = useState(null);
  const [timingDraft, setTimingDraft] = useState(null);
  const [savingTiming, setSavingTiming] = useState(false);
  const [timingSaved, setTimingSaved] = useState(false);
  const [timingSaveCount, setTimingSaveCount] = useState(0);
  const [classTeacherResult, setClassTeacherResult] = useState(null);

  useEffect(() => {
    if (!branch) return;
    listAcademicYears(client, branch).then(setAcademicYears).catch((e) => setError(e.message));
    fetchStaffByBranch(branch)
      .then(setStaffRows)
      .catch((e) => setError(e.message));
  }, [client, branch]);

  // staff_roles IS the teacher record now - its `id` is what this app stores
  // as teacher_id. There is no second table to reconcile names against any
  // more, so every staff row is directly usable.
  const teacherOptions = useMemo(() => {
    return staffRows.map((r) => ({ name: r.name, teacherId: r.id }));
  }, [staffRows]);

  const classTeacherNameByGradeSection = useMemo(() => {
    const map = new Map();
    for (const r of staffRows) {
      const cs = r.class_sections;
      const tokens = Array.isArray(cs) ? cs : cs ? [cs] : [];
      for (const tok of tokens) map.set(String(tok).trim().toUpperCase(), r.name);
    }
    return map;
  }, [staffRows]);

  useEffect(() => {
    setTimingSaved(false);
    setTimingDraft(null);
    setClassTeacherResult(null);
    if (!targetYearId) {
      setExistingTimingConfig(null);
      return;
    }
    fetchTimingConfig(client, Number(targetYearId))
      .then(setExistingTimingConfig)
      .catch((e) => setError(e.message));
  }, [client, targetYearId]);

  // Single workbook holds both the "SUB BIFURCATION" tab (unchanged, grade-
  // paired subject/periods columns) and a flat "Work Allotment" tab (teacher/
  // subject/grade+section rows) - confirmed by the user 2026-08-04 as one
  // file, not two separate uploads.
  async function handlePlanningFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBifurcation(null);
    setWorkAllotment(null);
    setInputs(null);
    setResult(null);
    setCommitResult(null);
    setConfirmReplace(false);
    try {
      const bytes = await file.arrayBuffer();
      const workbook = XLSX.read(bytes, { type: "array" });

      const bifurcationSheet = findSheetName(workbook.SheetNames, "sub bifurcation", /sub\s*bifurcation/i) || workbook.SheetNames[0];
      const parsedBifurcation = parseSubBifurcationWorkbook(workbook, bifurcationSheet);
      setBifurcation(parsedBifurcation);

      const allotmentSheet = findSheetName(workbook.SheetNames, "work allotment", /work\s*allotment|allotment/i);
      if (!allotmentSheet) {
        throw new Error('Could not find a "Work Allotment" tab in this workbook.');
      }
      const parsedAllotment = parseWorkAllotmentWorkbook(workbook, allotmentSheet);
      setWorkAllotment(parsedAllotment);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleTimingChange(config) {
    setTiming(config);
  }

  function runBuild() {
    if (!bifurcation || !workAllotment || !timing || !branch) return;
    setError(null);
    setResult(null);
    try {
      const built = buildTimetableInputsFromWorkAllotment(bifurcation.gradeSubjects, workAllotment.assignments);
      setInputs(built);
      if (built.sections.length) setSectionId(String(built.sections[0].id));

      const computed = generate({
        academicYearId: 0,
        sectionIds: null,
        rulesText: null,
        periodsPerDay: timing.periodsPerDay,
        gradeSubjectPeriods: built.gradeSubjectPeriods,
        sections: built.sections,
        sectionSubjectTeachers: built.sectionSubjectTeachers,
        existingSlots: [],
      });
      setResult(computed);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUseLabel() {
    if (!newYearLabel.trim() || !branch) return;
    setResolvingLabel(true);
    setError(null);
    try {
      const { year, created } = await getOrCreateAcademicYear(client, branch, newYearLabel);
      setAcademicYears((prev) => {
        const rest = prev.filter((y) => y.id !== year.id);
        return [...rest, year].sort((a, b) => a.label.localeCompare(b.label));
      });
      setTargetYearId(String(year.id));
      setLabelResolution({ label: year.label, created });
      setNewYearLabel("");
    } catch (err) {
      setError(err.message);
    } finally {
      setResolvingLabel(false);
    }
  }

  async function handleSaveTiming() {
    if (!targetYearId || !timingDraft) return;
    setSavingTiming(true);
    setError(null);
    setClassTeacherResult(null);
    try {
      await saveTimingConfig(client, Number(targetYearId), timingDraft);
      if (timingDraft.hasClassTeacher) {
        setClassTeacherResult(await ensureClassTeacherPeriod(client, Number(targetYearId), staffRows, teacherOptions));
      }
      setTimingSaved(true);
      setTimingSaveCount((c) => c + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingTiming(false);
    }
  }

  async function handleCommit() {
    if (!result || !inputs || !targetYearId || !confirmReplace) return;
    const year = academicYears.find((y) => String(y.id) === String(targetYearId));
    // eslint-disable-next-line no-alert
    if (!window.confirm(`This replaces ALL placed periods (including previously manually-edited ones) for "${year?.label}" (${branch}). Continue?`)) {
      return;
    }
    setCommitting(true);
    setError(null);
    setCommitResult(null);
    try {
      const commitResultData = await commitGeneratedToAcademicYear(client, Number(targetYearId), inputs, result, teacherOptions);
      setCommitResult(commitResultData);
      onCommitted?.(Number(targetYearId));
    } catch (err) {
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  }

  const gspSubjectById = useMemo(() => {
    if (!inputs) return new Map();
    return new Map(inputs.gradeSubjectPeriods.map((g) => [g.id, g.subject.raw_name]));
  }, [inputs]);

  const sstById = useMemo(() => {
    if (!inputs) return new Map();
    return new Map(inputs.sectionSubjectTeachers.map((s) => [s.id, s]));
  }, [inputs]);

  const grid = useMemo(() => {
    if (!result || !sectionId) return null;
    const bySlot = new Map();
    for (const s of result.newSlots.filter((s) => String(s.section_id) === String(sectionId))) {
      bySlot.set(`${s.day_of_week}|${s.period_number}`, s);
    }
    return bySlot;
  }, [result, sectionId]);

  function getCell(day, period) {
    const slot = grid?.get(`${day}|${period}`);
    if (!slot) return null;
    const gspId = sstById.get(slot.section_subject_teacher_id)?.grade_subject_period_id;
    return { subject: gspSubjectById.get(gspId) || "?", teacher: slot.teacher_id || "" };
  }

  if (!branch) return <p>Select a branch above to build a new timetable.</p>;

  return (
    <section>
      <h2>Build a new timetable</h2>
      <p>
        Upload one workbook with a "SUB BIFURCATION" tab (periods/week per subject per grade) and a "Work Allotment"
        tab (Teacher Name / Subject / Grade Section[/ Periods Per Week] - one row per assignment).
      </p>
      {error && <p className="error-text">{error}</p>}

      <label>
        Planning workbook (.xlsx): <input type="file" accept=".xlsx" onChange={handlePlanningFile} />
      </label>
      {bifurcation && (
        <p>
          Parsed subject bifurcation.
          {bifurcation.warnings.length > 0 && ` ${bifurcation.warnings.length} warning(s): ${bifurcation.warnings.join("; ")}`}
        </p>
      )}
      {workAllotment && (
        <p>
          Parsed {workAllotment.assignments.length} Work Allotment row(s).
          {workAllotment.warnings.length > 0 && ` ${workAllotment.warnings.length} warning(s): ${workAllotment.warnings.join("; ")}`}
        </p>
      )}

      <br />
      <h3>School timing</h3>
      <TimingSetup onChange={handleTimingChange} />
      {timing && <p>{timing.periodsPerDay} periods/day.</p>}

      <br />
      <button onClick={runBuild} disabled={!bifurcation || !workAllotment || !timing}>
        Compute timetable (preview)
      </button>

      {inputs && (
        <>
          {inputs.warnings.length > 0 && (
            <p className="error-text">
              {inputs.warnings.length} warning(s) found (missing Work Allotment coverage, subject-name mismatches,
              ...). You can still save this timetable - after saving, review and fix these grade by grade in View
              Timetable (each grade shows only its own warnings, with an option to ignore one for good).
            </p>
          )}
          <p>
            {inputs.grades.length} grade(s), {inputs.sections.length} section(s) derived from Work Allotment.
          </p>
        </>
      )}

      {result && inputs && inputs.sections.length > 0 && (
        <>
          <p>Computed {result.newSlots.length} period placements (placedCount: {result.placedCount}).</p>
          <label>
            Section:{" "}
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {inputs.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {inputs.grades.find((g) => g.id === s.grade_id)?.name} {s.name}
                </option>
              ))}
            </select>
          </label>
          <TimetableGrid schedule={timing.schedule} getCell={getCell} />

          <h3>Save to an academic year</h3>
          <label>
            Academic year:{" "}
            <select
              value={targetYearId}
              onChange={(e) => {
                setTargetYearId(e.target.value);
                setLabelResolution(null);
              }}
            >
              <option value="">Select</option>
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label} {y.is_active ? "(active)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div style={{ marginTop: 4 }}>
            <label>
              Or give it a label:{" "}
              <input
                type="text"
                value={newYearLabel}
                onChange={(e) => setNewYearLabel(e.target.value)}
                placeholder="e.g. 2026-27 (temp)"
              />
            </label>{" "}
            <button type="button" onClick={handleUseLabel} disabled={!newYearLabel.trim() || resolvingLabel}>
              {resolvingLabel ? "Working..." : "Use this label"}
            </button>
            <p>
              <small>
                A matching existing label overwrites that timetable when you commit below; a new label creates a
                separate one so your current timetable is left untouched.
              </small>
            </p>
            {labelResolution && (
              <p>
                <small>
                  {labelResolution.created
                    ? `Created a new academic year "${labelResolution.label}".`
                    : `Using existing academic year "${labelResolution.label}" - committing below will overwrite its timetable data.`}
                </small>
              </p>
            )}
          </div>

          {targetYearId && (
            <>
              <h4>Save school timing to this year</h4>
              <button type="button" onClick={handleSaveTiming} disabled={!timing || savingTiming}>
                {savingTiming ? "Saving..." : "Save timing"}
              </button>
              {timingSaved && <span> Saved.</span>}
              {classTeacherResult && (
                <div>
                  <p>
                    <small>Class Teacher period: {classTeacherResult.placedCount} slot(s) placed.</small>
                  </p>
                  {classTeacherResult.warnings.map((w, i) => (
                    <p key={i} className="error-text">
                      <small>{w}</small>
                    </p>
                  ))}
                </div>
              )}

              <h4>Commit</h4>
              <p className="error-text">
                This replaces ALL placed periods for the academic year selected above with the computed timetable
                above - including periods you've previously edited by hand.
              </p>
              <label>
                <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />{" "}
                I understand this replaces the selected year's entire placed timetable, including manual edits.
              </label>
              <br />
              {error && (
                <p className="error-text">
                  <strong>Error:</strong> {error}
                </p>
              )}
              <button onClick={handleCommit} disabled={!confirmReplace || committing}>
                {committing ? "Committing..." : "Save timetable data"}
              </button>
              {commitResult && (
                <div>
                  <p>Committed {commitResult.placedCount} periods.</p>
                  {commitResult.warnings.map((w, i) => (
                    <p key={i} className="error-text">
                      {w}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
