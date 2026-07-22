import { useEffect, useState } from "react";
import { api } from "../api";
import { fmtDate } from "../dateUtils";

export default function POWView({ token, user, powId, onBack, onDone }) {
  const [pow, setPow] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [implA, setImplA] = useState(""); const [implB, setImplB] = useState("");
  const [implC, setImplC] = useState(""); const [implD, setImplD] = useState("");
  const [implE, setImplE] = useState(""); const [implF, setImplF] = useState("");
  const [tbsMom, setTbsMom] = useState("");
  const [correctionDone, setCorrectionDone] = useState("");
  const [instructions, setInstructions] = useState("");
  const [teacherRemarks, setTeacherRemarks] = useState("");
  const [finalSave, setFinalSave] = useState(false);

  const [smeRemarks, setSmeRemarks] = useState("");
  const [cctDiscussed, setCctDiscussed] = useState(false);
  const [approvedClosed, setApprovedClosed] = useState(false);
  const [smeName, setSmeName] = useState(user.name || "");
  const [confirmedDate, setConfirmedDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    api.getPow(token, powId).then((res) => {
      setPow(res.pow);
      setReview(res.review);
      setImplA(res.pow.impl_a || ""); setImplB(res.pow.impl_b || "");
      setImplC(res.pow.impl_c || ""); setImplD(res.pow.impl_d || "");
      setImplE(res.pow.impl_e || ""); setImplF(res.pow.impl_f || "");
      setTbsMom(res.pow.tbs_mom || "");
      setCorrectionDone(res.pow.correction_done || "");
      setInstructions(res.pow.instructions || "");
      setTeacherRemarks(res.pow.teacher_remarks || "");
      setSmeRemarks(res.review?.remarks || "");
      setCctDiscussed(!!res.review?.cct_discussed);
      setApprovedClosed(!!res.review?.approved_closed);
      if (res.review?.sme_name) setSmeName(res.review.sme_name);
      if (res.review?.confirmed_date) setConfirmedDate(res.review.confirmed_date);
    }).catch((err) => setError(err.message));
  }, [token, powId]);

  if (error) return <div className="form-error">{error}</div>;
  if (!pow) return <div className="loading-spinner">Loading…</div>;

  const isSME = user.role === "SME";
  const isTeacher = user.role === "Teacher";
  // "final" | "reviewed" | "approved" all mean the teacher's own implementation
  // pass is done — see crud.STATUS_LABELS for the full lifecycle.
  const isPastFinalSave = ["final", "reviewed", "approved"].includes(pow.status);
  const isLocked = !isTeacher || isPastFinalSave;
  // TBS MOM stays editable by the teacher regardless of status — only
  // non-teacher viewers are ever locked out of it.
  const isTbsMomLocked = !isTeacher;
  const hasImpl = [implA, implB, implC, implD, implE, implF].some((v) => v && v.trim().length > 0);
  const cctYes = (pow.cct_topic_yn || "").toLowerCase() === "yes";

  async function saveTeacherImpl() {
    setSaving(true);
    setError("");
    try {
      await api.updatePowImplementation(token, powId, {
        impl_a: implA, impl_b: implB, impl_c: implC, impl_d: implD, impl_e: implE, impl_f: implF,
        tbs_mom: tbsMom, correction_done: correctionDone, instructions, teacher_remarks: teacherRemarks,
        final_save: finalSave,
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveTbsMomOnly() {
    setSaving(true);
    setError("");
    try {
      await api.updatePowImplementation(token, powId, {
        impl_a: implA, impl_b: implB, impl_c: implC, impl_d: implD, impl_e: implE, impl_f: implF,
        tbs_mom: tbsMom, correction_done: correctionDone, instructions, teacher_remarks: teacherRemarks,
        final_save: false,
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveSmeRemarksOnly() {
    setSaving(true);
    setError("");
    try {
      await api.saveSmeReview(token, powId, {
        remarks: smeRemarks,
        cct_discussed: cctYes ? cctDiscussed : null,
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmAndClose() {
    if (!smeName.trim() || !confirmedDate) {
      setError("Please enter your name and the date to confirm and close this POW.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.saveSmeReview(token, powId, {
        remarks: smeRemarks,
        cct_discussed: cctYes ? cctDiscussed : null,
        approved_closed: true,
        sme_name: smeName,
        confirmed_date: confirmedDate,
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button className="back-link" onClick={onBack}>← Back</button>
      <div className="section-title">Plan of Work — Details</div>
      {error && <div className="form-error">{error}</div>}

      <table>
        <tbody>
          <tr><th>Week</th><td>{fmtDate(pow.week_start)} – {fmtDate(pow.week_end)}</td></tr>
          <tr><th>Subject</th><td>{pow.subject}</td></tr>
          <tr><th>Grade</th><td>{pow.grade}</td></tr>
          <tr><th>Teacher</th><td>{pow.teacher_email}</td></tr>
          <tr><th>Chapter</th><td>{pow.topic}</td></tr>
          <tr><th>Topic / Sub Topic</th><td>{pow.subtopic || "—"}</td></tr>
          <tr><th>LP Session #</th><td>{pow.lp_session_num || "—"}</td></tr>
          <tr><th>Class Work</th><td>{pow.cw || "—"}</td></tr>
          <tr><th>Binder</th><td>{pow.binder || "—"}</td></tr>
          <tr><th>Activity</th><td>{pow.activity || "—"}</td></tr>
          <tr><th>Homework</th><td>{pow.homework || "—"}</td></tr>
          <tr><th>CCT Topic</th><td>{pow.cct_topic_yn || "—"}{pow.cct_topic_text ? ` — ${pow.cct_topic_text}` : ""}</td></tr>
        </tbody>
      </table>

      <div className="section-title">Implementation</div>
      <div className="hint-text">One field per class section — different section teachers each fill in their own.</div>
      {[
        [["A", implA, setImplA], ["B", implB, setImplB]],
        [["C", implC, setImplC], ["D", implD, setImplD]],
        [["E", implE, setImplE], ["F", implF, setImplF]],
      ].map((pair, i) => (
        <div className="form-row" key={i}>
          {pair.map(([label, val, setter]) => (
            <div className="form-group" key={label}>
              <label className="form-label">Grade {pow.grade} — Section {label}</label>
              <textarea className="form-control" value={val} disabled={isLocked} onChange={(e) => setter(e.target.value)} />
            </div>
          ))}
        </div>
      ))}
      <div className="form-group">
        <label className="form-label">Correction Done</label>
        <input className="form-control" value={correctionDone} disabled={isLocked} onChange={(e) => setCorrectionDone(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Instructions</label>
        <textarea className="form-control" value={instructions} disabled={isLocked} onChange={(e) => setInstructions(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Teacher Remarks</label>
        <textarea className="form-control" value={teacherRemarks} disabled={isLocked} onChange={(e) => setTeacherRemarks(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">TBS MOM{!tbsMom.trim() && isPastFinalSave && <span style={{ color: "var(--red)" }}> — not filled in yet</span>}</label>
        <textarea className="form-control" value={tbsMom} disabled={isTbsMomLocked} onChange={(e) => setTbsMom(e.target.value)} />
      </div>

      {!isLocked && (
        <div className="form-actions">
          <label className="checkbox-item">
            <input type="checkbox" checked={finalSave} onChange={(e) => setFinalSave(e.target.checked)} />
            Confirm Final Save
          </label>
          <button className="btn btn-primary" disabled={saving} onClick={saveTeacherImpl}>
            {finalSave ? "Save Final" : "Save as Draft"}
          </button>
        </div>
      )}

      {isLocked && !isTbsMomLocked && (
        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button className="btn btn-primary" disabled={saving} onClick={saveTbsMomOnly}>Save TBS MOM</button>
          <button className="btn btn-ghost" onClick={onBack}>Back to Dashboard</button>
        </div>
      )}

      {/* SME-only review block — gated strictly on role === "SME", never on
          isReadOnlyViewer, so Leadership can never see or touch this. */}
      {isSME && (
        <>
          <div className="section-title">SME Review</div>
          {cctYes && (
            <label className="checkbox-item">
              <input
                type="checkbox"
                checked={cctDiscussed}
                disabled={approvedClosed}
                onChange={(e) => setCctDiscussed(e.target.checked)}
              />
              CCT discussed
            </label>
          )}
          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">SME Remarks</label>
            <textarea className="form-control" value={smeRemarks} disabled={approvedClosed} onChange={(e) => setSmeRemarks(e.target.value)} />
          </div>

          {approvedClosed ? (
            <div className="hint-text">Confirmed and closed by {smeName} on {fmtDate(confirmedDate)}.</div>
          ) : hasImpl ? (
            <>
              <div className="hint-text">Once the teacher has filled in the implementation and TBS MOM above, confirm and close this POW.</div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Your Name</label>
                  <input className="form-control" value={smeName} onChange={(e) => setSmeName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="date" className="form-control" value={confirmedDate} onChange={(e) => setConfirmedDate(e.target.value)} />
                </div>
              </div>
              <div className="form-actions">
                <button className="btn btn-ghost" disabled={saving} onClick={saveSmeRemarksOnly}>Save Remarks Only</button>
                <button className="btn btn-primary" disabled={saving} onClick={confirmAndClose}>Confirm &amp; Close POW</button>
              </div>
            </>
          ) : (
            <button className="btn btn-ghost" disabled={saving} onClick={saveSmeRemarksOnly}>Save Remarks</button>
          )}
        </>
      )}
    </div>
  );
}
