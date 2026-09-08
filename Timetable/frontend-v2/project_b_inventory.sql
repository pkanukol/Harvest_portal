-- ============================================================================
-- ONE statement, ONE result grid. Read-only - creates and changes nothing.
--
-- Select all of this and Run. The Supabase SQL Editor only renders the last
-- statement's output, so everything is folded into a single query: a `section`
-- column says which question each row answers, and `detail` holds the values
-- as JSON. Read it top to bottom.
--
-- Settled already, for the record: `subjects` and `staff_roles` are REUSED as
-- shared masters; timetable_slots, section_subject_teachers,
-- grade_subject_periods, timing_configs and zero_period_schedules stay
-- Timetable's own under a tt_ prefix. Undecided: academic_years, grades,
-- sections - sections 1 and 2 below are what decide them.
-- ============================================================================

with cand as (
  -- Deliberately broad name match: an existing academic-year or section
  -- master may be called something other than the obvious name.
  -- query_to_xml is how you count rows of a dynamically-named table inside a
  -- plain SELECT (count(*) cannot take an identifier expression).
  select t.tablename,
         (select count(*) from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = t.tablename) as cols,
         (xpath('/row/c/text()',
                query_to_xml(format('select count(*) as c from public.%I', t.tablename),
                             false, true, '')))[1]::text::bigint as nrows
  from pg_tables t
  where t.schemaname = 'public'
    and t.tablename ~ '(year|term|grade|class|section|batch|standard|school|branch|campus|period|timetable|slot)'
)
select section, detail
from (
  -- 1. Does a master already exist for academic years / grades / sections?
  select 1 as ord, '1_candidate_tables' as section,
         jsonb_build_object('table', tablename, 'columns', cols, 'rows', nrows) as detail
  from cand

  -- 2. Their shapes, to tell a real master from a same-name-different-thing.
  union all
  select 2, '2_candidate_columns',
         jsonb_build_object('table', c.table_name, 'pos', c.ordinal_position,
                            'column', c.column_name, 'type', c.data_type)
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name in (select tablename from cand)

  -- 3. The subjects catalogue in full - decides whether the workbook's
  --    spellings line up with `name` or `code`, and whether combos can be
  --    expressed as groups of these rows.
  union all
  select 3, '3_subjects_catalogue', to_jsonb(s)
  from public.subjects s

  -- 4. staff_roles.id type - the tt_ tables' teacher_id must match it.
  union all
  select 4, '4_staff_roles_id_type',
         jsonb_build_object('column', column_name, 'type', data_type)
  from information_schema.columns
  where table_schema = 'public' and table_name = 'staff_roles' and column_name = 'id'

  -- 5. What access_level contains. If it encodes the edit/view tier it should
  --    replace the designation keyword regex in timetable_is_leadership().
  union all
  select 5, '5_access_level',
         jsonb_build_object('access_level', access_level, 'staff', count(*))
  from public.staff_roles where active group by access_level

  -- 6. Does access_level agree with designation? Shows whether switching to
  --    it would change who can edit.
  union all
  select 6, '6_access_level_x_designation',
         jsonb_build_object('access_level', access_level, 'designation', designation,
                            'staff', count(*))
  from public.staff_roles where active group by access_level, designation

  -- 7. Is auth_user_id populated? The gate matches lower(email) today;
  --    auth_user_id = auth.uid() would be exact, but only if it is filled in.
  union all
  select 7, '7_auth_user_id_coverage',
         jsonb_build_object(
           'with_auth_user_id',    count(*) filter (where auth_user_id is not null),
           'without_auth_user_id', count(*) filter (where auth_user_id is null),
           'without_email',        count(*) filter (where email is null or email = ''),
           'total_active',         count(*))
  from public.staff_roles where active

  -- 8. Shape of `permissions` - it may already be the per-app grant
  --    mechanism, in which case Timetable belongs in it.
  union all
  select 8, '8_permissions_sample', to_jsonb(p.permissions)
  from (select permissions from public.staff_roles
        where active and permissions is not null limit 5) p

  -- 9. school_id - single or multi tenant? More than one value means every
  --    query needs scoping by it, not just by branch.
  union all
  select 9, '9_school_id',
         jsonb_build_object('school_id', school_id, 'staff', count(*))
  from public.staff_roles where active group by school_id
) x
order by ord, detail::text;
