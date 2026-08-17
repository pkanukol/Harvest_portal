// Resolves the logged-in user by asking Supabase Auth to verify the token
// (getUser() hits the Auth server, which actually checks the signature), then
// looks the verified email up in staff_master on Project A. Access/roles are
// resolved separately from the role config (see src/lib/rolesApi.js).
//
// Throws on an AUTH failure (invalid/expired token) - distinct from returning
// null, which means the token is valid but this email has no staff_master row
// yet (some staff_list rows have a blank email until admin fills it in).
export async function resolveCurrentStaff(client, accessToken) {
  const { data: userData, error: userError } = await client.auth.getUser(accessToken);
  if (userError || !userData?.user?.email) {
    throw new Error("SSO session invalid or expired");
  }

  const email = userData.user.email;
  const { data, error } = await client
    .from("staff_master")
    .select("employee_id, employee_name, email, category, date_of_joining, branch")
    .ilike("email", email)
    .limit(1);
  if (error) throw error;

  const row = (data ?? [])[0];
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
