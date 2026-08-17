-- Run in Project A's SQL editor. Adds the category-wide festival holiday
-- list (Template 2: S.No / Festival / Day / Month / Date + a per-category
-- Yes/No column for Students_CBSE, CBSE, Acad Admin, Admin, Curriculum
-- Team - IB/MONT columns are read but dropped, CBSE-first rollout).
--
-- This is deliberately just a reference/audit table - importing a festival
-- expands it into the EXISTING staff_holiday table (one row per matching
-- staff_master member per category marked "Yes"), which
-- compute_attendance_status already checks. So no change to that function
-- is needed - see src/lib/festivalHolidayImport.js for the expansion logic.
-- Students_CBSE has no staff_master category to expand into (it's for
-- students, not staff) - it's stored here for record-keeping only.

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

alter table festival_holiday enable row level security;
create policy "authenticated full access" on festival_holiday for all to authenticated using (true) with check (true);
