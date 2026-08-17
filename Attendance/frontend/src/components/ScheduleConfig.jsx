import { useEffect, useState } from "react";
import { fetchCurrentSchedule, replaceSchedule, fetchCustomScheduleStaffIds, WEEKDAY_LABELS, SATURDAY_OCCURRENCES } from "../lib/scheduleApi";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon..Fri. Sunday is always off (never configured);
                                  // Saturday (6) has its own section below.
const DEFAULT_SATURDAYS_OFF = [1, 3]; // 1st & 3rd Saturday off by default.

function trimTime(t) {
  return t ? t.slice(0, 5) : "";
}

function ordinal(o) {
  return o === 5 ? "5th" : `${o}${["st", "nd", "rd"][o - 1] ?? "th"}`;
}

function newRule() {
  return {
    key: `new-${Math.random().toString(36).slice(2)}`,
    checkInTime: "",
    checkOutTime: "",
    graceMinutes: "0",
    days: new Set(),
  };
}

function defaultSaturday() {
  return {
    checkInTime: "",
    checkOutTime: "",
    graceMinutes: "0",
    offOccurrences: new Set(DEFAULT_SATURDAYS_OFF),
  };
}

// Regroup existing Mon-Fri rows into rule cards for editing (rows with the same
// time/grace merge into one rule). Saturday and Sunday are handled separately.
// Saving always replaces the whole schedule wholesale, so an imperfect regroup
// here can't corrupt anything.
function rowsToRules(rows) {
  const groups = new Map();
  rows
    .filter((r) => r.is_working_day && r.weekday >= 1 && r.weekday <= 5)
    .forEach((row) => {
      const sig = `${row.check_in_time}|${row.check_out_time}|${row.grace_minutes}`;
      if (!groups.has(sig)) {
        groups.set(sig, {
          key: sig,
          checkInTime: trimTime(row.check_in_time),
          checkOutTime: trimTime(row.check_out_time),
          graceMinutes: String(row.grace_minutes ?? 0),
          days: new Set(),
        });
      }
      groups.get(sig).days.add(row.weekday);
    });
  const rules = [...groups.values()];
  return rules.length > 0 ? rules : [newRule()];
}

// Derive the Saturday section from existing weekday=6 rows.
function rowsToSaturday(rows) {
  const satRows = rows.filter((r) => r.weekday === 6);
  if (satRows.length === 0) return defaultSaturday();

  const working = satRows.filter((r) => r.is_working_day);
  const workingOcc = new Set();
  working.forEach((r) => (r.week_occurrence ?? SATURDAY_OCCURRENCES).forEach((o) => workingOcc.add(o)));
  const off = SATURDAY_OCCURRENCES.filter((o) => !workingOcc.has(o));

  const t = working[0];
  return {
    checkInTime: t ? trimTime(t.check_in_time) : "",
    checkOutTime: t ? trimTime(t.check_out_time) : "",
    graceMinutes: String(t?.grace_minutes ?? 0),
    offOccurrences: new Set(off),
  };
}

function buildDesiredRows(rules, saturday) {
  const desired = [];
  const claimedWeekdays = new Set();

  rules.forEach((rule) => {
    // A rule with no check-in AND no check-out marks those days OFF, not
    // "working with no times" (which would compute as absent, not holiday).
    const isWorkingDay = rule.checkInTime.trim() !== "" || rule.checkOutTime.trim() !== "";
    const common = { checkInTime: rule.checkInTime, checkOutTime: rule.checkOutTime, graceMinutes: parseInt(rule.graceMinutes, 10) || 0 };
    rule.days.forEach((weekday) => {
      claimedWeekdays.add(weekday);
      desired.push({ weekday, isWorkingDay, weekOccurrence: null, ...common });
    });
  });

  // Any Mon-Fri not covered by a rule is an off day.
  WEEKDAYS.forEach((weekday) => {
    if (!claimedWeekdays.has(weekday)) {
      desired.push({ weekday, isWorkingDay: false, weekOccurrence: null, checkInTime: "", checkOutTime: "", graceMinutes: 0 });
    }
  });

  // Saturday: the occurrences NOT marked off are working (with the Saturday
  // timing); the ones marked off get an explicit off row.
  const off = [...saturday.offOccurrences];
  const working = SATURDAY_OCCURRENCES.filter((o) => !saturday.offOccurrences.has(o));
  const satCommon = {
    checkInTime: saturday.checkInTime,
    checkOutTime: saturday.checkOutTime,
    graceMinutes: parseInt(saturday.graceMinutes, 10) || 0,
  };
  if (working.length > 0) {
    desired.push({ weekday: 6, isWorkingDay: true, weekOccurrence: working, ...satCommon });
  }
  if (off.length > 0) {
    desired.push({ weekday: 6, isWorkingDay: false, weekOccurrence: off, checkInTime: "", checkOutTime: "", graceMinutes: 0 });
  }

  return desired;
}

// Either `staff` (single person, loads/edits their existing schedule) or
// `staffList` (a category's worth of people - starts blank, saving applies
// the same rules to everyone in the list).
export default function ScheduleConfig({ client, staff, staffList, currentUserEmail }) {
  const isGroup = !!staffList;
  const [rules, setRules] = useState(() => [newRule()]);
  const [saturday, setSaturday] = useState(defaultSaturday);
  const [loading, setLoading] = useState(!isGroup);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isGroup) {
      setRules([newRule()]);
      setSaturday(defaultSaturday());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchCurrentSchedule(client, staff.id).then((rows) => {
      if (cancelled) return;
      setRules(rowsToRules(rows));
      setSaturday(rowsToSaturday(rows));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, isGroup, staff?.id]);

  function updateRule(key, patch) {
    setRules((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function toggleDay(ruleKey, weekday) {
    setRules((prev) =>
      prev.map((r) => {
        if (r.key !== ruleKey) return r;
        const days = new Set(r.days);
        if (days.has(weekday)) days.delete(weekday);
        else days.add(weekday);
        return { ...r, days };
      })
    );
  }

  function toggleSaturdayOff(occurrence) {
    setSaturday((prev) => {
      const offOccurrences = new Set(prev.offOccurrences);
      if (offOccurrences.has(occurrence)) offOccurrences.delete(occurrence);
      else offOccurrences.add(occurrence);
      return { ...prev, offOccurrences };
    });
  }

  function addRule() {
    setRules((prev) => [...prev, newRule()]);
  }

  function removeRule(key) {
    setRules((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  function validate() {
    for (const rule of rules) {
      if (rule.days.size === 0) continue;
      if (rule.checkInTime && !TIME_RE.test(rule.checkInTime)) return "Check-in time must be HH:MM (24h)";
      if (rule.checkOutTime && !TIME_RE.test(rule.checkOutTime)) return "Check-out time must be HH:MM (24h)";
    }
    // If any Saturday is working, it needs a valid timing.
    const anySaturdayWorking = SATURDAY_OCCURRENCES.some((o) => !saturday.offOccurrences.has(o));
    if (anySaturdayWorking) {
      if (!TIME_RE.test(saturday.checkInTime) || !TIME_RE.test(saturday.checkOutTime)) {
        return "Set a valid Saturday check-in and check-out time (HH:MM), or mark all Saturdays off.";
      }
    }
    return null;
  }

  async function saveAll() {
    setMessage(null);
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    const activeRules = rules.filter((r) => r.days.size > 0);
    const desiredRows = buildDesiredRows(activeRules, saturday);
    setSaving(true);
    try {
      if (isGroup) {
        // Don't clobber anyone whose schedule was set By Person (is_custom) - a
        // category apply skips them.
        const custom = await fetchCustomScheduleStaffIds(client, staffList.map((p) => p.id));
        const targets = staffList.filter((p) => !custom.has(p.id));
        for (const person of targets) {
          await replaceSchedule(client, { staffId: person.id, desiredRows, updatedBy: currentUserEmail, isCustom: false });
        }
        const skipped = staffList.length - targets.length;
        setMessage(
          `Schedule applied to ${targets.length} staff member${targets.length !== 1 ? "s" : ""}` +
            (skipped > 0 ? `; skipped ${skipped} with a custom (By Person) schedule.` : ".")
        );
      } else {
        // By Person always protects the person from a later category apply.
        await replaceSchedule(client, { staffId: staff.id, desiredRows, updatedBy: currentUserEmail, isCustom: true });
        setMessage(`Schedule updated for ${staff.name} (protected from category apply).`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="hint">Loading schedule…</p>;

  const satWorkingOccurrences = SATURDAY_OCCURRENCES.filter((o) => !saturday.offOccurrences.has(o));

  return (
    <div>
      <p className="hint">
        {isGroup
          ? `Set weekday timing and tick which days it applies to - this replaces the schedule for all ${staffList.length} staff member${staffList.length > 1 ? "s" : ""} in this category. Sundays are always off.`
          : `Set weekday timing and tick which days it applies to for ${staff.name}. Sundays are always off; Saturday has its own timing below.`}
      </p>

      {rules.map((rule, idx) => (
        <div key={rule.key} className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{idx === 0 ? "Weekday timing (Mon-Fri)" : `Different timing ${idx}`}</strong>
            {rules.length > 1 ? (
              <button className="btn-link" onClick={() => removeRule(rule.key)}>
                Remove
              </button>
            ) : null}
          </div>
          <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
            Leave both times blank to mark the ticked days as off instead of working.
          </p>

          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="field-label">Check-in</label>
              <input type="text" placeholder="08:07" value={rule.checkInTime} onChange={(e) => updateRule(rule.key, { checkInTime: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label">Check-out</label>
              <input type="text" placeholder="14:10" value={rule.checkOutTime} onChange={(e) => updateRule(rule.key, { checkOutTime: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label">Grace (min)</label>
              <input type="number" value={rule.graceMinutes} onChange={(e) => updateRule(rule.key, { graceMinutes: e.target.value })} />
            </div>
          </div>

          <label className="field-label">Applies on</label>
          <div className="category-chips">
            {WEEKDAYS.map((weekday) => (
              <button key={weekday} className={rule.days.has(weekday) ? "chip chip-active" : "chip"} onClick={() => toggleDay(rule.key, weekday)}>
                {WEEKDAY_LABELS[weekday]}
              </button>
            ))}
          </div>
        </div>
      ))}

      <button className="btn-link" onClick={addRule}>
        + Add a rule for weekdays with different timing
      </button>

      <div className="card" style={{ marginTop: 12 }}>
        <strong>Saturday</strong>
        <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
          Saturday timing (used for every working Saturday). Then pick which Saturdays are OFF - the rest are working.
        </p>

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">Sat check-in</label>
            <input type="text" placeholder="08:07" value={saturday.checkInTime} onChange={(e) => setSaturday((p) => ({ ...p, checkInTime: e.target.value }))} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">Sat check-out</label>
            <input type="text" placeholder="12:30" value={saturday.checkOutTime} onChange={(e) => setSaturday((p) => ({ ...p, checkOutTime: e.target.value }))} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">Grace (min)</label>
            <input type="number" value={saturday.graceMinutes} onChange={(e) => setSaturday((p) => ({ ...p, graceMinutes: e.target.value }))} />
          </div>
        </div>

        <label className="field-label">Saturdays OFF (tap to toggle)</label>
        <div className="category-chips">
          {SATURDAY_OCCURRENCES.map((occurrence) => (
            <button key={occurrence} className={saturday.offOccurrences.has(occurrence) ? "chip chip-active" : "chip"} onClick={() => toggleSaturdayOff(occurrence)}>
              {ordinal(occurrence)}
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          {saturday.offOccurrences.size === SATURDAY_OCCURRENCES.length
            ? "All Saturdays off."
            : `Off: ${[...saturday.offOccurrences].sort().map(ordinal).join(", ") || "none"} · Working: ${satWorkingOccurrences.map(ordinal).join(", ")}`}
        </p>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="hint" style={{ color: "var(--green)" }}>{message}</p> : null}

      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={saving} onClick={saveAll}>
        {saving ? "Saving…" : isGroup ? `Apply to ${staffList.length} staff` : "Save schedule"}
      </button>
    </div>
  );
}
