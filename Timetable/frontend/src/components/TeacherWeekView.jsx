import { useEffect, useState } from "react";
import { api } from "../api";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export default function TeacherWeekView({ token, academicYearId }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getMyWeek(token, academicYearId).then(setEntries).catch((err) => setError(err.message));
  }, [token, academicYearId]);

  if (error) return <div className="status-banner error">{error}</div>;
  if (!entries) return <p>Loading…</p>;

  const periods = [...new Set(entries.map((e) => e.period_number))].sort((a, b) => a - b);
  const byCell = {};
  entries.forEach((e) => {
    const key = `${e.day_of_week}-${e.period_number}`;
    byCell[key] = byCell[key] || [];
    byCell[key].push(e);
  });

  return (
    <div className="card">
      <h2>My week</h2>
      <table className="grid-table">
        <thead>
          <tr><th>Period</th>{DAYS.map((d) => <th key={d}>{d}</th>)}</tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p}>
              <td>Period {p}</td>
              {DAYS.map((_, dayIdx) => {
                const cell = byCell[`${dayIdx}-${p}`] || [];
                return (
                  <td key={dayIdx} className="slot-cell">
                    {cell.length === 0 ? "—" : cell.map((e, i) => (
                      <div className="slot-occupant" key={i}>
                        <div className="subj">{e.component_label || e.subject}</div>
                        <div className="teacher">{e.grade_name} {e.section_name}</div>
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
