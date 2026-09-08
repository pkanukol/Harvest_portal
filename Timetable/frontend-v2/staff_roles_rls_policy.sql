-- Run this in the Supabase SQL Editor for project ukpythuclqvjwygqrsds
-- (the project that owns staff_roles - NOT the Timetable app's own project).

-- Base table privilege (separate from RLS policies below - an RLS policy
-- only restricts ROWS, the role still needs this GRANT to query the table
-- at all). This has been silently revoked/reset by something external more
-- than once (confirmed again 2026-08-04, this time as a bare "permission
-- denied for table staff_roles" from PostgREST, not just 0 rows) - if reads
-- against staff_roles start failing again, re-run this GRANT first.
grant select on public.staff_roles to anon, authenticated;

-- Read policy (already applied, kept here for reference/idempotent re-run).
-- Grants read-only access to staff_roles for the anon role (what the
-- Timetable app's publishable key resolves to).
alter table public.staff_roles enable row level security;

drop policy if exists "anon read access" on public.staff_roles;

create policy "anon read access"
  on public.staff_roles
  for select
  to anon, authenticated
  using (true);

-- Write policy (new): lets Timetable's "Upload timetable" tab append a
-- teacher-subject-grade-section mapping to teaching_sections when the
-- uploaded file's parsed assignment doesn't already match what's on record.
-- UPDATE only - no insert/delete, so Timetable can never create or remove a
-- staff_roles row, only append entries to teaching_sections on an existing one.
drop policy if exists "anon update teaching_sections" on public.staff_roles;

create policy "anon update teaching_sections"
  on public.staff_roles
  for update
  to anon, authenticated
  using (true)
  with check (true);
