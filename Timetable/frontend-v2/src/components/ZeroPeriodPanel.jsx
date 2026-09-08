import { useEffect, useMemo, useState } from "react";
import { listAcademicYears, fetchTimingSchedule } from "../lib/timetableData";
import { computeZeroPeriodSchedule, ZERO_PERIOD_TYPES } from "../lib/zeroPeriod";

const CREATE_TABLE_SQL = `create table if not exists zero_period_schedules (
  id bigint generated always as identity primary key,
  academic_year_id bigint not null references academic_years(id),
  zero_type text not null check (zero_type in ('morning','noon','last')),
  grade_ids bigint[] not null,
  start_date date not null,
  end_date date not null,
  schedule jsonb not null,
  created_at timestamptz not null default now()
);`;

function ScheduleStrip({ schedule }) {
  return (
    <table>
      <tbody>
        <tr>
          {schedule.map((col, i) => (
            <th key={i} className={col.type === "zero" ? "zero-cell" : undefined}>
              {col.type === "period" ? `P${col.number}` : col.label}
            </th>
          ))}
        </tr>
        <tr>
          {schedule.map((col, i) => (
            <td
              key={i}
              className={col.type === "zero" ? "zero-cell" : col.type === "break" ? "break-cell" : undefined}
            >
              {col.start}&ndash;{col.end}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

export default function ZeroPeriodPanel({ client, branch, canEdit }) {
  const [academicYears, setAcademicYears] = useState([]);
  const [yearId, setYearId] = useState("");
  const [grades, setGrades] = useState([]);
  const [baseSchedule, setBaseSchedule] = useState([]);
  const [zeroType, setZeroType] = useState(ZERO_PERIOD_TYPES[0].value);
  const [selectedGradeIds, setSelectedGradeIds] = useState(new Set());
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saved, setSaved] = useState([]);
  const [tableMissing, setTableMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!branch) return;
    setYearId("");
    listAcademicYears(client, branch).then(setAcademicYears).catch((e) => setError(e.message));
  }, [client, branch]);

  function loadSaved(academicYearId) {
    return client
      .from("tt_zero_period_schedules")
      .select("*")
      .eq("academic_year_id", academicYearId)
      .order("start_date", { ascending: false })
      .then(({ data, error: err }) => {
        if (err) {
          if (err.code === "42P01" || /schema cache/i.test(err.message || "")) {
            setTableMissing(true);
            setSaved([]);
          } else {
            setError(err.message);
          }
        } else {
          setTableMissing(false);
          setSaved(data);
        }
      });
  }

  useEffect(() => {
    if (!yearId) return;
    setError(null);
    setSelectedGradeIds(new Set());
    Promise.all([
      client.from("tt_grades").select("id, name, order_index").eq("academic_year_id", yearId).order("order_index"),
      fetchTimingSchedule(client, yearId),
    ])
      .then(([gradesRes, schedule]) => {
        if (gradesRes.error) throw gradesRes.error;
        setGrades(gradesRes.data);
        setBaseSchedule(schedule);
      })
      .catch((e) => setError(e.message));
    loadSaved(yearId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, yearId]);

  const preview = useMemo(() => {
    if (!baseSchedule.length) return [];
    return computeZeroPeriodSchedule(baseSchedule, zeroType);
  }, [baseSchedule, zeroType]);

  function toggleGrade(id) {
    setSelectedGradeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (!yearId || selectedGradeIds.size === 0 || !startDate || !endDate) return;
    if (endDate < startDate) {
      setError("End date must be on or after the start date.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: insError } = await client.from("tt_zero_period_schedules").insert({
        academic_year_id: Number(yearId),
        zero_type: zeroType,
        grade_ids: [...selectedGradeIds],
        start_date: startDate,
        end_date: endDate,
        schedule: preview,
      });
      if (insError) throw insError;
      setSelectedGradeIds(new Set());
      setStartDate("");
      setEndDate("");
      await loadSaved(yearId);
    } catch (e) {
      if (e.code === "42P01" || /schema cache/i.test(e.message || "")) {
        setTableMissing(true);
      } else {
        setError(e.message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    setError(null);
    try {
      const { error: delError } = await client.from("tt_zero_period_schedules").delete().eq("id", id);
      if (delError) throw delError;
      await loadSaved(yearId);
    } catch (e) {
      setError(e.message);
    }
  }

  const gradeNameById = new Map(grades.map((g) => [g.id, g.name]));

  if (!branch) return <p>Select a branch above.</p>;

  return (
    <section>
      <h2>Zero period schedule</h2>
      <p>
        Plan a temporary bell-schedule change for a date range and a set of grades - it does not touch the regular
        recurring timetable or its subject/teacher placements, only the reference bell times shown here.
      </p>

      {tableMissing && (
        <div className="no-print">
          <p className="error-text">
            This feature needs a new table that doesn't exist yet. Run this once in the Supabase SQL editor for
            Project A, then reload:
          </p>
          <pre style={{ background: "var(--bg-soft)", padding: "0.75rem", borderRadius: "var(--radius-sm)", overflow: "auto" }}>
            {CREATE_TABLE_SQL}
          </pre>
        </div>
      )}

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

        {error && <p className="error-text">{error}</p>}

        {yearId && (
          <>
            <div>
              <label>
                Zero period:{" "}
                <select value={zeroType} onChange={(e) => setZeroType(e.target.value)}>
                  {ZERO_PERIOD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <strong>Grades:</strong>{" "}
              {grades.map((g) => (
                <label key={g.id} style={{ marginRight: "0.75rem" }}>
                  <input
                    type="checkbox"
                    checked={selectedGradeIds.has(g.id)}
                    onChange={() => toggleGrade(g.id)}
                  />{" "}
                  {g.name}
                </label>
              ))}
            </div>

            <div>
              <label>
                From:{" "}
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>{" "}
              <label>
                To: <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </div>

            <h3>Preview</h3>
            {preview.length > 0 && <ScheduleStrip schedule={preview} />}

            <div>
              {canEdit && (
                <button
                  onClick={handleSave}
                  disabled={saving || selectedGradeIds.size === 0 || !startDate || !endDate}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {yearId && saved.length > 0 && (
        <div>
          <h3>Saved zero period schedules</h3>
          {saved.map((s) => (
            <div key={s.id} style={{ marginBottom: "1rem" }}>
              <p>
                <strong>{ZERO_PERIOD_TYPES.find((t) => t.value === s.zero_type)?.label || s.zero_type}</strong> for{" "}
                {s.grade_ids.map((id) => gradeNameById.get(id) || id).join(", ")} &mdash; {s.start_date} to{" "}
                {s.end_date}{" "}
                <span className="no-print">
                  <button onClick={() => window.print()}>Print</button>{" "}
                  {canEdit && <button onClick={() => handleDelete(s.id)}>Delete</button>}
                </span>
              </p>
              <ScheduleStrip schedule={s.schedule} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
