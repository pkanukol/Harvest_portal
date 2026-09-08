-- ============================================================================
-- Verify project_b_schema.sql + staff_roles_rpc.sql.
-- Run in Project B's SQL Editor AFTER both of those.
--
-- ONE statement, ONE result grid - the editor only renders the last
-- statement's output, so everything is folded into a single query. The
-- `check` column names what each row tests and `detail` carries the values.
-- Rows whose check starts with FAIL_ are problems; everything else is
-- informational.
--
-- Read-only: creates and changes nothing.
-- ============================================================================

with expected(name) as (
  values ('tt_academic_years'),('tt_timing_configs'),('tt_grades'),('tt_sections'),
         ('tt_subject_aliases'),('tt_subject_combos'),('tt_subject_combo_members'),
         ('tt_grade_subject_periods'),('tt_section_subject_teachers'),
         ('tt_timetable_slots'),('tt_substitutions'),('tt_zero_period_schedules')
),
present as (
  select e.name, (t.tablename is not null) as exists_now
  from expected e
  left join pg_tables t on t.schemaname = 'public' and t.tablename = e.name
)
select "check", detail from (

  -- 1. All 12 tt_ tables created?
  select 1 as ord,
         case when exists_now then 'ok_table_present' else 'FAIL_table_missing' end as "check",
         jsonb_build_object('table', name) as detail
  from present

  -- 2. The shared masters must still be untouched and present.
  union all
  select 2,
         case when count(*) = 2 then 'ok_shared_masters_present'
              else 'FAIL_shared_master_missing' end,
         jsonb_build_object('found', jsonb_agg(tablename order by tablename))
  from pg_tables
  where schemaname = 'public' and tablename in ('staff_roles','subjects')

  -- 3. We must NOT have created a table over one of theirs.
  union all
  select 3, 'ok_no_legacy_unprefixed_tables',
         jsonb_build_object('note',
           'subjects/grades/etc listed here are the OTHER app''s - confirm none has tt columns',
           'tables', coalesce(jsonb_agg(tablename order by tablename), '[]'::jsonb))
  from pg_tables
  where schemaname = 'public'
    and tablename in ('academic_years','timing_configs','grades','sections',
                      'grade_subject_periods','section_subject_teachers',
                      'timetable_slots','substitutions','zero_period_schedules','teachers')

  -- 4. Foreign keys: every one must stay inside our tt_ tables. A FK pointing
  --    at staff_roles or subjects would let us block the other app's deletes.
  union all
  select 4,
         case when c.confrelid::regclass::text like 'tt\_%' then 'ok_fk_internal'
              else 'FAIL_fk_leaves_tt_namespace' end,
         jsonb_build_object('child', c.conrelid::regclass::text,
                            'parent', c.confrelid::regclass::text,
                            'on_delete', case c.confdeltype when 'c' then 'cascade'
                                                            when 'n' then 'set null'
                                                            when 'a' then 'no action'
                                                            when 'r' then 'restrict'
                                                            else c.confdeltype::text end)
  from pg_constraint c
  where c.contype = 'f'
    and c.connamespace = 'public'::regnamespace
    and c.conrelid::regclass::text like 'tt\_%'

  -- 5. RLS: every tt_ table needs exactly the two policies (read + write).
  union all
  select 5,
         case when cl.relrowsecurity and count(p.polname) = 2 then 'ok_rls'
              else 'FAIL_rls' end,
         jsonb_build_object('table', cl.relname,
                            'rls_enabled', cl.relrowsecurity,
                            'policies', count(p.polname))
  from pg_class cl
  left join pg_policy p on p.polrelid = cl.oid
  where cl.relnamespace = 'public'::regnamespace
    and cl.relname in (select name from expected)
  group by cl.relname, cl.relrowsecurity

  -- 6. anon must hold no privilege on our tables.
  union all
  select 6,
         case when count(*) = 0 then 'ok_anon_has_no_grants'
              else 'FAIL_anon_still_granted' end,
         jsonb_build_object('grants', coalesce(jsonb_agg(distinct table_name), '[]'::jsonb))
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon'
    and table_name in (select name from expected)

  -- 7. The five RPCs, all still SECURITY DEFINER.
  union all
  select 7,
         case when prosecdef then 'ok_rpc_security_definer'
              else 'FAIL_rpc_not_security_definer' end,
         jsonb_build_object('function', proname,
                            'args', pg_get_function_identity_arguments(oid))
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('timetable_branches','timetable_staff_by_branch',
                    'timetable_append_teaching_sections','timetable_is_leadership',
                    'timetable_current_staff')

  -- 8. Who can actually edit? Should be access_level super_admin/approver.
  --    Read this list and sanity-check it against who you expect.
  union all
  select 8, 'info_editors',
         jsonb_build_object('access_level', access_level,
                            'people', count(*),
                            'designations', jsonb_agg(distinct designation))
  from public.staff_roles
  where active and access_level = any (array['super_admin','approver'])
  group by access_level

) x
order by ord, "check", detail::text;
