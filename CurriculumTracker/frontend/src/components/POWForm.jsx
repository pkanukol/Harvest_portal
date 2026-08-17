import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { nextWeekDates, toISO, fmtDate, MONTHS } from "../dateUtils";

// mode: "new" (current/future week, no implementation section) |
// "impl_only" (past-week fill-in, only the Impl A-F + notes section, everything else locked)
export default function POWForm({ token, user, mode, prefillPow, onDone, onBack }) {
  const isImplOnly = mode === "impl_only";
  const { mon, fri } = nextWeekDates();

  // users.subject holds one subject, but staff_roles knows some teachers take
  // two (Science and English, Maths and Computer Science) — so the subject is
  // a picker for them and a locked field for everyone else.
  const mySubjects = (user.subjects && user.subjects.length ? user.subjects : [user.subject]).filter(Boolean);
  const [subject, setSubject] = useState(isImplOnly ? (prefillPow?.subject || user.subject) : (user.subject || mySubjects[0] || ""));
  const hasManySubjects = mySubjects.length > 1;

  const [grade, setGrade] = useState(isImplOnly ? (prefillPow?.grade || "") : "");
  const [month, setMonth] = useState(new Date().toLocaleString("en-US", { month: "long" }));
  const [rows, setRows] = useState([]); // full planner hierarchy rows for subject+grade
  const [stream, setStream] = useState("");
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
    api.getPlannerTopics(token, subject, grade)
      .then(setRows)
      .catch((err) => setError(err.message));
  }, [token, subject, grade]);

  // Some subjects are taught as separate streams that the portal has no field
  // for — Biology, Physics and Chemistry all sit under a Science profile — so
  // the planner comes back carrying more than one subject. When it does, the
  // teacher picks the stream first and everything below is scoped to it. For
  // every other subject there's exactly one, and the selector never appears.
  const streams = useMemo(() => {
    const seen = [];
    rows.forEach((r) => { if (r.subject && !seen.includes(r.subject)) seen.push(r.subject); });
    return seen;
  }, [rows]);

  const hasStreams = streams.length > 1;

  useEffect(() => {
    if (!hasStreams) { setStream(""); return; }
    if (!streams.includes(stream)) { setStream(""); setDiscipline(""); setChapter(""); }
  }, [streams, hasStreams]);

  const scopedRows = useMemo(
    () => (hasStreams && stream ? rows.filter((r) => r.subject === stream) : hasStreams ? [] : rows),
    [rows, hasStreams, stream],
  );

  // English and Hindi sheets carry "Strands of Language" in place of the
  // Discipline column every other subject uses. Same position in the
  // hierarchy, different label — so the level reads whichever the rows carry.
  const usesStrands = useMemo(() => scopedRows.some((r) => r.strands_of_language), [scopedRows]);
  const levelLabel = usesStrands ? "Strands of Language" : "Discipline";
  const levelOf = (r) => (usesStrands ? r.strands_of_language : r.discipline) || "";

  // Month -> Discipline/Strand -> Chapter Name -> Topic -> Sub Topic, each
  // level deduped and scoped by every level chosen above it. A level that no
  // row fills in is skipped entirely rather than shown empty (see
  // needsDiscipline / hasRealTopics).
  const disciplinesThisMonth = useMemo(() => {
    const seen = new Set();
    scopedRows.forEach((r) => { if (r.month === month && levelOf(r)) seen.add(levelOf(r)); });
    return [...seen];
  }, [scopedRows, month, usesStrands]);

  // Sheets without any Discipline/Strands value at all (Social Science's
  // grade tabs are like this) skip that level and go straight to chapters.
  const needsDiscipline = disciplinesThisMonth.length > 0;

  const chaptersForDiscipline = useMemo(() => {
    const seen = new Set();
    const list = [];
    scopedRows.forEach((r) => {
      if (r.month !== month) return;
      if (needsDiscipline && levelOf(r) !== discipline) return;
      if (!seen.has(r.chapter_name)) { seen.add(r.chapter_name); list.push(r); }
    });
    return list;
  }, [scopedRows, month, discipline, needsDiscipline, usesStrands]);

  // Topic is skipped entirely when blank, or when it's just a restatement of
  // the Chapter Name — some planner rows carry no real Topic-level detail.
  const topicsForChapter = useMemo(() => {
    const seen = new Set();
    const list = [];
    scopedRows.forEach((r) => {
      if (r.month !== month || r.chapter_name !== chapter || !r.topic) return;
      if (needsDiscipline && levelOf(r) !== discipline) return;
      if (r.topic.trim().toLowerCase() === chapter.trim().toLowerCase()) return;
      if (!seen.has(r.topic)) { seen.add(r.topic); list.push(r.topic); }
    });
    return list;
  }, [scopedRows, month, discipline, chapter, needsDiscipline, usesStrands]);

  const hasRealTopics = topicsForChapter.length > 0;

  const subtopicsForTopic = useMemo(() => {
    const seen = new Set();
    const list = [];
    scopedRows.forEach((r) => {
      if (r.month !== month || r.chapter_name !== chapter || !r.subtopic) return;
      if (needsDiscipline && levelOf(r) !== discipline) return;
      if (hasRealTopics && r.topic !== topicPick) return;
      if (!seen.has(r.subtopic)) { seen.add(r.subtopic); list.push(r.subtopic); }
    });
    return list;
  }, [scopedRows, month, discipline, chapter, topicPick, hasRealTopics, needsDiscipline, usesStrands]);

  // Auto-select subtopic when there's only one option for the chosen topic.
  useEffect(() => {
    if (subtopicsForTopic.length === 1) setSubtopicPick(subtopicsForTopic[0]);
    else if (!subtopicsForTopic.includes(subtopicPick)) setSubtopicPick("");
  }, [subtopicsForTopic]);

  // A level is "chosen" either because the teacher picked one, or because
  // this sheet has no Discipline/Strands column to pick from.
  const levelChosen = !needsDiscipline || Boolean(discipline);
  const hasAnyRowsThisGrade = scopedRows.length > 0;
  const plannerEmpty = !needsDiscipline && chaptersForDiscipline.length === 0;

  // Sessions are stated per chapter, but some sheets leave Chapter Name empty
  // and carry the plan at Topic level instead — fall back to the selected
  // topic's row so the session checkboxes still appear.
  const chapterSessions = useMemo(() => {
    const row = chaptersForDiscipline.find((r) => r.chapter_name === chapter);
    if (row && row.sessions) return row.sessions;
    const topicRow = scopedRows.find(
      (r) => r.month === month && r.chapter_name === chapter && (!topicPick || r.topic === topicPick) && r.sessions,
    );
    return topicRow ? topicRow.sessions : (row ? row.sessions : 0);
  }, [chaptersForDiscipline, chapter, scopedRows, month, topicPick]);

  function onStreamChange(value) {
    setStream(value);
    setDiscipline(""); setChapter(""); setTopicPick(""); setSubtopicPick(""); setSessionChecks({});
  }
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

    if (hasStreams && !stream) {
      setError("Please select a stream before submitting.");
      setSubmitting(false);
      return;
    }

    if (!grade || (needsDiscipline && !discipline) || !chapter || (hasRealTopics && !topicPick)) {
      setError(`Please select a grade, ${needsDiscipline ? `${levelLabel.toLowerCase()}, ` : ""}chapter${hasRealTopics ? " and topic" : ""} before submitting.`);
      setSubmitting(false);
      return;
    }

    const lpSessionNum = Object.keys(sessionChecks).filter((k) => sessionChecks[k]).join(", ");

    try {
      await api.createPow(token, {
        // The stream when the subject is split into them (Physics rather than
        // Science), so the POW records what was actually taught. The dashboard
        // and progress screens still ask by profile subject and match the
        // whole group — see crud._subject_group_filter.
        subject: stream || subject,
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
                {hasManySubjects ? (
                  <select
                    className="form-control"
                    value={subject}
                    onChange={(e) => { setSubject(e.target.value); onMonthChange(month); }}
                  >
                    {mySubjects.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input className="form-control readonly-field" value={subject} readOnly />
                )}
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

            {hasStreams && (
              <div className="form-group">
                <label className="form-label">Stream</label>
                <select className="form-control" value={stream} onChange={(e) => onStreamChange(e.target.value)}>
                  <option value="">— select stream —</option>
                  {streams.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <div className="hint-text">{user.subject} · Grade {grade} is planned separately for each stream.</div>
              </div>
            )}

            {(!hasStreams || stream) && needsDiscipline && (
              <div className="form-group">
                <label className="form-label">{levelLabel}</label>
                <select className="form-control" value={discipline} onChange={(e) => onDisciplineChange(e.target.value)}>
                  <option value="">— select {levelLabel.toLowerCase()} —</option>
                  {disciplinesThisMonth.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}

            {(!hasStreams || stream) && grade && plannerEmpty && (
              <div className="hint-text">
                {hasAnyRowsThisGrade
                  ? `Nothing planned for ${stream || subject} · Grade ${grade} in ${month}.`
                  : `No curriculum sheet has been uploaded for ${stream || subject} · Grade ${grade} yet — ask your SME or the curriculum team to upload it.`}
              </div>
            )}

            {levelChosen && (
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
