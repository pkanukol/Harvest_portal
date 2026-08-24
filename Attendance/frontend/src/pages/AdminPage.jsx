import { useEffect, useState } from "react";
import StaffSearchPicker from "../components/StaffSearchPicker";
import StaffListImport from "../components/StaffListImport";
import ScheduleConfig from "../components/ScheduleConfig";
import StaybackOverride from "../components/StaybackOverride";
import BiometricReportImport from "../components/BiometricReportImport";
import FestivalHolidayImport from "../components/FestivalHolidayImport";
import LeavePolicyConfig from "../components/LeavePolicyConfig";
import CalendarOverrideConfig from "../components/CalendarOverrideConfig";
import RolesConfig from "../components/RolesConfig";
import VacationConfig from "../components/VacationConfig";
import DefaultScheduleConfig from "../components/DefaultScheduleConfig";
import WfhManager from "../components/WfhManager";
import AttendanceDiagnostics from "../components/AttendanceDiagnostics";
import BranchChips from "../components/BranchChips";
import { fetchDistinctCategoryValues, fetchStaffByCategoryValue, fetchAllStaff, CATEGORY_FIELDS } from "../lib/staffMaster";

const ALL_MARKER = "__ALL__";

const SECTIONS = [
  { key: "schedule", label: "Schedule" },
  { key: "stayback", label: "Stay-back" },
  { key: "wfh", label: "WFH" },
  { key: "diagnostics", label: "Diagnostics" },
];

function Card({ title, open, onToggle, children }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{title}</strong>
        <button className="btn-link" onClick={onToggle}>{open ? "Hide" : "Show"}</button>
      </div>
      {open ? <div style={{ marginTop: 12 }}>{children}</div> : null}
    </div>
  );
}

// `branches` = the branches this admin may act on (a branch admin: their branch;
// an org leader: all). Branch-specific settings use a per-tab branch chip; shared
// settings use an All|branch chip (default All).
export default function AdminPage({ client, staffRow, branches = [] }) {
  const [adminTab, setAdminTab] = useState("branch"); // 'branch' | 'shared'
  const [branchSel, setBranchSel] = useState(branches[0] || null);
  const [sharedScope, setSharedScope] = useState("ALL");
  const sharedBranch = sharedScope === "ALL" ? null : sharedScope;

  const [configMode, setConfigMode] = useState("person");
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [section, setSection] = useState("schedule");
  const [open, setOpen] = useState({});

  const [categoryField, setCategoryField] = useState("category");
  const [categoryValues, setCategoryValues] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [categoryStaff, setCategoryStaff] = useState(null);

  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  useEffect(() => {
    setSelectedCategory(null);
    setCategoryStaff(null);
    fetchDistinctCategoryValues(client, branchSel).then(setCategoryValues);
  }, [categoryField, client, branchSel]);

  async function selectCategory(value) {
    setSelectedCategory(value);
    const people =
      value === ALL_MARKER
        ? await fetchAllStaff(client, branchSel)
        : await fetchStaffByCategoryValue(client, value, branchSel);
    setCategoryStaff(people);
  }

  return (
    <div>
      <div className="mode-toggle">
        <button className={adminTab === "branch" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setAdminTab("branch")}>
          Branch settings
        </button>
        <button className={adminTab === "shared" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setAdminTab("shared")}>
          Shared settings
        </button>
      </div>

      {adminTab === "branch" ? (
        <>
          <div style={{ marginTop: 10 }}>
            <BranchChips branches={branches} value={branchSel} onChange={setBranchSel} label="Branch" />
          </div>

          <Card title="Roles & Branches" open={open.roles} onToggle={() => toggle("roles")}>
            <RolesConfig client={client} branch={branchSel} />
          </Card>

          <Card title="Import Staff List" open={open.staff} onToggle={() => toggle("staff")}>
            <StaffListImport client={client} />
          </Card>

          <Card title="Import Biometric Report (Basic Work Duration Report)" open={open.bio} onToggle={() => toggle("bio")}>
            <BiometricReportImport client={client} branch={branchSel} />
          </Card>

          <div className="card" style={{ marginTop: 16 }}>
            <strong>Configure Staff Schedule</strong>
            <div className="mode-toggle" style={{ marginTop: 10 }}>
              <button className={configMode === "person" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => { setConfigMode("person"); setSelectedStaff(null); }}>
                By person
              </button>
              <button className={configMode === "category" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => { setConfigMode("category"); setSelectedStaff(null); }}>
                By category
              </button>
            </div>

            {configMode === "person" ? (
              <div style={{ marginTop: 10 }}>
                {selectedStaff ? (
                  <div className="list-row" style={{ paddingTop: 0 }}>
                    <div>
                      <strong>{selectedStaff.name}</strong>
                      <div className="hint" style={{ margin: 0 }}>{selectedStaff.designation} · {selectedStaff.email}</div>
                    </div>
                    <button className="btn-link" onClick={() => setSelectedStaff(null)}>Change staff</button>
                  </div>
                ) : (
                  <StaffSearchPicker client={client} branch={branchSel} onSelect={setSelectedStaff} />
                )}
              </div>
            ) : (
              <div style={{ marginTop: 10 }}>
                <label className="field-label">Group by</label>
                <div className="category-chips">
                  {CATEGORY_FIELDS.map((f) => (
                    <button key={f.key} className={f.key === categoryField ? "chip chip-active" : "chip"} onClick={() => setCategoryField(f.key)}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="category-chips">
                  <button className={selectedCategory === ALL_MARKER ? "chip chip-active" : "chip"} onClick={() => selectCategory(ALL_MARKER)}>All</button>
                  {categoryValues.map((v) => (
                    <button key={v} className={v === selectedCategory ? "chip chip-active" : "chip"} onClick={() => selectCategory(v)}>{v}</button>
                  ))}
                </div>
                {selectedCategory && categoryStaff ? (
                  <p className="hint">
                    {categoryStaff.length} staff member{categoryStaff.length !== 1 ? "s" : ""} in "
                    {selectedCategory === ALL_MARKER ? "All" : selectedCategory}"
                    {categoryStaff.length > 0 ? `: ${categoryStaff.map((s) => s.name).join(", ")}` : ""}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {configMode === "person" && selectedStaff ? (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="subtabs" style={{ marginBottom: 12 }}>
                {SECTIONS.map((s) => (
                  <button key={s.key} className={s.key === section ? "subtab subtab-active" : "subtab"} onClick={() => setSection(s.key)}>{s.label}</button>
                ))}
              </div>
              {section === "schedule" && <ScheduleConfig client={client} staff={selectedStaff} currentUserEmail={staffRow?.email} />}
              {section === "stayback" && <StaybackOverride client={client} staff={selectedStaff} />}
              {section === "wfh" && <WfhManager client={client} staffRow={selectedStaff} currentUserEmail={staffRow?.email} />}
              {section === "diagnostics" && <AttendanceDiagnostics client={client} staff={selectedStaff} />}
            </div>
          ) : null}

          {configMode === "category" && selectedCategory && categoryStaff && categoryStaff.length > 0 ? (
            <div className="card" style={{ marginTop: 16 }}>
              <ScheduleConfig client={client} staffList={categoryStaff} currentUserEmail={staffRow?.email} />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div style={{ marginTop: 10 }}>
            <BranchChips branches={branches} value={sharedScope} onChange={setSharedScope} includeAll label="Applies to" />
          </div>

          <Card title="Default Working Schedule (per category)" open={open.defsched} onToggle={() => toggle("defsched")}>
            <DefaultScheduleConfig client={client} currentUserEmail={staffRow?.email} />
          </Card>

          <Card title="Import Festival Holiday List" open={open.fest} onToggle={() => toggle("fest")}>
            <FestivalHolidayImport client={client} currentUserEmail={staffRow?.email} branch={sharedBranch} />
          </Card>

          <Card title="Leave Policy (CL / EL per category · all branches)" open={open.policy} onToggle={() => toggle("policy")}>
            <LeavePolicyConfig client={client} currentUserEmail={staffRow?.email} />
          </Card>

          <Card title="Calendar Overrides (Saturdays / holidays)" open={open.ovr} onToggle={() => toggle("ovr")}>
            <CalendarOverrideConfig client={client} currentUserEmail={staffRow?.email} branchScope={sharedBranch} />
          </Card>

          <Card title="Vacations (CBSE / PT · ACAD/CURR derived)" open={open.vac} onToggle={() => toggle("vac")}>
            <VacationConfig client={client} currentUserEmail={staffRow?.email} branch={sharedBranch} />
          </Card>
        </>
      )}
    </div>
  );
}
