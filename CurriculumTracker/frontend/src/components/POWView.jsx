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
  // Completion date per section — sections finish a chapter on different days.
  const [implDates, setImplDates] = useState({ a: "", b: "", c: "", d: "", e: "", f: "" });
  // Correction Done is a date per section now, beside that section's
  // completion date, rather than one free-text box for the whole week.
  const [correctionDates, setCorrectionDates] = useState({ a: "", b: "", c: "", d: "", e: "", f: "" });
  // Implementation per (session, section) - see models.PowSessionImpl. The
  // per-section fields above stay for POWs filed before sessions existed.
  const [sessionImpl, setSessionImpl] = useState({});
  const [tbsMom, setTbsMom] = useState("");
  const [instructions, setInstructions] = useState("");
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
      setImplDates({
        a: res.pow.impl_a_date || "", b: res.pow.impl_b_date || "", c: res.pow.impl_c_date || "",
        d: res.pow.impl_d_date || "", e: res.pow.impl_e_date || "", f: res.pow.impl_f_date || "",
      });
      setCorrectionDates({
        a: res.pow.correction_a_date || "", b: res.pow.correction_b_date || "",
        c: res.pow.correction_c_date || "", d: res.pow.correction_d_date || "",
        e: res.pow.correction_e_date || "", f: res.pow.correction_f_date || "",
      });
      setTbsMom(res.pow.tbs_mom || "");
      setInstructions(res.pow.instructions || "");
      const impl = {};
      (res.pow.sessions || []).forEach((x) => {
        Object.entries(x.impl || {}).forEach(([sec, v]) => {
          impl[`${x.id}|${sec}`] = {
            remarks: v.remarks || "",
            completed_on: v.completed_on || "",
            correction_on: v.correction_on || "",
          };
        });
      });
      setSessionImpl(impl);
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
  // Whether this viewer may edit is decided server-side (crud.can_edit_pow) —
  // it depends on subject groups and staff_roles assignments the client can't
  // work out on its own.
  const canEdit = Boolean(pow.can_edit);
  const canEditTbsMom = Boolean(pow.can_edit_tbs_mom);
  // Who may fill in the implementation, from the server (crud.can_edit_pow):
  // role==Teacher was too narrow — HODs, Coordinators and SMEs who teach their
  // own classes were locked out of their own POWs. This does NOT let an SME
  // change what another teacher planned; SMEs review via remarks below.
  const canFillImplementation = canEdit;
  // "final" | "reviewed" | "approved" all mean the teacher's own implementation
  // pass is done — see crud.STATUS_LABELS for the full lifecycle.
  const isPastFinalSave = ["final", "reviewed", "approved"].includes(pow.status);
  const isLocked = !canFillImplementation || isPastFinalSave;
  // TBS MOM stays editable by the teacher regardless of status — only
  // non-teacher viewers are ever locked out of it.
  // Deliberately NOT tied to the final save: the TBS discussion happens after
  // the POW is finalised, which is what the missing-MOM reminder chases.
  const isTbsMomLocked = !canEditTbsMom;
  const hasImpl = [implA, implB, implC, implD, implE, implF].some((v) => v && v.trim().length > 0);
  const cctYes = (pow.cct_topic_yn || "").toLowerCase() === "yes";

  async function saveTeacherImpl() {
    setSaving(true);
    setError("");
    try {
      await api.updatePowImplementation(token, powId, {
        impl_a: implA, impl_b: implB, impl_c: implC, impl_d: implD, impl_e: implE, impl_f: implF,
        impl_a_date: implDates.a, impl_b_date: implDates.b, impl_c_date: implDates.c,
        impl_d_date: implDates.d, impl_e_date: implDates.e, impl_f_date: implDates.f,
        instructions,
        ...Object.fromEntries(
          Object.entries(correctionDates).map(([k, v]) => [`correction_${k}_date`, v]),
        ),
        session_impl: Object.entries(sessionImpl).map(([k, v]) => {
          const [sessionId, section] = k.split("|");
          return {
            session_id: Number(sessionId),
            section,
            remarks: v.remarks ?? "",
            completed_on: v.completed_on ?? "",
            correction_on: v.correction_on ?? "",
          };
        }),
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
      // Only the MOM — sending the implementation fields too would be rejected
      // once the POW is finalised, which is exactly when this button is used.
      await api.updatePowImplementation(token, powId, { tbs_mom: tbsMom, final_save: false });
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

  // Sessions grouped by the set of sections that share them. Sections on the
  // same chapter and topic belong in ONE box - it is one plan, taught to
  // several sections - while a section that fell behind has its own sessions
  // and so forms a box of its own. Within a box each session is separate,
  // because a section finishes session 8 and session 9 on different days.
  const sessionGroups = (() => {
    const groups = new Map();
    (pow.sessions || []).forEach((x) => {
      const letters = (x.sections || []).length
        ? [...x.sections].sort()
        : ["A", "B", "C", "D", "E", "F"];   // an older POW named none: the whole grade
      const key = letters.join(",");
      if (!groups.has(key)) groups.set(key, { sections: letters, sessions: [] });
      groups.get(key).sessions.push(x);
    });
    return [...groups.values()];
  })();

  // { "<sessionId>|<section>": {remarks, completed_on, correction_on} } - what
  // is on screen, seeded from the server and sent back as only the rows that
  // were touched.
  const implKey = (sessionId, section) => `${sessionId}|${section}`;

  function setImplField(sessionId, section, field, value) {
    setSessionImpl((prev) => {
      const k = implKey(sessionId, section);
      return { ...prev, [k]: { ...(prev[k] || {}), [field]: value } };
    });
  }

  function implValue(sessionId, section, field) {
    const v = sessionImpl[implKey(sessionId, section)];
    return (v && v[field] !== undefined ? v[field] : "") || "";
  }

  return (
    <div>
      <button className="back-link" onClick={onBack}>← Back</button>
      <div className="section-title">Plan of Work — Details</div>
      {error && <div className="form-error">{error}</div>}

      <table className="kv-table">
        <tbody>
          <tr><th>Week</th><td>{fmtDate(pow.week_start)} – {fmtDate(pow.week_end)}</td></tr>
          <tr><th>Subject</th><td>{pow.subject}</td></tr>
          <tr><th>Grade</th><td>{pow.grade}</td></tr>
          <tr><th>Teacher</th><td>{pow.teacher_email}</td></tr>
          <tr><th>Chapter</th><td>{pow.topic}</td></tr>
          <tr><th>Topic / Sub Topic</th><td>{pow.subtopic || "—"}</td></tr>
          <tr><th>CCQ Topic</th><td>{pow.cct_topic_yn || "—"}{pow.cct_topic_text ? ` — ${pow.cct_topic_text}` : ""}</td></tr>
        </tbody>
      </table>

      <table className="kv-table">
        <tbody>
          <tr><th>LP Session #</th><td>{pow.lp_session_num || "—"}</td></tr>
          {/* POWs filed before the per-session split still carry one set of
              week-level boxes; newer ones list each session separately below. */}
          {(pow.sessions || []).length === 0 && (
            <>
              <tr><th>Class Work</th><td>{pow.cw || "—"}</td></tr>
              <tr><th>Binder</th><td>{pow.binder || "—"}</td></tr>
              <tr><th>Activity</th><td>{pow.activity || "—"}</td></tr>
              <tr><th>Homework</th><td>{pow.homework || "—"}</td></tr>
            </>
          )}
        </tbody>
      </table>

      <div className="section-title">Implementation</div>
      <div className="hint-text">
        Sections sharing a plan are together; each session is recorded per section, since sections
        finish on different days.
      </div>

      {sessionGroups.map((group, gi) => (
        <div className="impl-section" key={gi}>
          <div className="impl-section-head">
            <span>
              {group.sections.map((x) => `${pow.grade}${x}`).join(", ")}
            </span>
            <span className="impl-section-plan">
              {[group.sessions[0]?.chapter].filter(Boolean).join("")}
            </span>
          </div>

          {group.sessions.map((sess) => (
            <div className="impl-session" key={sess.id}>
              <div className="impl-session-head">
                Session {sess.session_no || "—"}
                {sess.topic ? ` · ${sess.topic}` : ""}
                {sess.subtopic ? ` — ${sess.subtopic}` : ""}
              </div>

              <div className="impl-plan-fields">
                {[["Class work", sess.cw], ["Binder", sess.binder],
                  ["Activity", sess.activity], ["Homework", sess.homework],
                  ["Learning outcomes", sess.learning_outcomes]]
                  .filter(([, v]) => v)
                  .map(([k, v]) => <div key={k}><strong>{k}:</strong> {v}</div>)}
                {sess.lp_link && (
                  <div>
                    <strong>Lesson plan:</strong>{" "}
                    <a href={sess.lp_link} target="_blank" rel="noreferrer">{sess.lp_link}</a>
                  </div>
                )}
              </div>

              <table className="impl-grid">
                <thead>
                  <tr>
                    <th>Section</th>
                    <th>What happened</th>
                    <th>Completed on</th>
                    <th>Correction done</th>
                  </tr>
                </thead>
                <tbody>
                  {group.sections.map((sec) => (
                    <tr key={sec}>
                      <th className="impl-grid-section">{pow.grade}{sec}</th>
                      <td>
                        <textarea
                          className="form-control"
                          value={implValue(sess.id, sec, "remarks")}
                          disabled={isLocked}
                          onChange={(e) => setImplField(sess.id, sec, "remarks", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className="form-control impl-date"
                          value={implValue(sess.id, sec, "completed_on")}
                          disabled={isLocked}
                          onChange={(e) => setImplField(sess.id, sec, "completed_on", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className="form-control impl-date"
                          value={implValue(sess.id, sec, "correction_on")}
                          disabled={isLocked}
                          onChange={(e) => setImplField(sess.id, sec, "correction_on", e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}

      {sessionGroups.length === 0 && (
        <div className="hint-text">
          This POW has no sessions recorded, so there is nothing to implement against.
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Events / Holidays</label>
        <textarea className="form-control" value={instructions} disabled={isLocked} onChange={(e) => setInstructions(e.target.value)} />
      </div>
      {isPastFinalSave && (
        <div className="form-group">
          <label className="form-label">
            TBS MOM
            {!pow.tbs_mom && <span style={{ color: "var(--red)" }}> — not filled in yet</span>}
          </label>
          {canEditTbsMom ? (
            <textarea className="form-control" value={tbsMom} onChange={(e) => setTbsMom(e.target.value)} />
          ) : (
            /* Recorded once and then fixed — shown as text, not a disabled box,
               so it doesn't look like something that failed to load. */
            <div className="readonly-field tbs-mom-recorded">{pow.tbs_mom || "—"}</div>
          )}
        </div>
      )}

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

      {isLocked && canEditTbsMom && (
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
              CCQ discussed
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
