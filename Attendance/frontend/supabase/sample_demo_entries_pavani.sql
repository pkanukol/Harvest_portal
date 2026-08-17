-- Run in Project A's SQL editor. Demo entries for
-- pavani.k@harvestinternationalschool.in (staff_id 5): Aug 7 marked short,
-- Aug 3 marked regularised.

insert into attendance_daily_status (
  staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
  actual_check_in, actual_check_out, late_minutes, short_minutes, status
) values (
  5, '2026-08-07', true, '08:07', '14:10', '08:05', '13:45', 0, 25, 'short'
)
on conflict (staff_id, attendance_date) do update set
  is_working_day = true, required_check_in = '08:07', required_check_out = '14:10',
  actual_check_in = '08:05', actual_check_out = '13:45', late_minutes = 0, short_minutes = 25,
  status = 'short', computed_at = now();

insert into attendance_daily_status (
  staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
  actual_check_in, actual_check_out, late_minutes, short_minutes, status
) values (
  5, '2026-08-03', true, '08:07', '14:10', '08:20', '14:10', 13, 0, 'regularised'
)
on conflict (staff_id, attendance_date) do update set
  is_working_day = true, required_check_in = '08:07', required_check_out = '14:10',
  actual_check_in = '08:20', actual_check_out = '14:10', late_minutes = 13, short_minutes = 0,
  status = 'regularised', computed_at = now();
