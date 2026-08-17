import { useEffect, useState } from "react";
import { searchStaff, fetchDistinctCategoryValues, fetchStaffByCategoryValue, CATEGORY_FIELDS } from "../lib/staffMaster";
import { fetchStatsForStaffIds } from "../lib/reportsApi";
import BranchChips from "../components/BranchChips";

const YEAR = new Date().getFullYear();

function StatCard({ name, subtitle, stats, onViewCalendar }) {
  return (
    <div className="card stat-card" style={{ marginTop: 12, flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <strong>{name}</strong>
          {subtitle ? <div className="hint" style={{ margin: 0 }}>{subtitle}</div> : null}
        </div>
        {onViewCalendar ? (
          <button className="btn-link" onClick={onViewCalendar}>View calendar →</button>
        ) : null}
      </div>
      <div className="stat-numbers" style={{ marginTop: 10 }}>
        <div className="stat-box">
          <div className="stat-value">{stats.lateCount}</div>
          <div className="stat-label">Late</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{stats.shortCount}</div>
          <div className="stat-label">Early exit</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{stats.leavesTaken}</div>
          <div className="stat-label">Leaves</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{stats.leaveBalance}</div>
          <div className="stat-label">Balance</div>
        </div>
      </div>
    </div>
  );
}

export default function ReportsPage({ client, staffRow, branches = [], onViewCalendar }) {
  const [branch, setBranch] = useState(branches[0] || null);
  const [mode, setMode] = useState("person");

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [personStats, setPersonStats] = useState(null);

  const [categoryField, setCategoryField] = useState("category");
  const [categoryValues, setCategoryValues] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [categoryRows, setCategoryRows] = useState([]);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelectedCategory(null);
    setCategoryRows([]);
    fetchDistinctCategoryValues(client, branch).then(setCategoryValues);
  }, [categoryField, client, branch]);

  useEffect(() => {
    if (mode !== "person" || !query.trim()) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => searchStaff(client, query, branch).then(setSuggestions), 300);
    return () => clearTimeout(timer);
  }, [query, mode]);

  async function selectPerson(person) {
    setSelectedPerson(person);
    setSuggestions([]);
    setQuery(person.name);
    setLoading(true);
    const stats = await fetchStatsForStaffIds(client, [person.id], YEAR);
    setPersonStats(stats[person.id]);
    setLoading(false);
  }

  async function selectCategory(value) {
    setSelectedCategory(value);
    setLoading(true);
    const people = await fetchStaffByCategoryValue(client, value, branch);
    const stats = await fetchStatsForStaffIds(client, people.map((p) => p.id), YEAR);
    setCategoryRows(people.map((p) => ({ person: p, stats: stats[p.id] })));
    setLoading(false);
  }

  return (
    <div>
      <BranchChips branches={branches} value={branch} onChange={setBranch} label="Branch" />
      <div className="mode-toggle">
        <button className={mode === "person" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setMode("person")}>By person</button>
        <button className={mode === "category" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setMode("category")}>By category</button>
      </div>
      <p className="hint">Showing {YEAR} year-to-date</p>

      {mode === "person" ? (
        <>
          <input
            type="search"
            placeholder="Search name, email, or designation"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedPerson(null);
              setPersonStats(null);
            }}
          />
          {suggestions.length > 0 ? (
            <div className="suggestion-list">
              {suggestions.map((item) => (
                <div key={item.id} className="suggestion-row" onClick={() => selectPerson(item)}>
                  <strong>{item.name}</strong>
                  <div className="hint" style={{ margin: 0 }}>{item.designation} · {item.email}</div>
                </div>
              ))}
            </div>
          ) : null}

          {loading ? <p className="hint">Loading…</p> : null}

          {selectedPerson && personStats ? (
            <StatCard name={selectedPerson.name} subtitle={selectedPerson.designation} stats={personStats} onViewCalendar={() => onViewCalendar(selectedPerson)} />
          ) : null}
        </>
      ) : (
        <>
          <label className="field-label">Group by</label>
          <div className="category-chips">
            {CATEGORY_FIELDS.map((f) => (
              <button
                key={f.key}
                className={f.key === categoryField ? "chip chip-active" : "chip"}
                onClick={() => setCategoryField(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="category-chips">
            {categoryValues.map((v) => (
              <button key={v} className={v === selectedCategory ? "chip chip-active" : "chip"} onClick={() => selectCategory(v)}>
                {v}
              </button>
            ))}
          </div>

          {loading ? <p className="hint">Loading…</p> : null}

          {!loading && selectedCategory ? (
            categoryRows.length === 0 ? (
              <p className="empty-text">No staff found in this category for your branch.</p>
            ) : (
              categoryRows.map(({ person, stats }) => (
                <StatCard key={person.id} name={person.name} subtitle={person.email} stats={stats} onViewCalendar={() => onViewCalendar(person)} />
              ))
            )
          ) : null}
        </>
      )}
    </div>
  );
}
