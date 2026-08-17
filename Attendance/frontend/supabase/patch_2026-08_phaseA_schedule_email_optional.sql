-- Phase A follow-up - staff_schedule is keyed by employee_id (in the staff_id
-- column) now, and the app no longer writes staff_email at all (some staff have
-- a blank email in the staff_list, which was tripping the NOT NULL constraint
-- when configuring their schedule). Make the legacy column optional.
--
-- Run once in Project A (aouvxdfamzprykezeovl).

alter table staff_schedule alter column staff_email drop not null;
