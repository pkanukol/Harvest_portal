-- Run in Project A's SQL editor. Marks Aug 19 and Aug 21 as "short" for
-- pavani.k@harvestinternationalschool.in (staff_id 5).
insert into attendance_daily_status (
  staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
  actual_check_in, actual_check_out, late_minutes, short_minutes, status
) values
  (5, '2026-08-19', true, '08:07', '14:10', '08:05', '13:55', 0, 15, 'short'),
  (5, '2026-08-21', true, '08:07', '14:10', '08:05', '13:40', 0, 30, 'short')
on conflict (staff_id, attendance_date) do update set
  is_working_day = true, required_check_in = '08:07', required_check_out = '14:10',
  actual_check_in = excluded.actual_check_in, actual_check_out = excluded.actual_check_out,
  late_minutes = 0, short_minutes = excluded.short_minutes, status = 'short', computed_at = now();
