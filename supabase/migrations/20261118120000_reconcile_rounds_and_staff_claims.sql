begin;

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

  perform pg_catalog.pg_advisory_xact_lock(736219, p_date - date '2000-01-01');

  with ordered_schedules as (
    select
      s.*,
      lag(s.instructor_name) over (
        partition by s.room_id
        order by s.start_time, s.id
      ) as previous_instructor
    from public.schedules as s
    join public.rooms as room on room.id = s.room_id
    join public.buildings as building on building.id = room.building_id
    where s.is_active and not s.is_archived
      and room.is_active and not room.is_archived
      and building.is_active and not building.is_archived
      and p_date >= s.effective_start
      and (s.effective_end is null or p_date <= s.effective_end)
      and extract(dow from p_date)::smallint = any(s.days_of_week)
  ),
  handoffs as (
    select *
    from ordered_schedules
    where previous_instructor is null
       or previous_instructor is distinct from instructor_name
  ),
  expected as materialized (
    select h.*
    from handoffs as h
    where not exists (
      select 1 from public.rounds as done
      where done.scheduled_date = p_date and done.status = 'completed'
        and done.schedule_id = h.id and done.room_id = h.room_id
        and done.scheduled_start = h.start_time and done.scheduled_end = h.end_time
        and done.instructor_snapshot = h.instructor_name
    )
  ),
  cancelled as (
    update public.rounds as old
    set status = 'cancelled', claimed_by = null, claimed_at = null
    where old.scheduled_date = p_date and old.status in ('pending', 'in_progress')
      and not exists (
        select 1 from expected as e where e.id = old.schedule_id and e.revision = old.schedule_revision
      )
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
  from expected as h
  join public.rooms as r on r.id = h.room_id and r.is_active = true
  join public.buildings as b on b.id = r.building_id and b.is_active = true
  on conflict (schedule_id, schedule_revision, scheduled_date) do update
  set status = 'pending', claimed_by = null, claimed_at = null,
      building_name_snapshot = excluded.building_name_snapshot,
      building_code_snapshot = excluded.building_code_snapshot,
      room_number_snapshot = excluded.room_number_snapshot,
      room_name_snapshot = excluded.room_name_snapshot,
      room_floor_snapshot = excluded.room_floor_snapshot
  where rounds.status = 'cancelled';

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
  where r.scheduled_date = p_date and r.status <> 'cancelled'
  order by r.scheduled_start, r.building_name_snapshot, r.room_number_snapshot;
end;
$$;

-- Existing clients read the rounds table directly.
drop policy if exists rounds_read_active_users on public.rounds;
create policy rounds_read_active_users on public.rounds
for select to authenticated
using (status <> 'cancelled' and (select public.is_active_user()));

create or replace function public.claim_round(p_round_id uuid)
returns public.rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  -- Serialize with staff archive and deletion before taking any round row locks.
  perform 1 from public.profiles
  where id = auth.uid() and is_active
  for share;
  if not found then
    raise exception 'An active Rounds account is required.' using errcode = '42501';
  end if;

  update public.rounds as r
  set status = 'in_progress',
      claimed_by = auth.uid(),
      claimed_at = coalesce(r.claimed_at, now())
  where r.id = p_round_id
    and (
      r.status = 'pending'
      or (r.status = 'in_progress' and r.claimed_by = auth.uid())
    )
  returning r.* into v_round;

  if not found then
    raise exception 'This round is already claimed or is no longer available.' using errcode = 'P0001';
  end if;

  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'round_claimed', 'round', v_round.id,
    jsonb_build_object('room', v_round.room_number_snapshot, 'date', v_round.scheduled_date));

  return v_round;
end;
$$;

create or replace function public.complete_round(
  p_round_id uuid,
  p_pc_in_use boolean,
  p_personal_laptop_used boolean,
  p_hdmi_connected boolean,
  p_display_condition public.display_condition,
  p_notes text default null
)
returns public.rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  -- Serialize with staff archive and deletion before taking any round row locks.
  perform 1 from public.profiles
  where id = auth.uid() and is_active
  for share;
  if not found then
    raise exception 'An active Rounds account is required.' using errcode = '42501';
  end if;
  update public.rounds as r
  set status = 'completed',
      claimed_by = coalesce(r.claimed_by, auth.uid()),
      claimed_at = coalesce(r.claimed_at, now()),
      completed_by = auth.uid(),
      completed_at = now(),
      pc_in_use = p_pc_in_use,
      personal_laptop_used = p_personal_laptop_used,
      hdmi_connected = p_hdmi_connected,
      display_condition = p_display_condition,
      notes = nullif(trim(coalesce(p_notes, '')), '')
  where r.id = p_round_id
    and r.status in ('pending', 'in_progress')
    and (r.claimed_by = auth.uid() or public.is_admin())
  returning r.* into v_round;

  if not found then
    raise exception 'Claim this round first, or ask an administrator to review it.' using errcode = 'P0001';
  end if;

  if p_pc_in_use is false then
    insert into public.issues (round_id, issue_type, description, reported_by)
    values (v_round.id, 'pc_not_in_use',
      coalesce(v_round.notes, 'The room PC was not in use during the check.'), auth.uid());
  end if;

  if p_personal_laptop_used is true or p_hdmi_connected is true then
    insert into public.issues (round_id, issue_type, description, reported_by)
    values (v_round.id, 'personal_laptop_or_hdmi',
      coalesce(v_round.notes, 'A personal laptop or HDMI connection was observed.'), auth.uid());
  end if;

  if p_display_condition in ('attention', 'damaged') then
    insert into public.issues (round_id, issue_type, description, reported_by)
    values (v_round.id, 'display_attention',
      coalesce(v_round.notes, 'The display needs attention.'), auth.uid());
  end if;

  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'round_completed', 'round', v_round.id,
    jsonb_build_object(
      'room', v_round.room_number_snapshot,
      'instructor', v_round.instructor_snapshot,
      'pc_in_use', p_pc_in_use,
      'personal_laptop_used', p_personal_laptop_used,
      'hdmi_connected', p_hdmi_connected,
      'display_condition', p_display_condition
    ));

  return v_round;
end;
$$;

create or replace function public.admin_update_staff(
  p_profile_id uuid,
  p_full_name text,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an Admin can update IT Staff accounts.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'Enter the staff member name.' using errcode = '22023';
  end if;

  update public.profiles as p
  set full_name = trim(p_full_name),
      is_archived = p_archived,
      is_active = not p_archived
  where p.id = p_profile_id
    and p.role = 'staff'::public.app_role;

  if not found then
    raise exception 'The IT Staff account was not found.' using errcode = 'P0002';
  end if;
  if p_archived then
    update public.rounds
    set status = 'pending', claimed_by = null, claimed_at = null
    where status = 'in_progress' and claimed_by = p_profile_id;
  end if;
end;
$$;

create or replace function public.admin_delete_staff(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Only an Admin can delete IT Staff accounts.' using errcode = '42501';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_profile_id and role = 'staff'::public.app_role
  for update;

  if not found then
    raise exception 'The IT Staff account was not found.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.round_photos where uploaded_by = p_profile_id) then
    raise exception 'This account uploaded room-check photos. Archive it instead of permanently deleting it.' using errcode = '23503';
  end if;

  if exists (select 1 from public.rounds where completed_by = p_profile_id) then
    raise exception 'This account completed room checks. Archive it to preserve check history.' using errcode = '23503';
  end if;

  update public.rounds
  set status = 'pending', claimed_by = null, claimed_at = null
  where status = 'in_progress' and claimed_by = p_profile_id;
  delete from auth.users where id = p_profile_id;
  if not found then
    raise exception 'The linked Auth account was not found.' using errcode = 'P0002';
  end if;
end;
$$;

update public.rounds as r
set status = 'pending', claimed_by = null, claimed_at = null
where r.status = 'in_progress'
  and not exists (
    select 1 from public.profiles as p where p.id = r.claimed_by and p.is_active and not p.is_archived
  );

commit;
