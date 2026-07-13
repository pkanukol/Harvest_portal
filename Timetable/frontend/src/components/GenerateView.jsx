import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Spinner } from "./TimetableGrid";

const FOCUS_MAX_GRADE = 5;

function gapKey(g) {
  return `${g.section_id}-${g.gsp_id}`;
}

export default function GenerateView({ token, activeYear, onNext, onGoToImport }) {
  const [generating, setGenerating] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [gapsLoading, setGapsLoading] = useState(true);
  const [gaps, setGaps] = useState(null);
  const [placedCount, setPlacedCount] = useState(null);
  const [error, setError] = useState("");
  const [scoped, setScoped] = useState(false);
  const [sectionsInput, setSectionsInput] = useState("");
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [showAllGrades, setShowAllGrades] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  const loadGaps = useCallback(async () => {
    if (!activeYear) return;
    setGapsLoading(true);
    try {
      const result = await api.getGaps(token, activeYear.id);
      setGaps(result);
      setSelectedKeys(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setGapsLoading(false);
    }
  }, [token, activeYear]);

  useEffect(() => { loadGaps(); }, [loadGaps]);

  const visibleGaps = useMemo(() => {
    if (!gaps) return [];
    return showAllGrades ? gaps : gaps.filter((g) => g.grade_order_index <= FOCUS_MAX_GRADE);
  }, [gaps, showAllGrades]);
  const hiddenCount = gaps ? gaps.length - gaps.filter((g) => g.grade_order_index <= FOCUS_MAX_GRADE).length : 0;

  const toggleKey = (key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedKeys((prev) => {
      const allSelected = visibleGaps.length > 0 && visibleGaps.every((g) => prev.has(gapKey(g)));
      if (allSelected) return new Set();
      return new Set(visibleGaps.map(gapKey));
    });
  };

  const run = async () => {
    if (scoped && !sectionsInput.trim()) {
      setError("Enter at least one grade+section (e.g. 6A 6F 7C), or switch to \"Generate for all\".");
      return;
    }
    setGenerating(true);
    setError("");
    setPlacedCount(null);
    try {
      const res = await api.generate(token, activeYear.id, scoped ? sectionsInput.trim() : undefined);
      setPlacedCount(res.placed_count);
      setGaps(res.gaps);
      setSelectedKeys(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const saveTimetable = async () => {
    setSaving(true);
    setError("");
    setSavedMsg("");
    try {
      const res = await api.saveTimetable(token, activeYear.id);
      setSavedMsg(
        res.locked > 0
          ? `Saved — ${res.locked} period(s) are now locked in. Regenerating (full or scoped) from here on will only fill in new gaps, never rearrange this.`
          : "Already saved — nothing new to lock in."
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const fixSelected = async () => {
    if (selectedKeys.size === 0) return;
    const targets = visibleGaps
      .filter((g) => selectedKeys.has(gapKey(g)))
      .map((g) => ({ section_id: g.section_id, gsp_id: g.gsp_id }));
    setFixing(true);
    setError("");
    setPlacedCount(null);
    try {
      const res = await api.generateSelected(token, activeYear.id, targets);
      setPlacedCount(res.placed_count);
      setGaps(res.gaps);
      setSelectedKeys(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setFixing(false);
    }
  };

  if (!activeYear) {
    return (
      <div className="card">
        <p>Import a workbook first — there's no active academic year yet.</p>
        {onGoToImport && <button className="btn" onClick={onGoToImport}>+ Add / Update Workbook</button>}
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h2>Generate timetable — {activeYear.label}</h2>
        {onGoToImport && (
          <button className="btn secondary" onClick={onGoToImport}>+ Add / Update Workbook</button>
        )}
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Fills every section's weekly grid, avoiding teacher/section double-booking. Manually-edited slots from a
        previous run are kept — only auto-generated slots are replaced. The list below always reflects what's
        currently missing, live — it persists across tab switches and updates as you fix things in the Timetable tab.
      </p>

      <div className="card" style={{ background: "var(--gray)", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Happy with the current timetable? Save it to lock it in — a future Generate run (by you or anyone else)
          will then only fill in new gaps and will never wipe or rearrange what's already placed.
        </div>
        <button className="btn" onClick={saveTimetable} disabled={saving}>
          {saving ? <><Spinner /> Saving…</> : "Save Timetable"}
        </button>
      </div>
      {savedMsg && <div className="status-banner ok" style={{ marginBottom: 16 }}>{savedMsg}</div>}

      <div className="card" style={{ background: "var(--gray)", marginBottom: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={scoped} onChange={(e) => setScoped(e.target.checked)} />
          Only regenerate specific sections (leave unchecked to generate for all)
        </label>
        {scoped && (
          <input
            className="input" style={{ width: "100%", marginTop: 8 }}
            placeholder="e.g. 6A 6F 7C 7D"
            value={sectionsInput}
            onChange={(e) => setSectionsInput(e.target.value)}
          />
        )}
      </div>

      <button className="btn" onClick={run} disabled={generating || fixing}>
        {generating ? <><Spinner /> Generating…</> : scoped ? "Generate selected sections" : "Generate for all"}
      </button>
      {error && <div className="status-banner error" style={{ marginTop: 12 }}>{error}</div>}

      {placedCount !== null && (
        <div className="status-banner ok" style={{ marginTop: 16 }}>Placed {placedCount} periods this run.</div>
      )}

      <div style={{ marginTop: 16 }}>
        {gapsLoading ? (
          <p><Spinner /> Checking for gaps…</p>
        ) : visibleGaps.length > 0 ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <h4 style={{ margin: 0 }}>Needs manual attention ({visibleGaps.length})</h4>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={showAllGrades} onChange={(e) => setShowAllGrades(e.target.checked)} />
                  Show grades 6–10 too{!showAllGrades && hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
                </label>
              </div>
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              Focused on grades 1–5 for now. Check the gaps you want fixed and click "Fix selected" — everything
              else stays exactly as it is, nothing gets rearranged.
            </p>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={visibleGaps.length > 0 && visibleGaps.every((g) => selectedKeys.has(gapKey(g)))}
                onChange={toggleAllVisible}
              />
              Select all shown
            </label>
            <ul className="warning-list">
              {visibleGaps.map((g) => {
                const key = gapKey(g);
                return (
                  <li key={key} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input
                      type="checkbox"
                      style={{ marginTop: 3 }}
                      checked={selectedKeys.has(key)}
                      onChange={() => toggleKey(key)}
                    />
                    <span>
                      <strong>{g.grade_name} {g.section_name} — {g.subject}</strong>: {g.missing_periods} period(s) short.
                      <br />Suggestion: {g.suggestion}
                    </span>
                  </li>
                );
              })}
            </ul>
            <button className="btn" onClick={fixSelected} disabled={fixing || generating || selectedKeys.size === 0}>
              {fixing ? <><Spinner /> Fixing…</> : `Fix selected (${selectedKeys.size})`}
            </button>
          </>
        ) : (
          <p>No gaps{!showAllGrades && hiddenCount > 0 ? " in grades 1–5" : ""} — every period is placed without a clash.</p>
        )}
        {!gapsLoading && !showAllGrades && hiddenCount > 0 && visibleGaps.length === 0 && (
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
            <input type="checkbox" checked={showAllGrades} onChange={(e) => setShowAllGrades(e.target.checked)} />
            Show grades 6–10 too ({hiddenCount} hidden)
          </label>
        )}
      </div>

      {gaps !== null && (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <button className="btn" onClick={onNext}>
            {gaps.length === 0 ? "Next: View Timetable →" : "Fix gaps in Timetable →"}
          </button>
        </div>
      )}
    </div>
  );
}
