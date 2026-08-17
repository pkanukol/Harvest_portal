-- Run in Project A's SQL editor. Raw daily attendance ledger imported from
-- the biometric software's monthly "Basic Work Duration Report" (.xls),
-- keyed by employee_id (matching staff_master.employee_id) - NOT staff_id,
-- since most people in staff_master don't have a staff_roles/app account
-- yet. Bridging to the app's own schedule-based attendance_daily_status
-- pipeline (which needs a real staff_id) is a separate later step, done by
-- joining staff_master.employee_id -> staff_master.email -> staff_roles.id
-- once enough emails are filled in.
create table if not exists employee_daily_attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  attendance_date date not null,
  status text,           -- raw status code from the report (P, A, WO, ...) - not interpreted here
  in_time time,
  out_time time,
  total_minutes int,     -- parsed from the report's "Total" (H:MM) - null if unparseable/absent
  source_file text,
  imported_at timestamptz not null default now(),
  unique (employee_id, attendance_date)
);

alter table employee_daily_attendance enable row level security;
create policy "authenticated full access" on employee_daily_attendance for all to authenticated using (true) with check (true);

create index if not exists idx_employee_daily_attendance_employee on employee_daily_attendance (employee_id, attendance_date);
