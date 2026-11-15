create or replace function public.ensure_rounds_for_date(p_date date)
returns setof public.rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if not public.is_active_user() then
    raise exception 'An active Rounds account is required.' using errcode = '42501';
  end if;

  if p_date is distinct from (pg_catalog.now() at time zone 'Asia/Manila')::date then
    raise exception 'Rounds can only be generated for today.' using errcode = '22023';
  end if;

  with ordered_schedules as (
    select
      s.*,
      lag(s.instructor_name) over (
        partition by s.room_id
        order by s.start_time, s.id
      ) as previous_instructor
    from public.schedules as s
    where s.is_active = true
      and p_date >= s.effective_start
      and (s.effective_end is null or p_date <= s.effective_end)
      and extract(dow from p_date)::smallint = any(s.days_of_week)
  ),
  handoffs as (
    select *
    from ordered_schedules
    where previous_instructor is null
       or previous_instructor is distinct from instructor_name
  )
  insert into public.rounds (
    schedule_id, schedule_revision, scheduled_date, room_id,
    building_name_snapshot, building_code_snapshot,
    room_number_snapshot, room_name_snapshot, room_floor_snapshot,
    instructor_snapshot, course_snapshot, section_snapshot,
    scheduled_start, scheduled_end
  )
  select
    h.id, h.revision, p_date, r.id,
    b.name, b.code, r.room_number, r.name, r.floor,
    h.instructor_name, h.course_name, h.section,
    h.start_time, h.end_time
  from handoffs as h
  join public.rooms as r on r.id = h.room_id and r.is_active = true
  join public.buildings as b on b.id = r.building_id and b.is_active = true
  on conflict (schedule_id, schedule_revision, scheduled_date) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    insert into public.activity_log (actor_id, action, entity_type, details)
    values (
      auth.uid(),
      'rounds_generated',
      'round',
      jsonb_build_object('date', p_date, 'count', v_inserted)
    );
  end if;

  return query
  select r.*
  from public.rounds as r
  where r.scheduled_date = p_date
  order by r.scheduled_start, r.building_name_snapshot, r.room_number_snapshot;
end;
$$;
