import { findApprover } from "./rolesApi";

// Full CL/EL picture for one person (category, accrued/used/remaining), computed
// server-side from staff_master.date_of_joining + category_leave_policy + today.
// Replaces the old flat leave_balance() RPC.
export async function fetchLeaveEntitlement(client, employeeId) {
  const { data, error } = await client.rpc("leave_entitlement", { p_employee_id: employeeId });
  if (error) throw error;
  // The RPC returns a table; take the single row (null if the person isn't in staff_master).
  return (data ?? [])[0] ?? null;
}

export async function fetchLeavePolicies(client) {
  const { data, error } = await client.from("category_leave_policy").select("*").order("category");
  if (error) throw error;
  return data ?? [];
}

export async function upsertLeavePolicy(client, { category, clAnnual, elAnnual, clStartMonth, updatedBy }) {
  const { error } = await client.from("category_leave_policy").upsert(
    {
      category,
      cl_annual: clAnnual,
      el_annual: elAnnual,
      cl_start_month: clStartMonth,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy || null,
    },
    { onConflict: "category" }
  );
  if (error) throw error;
}

export async function fetchLeaveHistory(client, staffId) {
  const { data, error } = await client
    .from("leave_request")
    .select("*")
    .eq("staff_id", staffId)
    .order("from_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// The approver depends on the requester: their branch approver, unless they are
// a branch approver themselves (then an org approver / Chairman-MD). See rolesApi.
export async function findApproverForStaff(client, staffRow) {
  return findApprover(client, staffRow);
}

export async function submitLeaveRequest(client, { staffId, staffEmail, fromDate, toDate, leaveType, lopDays, reasonText, approverStaffId, approverName, requestedBy }) {
  const { error } = await client.from("leave_request").insert({
    staff_id: staffId,
    staff_email: staffEmail,
    from_date: fromDate,
    to_date: toDate,
    leave_type: leaveType || "CL",
    lop_days: lopDays || 0,
    reason_text: reasonText || null,
    approver_staff_id: approverStaffId || null,
    approver_name: approverName || null,
    requested_by: requestedBy,
  });
  if (error) throw error;
}

// Leave requests overlapping a date range, for calendar highlighting -
// pending AND approved show up immediately ("mark it in the calendar the
// minute I apply"); rejected ones are excluded so their dates fall back to
// whatever attendance_daily_status already has.
export async function fetchLeaveRequestsOverlapping(client, staffId, fromDate, toDate) {
  const { data, error } = await client
    .from("leave_request")
    .select("from_date, to_date, status")
    .eq("staff_id", staffId)
    .in("status", ["pending", "approved"])
    .lte("from_date", toDate)
    .gte("to_date", fromDate);
  if (error) throw error;
  return data ?? [];
}

// Approvals needs more than just 'pending' (reviewing past decisions too),
// so this takes the status explicitly rather than being pending-only.
export async function fetchLeaveRequestsByStatus(client, status) {
  const { data, error } = await client
    .from("leave_request")
    .select("*")
    .eq("status", status)
    .order("requested_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function decideLeaveRequest(client, { id, status, decidedBy, decisionNote }) {
  const { error } = await client
    .from("leave_request")
    .update({ status, decided_by: decidedBy, decided_at: new Date().toISOString(), decision_note: decisionNote || null })
    .eq("id", id);
  if (error) throw error;
}

// Self-service withdrawal by the requester, for a still-pending or already-
// approved request - deliberately leaves decided_by/decided_at untouched
// (null for a request that was never approver-acted-on), since those two
// columns mean "an approver decided this", not "this request is closed".
export async function cancelLeaveRequest(client, id) {
  const { error } = await client.from("leave_request").update({ status: "cancelled" }).eq("id", id);
  if (error) throw error;
}

export function currentYear() {
  return new Date().getFullYear();
}
