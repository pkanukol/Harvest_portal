import { useEffect, useMemo, useState } from "react";
import { listAcademicYears, fetchAllPlacements, fetchTimingSchedule } from "../lib/timetableData";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// Lower grades place these as separate subjects (Dance, Music, Yoga, Karate,
// Library, SPA); grade 5+ combines some into one subject
// ("Dance/Music/Drums/Keyboard/Guitar", "Yoga/Karate") - keyword matching
// catches both namings instead of relying on an exact subject-name match.
const RESOURCES = [
  { label: "Library", pattern: /\blibrary\b/i },
  { label: "Dance/Music/Drums/Keyboard/Guitar", pattern: /dance|music|drums|keyboard|guitar/i },
  { label: "SPA", pattern: /\bspa\b/i },
  { label: "Yoga/Karate", pattern: /yoga|karate/i },
];

export default function ResourceTimetableView({ client, branch }) {
  const [academicYears, setAcademicYears] = useState([]);
  const [yearId, setYearId] = useState("");
  const [lessons, setLessons] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [resourceLabel, setResourceLabel] = useState(RESOURCES[0].label);
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
    setError(null);
    setLoading(true);
    Promise.all([fetchAllPlacements(client, yearId, branch), fetchTimingSchedule(client, yearId)])
      .then(([lessonData, sched]) => {
        setLessons(lessonData);
        setSchedule(sched);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [client, yearId]);

  const resource = RESOURCES.find((r) => r.label === resourceLabel);

  const bySlot = useMemo(() => {
    if (!lessons || !resource) return new Map();
    const map = new Map();
    for (const l of lessons) {
      if (!resource.pattern.test(l.subject || "")) continue;
      const key = `${l.day_of_week}|${l.period_number}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(l);
    }
    return map;
  }, [lessons, resource]);

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
          Resource:{" "}
          <select value={resourceLabel} onChange={(e) => setResourceLabel(e.target.value)}>
            {RESOURCES.map((r) => (
              <option key={r.label} value={r.label}>
                {r.label}
              </option>
            ))}
          </select>
        </label>{" "}
        {lessons && <button onClick={() => window.print()}>Print</button>}
      </div>

      {loading && <p>Loading...</p>}
      {error && <p className="error-text">{error}</p>}

      {lessons && (
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
                  const entries = bySlot.get(`${day}|${col.number}`) || [];
                  return (
                    <td key={i}>
                      {entries.map((l, idx) => (
                        <div key={idx} className="cell-pair">
                          {l.grade_name} {l.section_name}
                          <br />
                          <small>{l.teacher_name || ""}</small>
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
