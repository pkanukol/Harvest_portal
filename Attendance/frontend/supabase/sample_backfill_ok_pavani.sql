-- Run in Project A's SQL editor. Fills in a green "ok" (on-time) dot for
-- every weekday in August 2026 up through today, for
-- pavani.k@harvestinternationalschool.in (staff_id 5) - skips weekends, and
-- ON CONFLICT DO NOTHING means it will never overwrite the short/regularised
-- test days already seeded (Aug 3, 6, 7, 19, 21).
insert into attendance_daily_status (
  staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
  actual_check_in, actual_check_out, late_minutes, short_minutes, status
)
select 5, d::date, true, '08:07', '14:10', '08:05', '14:10', 0, 0, 'ok'
from generate_series('2026-08-01'::date, current_date, '1 day') d
where extract(dow from d) not in (0, 6) -- skip Sunday/Saturday
on conflict (staff_id, attendance_date) do nothing;
