-- Run in Project A's SQL editor. Adds 'cancelled' as a valid leave_request
-- status, so the requester can withdraw their own pending/approved leave.
-- No other schema changes needed:
--  - leave_balance() only sums status='approved' days, so cancelling an
--    approved leave automatically restores the balance.
--  - The calendar's leave overlay only queries status in ('pending','approved'),
--    so a cancelled leave automatically disappears from the calendar.
--  - Approvals only lists status='pending', so a cancelled-while-pending
--    request automatically drops off that list too.
alter table leave_request drop constraint if exists leave_request_status_check;
alter table leave_request add constraint leave_request_status_check
  check (status in ('pending','approved','rejected','cancelled'));
