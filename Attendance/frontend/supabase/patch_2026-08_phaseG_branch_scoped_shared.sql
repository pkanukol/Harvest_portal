-- Phase G - give the shared settings a branch dimension so they can be All
-- (both branches) or scoped to one, with branch-specific winning over All.
-- calendar_override and vacation_period gain a `branch` column (null = all
-- branches). compute_attendance_status now resolves the most specific override
-- as person > branch > category > all. Leave policy stays global (per category).
-- Run once in Project A.

alter table calendar_override add column if not exists branch text;
alter table vacation_period add column if not exists branch text; -- null = both branches

-- The scope key now includes branch, so an "All" and a branch-specific override
-- can coexist for the same date/category.
drop index if exists uq_calendar_override_scope;
create unique index if not exists uq_calendar_override_scope
  on calendar_override (event_date, coalesce(staff_id, '*'), coalesce(branch, '*'), coalesce(category, '*'));

create or replace function compute_attendance_status(p_staff_id text, p_date date)
returns void
language plpgsql
as $$
declare
  v_weekday int := extract(dow from p_date)::int;
  v_occurrence int := ((extract(day from p_date)::int - 1) / 7) + 1;
  v_category text;
  v_branch text;
  v_override calendar_override%rowtype;
  v_force_working boolean := false;
  v_schedule staff_schedule%rowtype;
  v_stayback staff_stayback_override%rowtype;
  v_holiday staff_holiday%rowtype;
  v_punch punch_record_daily%rowtype;
  v_wfh wfh_day%rowtype;
  v_required_check_in time;
  v_required_check_out time;
  v_is_working_day boolean;
  v_late_minutes int := 0;
  v_short_minutes int := 0;
  v_status text;
begin
  select category, branch into v_category, v_branch from staff_master where employee_id = p_staff_id limit 1;

  -- Most specific override wins: person > branch > category > all.
  select * into v_override
  from calendar_override
  where event_date = p_date
    and (staff_id is null or staff_id = p_staff_id)
    and (branch is null or branch = v_branch)
    and (category is null or category = v_category)
  order by (staff_id is not null) desc, (branch is not null) desc, (category is not null) desc
  limit 1;

  select * into v_punch from punch_record_daily where staff_id = p_staff_id and attendance_date = p_date;

  if v_override.id is not null and v_override.kind = 'holiday' then
    insert into attendance_daily_status (staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
      actual_check_in, actual_check_out, late_minutes, short_minutes, status, computed_at)
    values (p_staff_id, p_date, false, null, null, v_punch.first_in_time, v_punch.last_out_time, 0, 0, 'holiday', now())
    on conflict (staff_id, attendance_date) do update set
      is_working_day = excluded.is_working_day, required_check_in = excluded.required_check_in,
      required_check_out = excluded.required_check_out, actual_check_in = excluded.actual_check_in,
      actual_check_out = excluded.actual_check_out, late_minutes = 0, short_minutes = 0,
      status = 'holiday', computed_at = now();
    return;
  end if;

  if v_override.id is not null and v_override.kind = 'working' then
    v_force_working := true;
  end if;

  if not v_force_working then
    select * into v_holiday from staff_holiday where staff_id = p_staff_id and holiday_date = p_date;
    if v_holiday.id is not null then
      insert into attendance_daily_status (staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
        actual_check_in, actual_check_out, late_minutes, short_minutes, status, computed_at)
      values (p_staff_id, p_date, false, null, null, v_punch.first_in_time, v_punch.last_out_time, 0, 0, 'holiday', now())
      on conflict (staff_id, attendance_date) do update set
        is_working_day = excluded.is_working_day, required_check_in = excluded.required_check_in,
        required_check_out = excluded.required_check_out, actual_check_in = excluded.actual_check_in,
        actual_check_out = excluded.actual_check_out, late_minutes = 0, short_minutes = 0,
        status = 'holiday', computed_at = now();
      return;
    end if;
  end if;

  select * into v_schedule
  from staff_schedule
  where staff_id = p_staff_id and weekday = v_weekday
    and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
    and (week_occurrence is null or v_occurrence = any(week_occurrence))
  order by (week_occurrence is not null) desc, effective_from desc
  limit 1;

  if v_force_working then
    v_is_working_day := true;
    if v_schedule.id is null or not v_schedule.is_working_day then
      select * into v_schedule
      from staff_schedule
      where staff_id = p_staff_id and weekday = v_weekday and is_working_day = true
        and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
      order by effective_from desc
      limit 1;
    end if;
  else
    if v_schedule.id is null then
      delete from attendance_daily_status where staff_id = p_staff_id and attendance_date = p_date;
      return;
    end if;
    v_is_working_day := v_schedule.is_working_day;
    if not v_is_working_day then
      insert into attendance_daily_status (staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
        actual_check_in, actual_check_out, late_minutes, short_minutes, status, computed_at)
      values (p_staff_id, p_date, false, v_schedule.check_in_time, v_schedule.check_out_time,
        v_punch.first_in_time, v_punch.last_out_time, 0, 0, 'holiday', now())
      on conflict (staff_id, attendance_date) do update set
        is_working_day = excluded.is_working_day, required_check_in = excluded.required_check_in,
        required_check_out = excluded.required_check_out, actual_check_in = excluded.actual_check_in,
        actual_check_out = excluded.actual_check_out, late_minutes = 0, short_minutes = 0,
        status = 'holiday', computed_at = now();
      return;
    end if;
  end if;

  select * into v_wfh from wfh_day where staff_id = p_staff_id and wfh_date = p_date;
  if v_wfh.id is not null then
    insert into attendance_daily_status (staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
      actual_check_in, actual_check_out, late_minutes, short_minutes, status, computed_at)
    values (p_staff_id, p_date, true, v_schedule.check_in_time, v_schedule.check_out_time,
      v_punch.first_in_time, v_punch.last_out_time, 0, 0, 'wfh', now())
    on conflict (staff_id, attendance_date) do update set
      is_working_day = true, required_check_in = excluded.required_check_in,
      required_check_out = excluded.required_check_out, actual_check_in = excluded.actual_check_in,
      actual_check_out = excluded.actual_check_out, late_minutes = 0, short_minutes = 0,
      status = 'wfh', computed_at = now();
    return;
  end if;

  select * into v_stayback
  from staff_stayback_override
  where staff_id = p_staff_id and weekday = v_weekday and active = true
    and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
  order by effective_from desc
  limit 1;

  v_required_check_in := v_schedule.check_in_time;
  v_required_check_out := coalesce(v_stayback.stayback_check_out_time, v_schedule.check_out_time);

  if v_punch.first_in_time is null and v_punch.last_out_time is null then
    v_status := 'absent';
  else
    if v_required_check_in is not null and v_punch.first_in_time is not null then
      v_late_minutes := greatest(0, extract(epoch from (
        v_punch.first_in_time - (v_required_check_in + (coalesce(v_schedule.grace_minutes, 0) || ' minutes')::interval)
      ))::int / 60);
    end if;
    if v_required_check_out is not null and v_punch.last_out_time is not null then
      v_short_minutes := greatest(0, extract(epoch from (v_required_check_out - v_punch.last_out_time))::int / 60);
    end if;
    if v_late_minutes > 0 then v_status := 'late';
    elsif v_short_minutes > 0 then v_status := 'short';
    else v_status := 'ok';
    end if;
  end if;

  insert into attendance_daily_status (staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
    actual_check_in, actual_check_out, late_minutes, short_minutes, status, computed_at)
  values (p_staff_id, p_date, true, v_required_check_in, v_required_check_out,
    v_punch.first_in_time, v_punch.last_out_time, v_late_minutes, v_short_minutes, v_status, now())
  on conflict (staff_id, attendance_date) do update set
    is_working_day = excluded.is_working_day, required_check_in = excluded.required_check_in,
    required_check_out = excluded.required_check_out, actual_check_in = excluded.actual_check_in,
    actual_check_out = excluded.actual_check_out, late_minutes = excluded.late_minutes,
    short_minutes = excluded.short_minutes, status = excluded.status, computed_at = now();
end;
$$;

grant execute on function compute_attendance_status(text, date) to authenticated;

-- Recompute helpers gain a branch filter (null = all branches).
drop function if exists recompute_calendar_date(date, text, text);
create or replace function recompute_calendar_date(p_date date, p_category text, p_staff_id text, p_branch text)
returns void language plpgsql as $$
declare r record;
begin
  if p_staff_id is not null then
    perform compute_attendance_status(p_staff_id, p_date);
    return;
  end if;
  for r in
    select employee_id from staff_master
    where employee_id is not null
      and (p_category is null or category = p_category)
      and (p_branch is null or branch = p_branch)
  loop
    perform compute_attendance_status(r.employee_id, p_date);
  end loop;
end; $$;
grant execute on function recompute_calendar_date(date, text, text, text) to authenticated;

drop function if exists recompute_calendar_range(date, date, text);
create or replace function recompute_calendar_range(p_from date, p_to date, p_category text, p_branch text)
returns void language plpgsql as $$
declare r record; d date;
begin
  for r in
    select employee_id from staff_master
    where employee_id is not null
      and (p_category is null or category = p_category)
      and (p_branch is null or branch = p_branch)
  loop
    d := p_from;
    while d <= p_to loop
      perform compute_attendance_status(r.employee_id, d);
      d := d + 1;
    end loop;
  end loop;
end; $$;
grant execute on function recompute_calendar_range(date, date, text, text) to authenticated;
