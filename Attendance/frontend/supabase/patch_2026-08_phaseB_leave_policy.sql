-- Phase B - policy-driven leave: per-category CL/EL config, CL accrual by
-- joining date, ADMIN-only EL after 1 year, a leave_type on each request, a
-- hard 3-continuous-day cap, and an lop_days field (populated at apply time;
-- the calendar LOP display comes in Phase C). Run once in Project A.

-- ========== PER-CATEGORY LEAVE POLICY (admin-editable) ==========
create table if not exists category_leave_policy (
  category text primary key check (category in ('CBSE','IB','MONT','CURR','PT','ACAD','ADMIN')),
  cl_annual int not null default 10,             -- casual leaves per fiscal year
  el_annual int not null default 0,              -- earned leaves per fiscal year (0 = none)
  cl_start_month int not null default 6,         -- calendar month CL accrual begins (Apr=4, Jun=6)
  el_min_service_months int not null default 12, -- EL only after this much service
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table category_leave_policy enable row level security;
drop policy if exists "authenticated full access" on category_leave_policy;
create policy "authenticated full access" on category_leave_policy for all to authenticated using (true) with check (true);

-- Seed: ADMIN works all 12 months (incl. April & May) -> CL accrues from April,
-- 12/yr (so 5 accrued by August). Everyone else has summer vacation in Apr/May
-- -> CL accrues from June, 10/yr (3 accrued by August). ADMIN also gets 15 EL
-- (after 1 year of service); other categories get CL only.
insert into category_leave_policy (category, cl_annual, el_annual, cl_start_month) values
  ('ADMIN', 12, 15, 4),
  ('CBSE',  10,  0, 6),
  ('ACAD',  10,  0, 6),
  ('CURR',  10,  0, 6),
  ('PT',    10,  0, 6),
  ('IB',    10,  0, 6),
  ('MONT',  10,  0, 6)
on conflict (category) do nothing;

-- Idempotent correction, so re-running this file fixes the start months even if
-- an earlier version seeded them differently: ADMIN starts April, everyone else June.
update category_leave_policy set cl_start_month = 4 where category = 'ADMIN'  and cl_start_month <> 4;
update category_leave_policy set cl_start_month = 6 where category <> 'ADMIN' and cl_start_month <> 6;

-- ========== leave_request: type, LOP, 3-day cap ==========
alter table leave_request add column if not exists leave_type text not null default 'CL'
  check (leave_type in ('CL','EL'));
alter table leave_request add column if not exists lop_days int not null default 0;

-- Max 3 continuous days per request (to_date - from_date is the gap in days, so
-- <= 2 means at most 3 inclusive days). Guarded so re-running is safe.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leave_span_max_3_days') then
    alter table leave_request add constraint leave_span_max_3_days check (to_date - from_date <= 2);
  end if;
end $$;

-- ========== ENTITLEMENT / ACCRUAL RPC ==========
-- One call returns everything ApplyLeaveModal needs for a person: their category,
-- the policy numbers, CL accrued-to-date (by joining date + system date), CL/EL
-- used this fiscal year (approved + pending), and remaining. Fiscal year is
-- Apr 1 - Mar 31. CL accrues +1 per month from the category's start month (or the
-- joining month, whichever is later), capped at cl_annual. EL is a flat annual
-- grant, only for categories with el_annual > 0 and only after el_min_service_months.
create or replace function leave_entitlement(p_employee_id text)
returns table (
  category text,
  cl_annual int,
  el_annual int,
  cl_accrued int,
  cl_used int,
  cl_remaining int,
  el_entitled int,
  el_used int,
  el_remaining int
)
language plpgsql
stable
as $$
declare
  v_category text;
  v_doj date;
  v_cl_annual int;
  v_el_annual int;
  v_cl_start_month int;
  v_el_min int;
  v_today date := current_date;
  v_fiscal_start date;
  v_fiscal_end date;
  v_cat_start_fidx int;
  v_join_fidx int;
  v_start_fidx int;
  v_cur_fidx int;
  v_accrued int;
  v_cl_used int;
  v_el_used int;
  v_el_entitled int;
begin
  select sm.category, sm.date_of_joining into v_category, v_doj
  from staff_master sm where sm.employee_id = p_employee_id limit 1;
  if v_category is null then
    return;
  end if;

  select clp.cl_annual, clp.el_annual, clp.cl_start_month, clp.el_min_service_months
  into v_cl_annual, v_el_annual, v_cl_start_month, v_el_min
  from category_leave_policy clp where clp.category = v_category;

  v_cl_annual := coalesce(v_cl_annual, 10);
  v_el_annual := coalesce(v_el_annual, 0);
  v_cl_start_month := coalesce(v_cl_start_month, 6);
  v_el_min := coalesce(v_el_min, 12);

  -- Fiscal year (Apr 1 - Mar 31) containing today.
  if extract(month from v_today) >= 4 then
    v_fiscal_start := make_date(extract(year from v_today)::int, 4, 1);
  else
    v_fiscal_start := make_date(extract(year from v_today)::int - 1, 4, 1);
  end if;
  v_fiscal_end := (v_fiscal_start + interval '1 year - 1 day')::date;

  -- Fiscal-month index: Apr=1 .. Mar=12.
  v_cat_start_fidx := ((v_cl_start_month - 4 + 12) % 12) + 1;
  v_cur_fidx := ((extract(month from v_today)::int - 4 + 12) % 12) + 1;

  v_start_fidx := v_cat_start_fidx;
  -- Joined mid-year: don't accrue for months before they joined.
  if v_doj is not null and v_doj >= v_fiscal_start and v_doj <= v_fiscal_end then
    v_join_fidx := ((extract(month from v_doj)::int - 4 + 12) % 12) + 1;
    if v_join_fidx > v_start_fidx then
      v_start_fidx := v_join_fidx;
    end if;
  end if;

  if v_doj is not null and v_doj > v_today then
    v_accrued := 0;                         -- not joined yet
  elsif v_cur_fidx >= v_start_fidx then
    v_accrued := least(v_cur_fidx - v_start_fidx + 1, v_cl_annual);
  else
    v_accrued := 0;                         -- before this category's accrual window (e.g. Apr/May for teachers)
  end if;

  -- LOP days (sandwich / beyond-balance) do NOT consume the CL/EL balance - only
  -- the non-LOP portion of each leave counts as used.
  select coalesce(sum(days_count - lop_days), 0)::int into v_cl_used
  from leave_request
  where staff_id = p_employee_id and leave_type = 'CL'
    and status in ('approved', 'pending')
    and from_date >= v_fiscal_start and from_date <= v_fiscal_end;

  select coalesce(sum(days_count - lop_days), 0)::int into v_el_used
  from leave_request
  where staff_id = p_employee_id and leave_type = 'EL'
    and status in ('approved', 'pending')
    and from_date >= v_fiscal_start and from_date <= v_fiscal_end;

  if v_el_annual > 0 and v_doj is not null
     and v_doj <= (v_today - make_interval(months => v_el_min))::date then
    v_el_entitled := v_el_annual;
  else
    v_el_entitled := 0;
  end if;

  category := v_category;
  cl_annual := v_cl_annual;
  el_annual := v_el_annual;
  cl_accrued := v_accrued;
  cl_used := v_cl_used;
  cl_remaining := v_accrued - v_cl_used;
  el_entitled := v_el_entitled;
  el_used := v_el_used;
  el_remaining := v_el_entitled - v_el_used;
  return next;
end;
$$;

grant execute on function leave_entitlement(text) to authenticated;
