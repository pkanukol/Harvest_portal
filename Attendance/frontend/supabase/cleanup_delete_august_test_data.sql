-- One-off cleanup of test data. KEEPS intact: staff_master (employee master),
-- July attendance (employee_daily_attendance / punch_record_daily /
-- attendance_daily_status), holiday lists (staff_holiday / festival_holiday /
-- calendar_override), and schedules/timings (staff_schedule / staff_stayback_override).
-- Run in Project A. Deleting by date range / whole-table covers BOTH branches
-- (these tables are keyed by employee/date, not branch).

-- 1) August 2026 attendance (test) - keep July.
delete from attendance_daily_status   where attendance_date between '2026-08-01' and '2026-08-31';
delete from punch_record_daily        where attendance_date between '2026-08-01' and '2026-08-31';
delete from employee_daily_attendance where attendance_date between '2026-08-01' and '2026-08-31';

-- 2) All test leave + regularisation (incl. bus-late) requests, for July & August
--    (these tables hold only test entries so far).
delete from leave_request;
delete from regularisation_request;

-- 3) OPTIONAL - if any July day was flipped to 'regularised' by a now-deleted
--    regularisation, recompute July from the intact punches so it reverts to its
--    real ok/late/short status. Uncomment and match your deployed signature
--    (Phase E: 3 args; Phase G added p_branch -> 4 args):
-- select recompute_calendar_range('2026-07-01','2026-07-31', null);            -- 3-arg
-- select recompute_calendar_range('2026-07-01','2026-07-31', null, null);      -- 4-arg (with branch)

-- Verify (optional):
-- select count(*) from leave_request;            -- 0
-- select count(*) from regularisation_request;   -- 0
-- select count(*) from employee_daily_attendance where attendance_date between '2026-08-01' and '2026-08-31';  -- 0
