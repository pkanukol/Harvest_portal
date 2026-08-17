import { toIsoDate } from "./dateUtils";

export async function fetchMonthStatus(client, staffId, year, monthIndex) {
  const from = toIsoDate(new Date(year, monthIndex, 1));
  const to = toIsoDate(new Date(year, monthIndex + 1, 0));
  const { data, error } = await client
    .from("attendance_daily_status")
    .select("*")
    .eq("staff_id", staffId)
    .gte("attendance_date", from)
    .lte("attendance_date", to);
  if (error) throw error;
  const byDate = {};
  (data ?? []).forEach((row) => {
    byDate[row.attendance_date] = row;
  });
  return byDate;
}

// For calendar coloring: a bus-travel regularisation isn't the person's
// fault, so the calendar shows it as green (same as "on time"), not the
// blue "regularised" color reserved for a manually-approved one - but
// attendance_daily_status.status only stores 'regularised' generically, so
// telling the two apart means looking at the underlying request's
// reason_category for each regularised date in the visible month.
export async function fetchRegularisationReasonsForRange(client, staffId, fromDate, toDate) {
  const { data, error } = await client
    .from("regularisation_request")
    .select("attendance_date, reason_category")
    .eq("staff_id", staffId)
    .in("status", ["approved", "auto_approved"])
    .gte("attendance_date", fromDate)
    .lte("attendance_date", toDate);
  if (error) throw error;
  const byDate = {};
  (data ?? []).forEach((row) => {
    byDate[row.attendance_date] = row.reason_category;
  });
  return byDate;
}

export async function fetchRegularisationForDate(client, staffId, attendanceDate) {
  const { data, error } = await client
    .from("regularisation_request")
    .select("*")
    .eq("staff_id", staffId)
    .eq("attendance_date", attendanceDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Upsert, not a plain insert: there's a unique(staff_id, attendance_date)
// constraint, and once a date already has a cancelled/rejected row, a
// plain insert would fail outright on that constraint when the person
// tries again for the same date. Explicitly resets status/decision fields -
// an upsert's ON CONFLICT UPDATE only overwrites columns actually listed
// here, so a stale status='rejected' or a stale decided_by from the old
// attempt would otherwise survive into the new request.
export async function submitRegularisation(client, { staffId, staffEmail, attendanceDate, reasonCategory, reasonText, requestedBy }) {
  const { error } = await client.from("regularisation_request").upsert(
    {
      staff_id: staffId,
      staff_email: staffEmail,
      attendance_date: attendanceDate,
      reason_category: reasonCategory,
      reason_text: reasonText || null,
      requested_by: requestedBy,
      requested_at: new Date().toISOString(),
      status: "pending",
      counts_toward_cap: true,
      decided_by: null,
      decided_at: null,
      decision_note: null,
    },
    { onConflict: "staff_id,attendance_date" }
  );
  if (error) throw error;
}

// Counts pending too, matching the DB trigger (enforce_regularisation_cap) -
// submitting one, even before a decision, uses up the month's single slot.
export async function fetchRegularisationCountThisMonth(client, staffId, attendanceDate) {
  const d = new Date(attendanceDate);
  const from = toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1));
  const to = toIsoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const { count, error } = await client
    .from("regularisation_request")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", staffId)
    .eq("counts_toward_cap", true)
    .in("status", ["pending", "approved", "auto_approved"])
    .gte("attendance_date", from)
    .lte("attendance_date", to);
  if (error) throw error;
  return count ?? 0;
}

export async function fetchMyRegularisationRequests(client, staffId) {
  const { data, error } = await client
    .from("regularisation_request")
    .select("*")
    .eq("staff_id", staffId)
    .order("attendance_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Self-service withdrawal - the UI only offers this while still 'pending'
// (unlike leave, which stays cancellable after approval too - see the
// comment on regularisation_request's status column in phase1_schema.sql
// for why approved regularisations don't get this).
export async function cancelRegularisationRequest(client, id) {
  const { error } = await client.from("regularisation_request").update({ status: "cancelled" }).eq("id", id);
  if (error) throw error;
}

// Approvals needs more than just 'pending' (reviewing past decisions too).
// Takes a single status or an array (e.g. ['approved','auto_approved'] to
// treat bus-travel auto-approvals as part of "Approved").
export async function fetchRegularisationRequestsByStatus(client, statusOrList) {
  let q = client.from("regularisation_request").select("*").order("requested_at", { ascending: true });
  q = Array.isArray(statusOrList) ? q.in("status", statusOrList) : q.eq("status", statusOrList);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// Updating to 'approved' triggers the DB side (trg_c_apply_regularisation_effect
// flips the day to 'regularised', trg_b_enforce_regularisation_cap blocks it
// if the 1/month cap is already used) - this function is a plain update,
// the business rules live in the schema, not duplicated here.
export async function decideRegularisationRequest(client, { id, status, decidedBy, decisionNote }) {
  const { error } = await client
    .from("regularisation_request")
    .update({ status, decided_by: decidedBy, decided_at: new Date().toISOString(), decision_note: decisionNote || null })
    .eq("id", id);
  if (error) throw error;
}
