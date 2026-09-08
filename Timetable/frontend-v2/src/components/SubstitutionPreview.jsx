import { useEffect, useState } from "react";
import { listAcademicYears, fetchAllLessons, listActiveTeacherNames } from "../lib/timetableData";
import { computeSuggestions } from "../lib/substitution";

const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DUTY_TYPES = ["Dispersal Duty", "Lunch Time Duty", "Assembly Duty", "Other"];

// "YYYY-MM-DD" -> 0 (Sun) .. 6 (Sat), parsed as a calendar date rather than
// via the local-timezone Date constructor (which can roll the date over near
// midnight depending on the browser's offset).
function weekdayFromDateString(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// "YYYY-MM-DD" -> 0 (Mon) .. 4 (Fri), null for a weekend date - matches the
// Mon=0..Fri=4 convention lessons.day_of_week already uses throughout this
// app (DAY_LABELS, fetchAllLessons, ...), unlike weekdayFromDateString above
// (0=Sun..6=Sat, only used for the duty log's informational day_of_week).
function mondayIndexFromDateString(dateStr) {
  const sunToSat = weekdayFromDateString(dateStr);
  return sunToSat >= 1 && sunToSat <= 5 ? sunToSat - 1 : null;
}

function todayDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function SubstitutionPreview({ client, branch, canEdit }) {
  const [academicYears, setAcademicYears] = useState([]);
  const [yearId, setYearId] = useState("");
  const [teacherNames, setTeacherNames] = useState([]);
  const [absentTeacher, setAbsentTeacher] = useState("");
  const [subDate, setSubDate] = useState(todayDateString);
  const [periods, setPeriods] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [revealedLowerGrades, setRevealedLowerGrades] = useState({}); // period_number -> count (0-3)
  const [activeCategories, setActiveCategories] = useState({}); // period_number -> Set of "spa"|"pe"|"other"
  const [recordedSubs, setRecordedSubs] = useState([]);
  const [selecting, setSelecting] = useState(null); // period_number currently saving
  const day = mondayIndexFromDateString(subDate);

  const [dutyDate, setDutyDate] = useState(todayDateString);
  const [dutyType, setDutyType] = useState(DUTY_TYPES[0]);
  const [dutyCustomText, setDutyCustomText] = useState("");
  const [dutyAbsentTeacher, setDutyAbsentTeacher] = useState("");
  const [dutySubTeacher, setDutySubTeacher] = useState("");
  const [dutyList, setDutyList] = useState([]);
  const [dutyLoading, setDutyLoading] = useState(false);
  const [dutySaving, setDutySaving] = useState(false);
  const [dutyError, setDutyError] = useState(null);

  useEffect(() => {
    if (!branch) return;
    setYearId("");
    setPeriods(null);
    Promise.all([listAcademicYears(client, branch), listActiveTeacherNames(client, branch)])
      .then(([years, names]) => {
        setAcademicYears(years);
        setTeacherNames(names.sort());
      })
      .catch((e) => setError(e.message));
  }, [client, branch]);

  function loadDuties() {
    if (!yearId || !dutyDate) {
      setDutyList([]);
      return Promise.resolve();
    }
    setDutyLoading(true);
    return client
      .from("tt_substitutions")
      .select("*")
      .eq("academic_year_id", Number(yearId))
      .eq("date", dutyDate)
      .eq("grade_name", "")
      .order("id", { ascending: false })
      .then(({ data, error: dutyErr }) => {
        if (dutyErr) throw dutyErr;
        setDutyList(data);
      })
      .catch((e) => setDutyError(e.message))
      .finally(() => setDutyLoading(false));
  }

  useEffect(() => {
    loadDuties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, yearId, dutyDate]);

  async function handleSaveDuty() {
    const dutyLabel = dutyType === "Other" ? dutyCustomText.trim() : dutyType;
    if (!yearId || !dutyDate || !dutyLabel || !dutyAbsentTeacher || !dutySubTeacher) return;
    setDutySaving(true);
    setDutyError(null);
    try {
      const { error: insError } = await client.from("tt_substitutions").insert({
        academic_year_id: Number(yearId),
        date: dutyDate,
        day_of_week: weekdayFromDateString(dutyDate),
        period_number: 0,
        grade_name: "",
        section_name: "",
        subject: dutyLabel,
        absent_teacher_name: dutyAbsentTeacher,
        substitute_teacher_name: dutySubTeacher,
      });
      if (insError) throw insError;
      setDutyAbsentTeacher("");
      setDutySubTeacher("");
      setDutyCustomText("");
      await loadDuties();
    } catch (e) {
      setDutyError(e.message);
    } finally {
      setDutySaving(false);
    }
  }

  async function handleDeleteDuty(id) {
    setDutyError(null);
    try {
      const { error: delError } = await client.from("tt_substitutions").delete().eq("id", id);
      if (delError) throw delError;
      await loadDuties();
    } catch (e) {
      setDutyError(e.message);
    }
  }

  function loadRecordedSubs() {
    if (!yearId || !subDate) {
      setRecordedSubs([]);
      return Promise.resolve();
    }
    return client
      .from("tt_substitutions")
      .select("*")
      .eq("academic_year_id", Number(yearId))
      .eq("date", subDate)
      .neq("grade_name", "") // excludes duty-log rows, which use grade_name ""
      .then(({ data, error: subErr }) => {
        if (subErr) throw subErr;
        setRecordedSubs(data);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    loadRecordedSubs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, yearId, subDate]);

  function runSuggest() {
    if (!yearId || !absentTeacher || day === null) return;
    setLoading(true);
    setError(null);
    setRevealedLowerGrades({});
    setActiveCategories({});
    fetchAllLessons(client, yearId, branch)
      .then((lessons) => {
        const result = computeSuggestions(lessons, absentTeacher, day, teacherNames);
        setPeriods(result);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function recordedFor(p) {
    return recordedSubs.find(
      (s) =>
        s.period_number === p.period_number &&
        s.grade_name === p.grade_name &&
        s.section_name === p.section_name
    );
  }

  async function handleSelectSubstitute(p, teacherName) {
    setSelecting(p.period_number);
    setError(null);
    try {
      const existing = recordedFor(p);
      if (existing) {
        const { error: updError } = await client
          .from("tt_substitutions")
          .update({ substitute_teacher_name: teacherName })
          .eq("id", existing.id);
        if (updError) throw updError;
      } else {
        const { error: insError } = await client.from("tt_substitutions").insert({
          academic_year_id: Number(yearId),
          date: subDate,
          day_of_week: day,
          period_number: p.period_number,
          grade_name: p.grade_name,
          section_name: p.section_name,
          subject: p.subject,
          absent_teacher_name: absentTeacher,
          substitute_teacher_name: teacherName,
        });
        if (insError) throw insError;
      }
      await loadRecordedSubs();
    } catch (e) {
      setError(e.message);
    } finally {
      setSelecting(null);
    }
  }

  async function handleRemoveSubstitute(id) {
    setError(null);
    try {
      const { error: delError } = await client.from("tt_substitutions").delete().eq("id", id);
      if (delError) throw delError;
      await loadRecordedSubs();
    } catch (e) {
      setError(e.message);
    }
  }

  // Each category button is an independent on/off toggle - showing or
  // hiding one (SPA/PE/other) never affects any other category, including
  // the always-shown "same grade" lists.
  function toggleCategory(periodNumber, key) {
    setActiveCategories((prev) => {
      const current = new Set(prev[periodNumber] || []);
      if (current.has(key)) current.delete(key);
      else current.add(key);
      return { ...prev, [periodNumber]: current };
    });
  }

  function CandidateList({ p, label, candidates }) {
    if (!candidates.length) return null;
    return (
      <div style={{ marginBottom: "0.5rem" }}>
        <strong>{label}</strong>
        <table>
          <thead>
            <tr>
              <th>Teacher</th>
              <th>Periods today</th>
              <th>Periods this week</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((s) => (
              <tr key={s.teacher_name}>
                <td>{s.teacher_name}</td>
                <td>{s.periods_today}</td>
                <td>{s.periods_week}</td>
                <td>
                  <button
                    onClick={() => handleSelectSubstitute(p, s.teacher_name)}
                    disabled={!canEdit}
                    disabled={selecting === p.period_number}
                  >
                    Select
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!branch) return null;

  return (
    <section>
      <h2>Substitution suggestions</h2>
      {error && <p className="error-text">{error}</p>}

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
      </label>{" "}
      <label>
        Absent teacher:{" "}
        <select value={absentTeacher} onChange={(e) => setAbsentTeacher(e.target.value)}>
          <option value="">Select</option>
          {teacherNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>{" "}
      <label>
        Date: <input type="date" value={subDate} onChange={(e) => setSubDate(e.target.value)} />
      </label>{" "}
      <button onClick={runSuggest} disabled={!yearId || !absentTeacher || day === null}>
        Find substitutes
      </button>
      {day === null && <p className="error-text">Selected date falls on a weekend.</p>}

      {loading && <p>Loading...</p>}

      {periods && (
        <>
          {periods.length === 0 && <p>{absentTeacher} has no periods on {DAY_LABELS[day]}.</p>}
          {periods.map((p) => {
            const recorded = recordedFor(p);
            const lowerCount = revealedLowerGrades[p.period_number] || 0;
            const canRevealMoreGrades = lowerCount < p.lowerGradeTiers.length;
            const active = activeCategories[p.period_number] || new Set();
            return (
              <div key={p.period_number} style={{ marginTop: "1rem" }}>
                <h3>
                  Period {p.period_number}: {p.grade_name}
                  {p.section_name} &mdash; {p.subject}
                </h3>
                {recorded && (
                  <p>
                    Covered by <strong>{recorded.substitute_teacher_name}</strong>{" "}
                    {canEdit && (
                      <button onClick={() => handleRemoveSubstitute(recorded.id)}>Remove</button>
                    )}
                  </p>
                )}

                <CandidateList p={p} label="Same subject, same grade" candidates={p.sameGradeSameSubject} />
                <CandidateList p={p} label="Same grade, other subject" candidates={p.sameGradeOtherSubject} />

                {lowerCount > 0 &&
                  p.lowerGradeTiers.slice(0, lowerCount).map((tier, i) => (
                    <CandidateList key={i} p={p} label={`Teaches ${tier.gradeName}`} candidates={tier.candidates} />
                  ))}

                <div className="no-print">
                  {canRevealMoreGrades && (
                    <button
                      className="secondary"
                      onClick={() => setRevealedLowerGrades((prev) => ({ ...prev, [p.period_number]: lowerCount + 1 }))}
                    >
                      More: next grade down
                    </button>
                  )}{" "}
                  <button className="secondary" onClick={() => toggleCategory(p.period_number, "spa")}>
                    {active.has("spa") ? "Hide" : "Show"} SPA teachers
                  </button>{" "}
                  <button className="secondary" onClick={() => toggleCategory(p.period_number, "pe")}>
                    {active.has("pe") ? "Hide" : "Show"} PE teachers
                  </button>{" "}
                  <button className="secondary" onClick={() => toggleCategory(p.period_number, "other")}>
                    {active.has("other") ? "Hide" : "Show"} other teachers
                  </button>
                </div>

                {active.has("spa") && <CandidateList p={p} label="SPA teachers" candidates={p.spaTeachers} />}
                {active.has("pe") && <CandidateList p={p} label="PE teachers" candidates={p.peTeachers} />}
                {active.has("other") && <CandidateList p={p} label="Other teachers" candidates={p.otherTeachers} />}
              </div>
            );
          })}
        </>
      )}

      <hr />
      <h2>Duty substitutions</h2>
      <p>Log coverage for non-class duties &mdash; Dispersal, Lunch time duty, Assembly duty, or anything else.</p>
      {!yearId && <p className="error-text">Select an academic year above first.</p>}
      {dutyError && <p className="error-text">{dutyError}</p>}

      <label>
        Date:{" "}
        <input type="date" value={dutyDate} onChange={(e) => setDutyDate(e.target.value)} />
      </label>{" "}
      <label>
        Duty:{" "}
        <select value={dutyType} onChange={(e) => setDutyType(e.target.value)}>
          {DUTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>{" "}
      {dutyType === "Other" && (
        <input
          type="text"
          placeholder="Describe the duty"
          value={dutyCustomText}
          onChange={(e) => setDutyCustomText(e.target.value)}
        />
      )}
      <br />
      <label>
        Absent teacher:{" "}
        <select value={dutyAbsentTeacher} onChange={(e) => setDutyAbsentTeacher(e.target.value)}>
          <option value="">Select</option>
          {teacherNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>{" "}
      <label>
        Covered by:{" "}
        <select value={dutySubTeacher} onChange={(e) => setDutySubTeacher(e.target.value)}>
          <option value="">Select</option>
          {teacherNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>{" "}
      {canEdit && (
        <button
          onClick={handleSaveDuty}
          disabled={
            !yearId ||
            !dutyDate ||
            !dutyAbsentTeacher ||
            !dutySubTeacher ||
            (dutyType === "Other" && !dutyCustomText.trim()) ||
            dutySaving
          }
        >
          {dutySaving ? "Saving..." : "Save"}
        </button>
      )}

      {dutyLoading && <p>Loading...</p>}
      {!dutyLoading && yearId && dutyDate && dutyList.length === 0 && <p>No duty substitutions logged for this date yet.</p>}
      {dutyList.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Duty</th>
              <th>Absent</th>
              <th>Covered by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {dutyList.map((d) => (
              <tr key={d.id}>
                <td>{d.subject}</td>
                <td>{d.absent_teacher_name}</td>
                <td>{d.substitute_teacher_name}</td>
                <td>
                  {canEdit && <button onClick={() => handleDeleteDuty(d.id)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
