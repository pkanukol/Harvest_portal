-- Phase F - multi-branch (Kodathi + Attibele) and role config. Run once in Project A.
-- Access model:
--   staff / branch admin        -> approved by their BRANCH approver
--   branch approver             -> approved by an ORG approver (Chairman / MD)
--   branch admin                -> Reports + Admin for their branch
--   branch approver             -> Reports + Approvals for their branch (NO admin)
--   org leader (Pavani/Chairman/MD/DLP) -> Reports + Admin for any branch (one at a time)
--   org approver (Chairman/MD)  -> also approve the branch approvers
-- Everyone is identified by employee_id. Reports/Admin filter to ONE branch (no "All").

-- ========== branch on staff_master ==========
alter table staff_master add column if not exists branch text;
-- Everyone currently loaded is Kodathi; Attibele staff arrive via a later upload
-- (the uploader's branch toggle stamps branch on those rows).
update staff_master set branch = 'Kodathi' where branch is null;

-- ========== role config (admin-editable via the Roles & Branches screen) ==========
-- Per-branch approver (one) and admins (one or more).
create table if not exists branch_role (
  id uuid primary key default gen_random_uuid(),
  branch text not null,
  employee_id text not null,
  role text not null check (role in ('approver','admin')),
  created_at timestamptz not null default now(),
  unique (branch, employee_id, role)
);
create index if not exists idx_branch_role_emp on branch_role (employee_id);

-- Org leaders: see Reports + Admin for any branch. is_approver = also approves the
-- branch approvers (Chairman / MD).
create table if not exists org_role (
  employee_id text primary key,
  name text,
  email text,
  is_approver boolean not null default false,
  created_at timestamptz not null default now()
);

alter table branch_role enable row level security;
alter table org_role enable row level security;
drop policy if exists "authenticated full access" on branch_role;
drop policy if exists "authenticated full access" on org_role;
create policy "authenticated full access" on branch_role for all to authenticated using (true) with check (true);
create policy "authenticated full access" on org_role for all to authenticated using (true) with check (true);

-- ========== org leaders who don't punch need a staff_master row to sign in ==========
-- Chairman & MD don't have attendance; give them a minimal row (branch null so they
-- aren't scoped to one branch). Pavani (1285HISSJ) & Guru (1251HISSJ) already come
-- in via the staff-list upload, so they're left alone.
insert into staff_master (employee_name, employee_id, category, email, branch) values
  ('Ram Gaddipati', '1', 'ADMIN', 'ram@harvestinternationalschool.in', null),
  ('Abhinav Gaddipati', '2', 'ADMIN', 'abhinav_g@harvestinternationalschool.in', null)
on conflict (employee_id) do nothing;

-- ========== seed roles ==========
insert into branch_role (branch, employee_id, role) values
  ('Kodathi',  '993',       'approver'),
  ('Attibele', '96',        'approver'),
  ('Attibele', '118HISAT',  'admin')
on conflict (branch, employee_id, role) do nothing;

insert into org_role (employee_id, name, email, is_approver) values
  ('1',         'Ram Gaddipati',     'ram@harvestinternationalschool.in',      true),
  ('2',         'Abhinav Gaddipati', 'abhinav_g@harvestinternationalschool.in', true),
  ('1285HISSJ', 'K Padma Pavani',    'pavani.k@harvestinternationalschool.in', false),
  ('1251HISSJ', 'S Guru Prasad',     'guru@harvestinternationalschool.in',     false)
on conflict (employee_id) do update set
  name = excluded.name, email = excluded.email, is_approver = excluded.is_approver;
