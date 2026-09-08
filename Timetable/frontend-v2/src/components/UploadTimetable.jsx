import { useEffect, useMemo, useState } from "react";
import { parseMultiSheetWorkbook } from "../lib/workbookParser";
import { fetchStaffByBranch } from "../lib/staffRoles";
import { findDistinctAssignments, checkAssignmentsAgainstStaffRoles } from "../lib/teachingSectionsSync";
import { listAcademicYears, getOrCreateAcademicYear, fetchTimingConfig, saveTimingConfig } from "../lib/timetableData";
import { commitUploadToAcademicYear, ensureClassTeacherPeriod } from "../lib/uploadCommit";
import { normalizeTeacherName } from "../lib/teacherName";
import TeacherMappingModal from "./TeacherMappingModal";
import TimingSetup from "./TimingSetup";

export default function UploadTimetable({ client, branch, onCommitted }) {
  const [parsed, setParsed] = useState(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState(null);
  const [staffRows, setStaffRows] = useState([]);
  const [unmatched, setUnmatched] = useState(null); // null = not checked yet / all matched
  // normalizeTeacherName(uploaded file's spelling) -> real staff_roles name,
  // from confirmations made in TeacherMappingModal - fed into the actual
  // commit so a confirmed mapping really changes which teacher_id gets
  // assigned, not just staff_roles.teaching_sections (see uploadCommit.js).
  const [teacherNameOverrides, setTeacherNameOverrides] = useState(new Map());
  const [checking, setChecking] = useState(false);
  const [academicYears, setAcademicYears] = useState([]);
  const [targetYearId, setTargetYearId] = useState("");
  const [newYearLabel, setNewYearLabel] = useState("");
  const [resolvingLabel, setResolvingLabel] = useState(false);
  const [labelResolution, setLabelResolution] = useState(null); // {label, created}
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
    // Loaded up front (not just after a file's chosen) so Timing Setup's
    // class-teacher auto-assignment works even before any workbook is
    // uploaded.
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

  // "1A" -> teacher name - the uploaded file never names a teacher for the
  // Class Teacher (period 0) period, so commitUploadToAcademicYear resolves
  // it from staff_roles.class_sections instead.
  const classTeacherNameByGradeSection = useMemo(() => {
    const map = new Map();
    for (const r of staffRows) {
      const cs = r.class_sections;
      const tokens = Array.isArray(cs) ? cs : cs ? [cs] : [];
      for (const tok of tokens) map.set(String(tok).trim().toUpperCase(), r.name);
    }
    return map;
  }, [staffRows]);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setParsed(null);
    setUnmatched(null);
    setTeacherNameOverrides(new Map());
    setCommitResult(null);
    setConfirmReplace(false);
    try {
      const bytes = await file.arrayBuffer();
      const result = parseMultiSheetWorkbook(new Uint8Array(bytes));
      setParsed(result);
      setLabel(file.name.replace(/\.xlsx$/i, ""));

      if (branch && staffRows.length) {
        setChecking(true);
        const assignments = findDistinctAssignments(result.lessons);
        const checked = checkAssignmentsAgainstStaffRoles(assignments, staffRows);
        const notMatching = checked.filter((a) => !a.matched);
        if (notMatching.length) setUnmatched(notMatching);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

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

  async function handleSaveTiming() {
    if (!targetYearId || !timingDraft) return;
    setSavingTiming(true);
    setError(null);
    setClassTeacherResult(null);
    try {
      await saveTimingConfig(client, Number(targetYearId), timingDraft);
      // The class teacher is the same person every day - there's no per-day
      // subject to place, so this generates the Mon-Fri period-0 slots
      // directly from staff_roles.class_sections the moment the option is
      // turned on, rather than waiting on a workbook upload to supply them.
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

  async function handleCommit() {
    if (!parsed || !targetYearId || !confirmReplace) return;
    const year = academicYears.find((y) => String(y.id) === String(targetYearId));
    // eslint-disable-next-line no-alert
    if (!window.confirm(`This replaces ALL placed periods (including previously manually-edited ones) for "${year?.label}" (${branch}). Continue?`)) {
      return;
    }
    setCommitting(true);
    setError(null);
    setCommitResult(null);
    try {
      const result = await commitUploadToAcademicYear(
        client,
        Number(targetYearId),
        parsed,
        teacherOptions,
        classTeacherNameByGradeSection,
        teacherNameOverrides
      );
      setCommitResult(result);
      onCommitted?.(Number(targetYearId));
    } catch (err) {
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <section>
      <h2>Upload a placed timetable</h2>
      <p>Each sheet/tab in the workbook should be one class, named e.g. "Grade 1A" or "1A".</p>
      {!branch && <p className="error-text">Select a branch above to check teacher assignments against staff_roles.</p>}
      {error && <p className="error-text">{error}</p>}

      {branch && (
        <div>
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
                placeholder="e.g. 2026-27 Term 2 (temp)"
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
              <h3>School timing</h3>
              <TimingSetup
                key={targetYearId}
                initialConfig={existingTimingConfig}
                onChange={setTimingDraft}
                collapseSignal={timingSaveCount}
              />
              <button type="button" onClick={handleSaveTiming} disabled={!timingDraft || savingTiming}>
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
            </>
          )}
        </div>
      )}

      <h3>Upload timetable file</h3>
      <input type="file" accept=".xlsx" onChange={handleFile} />
      {checking && <p>Checking teacher assignments against staff_roles...</p>}

      {unmatched && unmatched.length > 0 && (
        <TeacherMappingModal
          unmatched={unmatched}
          staffRows={staffRows}
          onClose={() => setUnmatched(null)}
          onSaved={(confirmedMappings) => {
            setTeacherNameOverrides((prev) => {
              const next = new Map(prev);
              for (const { uploadedName, staffRow } of confirmedMappings) {
                next.set(normalizeTeacherName(uploadedName), staffRow.name);
              }
              return next;
            });
            setUnmatched(null);
          }}
        />
      )}

      {parsed && (
        <>
          <label>
            Timetable label:{" "}
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. 2026-27" />
          </label>

          <p>Parsed {parsed.grades.length} grade(s), {parsed.lessons.length} lesson(s).</p>
          {parsed.warnings.length > 0 && (
            <p className="error-text">
              {parsed.warnings.length} warning(s) found while parsing this file. You can still replace the timetable
              with it - after saving, review and fix these grade by grade in View Timetable (each grade shows only
              its own warnings, with an option to ignore one for good).
            </p>
          )}

          {branch && (
            <div>
              <h3>Commit to an academic year</h3>
              <p className="error-text">
                This replaces ALL placed periods for the academic year selected above with what's in this file -
                including periods you've previously edited by hand. Subjects/periods-per-week are still merged in
                place, not purged.
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
              <button onClick={handleCommit} disabled={!targetYearId || !confirmReplace || committing}>
                {committing ? "Committing..." : "Replace timetable data"}
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
            </div>
          )}
        </>
      )}
    </section>
  );
}
