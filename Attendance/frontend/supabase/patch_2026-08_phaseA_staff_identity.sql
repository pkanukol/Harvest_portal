-- Phase A - re-key the whole app from the old integer staff_id (which was
-- staff_roles.id in Project B) to the text employee_id that lives on
-- staff_master and comes from the staff_list Excel. employee_id is the identity
-- everywhere now (the biometric report uses the same id), so staff_roles /
-- Project B is no longer used at all - which also removes the anon-SELECT 401
-- that bounced users to the portal sign-in.
--
-- Run this ONCE in Project A (aouvxdfamzprykezeovl) SQL editor.
--
-- The attendance tables keep the COLUMN NAME staff_id (so the frontend's
-- .eq("staff_id", ...) calls are unchanged) but the column TYPE becomes text and
-- now holds the employee_id value.
--
-- DATA: August is disposable test data; July is real. July is NOT migrated in
-- place (the old rows are keyed by the retired integer id and there's no clean
-- int->employee_id map without Project B). Instead the derived/config tables are
-- truncated here and July is rebuilt afterwards from employee_daily_attendance
-- (which is already keyed by employee_id and is left untouched) - see the
-- "After running" steps at the bottom.

begin;

-- 1. Drop the RPCs whose signatures pin staff_id as int (recreated as text below).
drop function if exists compute_attendance_status(int, date);
drop function if exists recompute_attendance_range(int, date, date);
drop function if exists leave_balance(int, int);

-- 2. Clear the tables that key on the old integer id. employee_daily_attendance
--    (raw July punches, keyed by employee_id) and festival_holiday (category-keyed
--    reference list) are deliberately KEPT. leave_request / regularisation_request
--    hold only in-app test entries (real July data came in via the biometric Excel,
--    not hand-entered leaves) so they are cleared too.
truncate table
  attendance_daily_status,
  punch_record_daily,
  punch_record_raw,
  staff_schedule,
  staff_stayback_override,
  staff_holiday,
  leave_request,
  regularisation_request;

-- 3. Flip the key columns int -> text (safe now the tables are empty).
alter table staff_schedule          alter column staff_id type text;
alter table staff_stayback_override alter column staff_id type text;
alter table staff_holiday           alter column staff_id type text;
alter table punch_record_daily      alter column staff_id type text;
alter table attendance_daily_status alter column staff_id type text;
alter table regularisation_request  alter column staff_id type text;
alter table leave_request           alter column staff_id type text;
alter table leave_request           alter column approver_staff_id type text;
alter table punch_record_raw        alter column matched_staff_id type text;

commit;

-- 4. Recreate the compute RPCs with a text p_staff_id (identical logic to
--    patch_2026-08_holiday_independent_of_schedule.sql, just the param type).
create or replace function compute_attendance_status(p_staff_id text, p_date date)
returns void
language plpgsql
as $$
declare
  v_weekday int := extract(dow from p_date)::int;
  v_occurrence int := ((extract(day from p_date)::int - 1) / 7) + 1;
  v_schedule staff_schedule%rowtype;
  v_stayback staff_stayback_override%rowtype;
  v_holiday staff_holiday%rowtype;
  v_punch punch_record_daily%rowtype;
  v_required_check_in time;
  v_required_check_out time;
  v_is_working_day boolean;
  v_late_minutes int := 0;
  v_short_minutes int := 0;
  v_status text;
begin
  select * into v_holiday
  from staff_holiday
  where staff_id = p_staff_id and holiday_date = p_date;

  select * into v_punch
  from punch_record_daily
  where staff_id = p_staff_id and attendance_date = p_date;

  -- Holiday always wins, regardless of whether a schedule exists.
  if v_holiday.id is not null then
    insert into attendance_daily_status (
      staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
      actual_check_in, actual_check_out, late_minutes, short_minutes, status, computed_at
    ) values (
      p_staff_id, p_date, false, null, null,
      v_punch.first_in_time, v_punch.last_out_time, 0, 0, 'holiday', now()
    )
    on conflict (staff_id, attendance_date) do update set
      is_working_day = excluded.is_working_day,
      required_check_in = excluded.required_check_in,
      required_check_out = excluded.required_check_out,
      actual_check_in = excluded.actual_check_in,
      actual_check_out = excluded.actual_check_out,
      late_minutes = excluded.late_minutes,
      short_minutes = excluded.short_minutes,
      status = excluded.status,
      computed_at = now();
    return;
  end if;

  select * into v_schedule
  from staff_schedule
  where staff_id = p_staff_id
    and weekday = v_weekday
    and effective_from <= p_date
    and (effective_to is null or effective_to >= p_date)
    and (week_occurrence is null or v_occurrence = any(week_occurrence))
  order by
    (week_occurrence is not null) desc,
    effective_from desc
  limit 1;

  if v_schedule.id is null then
    delete from attendance_daily_status where staff_id = p_staff_id and attendance_date = p_date;
    return;
  end if;

  v_is_working_day := v_schedule.is_working_day;

  if not v_is_working_day then
    insert into attendance_daily_status (
      staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
      actual_check_in, actual_check_out, late_minutes, short_minutes, status, computed_at
    ) values (
      p_staff_id, p_date, false, v_schedule.check_in_time, v_schedule.check_out_time,
      v_punch.first_in_time, v_punch.last_out_time, 0, 0, 'holiday', now()
    )
    on conflict (staff_id, attendance_date) do update set
      is_working_day = excluded.is_working_day,
      required_check_in = excluded.required_check_in,
      required_check_out = excluded.required_check_out,
      actual_check_in = excluded.actual_check_in,
      actual_check_out = excluded.actual_check_out,
      late_minutes = excluded.late_minutes,
      short_minutes = excluded.short_minutes,
      status = excluded.status,
      computed_at = now();
    return;
  end if;

  select * into v_stayback
  from staff_stayback_override
  where staff_id = p_staff_id
    and weekday = v_weekday
    and active = true
    and effective_from <= p_date
    and (effective_to is null or effective_to >= p_date)
  order by effective_from desc
  limit 1;

  v_required_check_in := v_schedule.check_in_time;
  v_required_check_out := coalesce(v_stayback.stayback_check_out_time, v_schedule.check_out_time);

  if v_punch.first_in_time is null and v_punch.last_out_time is null then
    v_status := 'absent';
  else
    if v_required_check_in is not null and v_punch.first_in_time is not null then
      v_late_minutes := greatest(0, extract(epoch from (
        v_punch.first_in_time - (v_required_check_in + (v_schedule.grace_minutes || ' minutes')::interval)
      ))::int / 60);
    end if;

    if v_required_check_out is not null and v_punch.last_out_time is not null then
      v_short_minutes := greatest(0, extract(epoch from (v_required_check_out - v_punch.last_out_time))::int / 60);
    end if;

    if v_late_minutes > 0 then
      v_status := 'late';
    elsif v_short_minutes > 0 then
      v_status := 'short';
    else
      v_status := 'ok';
    end if;
  end if;

  insert into attendance_daily_status (
    staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
    actual_check_in, actual_check_out, late_minutes, short_minutes, status, computed_at
  ) values (
    p_staff_id, p_date, true, v_required_check_in, v_required_check_out,
    v_punch.first_in_time, v_punch.last_out_time, v_late_minutes, v_short_minutes, v_status, now()
  )
  on conflict (staff_id, attendance_date) do update set
    is_working_day = excluded.is_working_day,
    required_check_in = excluded.required_check_in,
    required_check_out = excluded.required_check_out,
    actual_check_in = excluded.actual_check_in,
    actual_check_out = excluded.actual_check_out,
    late_minutes = excluded.late_minutes,
    short_minutes = excluded.short_minutes,
    status = excluded.status,
    computed_at = now();
end;
$$;

create or replace function recompute_attendance_range(p_staff_id text, p_from date, p_to date)
returns void
language plpgsql
as $$
declare
  v_date date;
begin
  v_date := p_from;
  while v_date <= p_to loop
    perform compute_attendance_status(p_staff_id, v_date);
    v_date := v_date + 1;
  end loop;
end;
$$;

-- Kept working with the new text key for now; Phase B replaces this with the
-- category-driven leave_entitlement() RPC.
create or replace function leave_balance(p_staff_id text, p_year int)
returns int
language sql
stable
as $$
  select 10 - coalesce(sum(days_count), 0)::int
  from leave_request
  where staff_id = p_staff_id
    and status = 'approved'
    and extract(year from from_date) = p_year;
$$;

grant execute on function compute_attendance_status(text, date) to authenticated;
grant execute on function recompute_attendance_range(text, date, date) to authenticated;
grant execute on function leave_balance(text, int) to authenticated;

-- After running this file:
--   1. Admin -> Import Staff List (uploads staff_list.xlsx -> staff_master).
--   2. Admin -> Import Festival Holiday List (re-expands staff_holiday).
--   3. Admin -> Configure Staff Schedule (bulk by category is fine).
--   4. Admin -> Import Biometric Report -> "Re-link this month" for July
--      (rebuilds July's calendar from employee_daily_attendance under the new key).
