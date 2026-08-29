import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import POWCard from "./POWCard";
import LaggingPanel from "./LaggingPanel";
import { fmtDate } from "../dateUtils";
import { GRADES } from "../grades";

export default function Dashboard({ token, user, isReadOnlyViewer, isLeadership, canUploadCurriculum, canCreatePow, canSeeOverview, canOversee, branch = "", onNewPow, onProgress, onOverview, onCompare, onPlannerUpload, onOpenPow }) {
  const [teachersList, setTeachersList] = useState([]);
  const mySubjects = (user.subjects && user.subjects.length ? user.subjects : [user.subject]).filter(Boolean);
  const [subject, setSubject] = useState(isReadOnlyViewer ? "" : (user.subject || mySubjects[0] || ""));
  const [grade, setGrade] = useState("");
  const [cards, setCards] = useState(null);
  const [error, setError] = useState("");
  const [missingTbsMomPopup, setMissingTbsMomPopup] = useState(null);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  // Curriculum-vs-other split, straight from the API — the same grouping the
  // Curriculum Upload picker uses, so the two screens read alike.
  const [subjectGroups, setSubjectGroups] = useState({ curriculum: [], other: [] });

  // Subject filter options for SME/Leadership — cheap (no pow_entries touched),
  // so this is safe to fetch on mount even though the cards fetch itself is deferred.
  // The subject list is fetched when the picker is first touched, not on
  // mount: the dashboard should paint immediately, and someone heading
  // straight for Progress Check or Curriculum Overview never needs it here.
  const [subjectsLoaded, setSubjectsLoaded] = useState(false);

  function loadSubjects() {
    if (!isReadOnlyViewer || subjectsLoaded || subjectsLoading) return;
    setSubjectsLoading(true);
    api.getTeachers(token, branch)
      .then((res) => {
        setTeachersList(res.teachers || []);
        if (res.subjects) setSubjectGroups(res.subjects);
        setSubjectsLoaded(true);
      })
      .catch((err) => setError(err.message))
      .finally(() => setSubjectsLoading(false));
  }

  // A branch change invalidates what was loaded for the previous one.
  useEffect(() => {
    setSubjectsLoaded(false);
    setTeachersList([]);
    setSubjectGroups({ curriculum: [], other: [] });
  }, [branch]);

  // Grouped list when the API provides one; the flat list derived from the
  // teachers is the fallback so an older backend still works.
  const subjectOptions = useMemo(() => {
    const grouped = [...(subjectGroups.curriculum || []), ...(subjectGroups.other || [])];
    if (grouped.length) return grouped;
    const seen = new Set();
    const list = [];
    teachersList.forEach((t) => { if (t.subject && !seen.has(t.subject)) { seen.add(t.subject); list.push(t.subject); } });
    return list;
  }, [teachersList, subjectGroups]);

  useEffect(() => {
    if (isReadOnlyViewer && subjectsLoaded && !subject && subjectOptions.length > 0) {
      setSubject(subjectOptions[0]);
    }
  }, [isReadOnlyViewer, subjectsLoaded, subject, subjectOptions]);

  // Nag popup for missing TBS MOM — deliberately independent of the subject/grade
  // filter below (a separate, lightweight, filter-independent query), so a teacher
  // isn't only warned about it if they happen to browse to that exact grade.
  // Shown to anyone who files POWs — a teaching HOD/Coordinator/SME needs the
  // reminder as much as a plain teacher does.
  useEffect(() => {
    if (!canCreatePow) return;
    // Deferred past the first paint: the reminder matters, but not before the
    // page is on screen.
    const timer = setTimeout(() => {
      api.getTbsMomAlerts(token)
        .then((res) => { if ((res.cards || []).length > 0) setMissingTbsMomPopup(res.cards); })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [token, canCreatePow]);

  // POW cards only fetch once both Subject and Grade are picked — no data
  // loads on mount at all, so the dashboard renders instantly regardless of
  // backend latency, and the fetch only touches the one subject/grade in view.
  useEffect(() => {
    if (!subject || !grade) { setCards(null); return; }
    setError("");
    api.getPowCards(token, subject, grade, branch)
      .then((res) => setCards(res.cards || []))
      .catch((err) => setError(err.message));
  }, [token, subject, grade, branch]);

  const grouped = {};
  const order = [];
  (cards || []).forEach((c) => {
    if (!grouped[c.teacher_email]) { grouped[c.teacher_email] = []; order.push(c.teacher_email); }
    grouped[c.teacher_email].push(c);
  });

  return (
    <div>
      {missingTbsMomPopup && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="section-title">⚠ TBS MOM missing</div>
            <p className="hint-text">
              {missingTbsMomPopup.length === 1
                ? "1 POW is finalized but still missing its TBS MOM:"
                : `${missingTbsMomPopup.length} POWs are finalized but still missing TBS MOM:`}
            </p>
            <div className="checkbox-list" style={{ marginBottom: 16 }}>
              {missingTbsMomPopup.map((c) => (
                <div
                  key={c.id}
                  className="pow-card-meta"
                  style={{ cursor: "pointer" }}
                  onClick={() => { setMissingTbsMomPopup(null); onOpenPow(c.id); }}
                >
                  • {c.subject} · Grade {c.grade} — {c.topic || "—"} ({fmtDate(c.week_start)} – {fmtDate(c.week_end)})
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={() => setMissingTbsMomPopup(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {user.can_see_lagging && (
        <LaggingPanel
          token={token}
          branch={branch}
          onOpenTeacher={(row) => { setSubject(row.subject); setGrade(row.grade); }}
        />
      )}

      <div className="dashboard-actions">
        {canCreatePow && <button className="btn btn-primary" onClick={onNewPow}>+ New POW</button>}
        {canUploadCurriculum && <button className="btn btn-ghost btn-sm" onClick={onPlannerUpload}>📄 Curriculum Upload</button>}
        {canOversee && <button className="btn btn-primary btn-sm" onClick={onProgress}>Progress Check</button>}
        {canSeeOverview && <button className="btn btn-primary btn-sm" onClick={onOverview}>Curriculum Overview</button>}
        {/* Spans every grade and both campuses, so it sits beside the others
            rather than inside a grade-scoped screen. */}
        {canOversee && <button className="btn btn-primary btn-sm" onClick={onCompare}>Compare Campuses</button>}
      </div>

      <div className="filter-bar">
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Subject</label>
          {isReadOnlyViewer ? (
            <select
              className="form-control"
              value={subject}
              onFocus={loadSubjects}
              onMouseDown={loadSubjects}
              onChange={(e) => { setSubject(e.target.value); setGrade(""); setCards(null); }}
            >
              {subjectOptions.length === 0 && (
                <option value="">
                  {subjectsLoading ? "Loading subjects…" : subjectsLoaded ? "No subjects available" : "Select a subject…"}
                </option>
              )}
              {(subjectGroups.curriculum || []).length > 0 ? (
                <>
                  <optgroup label="Curriculum subjects">
                    {subjectGroups.curriculum.map((s) => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
                  {(subjectGroups.other || []).length > 0 && (
                    <optgroup label="Other staff subjects">
                      {subjectGroups.other.map((s) => <option key={s} value={s}>{s}</option>)}
                    </optgroup>
                  )}
                </>
              ) : (
                subjectOptions.map((s) => <option key={s} value={s}>{s}</option>)
              )}
            </select>
          ) : mySubjects.length > 1 ? (
            <select className="form-control" value={subject} onChange={(e) => { setSubject(e.target.value); setCards(null); }}>
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
      </div>



      {error && <div className="form-error">{error}</div>}

      {!subject || !grade ? (
        <div className="empty-msg">Select a subject and grade above to view POW cards.</div>
      ) : !cards ? (
        <div className="loading-spinner">Loading…</div>
      ) : cards.length === 0 ? (
        <div className="empty-msg">No POWs to show yet.</div>
      ) : (
        order.map((email) => {
          const teacherCards = grouped[email];
          const name = teacherCards[0].teacher_name || email;
          const teacherSubject = teacherCards[0].subject || "";
          return (
            <div className="teacher-group" key={email}>
              <div className="teacher-group-title">
                👤 {name}{teacherSubject ? ` · ${teacherSubject}` : ""}
                {!branch && teacherCards[0].branch ? ` · ${teacherCards[0].branch}` : ""}
              </div>
              <div className="cards-grid">
                {teacherCards.map((c) => <POWCard key={c.id} card={c} onClick={onOpenPow} />)}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
