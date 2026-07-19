import { useEffect, useRef, useState } from "react";

// Mon-first column order, matching the school week used everywhere else in
// this app (DAY_NAMES = Mon..Fri on the backend) - Saturday/Sunday are shown
// but greyed out and unclickable, since the timetable only ever has Mon-Fri
// periods (day_of_week 0-4) and the backend already rejects anything else.
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toISO(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseISO(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isWeekend(date) {
  const day = date.getDay(); // 0=Sun, 6=Sat
  return day === 0 || day === 6;
}

// No date-picker library is installed in this project - this is a small
// from-scratch calendar rather than a native <input type="date">, since the
// native control has no way to disable specific weekdays (only a min/max
// range), and greying out Sundays needs exactly that.
export default function DatePicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = parseISO(value) || new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const today = startOfDay(new Date());
  const selected = value ? parseISO(value) : null;

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekdayMonBased = (firstOfMonth.getDay() + 6) % 7; // 0=Mon..6=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = Array(firstWeekdayMonBased).fill(null).concat(
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
  );

  const isDisabledDay = (d) => {
    const date = new Date(year, month, d);
    return date < today || isWeekend(date);
  };

  const pick = (d) => {
    if (isDisabledDay(d)) return;
    onChange(toISO(year, month, d));
    setOpen(false);
  };

  const label = selected
    ? selected.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })
    : "Select date";

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button" className="input" style={{ textAlign: "left", cursor: disabled ? "default" : "pointer", minWidth: 180 }}
        onClick={() => !disabled && setOpen((v) => !v)} disabled={disabled}
      >
        {label}
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20,
            background: "#fff", border: "1px solid var(--border)", borderRadius: 8,
            padding: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.15)", width: 240,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <button
              type="button" className="btn secondary" style={{ padding: "2px 8px" }}
              onClick={() => setViewMonth(new Date(year, month - 1, 1))}
            >
              ‹
            </button>
            <strong style={{ fontSize: 13 }}>
              {viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </strong>
            <button
              type="button" className="btn secondary" style={{ padding: "2px 8px" }}
              onClick={() => setViewMonth(new Date(year, month + 1, 1))}
            >
              ›
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
            {WEEKDAY_LABELS.map((w) => <div key={w} style={{ textAlign: "center" }}>{w}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {cells.map((d, i) => {
              if (d === null) return <div key={`blank-${i}`} />;
              const disabledDay = isDisabledDay(d);
              const isSelected = !!selected && selected.getFullYear() === year && selected.getMonth() === month && selected.getDate() === d;
              return (
                <button
                  key={d} type="button" onClick={() => pick(d)} disabled={disabledDay}
                  style={{
                    padding: "4px 0", fontSize: 12, borderRadius: 4, border: "none",
                    background: isSelected ? "var(--blue)" : "transparent",
                    color: disabledDay ? "#ccc" : (isSelected ? "#fff" : "var(--text)"),
                    cursor: disabledDay ? "not-allowed" : "pointer",
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
