import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import POWCard from "./POWCard";
import LaggingPanel from "./LaggingPanel";
import { fmtDate } from "../dateUtils";

export default function Dashboard({ token, user, isReadOnlyViewer, isLeadership, canUploadCurriculum, onNewPow, onProgress, onPlannerUpload, onOpenPow }) {
  const [teachersList, setTeachersList] = useState([]);
  const mySubjects = (user.subjects && user.subjects.length ? user.subjects : [user.subject]).filter(Boolean);
  const [subject, setSubject] = useState(isReadOnlyViewer ? "" : (user.subject || mySubjects[0] || ""));
  const [grade, setGrade] = useState("");
  const [cards, setCards] = useState(null);
  const [error, setError] = useState("");
  const [missingTbsMomPopup, setMissingTbsMomPopup] = useState(null);

  // Subject filter options for SME/Leadership — cheap (no pow_entries touched),
  // so this is safe to fetch on mount even though the cards fetch itself is deferred.
  useEffect(() => {
    if (!isReadOnlyViewer) return;
    api.getTeachers(token).then((res) => setTeachersList(res.teachers || [])).catch((err) => setError(err.message));
  }, [token, isReadOnlyViewer]);

  const subjectOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    teachersList.forEach((t) => { if (t.subject && !seen.has(t.subject)) { seen.add(t.subject); list.push(t.subject); } });
    return list;
  }, [teachersList]);

  useEffect(() => {
    if (isReadOnlyViewer && !subject && subjectOptions.length > 0) setSubject(subjectOptions[0]);
  }, [isReadOnlyViewer, subject, subjectOptions]);

  // Nag popup for missing TBS MOM — deliberately independent of the subject/grade
  // filter below (a separate, lightweight, filter-independent query), so a teacher
  // isn't only warned about it if they happen to browse to that exact grade.
  useEffect(() => {
    if (isReadOnlyViewer) return;
    api.getTbsMomAlerts(token)
      .then((res) => { if ((res.cards || []).length > 0) setMissingTbsMomPopup(res.cards); })
      .catch(() => {});
  }, [token, isReadOnlyViewer]);

  // POW cards only fetch once both Subject and Grade are picked — no data
  // loads on mount at all, so the dashboard renders instantly regardless of
  // backend latency, and the fetch only touches the one subject/grade in view.
  useEffect(() => {
    if (!subject || !grade) { setCards(null); return; }
    setError("");
    api.getPowCards(token, subject, grade)
      .then((res) => setCards(res.cards || []))
      .catch((err) => setError(err.message));
  }, [token, subject, grade]);

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
          onOpenTeacher={(row) => { setSubject(row.subject); setGrade(row.grade); }}
        />
      )}

      <div className="dashboard-actions">
        {!isReadOnlyViewer && <button className="btn btn-primary" onClick={onNewPow}>+ New POW</button>}
        {canUploadCurriculum && <button className="btn btn-ghost btn-sm" onClick={onPlannerUpload}>📄 Curriculum Upload</button>}
        {isReadOnlyViewer && <button className="btn btn-primary btn-sm" onClick={onProgress}>Progress Check</button>}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Subject</label>
          {isReadOnlyViewer ? (
            <select className="form-control" value={subject} onChange={(e) => { setSubject(e.target.value); setGrade(""); setCards(null); }}>
              {subjectOptions.length === 0 && <option value="">No subjects available</option>}
              {subjectOptions.map((s) => <option key={s} value={s}>{s}</option>)}
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
          <input className="form-control" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="e.g. 5" />
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
              <div className="teacher-group-title">👤 {name}{teacherSubject ? ` · ${teacherSubject}` : ""}</div>
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
