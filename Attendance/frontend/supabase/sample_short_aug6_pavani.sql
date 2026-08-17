-- Run in Project A's SQL editor. Marks Aug 6 as "short" for
-- pavani.k@harvestinternationalschool.in (staff_id 5) so there's a date to
-- test the Regularise flow against.
insert into attendance_daily_status (
  staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
  actual_check_in, actual_check_out, late_minutes, short_minutes, status
) values (
  5, '2026-08-06', true, '08:07', '14:10', '08:05', '13:50', 0, 20, 'short'
)
on conflict (staff_id, attendance_date) do update set
  is_working_day = true, required_check_in = '08:07', required_check_out = '14:10',
  actual_check_in = '08:05', actual_check_out = '13:50', late_minutes = 0, short_minutes = 20,
  status = 'short', computed_at = now();
