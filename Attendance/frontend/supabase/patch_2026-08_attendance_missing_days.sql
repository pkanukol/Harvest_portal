-- Reports the "gap" days inside the uploaded attendance span for a branch: dates
-- between the earliest and latest uploaded date that have NO rows in
-- employee_daily_attendance (i.e. a day's file was never imported), excluding
-- Sundays. Lets the import screen flag missing days between uploads. Run once in
-- Project A. p_branch null = across all staff.
create or replace function attendance_missing_days(p_branch text)
returns table (missing_date date)
language sql
stable
as $$
  with dates as (
    select distinct eda.attendance_date as d
    from employee_daily_attendance eda
    where p_branch is null
       or eda.employee_id in (select employee_id from staff_master where branch = p_branch)
  ),
  bounds as (select min(d) as lo, max(d) as hi from dates),
  cal as (
    select generate_series(b.lo, b.hi, interval '1 day')::date as d
    from bounds b
    where b.lo is not null
  )
  select cal.d
  from cal
  left join dates on dates.d = cal.d
  where dates.d is null
    and extract(dow from cal.d) <> 0   -- ignore Sundays
  order by cal.d;
$$;

grant execute on function attendance_missing_days(text) to authenticated;
