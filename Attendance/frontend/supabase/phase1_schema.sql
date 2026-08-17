-- Attendance app - Phase 1 schema
-- Run this in the SQL Editor of Project A (aouvxdfamzprykezeovl) - the SAME
-- Supabase project the school portal issues SSO access_tokens for, and that
-- Timetable already uses for its own domain tables. It must be this project
-- (not a separate new one) so the portal's SSO token, pinned as this app's
-- PostgREST bearer header (see src/lib/supabaseClients.js -
-- createAttendanceClient(accessToken), same pattern as Timetable's
-- createTimetableClient), verifies correctly - a token issued by a
-- different Supabase project would fail JWT verification here.
--
-- Do NOT run this against Project B (staff_roles, ukpythuclqvjwygqrsds) -
-- this app only ever READS staff_roles from Project B via a separate
-- anon-key client; staff_roles itself is never touched here.
--
-- staff_id / staff_email columns below refer to staff_roles.id / staff_roles.email
-- in Project B. There is no real foreign key across projects - joins happen
-- app-side (same pattern Timetable/frontend-v2 uses for staff_roles).
--
-- Verified before writing this file: none of the table names below
-- (staff_schedule, staff_stayback_override, staff_holiday,
-- punch_import_batch, punch_record_raw, punch_record_daily,
-- attendance_daily_status, regularisation_request, leave_request) already
-- exist in Project A - confirmed via a live REST HEAD check, all 404.

create extension if not exists pgcrypto;

-- ========== SCHEDULE CONFIG ==========

create table if not exists staff_schedule (
  id uuid primary key default gen_random_uuid(),
  staff_id int not null,
  staff_email text not null,
  weekday int not null check (weekday between 0 and 6),  -- 0=Sunday .. 6=Saturday (matches Postgres EXTRACT(DOW))
  is_working_day boolean not null default true,
  check_in_time time,
  check_out_time time,
  grace_minutes int not null default 0,
  -- null = applies to every occurrence of this weekday in the month (the
  -- default, and the only mode for Sun-Fri). A value like {1,3} restricts
  -- this row to just the 1st/3rd occurrence - the alternating-Saturday case
  -- (e.g. 1st & 3rd Saturday off, 2nd & 4th working) needs TWO staff_schedule
  -- rows for weekday=6 with disjoint occurrence sets, not one.
  week_occurrence int[],
  effective_from date not null default current_date,
  effective_to date,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, weekday, effective_from, week_occurrence)
);
create index if not exists idx_staff_schedule_staff on staff_schedule (staff_id, weekday);

create table if not exists staff_stayback_override (
  id uuid primary key default gen_random_uuid(),
  staff_id int not null,
  weekday int not null check (weekday between 0 and 6),
  stayback_check_out_time time not null,
  effective_from date not null default current_date,
  effective_to date,
  reason text,
  active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_stayback_staff on staff_stayback_override (staff_id, weekday);

create table if not exists staff_holiday (
  id uuid primary key default gen_random_uuid(),
  staff_id int not null,
  holiday_date date not null,
  label text,
  source text not null default 'manual' check (source in ('manual','bulk_import')),
  created_by text,
  created_at timestamptz not null default now(),
  unique (staff_id, holiday_date)
);
create index if not exists idx_staff_holiday_staff on staff_holiday (staff_id);

-- Category-wide festival holiday list (Template 2) - a reference/audit
-- table only. Importing a festival expands it into staff_holiday rows (one
-- per matching staff_master member per category marked "Yes"), which
-- compute_attendance_status already reads - see festivalHolidayImport.js.
-- Students_CBSE has no staff_master category to expand into (students, not
-- staff) - stored here for record-keeping only. A "Sunday" cell in the
-- sheet counts as Yes for that category (already a holiday for everyone);
-- a row with every category "No" isn't observed as a holiday at all and is
-- never written here.
create table if not exists festival_holiday (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  festival_name text not null,
  category text not null check (category in ('STUDENTS_CBSE','CBSE','ACAD','ADMIN','CURR')),
  imported_by text,
  created_at timestamptz not null default now(),
  unique (holiday_date, category)
);
create index if not exists idx_festival_holiday_date on festival_holiday (holiday_date);

-- ========== PUNCH INGESTION ==========

create table if not exists punch_import_batch (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  uploaded_by text not null,
  uploaded_at timestamptz not null default now(),
  row_count int,
  status text not null default 'processing' check (status in ('processing','completed','failed')),
  error_summary text
);

create table if not exists punch_record_raw (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references punch_import_batch(id),
  raw_row jsonb not null,
  parsed_staff_identifier text,
  parsed_date date,
  parsed_time time,
  parsed_direction text check (parsed_direction in ('in','out') or parsed_direction is null),
  match_status text not null default 'unmatched' check (match_status in ('matched','unmatched','ambiguous')),
  matched_staff_id int,
  created_at timestamptz not null default now()
);
create index if not exists idx_punch_raw_batch on punch_record_raw (batch_id);
create index if not exists idx_punch_raw_match_status on punch_record_raw (match_status);

create table if not exists punch_record_daily (
  id uuid primary key default gen_random_uuid(),
  staff_id int not null,
  attendance_date date not null,
  first_in_time time,
  last_out_time time,
  raw_punch_count int not null default 0,
  batch_id uuid references punch_import_batch(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, attendance_date)
);
create index if not exists idx_punch_daily_staff on punch_record_daily (staff_id, attendance_date);

-- ========== COMPUTED DAILY STATUS ==========

create table if not exists attendance_daily_status (
  id uuid primary key default gen_random_uuid(),
  staff_id int not null,
  attendance_date date not null,
  is_working_day boolean not null,
  required_check_in time,
  required_check_out time,
  actual_check_in time,
  actual_check_out time,
  late_minutes int not null default 0,
  short_minutes int not null default 0,
  status text not null check (status in ('ok','late','short','absent','holiday','regularised')),
  computed_at timestamptz not null default now(),
  unique (staff_id, attendance_date)
);
create index if not exists idx_attendance_status_staff on attendance_daily_status (staff_id, attendance_date);

-- ========== COMPUTATION RPCs ==========

-- Resolves schedule + stay-back + holiday + actual punch for one staff/date,
-- upserts the result into attendance_daily_status. Safe to call repeatedly
-- (e.g. re-run after a schedule edit or a fresh CSV import).
create or replace function compute_attendance_status(p_staff_id int, p_date date)
returns void
language plpgsql
as $$
declare
  v_weekday int := extract(dow from p_date)::int;
  -- Which occurrence of this weekday p_date is within its month (1st, 2nd,
  -- 3rd...) - needed to pick the right row when a weekday has more than one
  -- occurrence-scoped staff_schedule row (the alternating-Saturday case).
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

  -- A category-wide academic-calendar holiday always shows, regardless of
  -- whether this person has a schedule configured yet - checked BEFORE even
  -- looking up staff_schedule. Schedule/punch timings only govern
  -- present/absent/late/short on working days; holidays are an overlay on
  -- top of that, not conditional on it.
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
    (week_occurrence is not null) desc, -- an occurrence-specific row beats a generic "every occurrence" row
    effective_from desc
  limit 1;

  if v_schedule.id is null then
    -- no schedule configured for this weekday at all - no row at all (not a
    -- 'not_applicable' status). The UI already renders "no record" dates as
    -- a plain blank cell, so there's nothing else to represent here. Also
    -- covers the case where a schedule existed before and was removed.
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

  -- resolve stay-back override for this weekday/date, if any
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

-- Bulk re-run, e.g. after a staff_schedule/holiday edit needs to retroactively
-- re-evaluate a date range that was already computed.
create or replace function recompute_attendance_range(p_staff_id int, p_from date, p_to date)
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

-- ========== REGULARISATION (pulled forward from Phase 2: the day-detail
-- popup's Regularise/Bus-late buttons need somewhere to write to) ==========

create table if not exists regularisation_request (
  id uuid primary key default gen_random_uuid(),
  staff_id int not null,
  staff_email text not null,
  attendance_date date not null,
  reason_category text not null check (reason_category in ('bus_travel','traffic','personal','medical','other')),
  reason_text text,
  requested_at timestamptz not null default now(),
  requested_by text not null,
  -- 'cancelled' = the requester withdrew it themselves, only while still
  -- 'pending' (the UI enforces this - once approved/auto_approved, cancel is
  -- not offered, unlike leave_request which stays cancellable after
  -- approval too - reverting an already-applied regularisation would mean
  -- undoing trg_c_apply_regularisation_effect's day flip, more complexity
  -- than this basic version needs).
  status text not null default 'pending' check (status in ('pending','approved','rejected','auto_approved','cancelled')),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  counts_toward_cap boolean not null default true,
  created_at timestamptz not null default now(),
  unique (staff_id, attendance_date)
);
create index if not exists idx_regularisation_staff on regularisation_request (staff_id, attendance_date);
create index if not exists idx_regularisation_status on regularisation_request (status);

-- bus_travel requests auto-approve immediately and never count toward the
-- 3/month cap (a bus delay isn't the teacher's fault). Named trg_a_ so it
-- runs before trg_b_'s cap check below (Postgres runs same-timing triggers
-- in name order) - the cap check must see the final counts_toward_cap value.
create or replace function default_bus_travel_status() returns trigger as $$
begin
  if new.reason_category = 'bus_travel' then
    new.status := 'auto_approved';
    new.counts_toward_cap := false;
    new.decided_at := coalesce(new.decided_at, now());
    new.decision_note := coalesce(new.decision_note, 'Auto-approved: reported bus travel delay');
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_a_default_bus_travel_status
before insert on regularisation_request
for each row execute function default_bus_travel_status();

-- Hard cap: only 1 cap-counting regularisation per staff per calendar month
-- (reduced from 3), enforced at the DB layer so it's atomic regardless of
-- which client triggers it. Counts 'pending' as well as
-- 'approved'/'auto_approved' - submitting one (even before a decision) uses
-- up the month's slot, so a second can't be raised while the first is still
-- awaiting a decision. A 'rejected' request does NOT count, so the slot
-- frees up again if the first one is turned down.
create or replace function enforce_regularisation_cap() returns trigger as $$
declare
  existing_count int;
begin
  if new.status in ('pending','approved','auto_approved') and new.counts_toward_cap then
    select count(*) into existing_count
    from regularisation_request
    where staff_id = new.staff_id
      and counts_toward_cap
      and status in ('pending','approved','auto_approved')
      and date_trunc('month', attendance_date) = date_trunc('month', new.attendance_date)
      and id <> new.id;
    if existing_count >= 1 then
      raise exception 'Only 1 regularisation allowed per calendar month for this staff member';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_b_enforce_regularisation_cap
before insert or update on regularisation_request
for each row execute function enforce_regularisation_cap();

-- Flips the underlying day's attendance_daily_status to 'regularised' once a
-- request lands in an approved/auto_approved state.
create or replace function apply_regularisation_effect(p_request_id uuid)
returns void
language plpgsql
as $$
declare
  v_req regularisation_request%rowtype;
begin
  select * into v_req from regularisation_request where id = p_request_id;
  if v_req.id is null then
    return;
  end if;
  update attendance_daily_status
    set status = 'regularised', computed_at = now()
    where staff_id = v_req.staff_id and attendance_date = v_req.attendance_date;
end;
$$;

create or replace function trg_apply_regularisation_effect_fn() returns trigger as $$
begin
  if new.status in ('approved','auto_approved')
     and (TG_OP = 'INSERT' or OLD.status is distinct from NEW.status) then
    perform apply_regularisation_effect(new.id);
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_c_apply_regularisation_effect
after insert or update on regularisation_request
for each row execute function trg_apply_regularisation_effect_fn();

-- ========== LEAVE MANAGEMENT (basic version - no sandwich-rule handling
-- yet; from/to date range counted as inclusive calendar days) ==========

create table if not exists leave_request (
  id uuid primary key default gen_random_uuid(),
  staff_id int not null,
  staff_email text not null,
  from_date date not null,
  to_date date not null check (to_date >= from_date),
  days_count int generated always as (to_date - from_date + 1) stored,
  reason_text text,
  approver_staff_id int,       -- resolved app-side (staff_roles Principal for the requester's branch) and stored denormalized
  approver_name text,
  -- 'cancelled' = the requester withdrew it themselves (decided_by/decided_at
  -- stay null in that case - those two columns are for an APPROVER's
  -- decision only, so null-decided_by + status='cancelled' unambiguously
  -- means "the requester cancelled their own request", no separate
  -- cancelled_by/cancelled_at columns needed for that distinction).
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_at timestamptz not null default now(),
  requested_by text not null,
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_leave_staff on leave_request (staff_id);
create index if not exists idx_leave_status on leave_request (status);

-- 10 casual leaves per calendar year, hardcoded on purpose for this basic
-- version - raise this to a per-staff-type config if/when leave policy
-- differs by role (mirrors the same "generic, not hardcoded" principle used
-- for staff_schedule, just not built out yet since only one rule exists today).
create or replace function leave_balance(p_staff_id int, p_year int)
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

-- ========== ROW LEVEL SECURITY ==========
-- Phase 1 posture: any authenticated user (all staff sign in via Supabase
-- email-OTP) can read/write. Per-role restriction (e.g. only admins editing
-- someone else's schedule) is deferred to Phase 2 alongside the
-- regularisation approval gate - tighten these policies then, don't leave
-- them this open long-term.

alter table staff_schedule enable row level security;
alter table staff_stayback_override enable row level security;
alter table staff_holiday enable row level security;
alter table festival_holiday enable row level security;
alter table punch_import_batch enable row level security;
alter table punch_record_raw enable row level security;
alter table punch_record_daily enable row level security;
alter table attendance_daily_status enable row level security;
alter table regularisation_request enable row level security;
alter table leave_request enable row level security;

create policy "authenticated full access" on staff_schedule for all to authenticated using (true) with check (true);
create policy "authenticated full access" on staff_stayback_override for all to authenticated using (true) with check (true);
create policy "authenticated full access" on staff_holiday for all to authenticated using (true) with check (true);
create policy "authenticated full access" on festival_holiday for all to authenticated using (true) with check (true);
create policy "authenticated full access" on punch_import_batch for all to authenticated using (true) with check (true);
create policy "authenticated full access" on punch_record_raw for all to authenticated using (true) with check (true);
create policy "authenticated full access" on punch_record_daily for all to authenticated using (true) with check (true);
create policy "authenticated full access" on attendance_daily_status for all to authenticated using (true) with check (true);
create policy "authenticated full access" on regularisation_request for all to authenticated using (true) with check (true);
create policy "authenticated full access" on leave_request for all to authenticated using (true) with check (true);

grant execute on function compute_attendance_status(int, date) to authenticated;
grant execute on function recompute_attendance_range(int, date, date) to authenticated;
grant execute on function apply_regularisation_effect(uuid) to authenticated;
grant execute on function leave_balance(int, int) to authenticated;
