-- Phase D - one-off calendar overrides (turn a specific Saturday on/off, move a
-- holiday, or mark a working day as a holiday with a reason) and the 1-hour
-- permission (once per calendar month per person). Run once in Project A.

-- ========== CALENDAR OVERRIDE (school/category-wide, per specific date) ==========
-- A date-specific override that beats the recurring schedule:
--   kind='holiday'  -> that date is off for the scoped people (reason shows on the calendar)
--   kind='working'  -> that date is a working day even if the schedule says off
--                      (e.g. switch which Saturdays are off in a given month)
-- Scope precedence (most specific wins): a specific person (staff_id/employee_id)
-- beats a category, which beats all (both null). So a "By Person" override set on
-- someone overrides the "By Category" one for them.
create table if not exists calendar_override (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  staff_id text,     -- employee_id; null = not person-scoped
  category text check (category in ('CBSE','IB','MONT','CURR','PT','ACAD','ADMIN')),
  kind text not null check (kind in ('holiday','working')),
  reason text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_calendar_override_date on calendar_override (event_date);
-- One override per (date, scope); coalesce so null person/category don't create dupes.
create unique index if not exists uq_calendar_override_scope
  on calendar_override (event_date, coalesce(staff_id, '*'), coalesce(category, '*'));

alter table calendar_override enable row level security;
drop policy if exists "authenticated full access" on calendar_override;
create policy "authenticated full access" on calendar_override for all to authenticated using (true) with check (true);

-- ========== 1-HOUR PERMISSION ==========
create table if not exists hour_permission (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null,            -- employee_id
  staff_email text,
  permission_date date not null,
  reason text,
  is_emergency boolean not null default false,
  applied_by text,
  applied_at timestamptz not null default now()
);
create index if not exists idx_hour_permission_staff on hour_permission (staff_id, permission_date);

alter table hour_permission enable row level security;
drop policy if exists "authenticated full access" on hour_permission;
create policy "authenticated full access" on hour_permission for all to authenticated using (true) with check (true);

-- 1 per staff per calendar month; Saturdays only for emergencies.
create or replace function enforce_hour_permission_cap() returns trigger as $$
declare
  existing int;
begin
  if extract(dow from new.permission_date) = 6 and not new.is_emergency then
    raise exception 'A 1-hour permission on a Saturday is only allowed for emergencies';
  end if;
  select count(*) into existing
  from hour_permission
  where staff_id = new.staff_id
    and date_trunc('month', permission_date) = date_trunc('month', new.permission_date)
    and id <> new.id;
  if existing >= 1 then
    raise exception 'Only 1 one-hour permission is allowed per calendar month';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_hour_permission_cap on hour_permission;
create trigger trg_hour_permission_cap before insert on hour_permission
for each row execute function enforce_hour_permission_cap();

-- ========== compute_attendance_status (adds calendar_override) ==========
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
  v_required_check_in time;
  v_required_check_out time;
  v_is_working_day boolean;
  v_late_minutes int := 0;
  v_short_minutes int := 0;
  v_status text;
begin
  select category into v_category from staff_master where employee_id = p_staff_id limit 1;

  -- Most specific override wins: this person > their category > all.
  select * into v_override
  from calendar_override
  where event_date = p_date
    and (staff_id is null or staff_id = p_staff_id)
    and (category is null or category = v_category)
  order by (staff_id is not null) desc, (category is not null) desc
  limit 1;

  select * into v_punch from punch_record_daily where staff_id = p_staff_id and attendance_date = p_date;

  -- Forced holiday overrides everything.
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

  -- staff_holiday (academic-calendar) - skipped when a 'working' override forces the day on.
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
    -- Need a timing: if the matched row isn't a working one, borrow this weekday's
    -- working timing (e.g. the Saturday working-hours row) if there is one.
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

-- Recompute one date after an override is added/edited/removed so the affected
-- calendars reflect it. Scope: a specific person (p_staff_id), else a category
-- (p_category), else everyone (both null).
create or replace function recompute_calendar_date(p_date date, p_category text, p_staff_id text)
returns void
language plpgsql
as $$
declare
  r record;
begin
  if p_staff_id is not null then
    perform compute_attendance_status(p_staff_id, p_date);
    return;
  end if;
  for r in
    select employee_id from staff_master
    where employee_id is not null and (p_category is null or category = p_category)
  loop
    perform compute_attendance_status(r.employee_id, p_date);
  end loop;
end;
$$;

grant execute on function recompute_calendar_date(date, text, text) to authenticated;
