import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { nextWeekDates, toISO, fmtDate, MONTHS } from "../dateUtils";

// mode: "new" (current/future week, no implementation section) |
// "impl_only" (past-week fill-in, only the Impl A-F + notes section, everything else locked)
export default function POWForm({ token, user, mode, prefillPow, onDone, onBack }) {
  const isImplOnly = mode === "impl_only";
  const { mon, fri } = nextWeekDates();

  const [grade, setGrade] = useState(isImplOnly ? (prefillPow?.grade || "") : "");
  const [month, setMonth] = useState(new Date().toLocaleString("en-US", { month: "long" }));
  const [rows, setRows] = useState([]); // full planner hierarchy rows for subject+grade
  const [discipline, setDiscipline] = useState("");
  const [chapter, setChapter] = useState(isImplOnly ? (prefillPow?.topic || "") : "");
  const [topicPick, setTopicPick] = useState("");
  const [subtopicPick, setSubtopicPick] = useState("");
  const [sessionChecks, setSessionChecks] = useState({});

  const [cw, setCw] = useState("");
  const [binder, setBinder] = useState("");
  const [activity, setActivity] = useState("");
  const [homework, setHomework] = useState("");
  const [cctYes, setCctYes] = useState(false);
  const [cctText, setCctText] = useState("");
  const [cctDashboardUpdated, setCctDashboardUpdated] = useState(false);
  const [tbsMom, setTbsMom] = useState("");
  const [correctionDone, setCorrectionDone] = useState("");
  const [instructions, setInstructions] = useState("");
  const [teacherRemarks, setTeacherRemarks] = useState("");
  const [implA, setImplA] = useState(prefillPow?.impl_a || "");
  const [implB, setImplB] = useState(prefillPow?.impl_b || "");
  const [implC, setImplC] = useState(prefillPow?.impl_c || "");
  const [implD, setImplD] = useState(prefillPow?.impl_d || "");
  const [implE, setImplE] = useState(prefillPow?.impl_e || "");
  const [implF, setImplF] = useState(prefillPow?.impl_f || "");
  const [finalSave, setFinalSave] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!grade) { setRows([]); return; }
    api.getPlannerTopics(token, user.subject, grade)
      .then(setRows)
      .catch((err) => setError(err.message));
  }, [token, user.subject, grade]);

  // Month -> Discipline -> Chapter Name -> Topic -> Sub Topic, each level
  // deduped and scoped by every level chosen above it.
  const disciplinesThisMonth = useMemo(() => {
    const seen = new Set();
    rows.forEach((r) => { if (r.month === month && r.discipline) seen.add(r.discipline); });
    return [...seen];
  }, [rows, month]);

  const chaptersForDiscipline = useMemo(() => {
    const seen = new Set();
    const list = [];
    rows.forEach((r) => {
      if (r.month !== month || r.discipline !== discipline) return;
      if (!seen.has(r.chapter_name)) { seen.add(r.chapter_name); list.push(r); }
    });
    return list;
  }, [rows, month, discipline]);

  // Topic is skipped entirely when blank, or when it's just a restatement of
  // the Chapter Name — some planner rows carry no real Topic-level detail.
  const topicsForChapter = useMemo(() => {
    const seen = new Set();
    const list = [];
    rows.forEach((r) => {
      if (r.month !== month || r.discipline !== discipline || r.chapter_name !== chapter || !r.topic) return;
      if (r.topic.trim().toLowerCase() === chapter.trim().toLowerCase()) return;
      if (!seen.has(r.topic)) { seen.add(r.topic); list.push(r.topic); }
    });
    return list;
  }, [rows, month, discipline, chapter]);

  const hasRealTopics = topicsForChapter.length > 0;

  const subtopicsForTopic = useMemo(() => {
    const seen = new Set();
    const list = [];
    rows.forEach((r) => {
      if (r.month !== month || r.discipline !== discipline || r.chapter_name !== chapter || !r.subtopic) return;
      if (hasRealTopics && r.topic !== topicPick) return;
      if (!seen.has(r.subtopic)) { seen.add(r.subtopic); list.push(r.subtopic); }
    });
    return list;
  }, [rows, month, discipline, chapter, topicPick, hasRealTopics]);

  // Auto-select subtopic when there's only one option for the chosen topic.
  useEffect(() => {
    if (subtopicsForTopic.length === 1) setSubtopicPick(subtopicsForTopic[0]);
    else if (!subtopicsForTopic.includes(subtopicPick)) setSubtopicPick("");
  }, [subtopicsForTopic]);

  const chapterSessions = useMemo(() => {
    const row = chaptersForDiscipline.find((r) => r.chapter_name === chapter);
    return row ? row.sessions : 0;
  }, [chaptersForDiscipline, chapter]);

  function onMonthChange(value) {
    setMonth(value);
    setDiscipline(""); setChapter(""); setTopicPick(""); setSubtopicPick(""); setSessionChecks({});
  }
  function onDisciplineChange(value) {
    setDiscipline(value);
    setChapter(""); setTopicPick(""); setSubtopicPick(""); setSessionChecks({});
  }
  function onChapterChange(value) {
    setChapter(value);
    setTopicPick(""); setSubtopicPick(""); setSessionChecks({});
  }
  function onTopicPickChange(value) {
    setTopicPick(value);
    setSubtopicPick("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    if (isImplOnly) {
      try {
        await api.updatePowImplementation(token, prefillPow.id, {
          impl_a: implA, impl_b: implB, impl_c: implC, impl_d: implD, impl_e: implE, impl_f: implF,
          tbs_mom: tbsMom, correction_done: correctionDone, instructions, teacher_remarks: teacherRemarks,
          final_save: finalSave,
        });
        onDone();
      } catch (err) {
        setError(err.message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!grade || !discipline || !chapter || (hasRealTopics && !topicPick)) {
      setError(`Please select a grade, discipline, chapter${hasRealTopics ? " and topic" : ""} before submitting.`);
      setSubmitting(false);
      return;
    }

    const lpSessionNum = Object.keys(sessionChecks).filter((k) => sessionChecks[k]).join(", ");

    try {
      await api.createPow(token, {
        subject: user.subject,
        grade,
        week_start: toISO(mon),
        week_end: toISO(fri),
        topic: chapter,
        subtopic: [hasRealTopics ? topicPick : "", subtopicPick].filter(Boolean).join(" — "),
        lp_session_num: lpSessionNum,
        cw, binder, activity, homework,
        cct_topic_yn: cctYes ? "Yes" : "No",
        cct_topic_text: cctText,
        cct_dashboard_updated: cctDashboardUpdated,
        correction_done: correctionDone,
        instructions,
        teacher_remarks: teacherRemarks,
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button className="back-link" onClick={onBack}>← Back</button>
      <div className="section-title">
        {isImplOnly ? "Add Implementation — Previous Week" : "New Plan of Work"}
      </div>

      {isImplOnly && (
        <div className="hint-text">
          Week: {fmtDate(prefillPow.week_start)} – {fmtDate(prefillPow.week_end)}. Fill in how each section progressed last week.
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        {!isImplOnly && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Subject</label>
                <input className="form-control readonly-field" value={user.subject} readOnly />
              </div>
              <div className="form-group">
                <label className="form-label">Grade</label>
                <input className="form-control" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="e.g. 5" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Week</label>
                <input className="form-control readonly-field" value={`${fmtDate(toISO(mon))} – ${fmtDate(toISO(fri))}`} readOnly />
              </div>
              <div className="form-group">
                <label className="form-label">Month</label>
                <select className="form-control" value={month} onChange={(e) => onMonthChange(e.target.value)}>
                  {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Discipline</label>
              <select className="form-control" value={discipline} onChange={(e) => onDisciplineChange(e.target.value)}>
                <option value="">— select discipline —</option>
                {disciplinesThisMonth.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              {grade && disciplinesThisMonth.length === 0 && (
                <div className="hint-text">No planner data for {user.subject} · Grade {grade} · {month} yet.</div>
              )}
            </div>

            {discipline && (
              <div className="form-group">
                <label className="form-label">Chapter Name</label>
                <select className="form-control" value={chapter} onChange={(e) => onChapterChange(e.target.value)}>
                  <option value="">— select chapter —</option>
                  {chaptersForDiscipline.map((r) => <option key={r.chapter_name} value={r.chapter_name}>{r.chapter_name}</option>)}
                </select>
              </div>
            )}

            {chapter && hasRealTopics && (
              <div className="form-group">
                <label className="form-label">Topic</label>
                <select className="form-control" value={topicPick} onChange={(e) => onTopicPickChange(e.target.value)}>
                  <option value="">— select topic —</option>
                  {topicsForChapter.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            {chapter && (!hasRealTopics || topicPick) && subtopicsForTopic.length > 0 && (
              <div className="form-group">
                <label className="form-label">Sub Topic</label>
                <select className="form-control" value={subtopicPick} onChange={(e) => setSubtopicPick(e.target.value)}>
                  <option value="">— select sub topic —</option>
                  {subtopicsForTopic.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}

            {chapter && (
              <div className="form-group">
                <label className="form-label">Total Sessions (Chapter)</label>
                <input className="form-control readonly-field" value={chapterSessions} readOnly />
              </div>
            )}

            {chapter && chapterSessions > 0 && (
              <div className="form-group">
                <label className="form-label">Sessions planned for this week</label>
                <div className="checkbox-list">
                  {Array.from({ length: chapterSessions }, (_, i) => i + 1).map((s) => (
                    <label className="checkbox-item" key={s}>
                      <input
                        type="checkbox"
                        checked={!!sessionChecks[s]}
                        onChange={(e) => setSessionChecks({ ...sessionChecks, [s]: e.target.checked })}
                      />
                      Session {s}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Class Work</label>
              <textarea className="form-control" value={cw} onChange={(e) => setCw(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Binder</label>
              <textarea className="form-control" value={binder} onChange={(e) => setBinder(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Activity</label>
              <textarea className="form-control" value={activity} onChange={(e) => setActivity(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Homework</label>
              <textarea className="form-control" value={homework} onChange={(e) => setHomework(e.target.value)} />
            </div>

            <div className="form-group">
              <label className="form-label">CCT Topic this week?</label>
              <div className="checkbox-list" style={{ flexDirection: "row", gap: 20 }}>
                <label className="checkbox-item">
                  <input type="radio" name="cctYn" checked={cctYes} onChange={() => setCctYes(true)} />
                  Yes
                </label>
                <label className="checkbox-item">
                  <input type="radio" name="cctYn" checked={!cctYes} onChange={() => { setCctYes(false); setCctText(""); setCctDashboardUpdated(false); }} />
                  No
                </label>
              </div>
              {cctYes && (
                <div className="form-row" style={{ marginTop: 8 }}>
                  <div className="form-group">
                    <label className="form-label">CCT Topic</label>
                    <input className="form-control" placeholder="CCT topic" value={cctText} onChange={(e) => setCctText(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">CCT dashboard updated</label>
                    <div className="checkbox-list" style={{ flexDirection: "row", gap: 20 }}>
                      <label className="checkbox-item">
                        <input type="radio" name="cctDash" checked={cctDashboardUpdated} onChange={() => setCctDashboardUpdated(true)} />
                        Yes
                      </label>
                      <label className="checkbox-item">
                        <input type="radio" name="cctDash" checked={!cctDashboardUpdated} onChange={() => setCctDashboardUpdated(false)} />
                        No
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </>
        )}

        {isImplOnly && (
          <>
            <div className="section-title">Implementation</div>
            <div className="hint-text">
              One field per class section for this grade — different section teachers each fill in their own; this card can be saved multiple times as each section's teacher adds theirs.
            </div>
            {[
              [["A", implA, setImplA], ["B", implB, setImplB]],
              [["C", implC, setImplC], ["D", implD, setImplD]],
              [["E", implE, setImplE], ["F", implF, setImplF]],
            ].map((pair, i) => (
              <div className="form-row" key={i}>
                {pair.map(([label, val, setter]) => (
                  <div className="form-group" key={label}>
                    <label className="form-label">Grade {prefillPow?.grade} — Section {label}</label>
                    <textarea className="form-control" value={val} onChange={(e) => setter(e.target.value)} />
                  </div>
                ))}
              </div>
            ))}

            <div className="form-group">
              <label className="form-label">Correction Done</label>
              <input className="form-control" value={correctionDone} onChange={(e) => setCorrectionDone(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Instructions</label>
              <textarea className="form-control" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Teacher Remarks</label>
              <textarea className="form-control" value={teacherRemarks} onChange={(e) => setTeacherRemarks(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">TBS MOM</label>
              <textarea className="form-control" value={tbsMom} onChange={(e) => setTbsMom(e.target.value)} />
            </div>
            <label className="checkbox-item">
              <input type="checkbox" checked={finalSave} onChange={(e) => setFinalSave(e.target.checked)} />
              Confirm Final Save (locks this POW's implementation)
            </label>
          </>
        )}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {isImplOnly ? (finalSave ? "Save Final" : "Save as Draft") : "Submit POW"}
          </button>
        </div>
      </form>
    </div>
  );
}
