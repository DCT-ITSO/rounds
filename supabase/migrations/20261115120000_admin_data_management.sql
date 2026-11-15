-- Adds reversible archive states, safe staff administration, and audit entries
-- for Admin-managed workspace data. Apply after the client integration migration.
begin;

alter table public.profiles add column if not exists is_archived boolean not null default false;
alter table public.buildings add column if not exists is_archived boolean not null default false;
alter table public.rooms add column if not exists is_archived boolean not null default false;
alter table public.schedules add column if not exists is_archived boolean not null default false;

create index if not exists buildings_archive_idx on public.buildings (is_archived, name);
create index if not exists rooms_archive_idx on public.rooms (is_archived, building_id, room_number);
create index if not exists schedules_archive_idx on public.schedules (is_archived, room_id, start_time);

create or replace view public.profile_directory
with (security_barrier = true)
as
select p.id, p.full_name, p.role
from public.profiles as p
where p.is_active = true
  and p.is_archived = false
  and (select public.is_active_user());

revoke all on public.profile_directory from anon;
grant select on public.profile_directory to authenticated;

drop policy if exists buildings_read_active on public.buildings;
create policy buildings_read_active on public.buildings
for select to authenticated
using (
  (select public.is_admin())
  or ((select public.is_active_user()) and is_active and not is_archived)
);

drop policy if exists rooms_read_active on public.rooms;
create policy rooms_read_active on public.rooms
for select to authenticated
using (
  (select public.is_admin())
  or (
    (select public.is_active_user())
    and is_active
    and not is_archived
    and exists (
      select 1 from public.buildings as b
      where b.id = rooms.building_id
        and b.is_active = true
        and b.is_archived = false
    )
  )
);

drop policy if exists schedules_read_active on public.schedules;
create policy schedules_read_active on public.schedules
for select to authenticated
using (
  (select public.is_admin())
  or (
    (select public.is_active_user())
    and is_active
    and not is_archived
    and exists (
      select 1
      from public.rooms as r
      join public.buildings as b on b.id = r.building_id
      where r.id = schedules.room_id
        and r.is_active = true
        and r.is_archived = false
        and b.is_active = true
        and b.is_archived = false
    )
  )
);

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

  with ordered_schedules as (
    select
      s.*,
      lag(s.instructor_name) over (
        partition by s.room_id
        order by s.start_time, s.id
      ) as previous_instructor
    from public.schedules as s
    where s.is_active = true
      and s.is_archived = false
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
  join public.rooms as r on r.id = h.room_id
    and r.is_active = true and r.is_archived = false
  join public.buildings as b on b.id = r.building_id
    and b.is_active = true and b.is_archived = false
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

create or replace function public.log_admin_data_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_entity text;
  v_label text;
  v_kind text;
  v_id uuid;
begin
  if TG_OP = 'INSERT' and TG_TABLE_NAME = 'profiles' and auth.uid() is null then
    return NEW;
  end if;
  if TG_OP <> 'INSERT' then v_old := to_jsonb(OLD); end if;
  if TG_OP <> 'DELETE' then v_new := to_jsonb(NEW); end if;

  if TG_OP = 'UPDATE' and TG_TABLE_NAME = 'profiles'
    and row(v_old ->> 'full_name', v_old ->> 'is_active', v_old ->> 'is_archived')
      is not distinct from
        row(v_new ->> 'full_name', v_new ->> 'is_active', v_new ->> 'is_archived') then
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_row := v_old;
    v_kind := 'deleted';
  else
    v_row := v_new;
    v_kind := case when TG_OP = 'INSERT' then 'created' else 'updated' end;
  end if;

  if TG_TABLE_NAME = 'profiles' then
    v_entity := 'staff';
    v_label := coalesce(v_row ->> 'full_name', 'IT Staff');
  elsif TG_TABLE_NAME = 'buildings' then
    v_entity := 'building';
    v_label := coalesce(v_row ->> 'name', 'Building');
  elsif TG_TABLE_NAME = 'rooms' then
    v_entity := 'room';
    v_label := concat_ws(' ', v_row ->> 'name', v_row ->> 'room_number');
  else
    v_entity := 'schedule';
    v_label := concat_ws(' · ', v_row ->> 'course_name', v_row ->> 'instructor_name');
  end if;

  if TG_OP = 'UPDATE' and v_old ->> 'is_archived' is distinct from v_new ->> 'is_archived' then
    v_kind := case when (v_new ->> 'is_archived')::boolean then 'archived' else 'restored' end;
  elsif TG_OP = 'UPDATE' and TG_TABLE_NAME = 'schedules'
    and v_old ->> 'is_active' is distinct from v_new ->> 'is_active' then
    v_kind := case when (v_new ->> 'is_active')::boolean then 'resumed' else 'paused' end;
  elsif TG_OP = 'UPDATE' and TG_TABLE_NAME = 'profiles'
    and v_old ->> 'is_active' is distinct from v_new ->> 'is_active' then
    v_kind := case when (v_new ->> 'is_active')::boolean then 'restored' else 'archived' end;
  end if;

  v_id := nullif(v_row ->> 'id', '')::uuid;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    v_entity || '_' || v_kind,
    v_entity,
    v_id,
    jsonb_build_object('name', v_label)
  );

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

revoke all on function public.log_admin_data_change() from public, anon, authenticated;

drop trigger if exists profiles_log_admin_data_change on public.profiles;
create trigger profiles_log_admin_data_change
after insert or update or delete on public.profiles
for each row execute function public.log_admin_data_change();

drop trigger if exists buildings_log_admin_data_change on public.buildings;
create trigger buildings_log_admin_data_change
after insert or update or delete on public.buildings
for each row execute function public.log_admin_data_change();

drop trigger if exists rooms_log_admin_data_change on public.rooms;
create trigger rooms_log_admin_data_change
after insert or update or delete on public.rooms
for each row execute function public.log_admin_data_change();

drop trigger if exists schedules_log_admin_data_change on public.schedules;
create trigger schedules_log_admin_data_change
after insert or update or delete on public.schedules
for each row execute function public.log_admin_data_change();

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

  delete from auth.users where id = p_profile_id;
  if not found then
    raise exception 'The linked Auth account was not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_update_staff(uuid, text, boolean) from public, anon;
revoke all on function public.admin_delete_staff(uuid) from public, anon;
grant execute on function public.admin_update_staff(uuid, text, boolean) to authenticated;
grant execute on function public.admin_delete_staff(uuid) to authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['profiles', 'activity_log'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

commit;
