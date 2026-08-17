-- Run in Project A's SQL editor. Backfills the missing regularisation_request
-- row for the Aug 3 demo entry I set directly via SQL earlier - that shortcut
-- set attendance_daily_status.status = 'regularised' but never created the
-- actual request row, so the 1/month cap correctly saw 0 used (there was
-- nothing in regularisation_request to count). This creates the real row so
-- the cap reflects it properly going forward.
insert into regularisation_request (
  staff_id, staff_email, attendance_date, reason_category, reason_text,
  requested_by, status, decided_by, decided_at, counts_toward_cap
) values (
  5, 'pavani.k@harvestinternationalschool.in', '2026-08-03', 'personal', 'test regularisation (backfilled)',
  'pavani.k@harvestinternationalschool.in', 'approved', 'pavani.k@harvestinternationalschool.in', now(), true
)
on conflict (staff_id, attendance_date) do update set
  status = 'approved', decided_by = excluded.decided_by, decided_at = excluded.decided_at, counts_toward_cap = true;
