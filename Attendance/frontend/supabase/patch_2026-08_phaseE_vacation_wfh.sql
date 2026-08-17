-- Phase E - vacations (CBSE/PT marked; ACAD/CURR derive 50%), work-from-home
-- (ACAD/ADMIN/CURR), and per-person schedule protection. Run once in Project A.

-- ========== per-person schedule protection ==========
-- A schedule saved "By Person" is marked custom so a later "By Category" bulk
-- apply skips that person instead of clobbering their timing.
alter table staff_schedule add column if not exists is_custom boolean not null default false;

-- ========== VACATIONS ==========
-- A marked vacation for a board (CBSE or PT). It is expanded into category-scoped
-- calendar_override 'holiday' rows (reusing Phase D's machinery) so it shows on
-- the calendar and computes as off; those override rows carry vacation_id so the
-- vacation can be removed as a unit. ACAD/CURR vacation days (50% of CBSE, admin-
-- picked) are also stored as calendar_override rows tagged with the same vacation.
create table if not exists vacation_period (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  board text not null check (board in ('CBSE','PT')),
  from_date date not null,
  to_date date not null check (to_date >= from_date),
  created_by text,
  created_at timestamptz not null default now()
);

alter table calendar_override add column if not exists vacation_id uuid references vacation_period(id) on delete cascade;

alter table vacation_period enable row level security;
drop policy if exists "authenticated full access" on vacation_period;
create policy "authenticated full access" on vacation_period for all to authenticated using (true) with check (true);

-- ========== WORK FROM HOME ==========
create table if not exists wfh_day (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null,          -- employee_id
  wfh_date date not null,
  reason text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (staff_id, wfh_date)
);
create index if not exists idx_wfh_day_staff on wfh_day (staff_id, wfh_date);

alter table wfh_day enable row level security;
drop policy if exists "authenticated full access" on wfh_day;
create policy "authenticated full access" on wfh_day for all to authenticated using (true) with check (true);

-- Allow the new 'wfh' status (present, worked from home). Robustly replaces any
-- existing check constraint on the status column.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'attendance_daily_status'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table attendance_daily_status drop constraint %I', c.conname);
  end loop;
  alter table attendance_daily_status add constraint attendance_daily_status_status_check
    check (status in ('ok','late','short','absent','holiday','regularised','wfh'));
end $$;

-- ========== compute_attendance_status (adds WFH; keeps Phase D overrides) ==========
create or replace function compute_attendance_status(p_staff_id text, p_date date)
returns void
language plpgsql
as $$
declare
  v_weekday int := extract(dow from p_date)::int;
  v_occurrence int := ((extract(day from p_date)::int - 1) / 7) + 1;
  v_category text;
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
  select category into v_category from staff_master where employee_id = p_staff_id limit 1;

  select * into v_override
  from calendar_override
  where event_date = p_date
    and (staff_id is null or staff_id = p_staff_id)
    and (category is null or category = v_category)
  order by (staff_id is not null) desc, (category is not null) desc
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

  -- Work-from-home: a working day worked from home = present, no punch expected.
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

-- Recompute a whole date range for a category (or everyone) - used when a
-- vacation (many dates) is added/removed.
create or replace function recompute_calendar_range(p_from date, p_to date, p_category text)
returns void
language plpgsql
as $$
declare
  r record;
  d date;
begin
  for r in
    select employee_id from staff_master
    where employee_id is not null and (p_category is null or category = p_category)
  loop
    d := p_from;
    while d <= p_to loop
      perform compute_attendance_status(r.employee_id, d);
      d := d + 1;
    end loop;
  end loop;
end;
$$;

grant execute on function recompute_calendar_range(date, date, text) to authenticated;
