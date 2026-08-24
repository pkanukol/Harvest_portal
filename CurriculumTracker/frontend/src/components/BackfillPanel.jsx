import { Fragment, useEffect, useState } from "react";
import { api } from "../api";

/**
 * One-time marking of curriculum covered BEFORE the app started collecting
 * POWs, for the subject's SME (and the curriculum administrators).
 *
 * Only months already past are listed — in August that is April to July.
 * Ticking a chapter counts every topic, sub-topic and session in it as done.
 * Leaving it unticked opens its topics/sub-topics, so a partly-taught chapter
 * can be marked precisely.
 *
 * Teachers filing POWs does NOT close it — only the SME confirming that the
 * teacher's past coverage is complete does, and that can be reopened.
 */
export default function BackfillPanel({ token, subject, grade, teachers = [] }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState({});
  // Marking is per teacher: two teachers sharing a class can be at different
  // points, so each is marked on their own.
  const [teacher, setTeacher] = useState("");

  useEffect(() => { setTeacher(""); setData(null); }, [subject, grade]);

  useEffect(() => {
    if (!subject || !grade || !teacher) { setData(null); return; }
    setError(""); setSaved(false);
    api.getBackfill(token, subject, grade, teacher)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [token, subject, grade, teacher]);

  async function reopen() {
    setSaving(true);
    setError("");
    try {
      await api.reopenBackfill(token, { subject, grade: Number(grade), teacher_email: teacher });
      setData(await api.getBackfill(token, subject, grade, teacher));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!subject || !grade) return null;

  const picker = (
    <div className="form-group backfill-picker">
      <label className="form-label">Mark past coverage for</label>
      <select className="form-control" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
        <option value="">— select teacher —</option>
        {teachers.map((t) => (
          <option key={t.email} value={t.email}>{t.name || t.email}</option>
        ))}
      </select>
      {teachers.length === 0 && (
        <div className="hint-text">No teachers found for {subject} — nothing to mark.</div>
      )}
    </div>
  );

  if (!teacher) {
    return (
      <div className="backfill-panel">
        <div className="section-title">✅ Mark what was already covered</div>
        <div className="hint-text">
          Per teacher, for the months before this one — so a class that was already part-way through the
          curriculum isn&apos;t reported as fully behind. Stays open until you confirm it&apos;s complete.
        </div>
        {picker}
      </div>
    );
  }
  if (error) return <div className="backfill-panel">{picker}<div className="upload-note backfill-note">{error}</div></div>;
  if (!data) return <div className="backfill-panel">{picker}</div>;

  const teacherName = (teachers.find((t) => t.email === teacher) || {}).name || teacher;

  if (data.locked) {
    return (
      <div className="backfill-panel">
        {picker}
        <div className="upload-note backfill-note">
          Past coverage for {teacherName} — {subject} Grade {grade} was confirmed complete
          {data.confirmed_by ? ` by ${data.confirmed_by}` : ""}
          {data.confirmed_at ? ` on ${data.confirmed_at.slice(0, 10)}` : ""}.
          <button className="btn btn-ghost btn-sm backfill-month-btn" disabled={saving} onClick={reopen}>
            Reopen for changes
          </button>
        </div>
      </div>
    );
  }

  if (data.chapters.length === 0) {
    return (
      <div className="backfill-panel">
        {picker}
        <div className="upload-note backfill-note">
          Nothing to mark for {subject} Grade {grade} — no curriculum is planned for the months before this one.
        </div>
      </div>
    );
  }

  const chapterKey = (c) => `${c.month}|${c.chapter_name}`;

  function toggleChapter(target) {
    setData((prev) => ({
      ...prev,
      chapters: prev.chapters.map((c) =>
        chapterKey(c) === chapterKey(target)
          ? { ...c, done: !c.done, items: c.items.map((i) => ({ ...i, done: false })) }
          : c),
    }));
    setSaved(false);
  }

  function toggleItem(target, label) {
    setData((prev) => ({
      ...prev,
      chapters: prev.chapters.map((c) =>
        chapterKey(c) === chapterKey(target)
          ? { ...c, items: c.items.map((i) => (i.label === label ? { ...i, done: !i.done } : i)) }
          : c),
    }));
    setSaved(false);
  }

  function markMonth(month, done) {
    setData((prev) => ({
      ...prev,
      chapters: prev.chapters.map((c) =>
        c.month === month ? { ...c, done, items: c.items.map((i) => ({ ...i, done: false })) } : c),
    }));
    setSaved(false);
  }

  async function save(opts = {}) {
    if (!opts.silent) setSaving(true);
    setError("");
    const marks = [];
    data.chapters.forEach((c) => {
      if (c.done) {
        marks.push({ month: c.month, chapter_name: c.chapter_name, subtopic: null, done: true });
      } else {
        c.items.filter((i) => i.done).forEach((i) => {
          marks.push({ month: c.month, chapter_name: c.chapter_name, subtopic: i.label, done: true });
        });
      }
    });
    try {
      await api.saveBackfill(token, { subject, grade: Number(grade), teacher_email: teacher, marks });
      if (!opts.silent) {
        setSaved(true);
        setData(await api.getBackfill(token, subject, grade, teacher));
      }
    } catch (err) {
      setError(err.message);
      if (opts.silent) throw err;      // let confirmDone() stop on a failed save
    } finally {
      if (!opts.silent) setSaving(false);
    }
  }

  async function confirmDone() {
    setSaving(true);
    setError("");
    try {
      await save({ silent: true });
      await api.confirmBackfill(token, { subject, grade: Number(grade), teacher_email: teacher });
      setData(await api.getBackfill(token, subject, grade, teacher));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const markedChapters = data.chapters.filter((c) => c.done).length;
  const partial = data.chapters.filter((c) => !c.done && c.items.some((i) => i.done)).length;

  return (
    <div className="backfill-panel">
      {picker}
      <button className="lag-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`lag-caret ${open ? "lag-caret-open" : ""}`}>▸</span>
        <span className="section-title lag-title">✅ {teacherName} — mark what was already covered</span>
        <span className="lag-summary">
          {markedChapters} of {data.chapters.length} chapters{partial > 0 ? ` · ${partial} partly` : ""}
        </span>
      </button>

      {open && (
        <>
          <div className="hint-text">
            For {data.months.join(", ")} — the months before this one. Tick a chapter to count all its
            topics, sub-topics and sessions as done. Leave it unticked to mark only some of its topics.
            Teachers filing POWs doesn&apos;t close this; it stays open until you confirm
            {" "}{teacherName}&apos;s past coverage is complete.
          </div>

          {saved && <div className="upload-success">Saved. The progress and lag reports now treat these as covered.</div>}

          <div className="card upload-preview-table">
            <table>
              <thead>
                <tr><th>Month</th><th>Chapter</th><th>Sessions</th><th>Covered</th><th /></tr>
              </thead>
              <tbody>
                {data.months.map((month) => {
                  const inMonth = data.chapters.filter((c) => c.month === month);
                  if (inMonth.length === 0) return null;
                  return (
                    <Fragment key={month}>
                      <tr className="backfill-month-row">
                        <td colSpan={5}>
                          <strong>{month}</strong>
                          <button className="btn btn-ghost btn-sm backfill-month-btn" onClick={() => markMonth(month, true)}>
                            Mark whole month done
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => markMonth(month, false)}>Clear</button>
                        </td>
                      </tr>
                      {inMonth.map((c) => (
                        <Fragment key={chapterKey(c)}>
                          <tr>
                            <td />
                            <td>{c.chapter_name}</td>
                            <td>{c.sessions}</td>
                            <td>
                              <label className="checkbox-item">
                                <input type="checkbox" checked={c.done} onChange={() => toggleChapter(c)} />
                                done
                              </label>
                            </td>
                            <td>
                              {!c.done && c.items.length > 0 && (
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => setExpanded({ ...expanded, [chapterKey(c)]: !expanded[chapterKey(c)] })}
                                >
                                  {expanded[chapterKey(c)]
                                    ? "Hide"
                                    : `${c.items.filter((i) => i.done).length}/${c.items.length} topics`}
                                </button>
                              )}
                            </td>
                          </tr>
                          {!c.done && expanded[chapterKey(c)] && (
                            <tr>
                              <td colSpan={5} className="grade-detail-cell">
                                <div className="checkbox-list">
                                  {c.items.map((i) => (
                                    <label className="checkbox-item" key={i.label}>
                                      <input type="checkbox" checked={i.done} onChange={() => toggleItem(c, i.label)} />
                                      {i.label}
                                    </label>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="form-actions">
            <span className="hint-text">
              Save as often as you like — this stays open, even after teachers start filing POWs. Confirm
              only when {teacherName}&apos;s past coverage is complete.
            </span>
            <div className="backfill-actions">
              <button className="btn btn-ghost" disabled={saving} onClick={() => save()}>
                {saving ? "Saving…" : "Save coverage"}
              </button>
              <button className="btn btn-primary" disabled={saving} onClick={confirmDone}>
                Save &amp; confirm done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
