import { useEffect, useMemo, useState } from "react";
import { listAcademicYears, fetchAllLessons, fetchTimingSchedule } from "../lib/timetableData";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function Grid({ schedule, cellFor }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Day</th>
          {schedule.map((col, i) => (
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
            {schedule.map((col, i) => {
              if (col.type !== "period") {
                return (
                  <td key={i} className="break-cell">
                    &mdash;
                  </td>
                );
              }
              const cell = cellFor(day, col.number);
              return <td key={i}>{cell || ""}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function TeacherTimetableView({ client, branch }) {
  const [academicYears, setAcademicYears] = useState([]);
  const [yearId, setYearId] = useState("");
  const [lessons, setLessons] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [teacherName, setTeacherName] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!branch) return;
    setYearId("");
    setLessons(null);
    listAcademicYears(client, branch).then(setAcademicYears).catch((e) => setError(e.message));
  }, [client, branch]);

  useEffect(() => {
    if (!yearId) return;
    setLessons(null);
    setTeacherName("");
    setSubjectName("");
    setError(null);
    setLoading(true);
    Promise.all([fetchAllLessons(client, yearId, branch), fetchTimingSchedule(client, yearId)])
      .then(([lessonData, sched]) => {
        setLessons(lessonData);
        setSchedule(sched);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [client, yearId]);

  const teacherNames = useMemo(() => {
    if (!lessons) return [];
    return [...new Set(lessons.map((l) => l.teacher_name).filter(Boolean))].sort();
  }, [lessons]);

  const subjectNames = useMemo(() => {
    if (!lessons) return [];
    return [...new Set(lessons.map((l) => l.subject).filter(Boolean))].sort();
  }, [lessons]);

  function cellLabel(l) {
    return (
      <>
        {l.subject}
        <br />
        <small>
          {l.grade_name} {l.section_name}
        </small>
      </>
    );
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
        </label>{" "}
        <label>
          Teacher:{" "}
          <select
            value={teacherName}
            onChange={(e) => {
              setTeacherName(e.target.value);
              if (e.target.value) setSubjectName("");
            }}
            disabled={!lessons || !!subjectName}
          >
            <option value="">Select</option>
            {teacherNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Subject:{" "}
          <select
            value={subjectName}
            onChange={(e) => {
              setSubjectName(e.target.value);
              if (e.target.value) setTeacherName("");
            }}
            disabled={!lessons || !!teacherName}
          >
            <option value="">Select</option>
            {subjectNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>{" "}
        {(teacherName || subjectName) && <button onClick={() => window.print()}>Print</button>}
      </div>

      {loading && <p>Loading...</p>}
      {error && <p className="error-text">{error}</p>}

      {teacherName &&
        (() => {
          const forTeacher = lessons.filter((l) => l.teacher_name === teacherName);
          const bySlot = new Map(forTeacher.map((l) => [`${l.day_of_week}|${l.period_number}`, l]));
          return (
            <div>
              <h3>{teacherName}</h3>
              <Grid schedule={schedule} cellFor={(day, period) => {
                const l = bySlot.get(`${day}|${period}`);
                return l ? cellLabel(l) : null;
              }} />
            </div>
          );
        })()}

      {subjectName &&
        (() => {
          const forSubject = lessons.filter((l) => l.subject === subjectName);
          const teachersForSubject = [...new Set(forSubject.map((l) => l.teacher_name).filter(Boolean))].sort();
          if (teachersForSubject.length === 0) {
            return <p>No teacher currently has a placed period for {subjectName}.</p>;
          }
          return teachersForSubject.map((tName) => {
            const bySlot = new Map(
              forSubject.filter((l) => l.teacher_name === tName).map((l) => [`${l.day_of_week}|${l.period_number}`, l])
            );
            return (
              <div key={tName}>
                <h3>{tName}</h3>
                <Grid
                  schedule={schedule}
                  cellFor={(day, period) => {
                    const l = bySlot.get(`${day}|${period}`);
                    return l ? cellLabel(l) : null;
                  }}
                />
              </div>
            );
          });
        })()}
    </section>
  );
}
