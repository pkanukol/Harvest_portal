import { Fragment, useEffect, useState } from "react";
import { api } from "../api";

/**
 * Marking of curriculum already covered for a CLASS — per subject + grade, not
 * per teacher: the curriculum was taught (or not) for the class, whoever took
 * the sessions.
 *
 * Covers April up to and including the current month. Ticking a chapter counts
 * every topic, sub-topic and session in it as done; leaving it unticked opens
 * its topics/sub-topics so a partly-taught chapter can be marked precisely.
 *
 * Teachers filing POWs does NOT close it — only the SME confirming that
 * coverage is complete does, and that can be reopened.
 */
export default function BackfillPanel({ token, subject, grade, branch = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState({});

  function load() {
    setError("");
    setSaved(false);
    api.getBackfill(token, subject, grade, branch)
      .then(setData)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (!subject || !grade) { setData(null); return; }
    load();
  }, [token, subject, grade, branch]);

  if (!subject || !grade) return null;
  if (error) return <div className="upload-note backfill-note">{error}</div>;
  if (!data) return null;

  // Coverage is per campus, so the panel names the one it will write to and
  // will not let a mark be saved against "All branches" - that is what made
  // the earlier marks count for both.
  const title = `${subject} Grade ${grade}${branch ? ` · ${branch}` : ""}`;
  const noCampus = !branch;

  async function reopen() {
    setSaving(true);
    setError("");
    try {
      await api.reopenBackfill(token, { subject, grade: Number(grade), branch });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (data.locked) {
    return (
      <div className="backfill-panel">
        <div className="upload-note backfill-note">
          Coverage for {title} was confirmed complete
          {data.confirmed_by ? ` by ${data.confirmed_by}` : ""}
          {data.confirmed_at ? ` on ${data.confirmed_at.slice(0, 10)}` : ""}.
          <button className="btn btn-ghost btn-sm backfill-month-btn" disabled={saving || noCampus} onClick={reopen}>
            Reopen for changes
          </button>
          {noCampus && (
            <div className="hint-text">
              Choose <strong>Kodathi</strong> or <strong>Attibele</strong> at the top of the page to
              reopen it — each campus is confirmed separately.
            </div>
          )}
        </div>
      </div>
    );
  }

  if (data.chapters.length === 0) {
    return (
      <div className="backfill-panel">
        <div className="upload-note backfill-note">
          Nothing to mark for {title} — no curriculum is planned for {data.months.join(", ")}.
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
      await api.saveBackfill(token, { subject, grade: Number(grade), branch, marks });
      if (!opts.silent) { setSaved(true); load(); }
    } catch (err) {
      setError(err.message);
      if (opts.silent) throw err;
    } finally {
      if (!opts.silent) setSaving(false);
    }
  }

  async function confirmDone() {
    setSaving(true);
    setError("");
    try {
      await save({ silent: true });
      await api.confirmBackfill(token, { subject, grade: Number(grade), branch });
      load();
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
      <button className="lag-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`lag-caret ${open ? "lag-caret-open" : ""}`}>▸</span>
        <span className="section-title lag-title">✅ Mark what was already covered — {title}</span>
        <span className="lag-summary">
          {markedChapters} of {data.chapters.length} chapters{partial > 0 ? ` · ${partial} partly` : ""}
        </span>
      </button>

      {open && (
        <>
          <div className="hint-text">
            For {data.months.join(", ")} — this year to date. Tick a chapter to count all its topics,
            sub-topics and sessions as done. Leave it unticked to mark only some of its topics. Teachers
            filing POWs doesn&apos;t close this; it stays open until you confirm coverage is complete.
          </div>

          {noCampus && (
            <div className="upload-note backfill-note">
              Choose <strong>Kodathi</strong> or <strong>Attibele</strong> at the top of the page
              first. Each campus is marked separately, because they teach the same grade at their
              own pace.
            </div>
          )}

          {saved && (
            <div className="upload-success">
              Saved for {branch}. The progress and lag reports now treat these as covered there.
            </div>
          )}

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
                          {month === data.months[data.months.length - 1] && (
                            <span className="hint-text backfill-current"> (current month)</span>
                          )}
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
              Save as often as you like — this stays open. Confirm only when coverage for {title} is complete.
            </span>
            <div className="backfill-actions">
              <button className="btn btn-ghost" disabled={saving || noCampus} onClick={() => save()}>
                {saving ? "Saving…" : "Save coverage"}
              </button>
              <button className="btn btn-primary" disabled={saving || noCampus} onClick={confirmDone}>
                Save &amp; confirm done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
