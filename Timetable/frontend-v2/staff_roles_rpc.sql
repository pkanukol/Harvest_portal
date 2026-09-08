-- Run this in the Supabase SQL Editor for project ukpythuclqvjwygqrsds
-- (the project that owns staff_roles - NOT the Timetable app's own project).
--
-- WHY THIS REPLACES staff_roles_rls_policy.sql
-- --------------------------------------------
-- staff_roles is owned and migrated by a DIFFERENT app. Granting `select`
-- (and `update`) on the table directly to `anon` worked, but that GRANT was
-- silently revoked by something external more than once (last confirmed
-- 2026-08-04, as a bare "permission denied for table staff_roles" from
-- PostgREST) - presumably the owning app re-running its own migrations.
-- Every time that happened the Timetable app broke and needed a manual
-- re-grant.
--
-- These SECURITY DEFINER functions execute with the FUNCTION OWNER's
-- privileges, so the table-level GRANT to anon stops mattering entirely -
-- and RLS on staff_roles is bypassed inside them. The only privilege the
-- app needs is EXECUTE on these three functions, which are not part of the
-- owning app's migrations and so are not reset by them.
--
-- Timetable's access stays exactly as narrow as before: read active rows,
-- and append to teaching_sections on an existing row. It still cannot insert
-- or delete a staff_roles row.

-- ── 1. Distinct branch list ──────────────────────────────────────────────
-- branches is a JSON array per row, not a scalar - single-branch
-- (["Kodathi"]), multi-branch (["Kodathi","Attibele"]) and empty-array rows
-- all exist in real data, so this unrolls the array rather than reading it
-- as one value.
create or replace function public.timetable_branches()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct branch
  from public.staff_roles sr,
       lateral jsonb_array_elements_text(
         case jsonb_typeof(to_jsonb(sr.branches))
           when 'array' then to_jsonb(sr.branches)
           else '[]'::jsonb
         end
       ) as branch
  where sr.active
    and branch is not null
    and branch <> ''
  order by branch;
$$;

-- ── 2. Active staff for one branch ───────────────────────────────────────
-- Returns the WHOLE row as jsonb rather than a fixed column list. staff_roles
-- is now this app's only teacher identity: `designation` says who counts as a
-- teacher, `subjects` and `grades` what they handle, `class_sections` which
-- grade-sections they are class teacher of, `teaching_sections` the
-- "Subject|grade-section" list (e.g. ["Maths|4A","Maths|5A"]), `branches` the
-- campus. The owning app may also add columns to it.
-- Projecting the whole row means a new column becomes available here without
-- a migration on our side, and means this function does not have to hardcode
-- names it might get wrong.
--
-- One call shape serves all three read sites (TimetableViewer,
-- UploadTimetable, BuildNewTimetable); the row count per branch is small.
drop function if exists public.timetable_staff_by_branch(text);

create function public.timetable_staff_by_branch(p_branch text)
returns setof jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(sr)
  from public.staff_roles sr
  where sr.active
    and to_jsonb(sr.branches) @> to_jsonb(array[p_branch])
  order by sr.name;
$$;

-- ── 3. Append-only write to teaching_sections ────────────────────────────
-- The client computes the new array (it owns the name/subject normalisation
-- rules) and passes it whole, but this function refuses any value that
-- DROPS an existing entry. That is stricter than the old
-- `for update ... with check (true)` policy, which let the app overwrite
-- teaching_sections with anything at all - a bug in Timetable's parsing
-- could previously have wiped another app's data.
-- staff_roles.id is an int (confirmed by the user 2026-09-08), so p_id is
-- bigint. An earlier revision of this file typed it as text; dropping that
-- signature explicitly, because changing an argument type would otherwise
-- leave a second overload behind rather than replacing the function.
drop function if exists public.timetable_append_teaching_sections(text, jsonb);

create or replace function public.timetable_append_teaching_sections(
  p_id bigint,
  p_teaching_sections jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing jsonb;
begin
  if not public.timetable_is_leadership() then
    raise exception 'not permitted: editing requires a leadership designation';
  end if;

  if jsonb_typeof(p_teaching_sections) is distinct from 'array' then
    raise exception 'teaching_sections must be a JSON array, got %',
      coalesce(jsonb_typeof(p_teaching_sections), 'null');
  end if;

  select to_jsonb(sr.teaching_sections) into v_existing
  from public.staff_roles sr
  where sr.id = p_id
  for update;

  if not found then
    raise exception 'staff_roles row % not found', p_id;
  end if;

  v_existing := case jsonb_typeof(v_existing)
                  when 'array' then v_existing
                  else '[]'::jsonb
                end;

  -- Append-only: every entry already on record must still be present.
  if exists (
    select 1
    from jsonb_array_elements_text(v_existing) old_entry
    where not p_teaching_sections @> to_jsonb(array[old_entry])
  ) then
    raise exception 'refusing to drop existing teaching_sections entries on row %', p_id;
  end if;

  update public.staff_roles
  set teaching_sections = p_teaching_sections
  where id = p_id;

  return p_teaching_sections;
end;
$$;

-- ── 4. Who am I, and am I leadership? ────────────────────────────────────
-- Edit rights come from staff_roles.access_level:
--   access_level in ('super_admin','approver','admin')
--
-- 'admin' was initially left out, then added back on 2026-09-08 when the
-- user's own account came back as read-only. It also restores Principal,
-- Chairman, MD and Curriculum Head - who could edit in v1 - and, less
-- obviously, IT Manager and Graphic Designer, who sit at 'admin' too.
--
-- This is NOT what v1 did. v1 (backend/app/auth.py) matched designation
-- keywords - vice principal, block head, coordinator, principal, managing
-- director, chairman, apm. access_level is the column the rest of Project B
-- already maintains, so it was chosen instead, but the two do not agree:
--
--   super_admin (5): APM, DLP Manager, Information Technology,
--                    Managing Director, + 1 row with no designation
--   approver    (7): Block Head, Head Mistress, HR Manager, Vice Principal,
--                    Coordinator x3
--
-- Read-only tiers are therefore: teacher (123), sme (19), reviewer (2),
-- viewer (2). Everyone else can edit.
--
-- KEEP THE LIST IN SYNC with src/lib/accessLevel.js. This SQL copy is the
-- actual enforcement (it backs the RLS write policy); the JS copy only
-- decides which controls render.
--
-- Matched on lower(email) rather than auth.uid(): staff_roles.auth_user_id is
-- populated on 0 of 168 active rows (checked 2026-09-08), so auth.uid() would
-- match nobody. All 168 do have an email. Revisit if auth_user_id ever gets
-- backfilled - it would be the more robust key.
create or replace function public.timetable_is_leadership()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.staff_roles sr
    where sr.active
      and lower(sr.email) = lower(auth.jwt() ->> 'email')
      and sr.access_level = any (array['super_admin', 'approver', 'admin'])
  );
$$;

-- The signed-in user's own staff_roles row (whole row as jsonb), or no row if
-- their auth account has no staff_roles match. The app treats "no row" as
-- read-only rather than as an error - v1 gave every valid portal account at
-- least view access, and a missing staff_roles row is a data gap, not an
-- intrusion. Scoped to the caller's own email, so this cannot be used to read
-- anybody else's record.
create or replace function public.timetable_current_staff()
returns setof jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(sr)
  from public.staff_roles sr
  where sr.active
    and lower(sr.email) = lower(auth.jwt() ->> 'email')
  limit 1;
$$;

-- ── Privileges ───────────────────────────────────────────────────────────
-- EXECUTE is the ONLY privilege the Timetable app needs now. Revoke the
-- implicit grant to public first so these are not callable by anything that
-- happens to reach the database.
revoke all on function public.timetable_branches()                              from public;
revoke all on function public.timetable_staff_by_branch(text)                   from public;
revoke all on function public.timetable_append_teaching_sections(bigint, jsonb) from public;

-- `authenticated` only: the app signs in against this project's Supabase
-- Auth (email+password, see LoginView.jsx), so the publishable key on its own
-- must not reach staff_roles.
grant execute on function public.timetable_branches()            to authenticated;
grant execute on function public.timetable_staff_by_branch(text) to authenticated;
grant execute on function public.timetable_append_teaching_sections(bigint, jsonb) to authenticated;

revoke all on function public.timetable_is_leadership()  from public;
revoke all on function public.timetable_current_staff()  from public;
grant execute on function public.timetable_is_leadership() to authenticated;
grant execute on function public.timetable_current_staff() to authenticated;

-- ── Optional cleanup ─────────────────────────────────────────────────────
-- Once the app is confirmed working through the functions above, the direct
-- table access from staff_roles_rls_policy.sql is no longer needed and can
-- be dropped. Leave this commented until you have verified the app:
--
--   revoke select, update on public.staff_roles from anon, authenticated;
--   drop policy if exists "anon read access" on public.staff_roles;
--   drop policy if exists "anon update teaching_sections" on public.staff_roles;
