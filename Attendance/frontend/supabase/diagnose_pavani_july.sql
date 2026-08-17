-- Run each of these in Project A's SQL editor and share what comes back -
-- this walks the whole chain step by step so we can see exactly where it
-- breaks: staff_master -> employee_daily_attendance -> punch_record_daily
-- -> staff_schedule -> attendance_daily_status (what the calendar reads).

-- 1. Her staff_master row and employee_id
select * from staff_master where email = 'pavani.k@harvestinternationalschool.in';

-- 2. Does the raw import actually have July rows under that employee_id?
select count(*), min(attendance_date), max(attendance_date)
from employee_daily_attendance
where employee_id = (select employee_id from staff_master where email = 'pavani.k@harvestinternationalschool.in');

-- 3. Did the bridge step write punch_record_daily for her (staff_id 5)?
select count(*), min(attendance_date), max(attendance_date)
from punch_record_daily
where staff_id = 5 and attendance_date between '2026-07-01' and '2026-07-31';

-- 4. Does she have a schedule configured at all? (If this is empty, that's
-- almost certainly the whole problem - no schedule means nothing to compare
-- punch times against, so compute_attendance_status intentionally writes
-- nothing for her.)
select * from staff_schedule where staff_id = 5;

-- 5. What actually landed in the table the calendar reads?
select * from attendance_daily_status
where staff_id = 5 and attendance_date between '2026-07-01' and '2026-07-31'
order by attendance_date;
