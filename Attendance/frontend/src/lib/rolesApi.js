// Branch + role config. Loaded once per session into a config object the app
// uses to gate tabs, scope Reports/Admin/Approvals to a branch, and route leave
// approvals. Everyone is keyed by employee_id.

// A small allowlist who can open the "Attendance Check" audit (which staff
// weren't read for a month). Independent of branch/admin roles.
//   1285HISSJ = K Padma Pavani · 1251HISSJ = S Guru Prasad (DLP)
//   1130      = Deepa Naveen (HR) · 285 = Sathish B V (IT Manager)
export const ATTENDANCE_AUDIT_EMPLOYEE_IDS = ["1285HISSJ", "1251HISSJ", "1130", "285"];

export async function fetchRoleConfig(client) {
  const [br, org, branchesRes] = await Promise.all([
    client.from("branch_role").select("*"),
    client.from("org_role").select("*"),
    client.from("staff_master").select("branch").not("branch", "is", null),
  ]);
  if (br.error) throw br.error;
  if (org.error) throw org.error;
  if (branchesRes.error) throw branchesRes.error;

  const branchRoles = br.data ?? [];
  const orgRoles = org.data ?? [];

  const branchApprover = {}; // branch -> employee_id
  const branchAdmins = {}; // branch -> [employee_id]
  branchRoles.forEach((r) => {
    if (r.role === "approver") branchApprover[r.branch] = r.employee_id;
    else if (r.role === "admin") {
      if (!branchAdmins[r.branch]) branchAdmins[r.branch] = [];
      branchAdmins[r.branch].push(r.employee_id);
    }
  });

  const branches = [
    ...new Set([
      ...(branchesRes.data ?? []).map((r) => r.branch),
      ...Object.keys(branchApprover),
      ...Object.keys(branchAdmins),
    ]),
  ].sort();

  return {
    branchRoles,
    orgRoles,
    branchApprover,
    branchAdmins,
    branches,
    orgLeaders: new Set(orgRoles.map((o) => o.employee_id)),
    orgApprovers: new Set(orgRoles.filter((o) => o.is_approver).map((o) => o.employee_id)),
  };
}

// What the logged-in person can do, given the role config.
export function computeCapabilities(staffRow, cfg) {
  const id = staffRow?.id;
  const isOrgLeader = cfg.orgLeaders.has(id);
  const isOrgApprover = cfg.orgApprovers.has(id);
  const approverBranches = Object.entries(cfg.branchApprover).filter(([, eid]) => eid === id).map(([b]) => b);
  const adminBranches = Object.entries(cfg.branchAdmins).filter(([, ids]) => ids.includes(id)).map(([b]) => b);

  // Reports: org leader sees any branch; branch admin/approver see their branch(es).
  const reportBranches = isOrgLeader ? cfg.branches : [...new Set([...approverBranches, ...adminBranches])];
  // Admin: org leader any branch; branch admin their branch; branch approver NONE.
  const adminBranchesAllowed = isOrgLeader ? cfg.branches : adminBranches;

  return {
    isOrgLeader,
    isOrgApprover,
    approverBranches,
    adminBranches,
    reportBranches,
    adminBranchesAllowed,
    canSeeReports: reportBranches.length > 0,
    canSeeAdmin: adminBranchesAllowed.length > 0,
    canSeeApprovals: approverBranches.length > 0 || isOrgApprover,
  };
}

// The employee_id who approves this person's leave: their branch approver,
// unless they ARE a branch approver (then an org approver / Chairman-MD).
export function resolveApproverId(staffRow, cfg) {
  const id = staffRow?.id;
  const isBranchApprover = Object.values(cfg.branchApprover).includes(id);
  if (isBranchApprover) return [...cfg.orgApprovers][0] ?? null;
  return cfg.branchApprover[staffRow?.branch] ?? null;
}

// Resolve the approver to a { id, name } for denormalised storage on the request.
export async function findApprover(client, staffRow, cfg) {
  const config = cfg || (await fetchRoleConfig(client));
  const approverId = resolveApproverId(staffRow, config);
  if (!approverId) return null;
  const { data, error } = await client.from("staff_master").select("employee_id, employee_name").eq("employee_id", approverId).limit(1);
  if (error) throw error;
  const row = (data ?? [])[0];
  return row ? { id: row.employee_id, name: row.employee_name } : { id: approverId, name: approverId };
}

// ===== CRUD for the Roles & Branches admin screen =====

export async function setBranchApprover(client, branch, employeeId) {
  await client.from("branch_role").delete().eq("branch", branch).eq("role", "approver");
  const { error } = await client.from("branch_role").insert({ branch, employee_id: employeeId, role: "approver" });
  if (error) throw error;
}

export async function addBranchAdmin(client, branch, employeeId) {
  const { error } = await client.from("branch_role").upsert({ branch, employee_id: employeeId, role: "admin" }, { onConflict: "branch,employee_id,role" });
  if (error) throw error;
}

export async function removeBranchRole(client, id) {
  const { error } = await client.from("branch_role").delete().eq("id", id);
  if (error) throw error;
}

export async function upsertOrgLeader(client, { employeeId, name, email, isApprover }) {
  const { error } = await client.from("org_role").upsert(
    { employee_id: employeeId, name: name || null, email: email || null, is_approver: !!isApprover },
    { onConflict: "employee_id" }
  );
  if (error) throw error;
}

export async function removeOrgLeader(client, employeeId) {
  const { error } = await client.from("org_role").delete().eq("employee_id", employeeId);
  if (error) throw error;
}

export async function distinctBranches(client) {
  const { data, error } = await client.from("staff_master").select("branch").not("branch", "is", null);
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.branch))].sort();
}
