import { useEffect, useState } from "react";
import { api } from "../api";

// A monthly or termly goal whose period has rolled over is offered back to its
// owner here. Deliberately a prompt rather than an automatic copy: most people
// will want some of last month's goals again and not others, and quietly
// recreating all of them would fill both their list and their reviewer's queue.
export default function RepeatPrompt({ token, onAdded }) {
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setSuggestions(await api.getRepeatSuggestions(token));
    } catch {
      // Non-critical: the goals themselves still load.
    }
  }

  useEffect(() => { load(); }, []);

  async function add(s) {
    setBusy(s.goal_id);
    setError("");
    try {
      await api.repeatGoal(token, s.goal_id);
      await load();
      onAdded && onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function skip(s) {
    setBusy(s.goal_id);
    try {
      await api.dismissRepeat(token, s.root_goal_id, s.instance_key);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (suggestions.length === 0) return null;

  return (
    <div className="repeat-prompt">
      <div className="repeat-prompt-head">
        Set {suggestions.length === 1 ? "this goal" : "these goals"} again for {suggestions[0].period_label}?
      </div>
      {error && <div className="form-error">{error}</div>}
      {suggestions.map((s) => (
        <div className="repeat-row" key={`${s.root_goal_id}-${s.instance_key}`}>
          <span className="repeat-title">{s.title}</span>
          <span className="hint-text repeat-meta">
            {s.cadence === "mid_term" ? "Role" : "Organisation"} · was {s.period === "month" ? "monthly" : "termly"}
          </span>
          <span className="repeat-actions">
            <button className="btn btn-primary btn-sm" disabled={busy === s.goal_id} onClick={() => add(s)}>
              Set for {s.period_label}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy === s.goal_id} onClick={() => skip(s)}>
              Not this {s.period === "month" ? "month" : "term"}
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
