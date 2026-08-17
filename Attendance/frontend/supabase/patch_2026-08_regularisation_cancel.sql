-- Run in Project A's SQL editor. Adds 'cancelled' as a valid
-- regularisation_request status, so the requester can withdraw their own
-- still-pending request (the UI only offers this while pending - once
-- approved/auto_approved, cancelling isn't offered, unlike leave which stays
-- cancellable after approval too).
-- No other changes needed: fetchRegularisationCountThisMonth and the DB's
-- own enforce_regularisation_cap trigger both only count
-- ('pending','approved','auto_approved'), so a cancelled request
-- automatically frees its month's slot, same as a rejected one already does.
alter table regularisation_request drop constraint if exists regularisation_request_status_check;
alter table regularisation_request add constraint regularisation_request_status_check
  check (status in ('pending','approved','rejected','auto_approved','cancelled'));
