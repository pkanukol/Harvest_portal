import { useEffect, useState } from "react";
import {
  fetchRoleConfig,
  setBranchApprover,
  addBranchAdmin,
  removeBranchRole,
  upsertOrgLeader,
  removeOrgLeader,
} from "../lib/rolesApi";
import { fetchStaffByIds } from "../lib/staffMaster";
import StaffSearchPicker from "./StaffSearchPicker";

// Admin screen to manage branches' approver/admins and the org-leader list.
// New branch: upload its staff (branch toggle) then assign an approver here.
export default function RolesConfig({ client, branch }) {
  const [cfg, setCfg] = useState(null);
  const [nameById, setNameById] = useState({});
  const [picker, setPicker] = useState(null); // { kind:'approver'|'admin'|'org', branch? }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function reload() {
    const c = await fetchRoleConfig(client);
    setCfg(c);
    const ids = new Set([
      ...Object.values(c.branchApprover),
      ...Object.values(c.branchAdmins).flat(),
      ...c.orgRoles.map((o) => o.employee_id),
    ]);
    const rows = await fetchStaffByIds(client, [...ids]);
    const map = {};
    rows.forEach((r) => (map[r.id] = r.name));
    setNameById(map);
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const label = (id) => `${nameById[id] || "?"} (${id})`;

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPicker(null);
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !cfg) return <p className="error-text">{error}</p>;
  if (!cfg) return <p className="hint">Loading roles…</p>;

  return (
    <div>
      <p className="hint">
        Each branch has one <strong>approver</strong> (approves that branch's leave; also sees Reports) and any number
        of <strong>admins</strong> (Reports + Admin for that branch). <strong>Org leaders</strong> see Reports + Admin
        for every branch; org approvers additionally approve the branch approvers.
      </p>

      {cfg.branches.filter((b) => !branch || b === branch).map((b) => (
        <div key={b} className="card" style={{ marginTop: 10 }}>
          <strong>{b}</strong>
          <div style={{ marginTop: 6 }}>
            <span className="hint" style={{ margin: 0 }}>Approver: </span>
            {cfg.branchApprover[b] ? <strong>{label(cfg.branchApprover[b])}</strong> : <em className="hint">none</em>}
            <button className="btn-link" style={{ marginLeft: 8 }} onClick={() => setPicker({ kind: "approver", branch: b })}>
              {cfg.branchApprover[b] ? "Change" : "Set"}
            </button>
          </div>
          {picker && picker.kind === "approver" && picker.branch === b ? (
            <StaffSearchPicker client={client} branch={b} onSelect={(p) => run(() => setBranchApprover(client, b, p.id))} />
          ) : null}

          <div style={{ marginTop: 8 }}>
            <span className="hint" style={{ margin: 0 }}>Admins: </span>
            {(cfg.branchRoles.filter((r) => r.branch === b && r.role === "admin")).map((r) => (
              <span key={r.id} style={{ marginRight: 10 }}>
                {label(r.employee_id)}
                <button className="btn-link" style={{ color: "var(--red)", marginLeft: 4 }} onClick={() => run(() => removeBranchRole(client, r.id))}>×</button>
              </span>
            ))}
            <button className="btn-link" onClick={() => setPicker({ kind: "admin", branch: b })}>+ Add admin</button>
          </div>
          {picker && picker.kind === "admin" && picker.branch === b ? (
            <StaffSearchPicker client={client} branch={b} onSelect={(p) => run(() => addBranchAdmin(client, b, p.id))} />
          ) : null}
        </div>
      ))}

      <div className="card" style={{ marginTop: 14 }}>
        <strong>Org leaders</strong>
        <div style={{ marginTop: 6 }}>
          {cfg.orgRoles.map((o) => (
            <div key={o.employee_id} className="list-row">
              <span>
                {o.name || nameById[o.employee_id] || "?"} ({o.employee_id}){o.email ? ` · ${o.email}` : ""}
                <label style={{ marginLeft: 12, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={o.is_approver}
                    style={{ width: "auto", marginRight: 4 }}
                    onChange={(e) => run(() => upsertOrgLeader(client, { employeeId: o.employee_id, name: o.name, email: o.email, isApprover: e.target.checked }))}
                  />
                  org approver
                </label>
              </span>
              <button className="btn-link" style={{ color: "var(--red)" }} onClick={() => run(() => removeOrgLeader(client, o.employee_id))}>Remove</button>
            </div>
          ))}
        </div>
        <button className="btn-link" onClick={() => setPicker({ kind: "org" })}>+ Add org leader</button>
        {picker && picker.kind === "org" ? (
          <StaffSearchPicker
            client={client}
            onSelect={(p) => run(() => upsertOrgLeader(client, { employeeId: p.id, name: p.name, email: p.email, isApprover: false }))}
          />
        ) : null}
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {busy ? <p className="hint">Saving…</p> : null}
    </div>
  );
}
