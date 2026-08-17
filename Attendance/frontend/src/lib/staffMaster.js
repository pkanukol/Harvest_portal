// Staff identity + category, sourced entirely from staff_master on Project A
// via the authenticated client (the portal SSO token). staff_roles / Project B
// is no longer read anywhere - so there is one Supabase project in play now and
// the anon-SELECT 401 that used to bounce users to sign-in is gone.
//
// employee_id (text, from the staff_list Excel - e.g. "1064", "1227HISSJ") is
// the identity/PK: it keys every attendance table (the column is still named
// staff_id there, but now holds employee_id) and matches the biometric report.
// Rows are normalised to { id, name, email, category, designation,
// date_of_joining } where id === employee_id; designation mirrors category,
// since staff_master has no separate designation field.

// Access/roles (approver, branch admins, org leaders) are resolved from the role
// config in src/lib/rolesApi.js - not from a hardcoded list here.

// Grouping is a single dimension (HR category). One-entry array so the existing
// chip-rendering in ReportsPage/AdminPage stays unchanged.
export const CATEGORY_FIELDS = [{ key: "category", label: "Category" }];

const SELECT = "employee_id, employee_name, email, category, date_of_joining, branch";

function normalize(row) {
  if (!row) return null;
  return {
    id: row.employee_id,
    employeeId: row.employee_id,
    name: row.employee_name,
    email: row.email,
    category: row.category,
    designation: row.category,
    date_of_joining: row.date_of_joining,
    branch: row.branch,
  };
}

// An optional `branch` scopes results to one branch (for branch-filtered
// Reports/Admin). Omit for no branch filter.
export async function searchStaff(client, query, branch) {
  let q = client.from("staff_master").select(SELECT).order("employee_name").limit(50);
  if (branch) q = q.eq("branch", branch);
  const term = (query || "").trim();
  if (term) {
    q = q.or(
      `employee_name.ilike.%${term}%,email.ilike.%${term}%,employee_id.ilike.%${term}%,category.ilike.%${term}%`
    );
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(normalize);
}

export async function fetchDistinctCategoryValues(client, branch) {
  let q = client.from("staff_master").select("category");
  if (branch) q = q.eq("branch", branch);
  const { data, error } = await q;
  if (error) throw error;
  const set = new Set();
  (data ?? []).forEach((r) => {
    if (r.category) set.add(r.category);
  });
  return [...set].sort();
}

export async function fetchStaffByCategoryValue(client, value, branch) {
  let q = client.from("staff_master").select(SELECT).eq("category", value).order("employee_name");
  if (branch) q = q.eq("branch", branch);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(normalize);
}

export async function fetchAllStaff(client, branch) {
  let q = client.from("staff_master").select(SELECT).order("employee_name");
  if (branch) q = q.eq("branch", branch);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(normalize);
}

// Bulk lookup by employee_id, for the Approvals list (request rows carry only
// the id). Returns normalised rows the caller can index by id.
export async function fetchStaffByIds(client, ids) {
  const unique = [...new Set(ids)].filter((v) => v != null);
  if (unique.length === 0) return [];
  const { data, error } = await client.from("staff_master").select(SELECT).in("employee_id", unique);
  if (error) throw error;
  return (data ?? []).map(normalize);
}
