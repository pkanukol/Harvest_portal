-- Run in Project A's SQL editor. Fixes compute_attendance_status so a
-- staff_holiday row (academic-calendar holiday, from the festival import)
-- always shows on the calendar - even for a staff member who has no
-- staff_schedule configured yet. Previously the function bailed out early
-- ("if v_schedule.id is null then delete...return") before ever checking
-- staff_holiday, so a person with holidays imported but no schedule saw a
-- blank calendar instead of the holiday. Schedule/punch timings should only
-- govern present/absent/late/short on WORKING days - holidays are a
-- category-wide calendar overlay, independent of any individual's timings.

create or replace function compute_attendance_status(p_staff_id int, p_date date)
returns void
language plpgsql
as $$
declare
  v_weekday int := extract(dow from p_date)::int;
  v_occurrence int := ((extract(day from p_date)::int - 1) / 7) + 1;
  v_schedule staff_schedule%rowtype;
  v_stayback staff_stayback_override%rowtype;
  v_holiday staff_holiday%rowtype;
  v_punch punch_record_daily%rowtype;
  v_required_check_in time;
  v_required_check_out time;
  v_is_working_day boolean;
  v_late_minutes int := 0;
  v_short_minutes int := 0;
  v_status text;
begin
  select * into v_holiday
  from staff_holiday
  where staff_id = p_staff_id and holiday_date = p_date;

  select * into v_punch
  from punch_record_daily
  where staff_id = p_staff_id and attendance_date = p_date;

  -- Holiday always wins, regardless of whether a schedule exists - checked
  -- BEFORE looking up staff_schedule at all.
  if v_holiday.id is not null then
    insert into attendance_daily_status (
      staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
      actual_check_in, actual_check_out, late_minutes, short_minutes, status, computed_at
    ) values (
      p_staff_id, p_date, false, null, null,
      v_punch.first_in_time, v_punch.last_out_time, 0, 0, 'holiday', now()
    )
    on conflict (staff_id, attendance_date) do update set
      is_working_day = excluded.is_working_day,
      required_check_in = excluded.required_check_in,
      required_check_out = excluded.required_check_out,
      actual_check_in = excluded.actual_check_in,
      actual_check_out = excluded.actual_check_out,
      late_minutes = excluded.late_minutes,
      short_minutes = excluded.short_minutes,
      status = excluded.status,
      computed_at = now();
    return;
  end if;

  select * into v_schedule
  from staff_schedule
  where staff_id = p_staff_id
    and weekday = v_weekday
    and effective_from <= p_date
    and (effective_to is null or effective_to >= p_date)
    and (week_occurrence is null or v_occurrence = any(week_occurrence))
  order by
    (week_occurrence is not null) desc,
    effective_from desc
  limit 1;

  if v_schedule.id is null then
    delete from attendance_daily_status where staff_id = p_staff_id and attendance_date = p_date;
    return;
  end if;

  v_is_working_day := v_schedule.is_working_day;

  if not v_is_working_day then
    insert into attendance_daily_status (
      staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
      actual_check_in, actual_check_out, late_minutes, short_minutes, status, computed_at
    ) values (
      p_staff_id, p_date, false, v_schedule.check_in_time, v_schedule.check_out_time,
      v_punch.first_in_time, v_punch.last_out_time, 0, 0, 'holiday', now()
    )
    on conflict (staff_id, attendance_date) do update set
      is_working_day = excluded.is_working_day,
      required_check_in = excluded.required_check_in,
      required_check_out = excluded.required_check_out,
      actual_check_in = excluded.actual_check_in,
      actual_check_out = excluded.actual_check_out,
      late_minutes = excluded.late_minutes,
      short_minutes = excluded.short_minutes,
      status = excluded.status,
      computed_at = now();
    return;
  end if;

  select * into v_stayback
  from staff_stayback_override
  where staff_id = p_staff_id
    and weekday = v_weekday
    and active = true
    and effective_from <= p_date
    and (effective_to is null or effective_to >= p_date)
  order by effective_from desc
  limit 1;

  v_required_check_in := v_schedule.check_in_time;
  v_required_check_out := coalesce(v_stayback.stayback_check_out_time, v_schedule.check_out_time);

  if v_punch.first_in_time is null and v_punch.last_out_time is null then
    v_status := 'absent';
  else
    if v_required_check_in is not null and v_punch.first_in_time is not null then
      v_late_minutes := greatest(0, extract(epoch from (
        v_punch.first_in_time - (v_required_check_in + (v_schedule.grace_minutes || ' minutes')::interval)
      ))::int / 60);
    end if;

    if v_required_check_out is not null and v_punch.last_out_time is not null then
      v_short_minutes := greatest(0, extract(epoch from (v_required_check_out - v_punch.last_out_time))::int / 60);
    end if;

    if v_late_minutes > 0 then
      v_status := 'late';
    elsif v_short_minutes > 0 then
      v_status := 'short';
    else
      v_status := 'ok';
    end if;
  end if;

  insert into attendance_daily_status (
    staff_id, attendance_date, is_working_day, required_check_in, required_check_out,
    actual_check_in, actual_check_out, late_minutes, short_minutes, status, computed_at
  ) values (
    p_staff_id, p_date, true, v_required_check_in, v_required_check_out,
    v_punch.first_in_time, v_punch.last_out_time, v_late_minutes, v_short_minutes, v_status, now()
  )
  on conflict (staff_id, attendance_date) do update set
    is_working_day = excluded.is_working_day,
    required_check_in = excluded.required_check_in,
    required_check_out = excluded.required_check_out,
    actual_check_in = excluded.actual_check_in,
    actual_check_out = excluded.actual_check_out,
    late_minutes = excluded.late_minutes,
    short_minutes = excluded.short_minutes,
    status = excluded.status,
    computed_at = now();
end;
$$;
