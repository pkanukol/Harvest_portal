-- Run in Project A's SQL editor. Adds a demo "short" (early-exit) entry for
-- pavani.k@harvestinternationalschool.in (staff_id 5) on today's date, so
-- there's something to look at in the calendar without needing to configure
-- a full schedule + import a CSV first.
insert into attendance_daily_status (
  staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
  actual_check_in, actual_check_out, late_minutes, short_minutes, status
) values (
  5, current_date, true, '08:07', '14:10', '08:05', '13:45', 0, 25, 'short'
)
on conflict (staff_id, attendance_date) do update set
  is_working_day = true,
  required_check_in = '08:07',
  required_check_out = '14:10',
  actual_check_in = '08:05',
  actual_check_out = '13:45',
  late_minutes = 0,
  short_minutes = 25,
  status = 'short',
  computed_at = now();
