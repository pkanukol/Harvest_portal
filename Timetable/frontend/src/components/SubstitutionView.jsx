import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Spinner } from "./TimetableGrid";
import DatePicker from "./DatePicker";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function SubstitutionView({ token, location, activeYear }) {
  const [teachers, setTeachers] = useState(null);
  const [teachersError, setTeachersError] = useState("");
  const [teacherId, setTeacherId] = useState("");

  const [date, setDate] = useState(todayISO);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [assigned, setAssigned] = useState({});
  const [savingKey, setSavingKey] = useState(null);

  const [history, setHistory] = useState(null);
  const [clearingId, setClearingId] = useState(null);

  useEffect(() => {
    api.listTeachers(token, location)
      .then((list) => {
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
        setTeachers(sorted);
        setTeacherId(sorted[0]?.id ? String(sorted[0].id) : "");
      })
      .catch((err) => setTeachersError(err.message));
  }, [token, location]);

  const loadHistory = useCallback(async () => {
    if (!activeYear?.id || !date) return;
    try {
      setHistory(await api.listSubstitutions(token, activeYear.id, date));
    } catch {
      // history is a convenience panel, not critical - stay silent on failure
    }
  }, [token, activeYear?.id, date]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const resolveTeacherId = (name) =>
    teachers?.find((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase())?.id || null;

  const runSuggest = async () => {
    if (!activeYear?.id) return;
    if (!teacherId) { setError("Select a teacher."); return; }
    setError("");
    setLoading(true);
    setResult(null);
    setAssigned({});
    try {
      const res = await api.substitutionSuggest(token, {
        academic_year_id: activeYear.id,
        date,
        absent_teacher_id: Number(teacherId),
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const clearSubstitution = async (id) => {
    if (!window.confirm("Clear this substitution? This can't be undone.")) return;
    setClearingId(id);
    setError("");
    try {
      await api.deleteSubstitution(token, id);
      await loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setClearingId(null);
    }
  };

  const confirmAssignment = async (periodEntry, suggestion) => {
    setSavingKey(periodEntry.period_number);
    setError("");
    try {
      await api.createSubstitution(token, {
        academic_year_id: activeYear.id,
        date,
        day_of_week: result.day_of_week,
        period_number: periodEntry.period_number,
        grade_name: periodEntry.grade_name,
        section_name: periodEntry.section_name,
        subject: periodEntry.subject,
        absent_teacher_name: result.absent_teacher_name,
        absent_teacher_id: Number(teacherId),
        substitute_teacher_name: suggestion.teacher_name,
        substitute_teacher_id: resolveTeacherId(suggestion.teacher_name),
        tier: suggestion.tier,
      });
      setAssigned((prev) => ({ ...prev, [periodEntry.period_number]: suggestion }));
      loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingKey(null);
    }
  };

  if (!activeYear) return <p>No timetable data yet.</p>;

  return (
    <>
      <div className="card">
        <h2>Find a substitute</h2>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          {teachersError ? (
            <div className="status-banner error">{teachersError}</div>
          ) : !teachers ? (
            <p><Spinner /> Loading teachers…</p>
          ) : (
            <label>
              Absent teacher<br />
              <select className="select" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}
          <label>
            Date<br />
            <DatePicker value={date} onChange={setDate} />
          </label>
          <button className="btn" onClick={runSuggest} disabled={loading}>
            {loading ? <><Spinner /> Finding…</> : "Find substitutes"}
          </button>
        </div>
        {error && <div className="status-banner error" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {result && (
        <div className="card">
          <h3>{result.absent_teacher_name} — {result.day_name}, {date}</h3>
          {result.periods.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No periods found for this teacher on this day.</p>
          ) : (
            result.periods.map((p) => {
              const done = assigned[p.period_number];
              return (
                <div key={p.period_number} className="card" style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 600 }}>
                    Period {p.period_number} — {p.grade_name} {p.section_name} — {p.subject}
                  </div>
                  {done ? (
                    <p style={{ marginTop: 8 }}>
                      ✓ Assigned to <strong>{done.teacher_name}</strong>{" "}
                      <button
                        className="btn secondary" style={{ marginLeft: 8 }}
                        onClick={() => setAssigned((prev) => {
                          const next = { ...prev };
                          delete next[p.period_number];
                          return next;
                        })}
                      >
                        Change
                      </button>
                    </p>
                  ) : p.suggestions.length === 0 ? (
                    <p style={{ marginTop: 8, color: "var(--muted)" }}>No free teacher found for this period.</p>
                  ) : (
                    <table className="teacher-table" style={{ marginTop: 8 }}>
                      <thead><tr><th>Teacher</th><th>Why</th><th>Periods today</th><th>Periods/week</th><th></th></tr></thead>
                      <tbody>
                        {p.suggestions.map((s) => (
                          <tr key={s.teacher_name}>
                            <td>{s.teacher_name}</td>
                            <td style={{ color: "var(--muted)", fontSize: 13 }}>{s.tier_label}</td>
                            <td>{s.periods_today}</td>
                            <td>{s.periods_week}</td>
                            <td>
                              <button
                                className="btn secondary"
                                disabled={savingKey === p.period_number}
                                onClick={() => confirmAssignment(p, s)}
                              >
                                {savingKey === p.period_number ? <Spinner /> : "Assign"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="card">
        <h3>Substitution history — {date}</h3>
        {!history ? (
          <p><Spinner /> Loading…</p>
        ) : history.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No substitutions recorded for this date yet.</p>
        ) : (
          <table className="teacher-table">
            <thead><tr><th>Period</th><th>Class</th><th>Subject</th><th>Absent</th><th>Substitute</th><th></th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{h.period_number}</td>
                  <td>{h.grade_name} {h.section_name}</td>
                  <td>{h.subject}</td>
                  <td>{h.absent_teacher_name}</td>
                  <td>{h.substitute_teacher_name}</td>
                  <td>
                    <button
                      className="btn secondary" disabled={clearingId === h.id}
                      onClick={() => clearSubstitution(h.id)}
                    >
                      {clearingId === h.id ? <Spinner /> : "Clear"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
