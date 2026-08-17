-- Run in Project A's SQL editor.

-- 1. Force a fresh recompute for July using whatever schedule exists right now.
select recompute_attendance_range(5, '2026-07-01', '2026-07-31');

-- 2. Check what actually landed - if this is still empty, the problem is
-- earlier in the chain (no schedule, or no punch_record_daily rows for July).
select * from attendance_daily_status
where staff_id = 5 and attendance_date between '2026-07-01' and '2026-07-31'
order by attendance_date;

-- 3. If #2 is still empty, check these two:
select * from staff_schedule where staff_id = 5;  -- should NOT be empty
select count(*) from punch_record_daily where staff_id = 5 and attendance_date between '2026-07-01' and '2026-07-31';  -- should be > 0
