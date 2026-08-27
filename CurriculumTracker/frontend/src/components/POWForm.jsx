import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { GRADES } from "../grades";
import { nextWeekDates, toISO, fmtDate, MONTHS } from "../dateUtils";

// mode: "new" (current/future week, no implementation section) |
// "impl_only" (past-week fill-in, only the Impl A-F + notes section, everything else locked)
export default function POWForm({ token, user, mode, prefillPow, onDone, onBack }) {
  const isImplOnly = mode === "impl_only";
  // TBS MOM is filled in after the final save, so it only shows once this POW
  // has been finalised (see POWView for the same rule).
  const isFinalised = ["final", "reviewed", "approved"].includes(prefillPow?.status);
  // The MOM window: open after the final save, closed once it has been saved.
  const tbsMomOpen = isFinalised && !(prefillPow?.tbs_mom || "").trim();
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

  // The week is one or more PLANS. A plan is a set of sections plus the
  // sessions they sit through, and a session carries everything about itself:
  // chapter, topic, sub-topic, class work, binder, activity, homework, its
  // lesson plan and its learning outcomes.
  //
  // Normally there is one plan covering every section. When a section falls
  // behind - a holiday on its slot - it moves into a plan of its own, with its
  // own chapter and its own class work, rather than being noted as an
  // exception to somebody else's plan.
  const [plans, setPlans] = useState([{ sections: [], sessions: [] }]);

  // Where each section got to last week: seeds the first plan's section list,
  // and tells the teacher what a section is carrying forward.
  const [lastPlans, setLastPlans] = useState({});
  // The sections this campus runs for the grade, from staff_roles. Attibele
  // runs two where Kodathi runs five or six, so A-F is not the right offer.
  const [gradeSections, setGradeSections] = useState([]);
  const [cctYes, setCctYes] = useState(false);
  const [cctText, setCctText] = useState("");
  const [cctDashboardUpdated, setCctDashboardUpdated] = useState(false);
  const [tbsMom, setTbsMom] = useState("");
  const [instructions, setInstructions] = useState("");
  const [implA, setImplA] = useState(prefillPow?.impl_a || "");
  const [implB, setImplB] = useState(prefillPow?.impl_b || "");
  const [implC, setImplC] = useState(prefillPow?.impl_c || "");
  const [implD, setImplD] = useState(prefillPow?.impl_d || "");
  const [implE, setImplE] = useState(prefillPow?.impl_e || "");
  const [implF, setImplF] = useState(prefillPow?.impl_f || "");
  const [implDates, setImplDates] = useState({
    a: prefillPow?.impl_a_date || "", b: prefillPow?.impl_b_date || "", c: prefillPow?.impl_c_date || "",
    d: prefillPow?.impl_d_date || "", e: prefillPow?.impl_e_date || "", f: prefillPow?.impl_f_date || "",
  });
  // Correction Done is a date per section now, sitting beside that section's
  // completion date rather than being one free-text box for the week.
  const [correctionDates, setCorrectionDates] = useState({
    a: prefillPow?.correction_a_date || "", b: prefillPow?.correction_b_date || "",
    c: prefillPow?.correction_c_date || "", d: prefillPow?.correction_d_date || "",
    e: prefillPow?.correction_e_date || "", f: prefillPow?.correction_f_date || "",
  });
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

  // Where each section left off last week. Fetched per subject+grade, and only
  // for a new POW - the implementation-only form is not planning anything.
  useEffect(() => {
    if (isImplOnly || !grade) { setLastPlans({}); return; }
    api.getSectionsForGrade(token, stream || subject, grade)
      .then((res) => setGradeSections(res.sections || []))
      .catch(() => setGradeSections([]));

    api.getLastSectionPlans(token, stream || subject, grade)
      .then((res) => {
        const plans = res.plans || {};
        setLastPlans(plans);
        // The first plan opens on whichever sections this grade ran last week,
        // or A and B for a grade with no history yet.
        const known = Object.keys(plans).sort();
        setPlans((prev) => (prev.length === 1 && prev[0].sections.length === 0
          ? [{ ...prev[0], sections: known.length ? known : ["A", "B"] }]
          : prev));
      })
      .catch(() => setLastPlans({}));
  }, [token, stream, subject, grade, isImplOnly]);

  // A section may be on a different chapter from the week's headline pick, so
  // its topic and sub-topic lists are derived from ITS chapter, not the form's.
  function topicsForSection(sectionChapter) {
    const seen = new Set();
    const list = [];
    scopedRows.forEach((r) => {
      if (r.chapter_name !== sectionChapter || !r.topic) return;
      if (!seen.has(r.topic)) { seen.add(r.topic); list.push(r.topic); }
    });
    return list;
  }

  function subtopicsForSection(sectionChapter, sectionTopic) {
    const seen = new Set();
    const list = [];
    scopedRows.forEach((r) => {
      if (r.chapter_name !== sectionChapter || !r.subtopic) return;
      if (sectionTopic && r.topic !== sectionTopic) return;
      if (!seen.has(r.subtopic)) { seen.add(r.subtopic); list.push(r.subtopic); }
    });
    return list;
  }


  // ── plans and their sessions ───────────────────────────────────────────
  // Every section named anywhere, which is the grade's full set.
  const allPlannedSections = plans.flatMap((p) => p.sections);

  const defaultChapter = chaptersForDiscipline.length ? chaptersForDiscipline[0].chapter_name : "";

  function updatePlan(pi, changes) {
    setPlans((prev) => prev.map((p, i) => (i === pi ? { ...p, ...changes } : p)));
  }

  // A section belongs to exactly one plan: adding it here takes it out of
  // wherever it was, which is what keeps "common" and "different" from
  // overlapping.
  function toggleSection(pi, sec) {
    setPlans((prev) => prev.map((p, i) => {
      if (i === pi) {
        return p.sections.includes(sec)
          ? { ...p, sections: p.sections.filter((x) => x !== sec) }
          : { ...p, sections: [...p.sections, sec].sort() };
      }
      return { ...p, sections: p.sections.filter((x) => x !== sec) };
    }));
  }

  function setSessionField(pi, si, field, value) {
    setPlans((prev) => prev.map((p, i) => (
      i === pi
        ? { ...p, sessions: p.sessions.map((x, j) => (j === si ? { ...x, [field]: value } : x)) }
        : p
    )));
  }

  // How many sessions a chapter plans, from the mapping - the range the
  // session-number dropdown offers.
  function sessionsInChapter(chapterName) {
    const row = chaptersForDiscipline.find((r) => r.chapter_name === chapterName);
    return (row && row.sessions) || 0;
  }

  // Within a chapter the sessions run in order, so a plan only offers numbers
  // after the ones it has already used for that chapter.
  function availableSessionNos(pi, si, chapterName) {
    const total = sessionsInChapter(chapterName);
    if (!total) return [];
    const rows = plans[pi].sessions;
    const takenElsewhere = rows
      .filter((x, j) => j !== si && x.chapter === chapterName)
      .map((x) => String(x.session_no));
    const earlier = rows
      .filter((x, j) => j < si && x.chapter === chapterName)
      .map((x) => Number(x.session_no))
      .filter((n) => !Number.isNaN(n));
    const floor = earlier.length ? Math.max(...earlier) : 0;
    return Array.from({ length: total }, (_, i) => i + 1)
      .filter((n) => n > floor && !takenElsewhere.includes(String(n)));
  }

  function addSession(pi) {
    const rows = plans[pi].sessions;
    const base = (rows.length ? rows[rows.length - 1].chapter : "") || defaultChapter;
    const used = rows
      .filter((x) => x.chapter === base)
      .map((x) => Number(x.session_no))
      .filter((n) => !Number.isNaN(n));
    const next = (used.length ? Math.max(...used) : 0) + 1;
    const cap = sessionsInChapter(base);
    updatePlan(pi, {
      sessions: [...rows, {
        session_no: String(cap ? Math.min(next, cap) : next),
        chapter: base,
        topic: "", subtopic: "",
        cw: "", binder: "", activity: "", homework: "",
        lp_link: "", learning_outcomes: "",
      }],
    });
  }

  function removeSession(pi, si) {
    updatePlan(pi, { sessions: plans[pi].sessions.filter((_, j) => j !== si) });
  }

  function addPlan() {
    setPlans((prev) => [...prev, { sections: [], sessions: [] }]);
  }

  function removePlan(pi) {
    setPlans((prev) => prev.filter((_, i) => i !== pi));
  }

  function onStreamChange(value) {
    setStream(value);
    setDiscipline(""); setChapter(""); setTopicPick(""); setSubtopicPick(""); setPlans([{ sections: [], sessions: [] }]);
  }
  function onMonthChange(value) {
    setMonth(value);
    setDiscipline(""); setChapter(""); setTopicPick(""); setSubtopicPick(""); setPlans([{ sections: [], sessions: [] }]);
  }
  function onDisciplineChange(value) {
    setDiscipline(value);
    setChapter(""); setTopicPick(""); setSubtopicPick(""); setPlans([{ sections: [], sessions: [] }]);
  }
  // The POW's own chapter is the first session's - there is no separate
  // week-level pick any more, since every session names its own chapter and
  // every section can name its own too.
  const firstSession = plans.flatMap((p) => p.sessions)[0] || null;
  const primaryChapter = firstSession ? (firstSession.chapter || "") : "";
  const primaryTopic = firstSession ? (firstSession.topic || "") : "";
  const primarySubtopic = firstSession ? (firstSession.subtopic || "") : "";

  function onChapterChange(value) {
    setChapter(value);
    setTopicPick(""); setSubtopicPick(""); setPlans([{ sections: [], sessions: [] }]);
  }
  function onTopicPickChange(value) {
    setTopicPick(value);
    setSubtopicPick("");
  }

  // One entry per section the POW being implemented names, each with its plan
  // and its sessions - so the fields sit next to what they describe. Mirrors
  // the same block in POWView.
  const implValues = { a: implA, b: implB, c: implC, d: implD, e: implE, f: implF };
  const implSetters = { a: setImplA, b: setImplB, c: setImplC, d: setImplD, e: setImplE, f: setImplF };

  const implSections = (() => {
    const named = (prefillPow?.section_plans || []).map((p) => p.section);
    const fromSessions = (prefillPow?.sessions || []).flatMap((x) => x.sections || []);
    const known = Array.from(new Set([...named, ...fromSessions])).sort();
    // A POW filed before sections were recorded still needs all six fields.
    const letters = known.length ? known : ["A", "B", "C", "D", "E", "F"];
    return letters.map((letter) => ({
      letter,
      plan: (prefillPow?.section_plans || []).find((p) => p.section === letter) || null,
      sessions: (prefillPow?.sessions || []).filter(
        (x) => !(x.sections || []).length || (x.sections || []).includes(letter),
      ),
    }));
  })();

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    if (isImplOnly) {
      try {
        await api.updatePowImplementation(token, prefillPow.id, {
          impl_a: implA, impl_b: implB, impl_c: implC, impl_d: implD, impl_e: implE, impl_f: implF,
          impl_a_date: implDates.a, impl_b_date: implDates.b, impl_c_date: implDates.c,
          impl_d_date: implDates.d, impl_e_date: implDates.e, impl_f_date: implDates.f,
          ...(tbsMomOpen ? { tbs_mom: tbsMom } : {}),
          correction_done: correctionDone, instructions, teacher_remarks: teacherRemarks,
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

    const usable = plans.filter((p) => p.sessions.length > 0);
    const allSessions = usable.flatMap((p) => p.sessions);
    const incomplete = allSessions.filter((x) => !x.chapter || !String(x.session_no || "").trim());
    const sectionless = usable.filter((p) => p.sections.length === 0);
    if (!grade || (needsDiscipline && !discipline) || allSessions.length === 0
        || incomplete.length > 0 || sectionless.length > 0) {
      setError(
        allSessions.length === 0
          ? `Add at least one session${needsDiscipline && !discipline ? ` after choosing a ${levelLabel.toLowerCase()}` : ""} before submitting.`
          : sectionless.length > 0
            ? "Every plan needs at least one section selected."
            : "Every session needs a chapter and a session number.",
      );
      setSubmitting(false);
      return;
    }

    const lpSessionNum = Array.from(new Set(
      plans.flatMap((p) => p.sessions).map((x) => String(x.session_no || "").trim()).filter(Boolean),
    )).join(", ");

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
        topic: primaryChapter,
        subtopic: [primaryTopic, primarySubtopic].filter(Boolean).join(" — "),
        lp_session_num: lpSessionNum,
        cct_topic_yn: cctYes ? "Yes" : "No",
        cct_topic_text: cctText,
        cct_dashboard_updated: cctDashboardUpdated,
        instructions,
        // Flattened, each session carrying the sections it is for. The
        // backend derives each section's end-of-week position from these, so
        // nothing is stated twice.
        sessions: usable.flatMap((p) => p.sessions.map((x) => ({
          session_no: String(x.session_no || ""),
          sections: p.sections,
          chapter: x.chapter || "",
          topic: x.topic || "",
          subtopic: x.subtopic || "",
          cw: x.cw || "", binder: x.binder || "",
          activity: x.activity || "", homework: x.homework || "",
          lp_link: x.lp_link || "", learning_outcomes: x.learning_outcomes || "",
        }))),
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
                <select className="form-control" value={grade} onChange={(e) => setGrade(e.target.value)}>
                  <option value="">Select a grade…</option>
                  {GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}
                </select>
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


            {/* The week as one or more PLANS. A plan says which sections it
                covers and lists their sessions in full - chapter, topic,
                class work, lesson plan, the lot. A section that fell behind
                gets a plan of its own rather than being an exception noted
                against somebody else's. */}
            {levelChosen && plans.map((plan, pi) => (
              <div className="plan-card" key={pi}>
                <div className="plan-head">
                  <span className="plan-title">
                    {pi === 0 ? "Plan for the week" : "Separate plan"}
                  </span>
                  {plans.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removePlan(pi)}>
                      Remove plan
                    </button>
                  )}
                </div>

                <div className="pill-field">
                  <span className="pill-label">
                    Sections on this plan
                    <span className="pill-sublabel">a section belongs to one plan only</span>
                  </span>
                  <div className="pill-row">
                    {(gradeSections.length ? gradeSections : ["A", "B", "C", "D", "E", "F"]).map((sec) => {
                      const mine = plan.sections.includes(sec);
                      const takenBy = plans.findIndex((p, i) => i !== pi && p.sections.includes(sec));
                      return (
                        <button
                          type="button"
                          key={sec}
                          className={`pill${mine ? " pill-on" : ""}${takenBy >= 0 ? " pill-taken" : ""}`}
                          title={takenBy >= 0 ? `Currently on plan ${takenBy + 1} — click to move it here` : ""}
                          onClick={() => toggleSection(pi, sec)}
                        >
                          {grade}{sec}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {plan.sessions.length === 0 && (
                  <div className="hint-text">No sessions yet — add the first one below.</div>
                )}

                {plan.sessions.map((sess, si) => (
                  <div className="session-block" key={si}>
                    <div className="session-block-head">
                      Session {si + 1}
                      <button type="button" className="btn btn-ghost btn-sm session-remove" onClick={() => removeSession(pi, si)}>
                        Remove
                      </button>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Chapter</label>
                        <select
                          className="form-control"
                          value={sess.chapter || ""}
                          onChange={(e) => {
                            setSessionField(pi, si, "chapter", e.target.value);
                            setSessionField(pi, si, "topic", "");
                            setSessionField(pi, si, "subtopic", "");
                            setSessionField(pi, si, "session_no", "");
                          }}
                        >
                          <option value="">Select a chapter…</option>
                          {chaptersForDiscipline.map((r) => (
                            <option key={r.chapter_name} value={r.chapter_name}>{r.chapter_name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Session number</label>
                        <select
                          className="form-control"
                          value={sess.session_no || ""}
                          onChange={(e) => setSessionField(pi, si, "session_no", e.target.value)}
                        >
                          <option value="">Select…</option>
                          {availableSessionNos(pi, si, sess.chapter).map((n) => (
                            <option key={n} value={n}>Session {n}</option>
                          ))}
                        </select>
                        <div className="hint-text">
                          of {sessionsInChapter(sess.chapter) || "—"} planned for this chapter
                        </div>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Topic</label>
                        <select
                          className="form-control"
                          value={sess.topic || ""}
                          onChange={(e) => setSessionField(pi, si, "topic", e.target.value)}
                        >
                          <option value="">—</option>
                          {topicsForSection(sess.chapter).map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Sub Topic</label>
                        <select
                          className="form-control"
                          value={sess.subtopic || ""}
                          onChange={(e) => setSessionField(pi, si, "subtopic", e.target.value)}
                        >
                          <option value="">—</option>
                          {subtopicsForSection(sess.chapter, sess.topic).map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Class Work</label>
                        <textarea className="form-control" value={sess.cw}
                          onChange={(e) => setSessionField(pi, si, "cw", e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Binder</label>
                        <textarea className="form-control" value={sess.binder}
                          onChange={(e) => setSessionField(pi, si, "binder", e.target.value)} />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Activity</label>
                        <textarea className="form-control" value={sess.activity}
                          onChange={(e) => setSessionField(pi, si, "activity", e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Homework</label>
                        <textarea className="form-control" value={sess.homework}
                          onChange={(e) => setSessionField(pi, si, "homework", e.target.value)} />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Lesson plan link</label>
                        <input className="form-control" type="url" placeholder="https://…"
                          value={sess.lp_link}
                          onChange={(e) => setSessionField(pi, si, "lp_link", e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Learning outcomes</label>
                        <textarea className="form-control" value={sess.learning_outcomes}
                          onChange={(e) => setSessionField(pi, si, "learning_outcomes", e.target.value)} />
                      </div>
                    </div>
                  </div>
                ))}

                <button type="button" className="btn btn-ghost btn-sm" onClick={() => addSession(pi)}>
                  + Add session
                </button>
              </div>
            ))}

            {levelChosen && (
              <button type="button" className="btn btn-ghost btn-sm plan-add" onClick={addPlan}>
                + Add a separate plan for sections on a different chapter
              </button>
            )}

            <div className="form-group">
              <label className="form-label">CCQ Topic this week?</label>
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
                    <label className="form-label">CCQ Topic</label>
                    <input className="form-control" placeholder="CCQ topic" value={cctText} onChange={(e) => setCctText(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">CCQ scheduled</label>
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
              Each section shows what it was planned to cover, with the box its own teacher fills
              in. This card can be saved as many times as needed, as each section's teacher adds theirs.
            </div>

            {/* Same shape as POWView: a section's plan sits with its
                implementation, not in a list further up the page. */}
            {implSections.map(({ letter, plan, sessions }) => {
              const key = letter.toLowerCase();
              return (
                <div className="impl-section" key={letter}>
                  <div className="impl-section-head">
                    Grade {prefillPow?.grade} — Section {letter}
                    {plan && (
                      <span className="impl-section-plan">
                        {[plan.chapter, plan.topic, plan.subtopic].filter(Boolean).join(" — ")}
                      </span>
                    )}
                  </div>

                  {sessions.length > 0 && (
                    <table className="kv-table impl-plan-table">
                      <tbody>
                        {sessions.map((x, i) => (
                          <tr key={i}>
                            <th>
                              Session {x.session_no || "—"}
                              {x.topic ? <div className="hint-text">{x.topic}</div> : null}
                            </th>
                            <td>
                              <div className="impl-plan-fields">
                                {[["Class work", x.cw], ["Binder", x.binder],
                                  ["Activity", x.activity], ["Homework", x.homework],
                                  ["Learning outcomes", x.learning_outcomes]]
                                  .filter(([, v]) => v)
                                  .map(([k, v]) => <div key={k}><strong>{k}:</strong> {v}</div>)}
                                {x.lp_link && (
                                  <div>
                                    <strong>Lesson plan:</strong>{" "}
                                    <a href={x.lp_link} target="_blank" rel="noreferrer">{x.lp_link}</a>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <textarea
                    className="form-control"
                    placeholder={`What actually happened in ${prefillPow?.grade}${letter}`}
                    value={implValues[key]}
                    onChange={(e) => implSetters[key](e.target.value)}
                  />
                  <div className="impl-date-row">
                    <span className="hint-text">Completed on</span>
                    <input
                      type="date"
                      className="form-control impl-date"
                      value={implDates[key]}
                      onChange={(e) => setImplDates({ ...implDates, [key]: e.target.value })}
                    />
                    <span className="hint-text">Correction done</span>
                    <input
                      type="date"
                      className="form-control impl-date"
                      value={correctionDates[key]}
                      onChange={(e) => setCorrectionDates({ ...correctionDates, [key]: e.target.value })}
                    />
                  </div>
                </div>
              );
            })}

            <div className="form-group">
              <label className="form-label">Events / Holidays</label>
              <textarea className="form-control" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            </div>
            {tbsMomOpen && (
              <div className="form-group">
                <label className="form-label">TBS MOM</label>
                <textarea className="form-control" value={tbsMom} onChange={(e) => setTbsMom(e.target.value)} />
              </div>
            )}
            {isFinalised && !tbsMomOpen && (
              <div className="form-group">
                <label className="form-label">TBS MOM</label>
                <div className="readonly-field tbs-mom-recorded">{prefillPow.tbs_mom}</div>
              </div>
            )}
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
