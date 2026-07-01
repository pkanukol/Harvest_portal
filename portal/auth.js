const SUPABASE_URL = 'https://aouvxdfamzprykezeovl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rIfo8DPrbyOmU006ii3onw_sDRWJwvE';

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session;
}

async function getUserProfile(email) {
  const { data, error } = await supabaseClient
    .from('users')
    .select('role, name, designation')
    .ilike('email', email)
    .single();
  if (error) {
    console.error('getUserProfile error:', error.message, error.code, error.details);
    return null;
  }
  return data;
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = '/portal/login.html';
}

async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = '/portal/login.html';
    return null;
  }
  const email = session.user.email;
  if (!email.toLowerCase().endsWith('@harvestinternationalschool.in')) {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html?error=domain';
    return null;
  }
  return session;
}
