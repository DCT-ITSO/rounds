-- Rounds Supabase schema
-- Run in Supabase Dashboard > SQL Editor.
-- Electron and future mobile clients use Supabase Auth + the Data API.
-- Never put a Supabase secret/service-role key in a client app.

begin;

do $$ begin
  create type public.app_role as enum ('admin', 'staff');
exception when duplicate_object then null;
end; $$;

do $$ begin
  create type public.round_status as enum ('pending', 'in_progress', 'completed', 'cancelled');
exception when duplicate_object then null;
end; $$;

do $$ begin
  create type public.display_condition as enum ('not_checked', 'normal', 'attention', 'damaged');
exception when duplicate_object then null;
end; $$;

do $$ begin
  create type public.issue_status as enum ('open', 'resolved');
exception when duplicate_object then null;
end; $$;

do $$ begin
  create type public.issue_type as enum ('pc_not_in_use', 'personal_laptop_or_hdmi', 'display_attention');
exception when duplicate_object then null;
end; $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default 'IT Staff',
  role public.app_role not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
create unique index if not exists profiles_email_lower_unique on public.profiles (lower(email)) where email is not null;

create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  floors integer,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buildings_code_not_blank check (length(trim(code)) > 0),
  constraint buildings_name_not_blank check (length(trim(name)) > 0),
  constraint buildings_floors_positive check (floors is null or floors > 0)
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete restrict,
  room_number text not null,
  name text not null,
  floor text,
  equipment text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_name_not_blank check (length(trim(name)) > 0),
  constraint rooms_number_not_blank check (length(trim(room_number)) > 0),
  constraint rooms_building_room_unique unique (building_id, room_number)
);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete restrict,
  instructor_name text not null,
  course_name text not null,
  section text,
  -- Match the current prototype: 0=Sunday, 1=Monday, ... 6=Saturday.
  days_of_week smallint[] not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  effective_start date not null default current_date,
  effective_end date,
  revision integer not null default 1,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedules_instructor_not_blank check (length(trim(instructor_name)) > 0),
  constraint schedules_course_not_blank check (length(trim(course_name)) > 0),
  constraint schedules_days_valid check (
    cardinality(days_of_week) between 1 and 7
    and days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  constraint schedules_time_order check (start_time < end_time),
  constraint schedules_effective_dates check (effective_end is null or effective_end >= effective_start),
  constraint schedules_revision_positive check (revision > 0)
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules (id) on delete restrict,
  schedule_revision integer not null,
  scheduled_date date not null,
  room_id uuid not null references public.rooms (id) on delete restrict,
  building_name_snapshot text not null,
  building_code_snapshot text not null,
  room_number_snapshot text not null,
  room_name_snapshot text not null,
  room_floor_snapshot text,
  instructor_snapshot text not null,
  course_snapshot text not null,
  section_snapshot text,
  scheduled_start time without time zone not null,
  scheduled_end time without time zone not null,
  status public.round_status not null default 'pending',
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  pc_in_use boolean,
  personal_laptop_used boolean,
  hdmi_connected boolean,
  display_condition public.display_condition not null default 'not_checked',
  notes text,
  created_at timestamptz not null default now(),
  constraint rounds_schedule_revision_date_unique unique (schedule_id, schedule_revision, scheduled_date),
  constraint rounds_time_order check (scheduled_start < scheduled_end),
  constraint rounds_completion_has_check check (
    status <> 'completed' or (
      completed_by is not null
      and completed_at is not null
    )
  )
);

alter table public.rounds drop constraint if exists rounds_completion_has_check;
alter table public.rounds add constraint rounds_completion_has_check check (
  status <> 'completed' or (
    completed_by is not null
    and completed_at is not null
  )
);

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete restrict,
  issue_type public.issue_type not null,
  description text not null,
  status public.issue_status not null default 'open',
  reported_by uuid references public.profiles (id) on delete set null,
  reported_at timestamptz not null default now(),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  constraint issues_round_type_unique unique (round_id, issue_type),
  constraint issues_resolution_fields check (
    (status = 'open' and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null)
  )
);

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.round_photos (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  storage_path text not null unique,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  uploaded_at timestamptz not null default now()
);

create index if not exists rooms_building_active_idx on public.rooms (building_id, is_active);
create index if not exists schedules_room_active_time_idx on public.schedules (room_id, is_active, start_time);
create index if not exists rounds_date_status_idx on public.rounds (scheduled_date, status, scheduled_start);
create index if not exists rounds_claimed_by_idx on public.rounds (claimed_by) where claimed_by is not null;
create index if not exists issues_status_reported_idx on public.issues (status, reported_at desc);
create index if not exists activity_log_created_idx on public.activity_log (created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.bump_schedule_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    new.room_id, new.instructor_name, new.course_name, new.section,
    new.days_of_week, new.start_time, new.end_time,
    new.effective_start, new.effective_end, new.is_active
  ) is distinct from row(
    old.room_id, old.instructor_name, old.course_name, old.section,
    old.days_of_week, old.start_time, old.end_time,
    old.effective_start, old.effective_end, old.is_active
  ) then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists buildings_set_updated_at on public.buildings;
create trigger buildings_set_updated_at before update on public.buildings
for each row execute function public.set_updated_at();

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at before update on public.rooms
for each row execute function public.set_updated_at();

drop trigger if exists schedules_set_updated_at on public.schedules;
create trigger schedules_set_updated_at before update on public.schedules
for each row execute function public.set_updated_at();

drop trigger if exists schedules_bump_revision on public.schedules;
create trigger schedules_bump_revision before update on public.schedules
for each row execute function public.bump_schedule_revision();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    lower(new.email),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'IT Staff'
    ),
    'staff'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        updated_at = now();
  return new;
end;
$$;

-- Backfill Auth users created before this schema was installed. They start as staff.
insert into public.profiles (id, email, full_name, role)
select
  u.id,
  lower(u.email),
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'IT Staff'
  ),
  'staff'
from auth.users as u
on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      updated_at = now();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = (select auth.uid())
    and p.is_active = true
  limit 1
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_app_role() is not null
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_app_role() = 'admin'::public.app_role
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.bump_schedule_revision() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.current_app_role() from public;
revoke all on function public.is_active_user() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.buildings enable row level security;
alter table public.rooms enable row level security;
alter table public.schedules enable row level security;
alter table public.rounds enable row level security;
alter table public.issues enable row level security;
alter table public.activity_log enable row level security;
alter table public.round_photos enable row level security;

drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists profiles_update_own_name on public.profiles;
create policy profiles_update_own_name on public.profiles
for update to authenticated
using (id = (select auth.uid()) and (select public.is_active_user()))
with check (id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists buildings_read_active on public.buildings;
create policy buildings_read_active on public.buildings
for select to authenticated
using ((select public.is_active_user()) and (is_active or (select public.is_admin())));

drop policy if exists buildings_admin_manage on public.buildings;
create policy buildings_admin_manage on public.buildings
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists rooms_read_active on public.rooms;
create policy rooms_read_active on public.rooms
for select to authenticated
using (
  (select public.is_active_user())
  and (is_active or (select public.is_admin()))
);

drop policy if exists rooms_admin_manage on public.rooms;
create policy rooms_admin_manage on public.rooms
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists schedules_read_active on public.schedules;
create policy schedules_read_active on public.schedules
for select to authenticated
using ((select public.is_active_user()) and (is_active or (select public.is_admin())));

drop policy if exists schedules_admin_manage on public.schedules;
create policy schedules_admin_manage on public.schedules
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists rounds_read_active_users on public.rounds;
create policy rounds_read_active_users on public.rounds
for select to authenticated
using ((select public.is_active_user()));

drop policy if exists issues_read_active_users on public.issues;
create policy issues_read_active_users on public.issues
for select to authenticated
using ((select public.is_active_user()));

drop policy if exists activity_admin_read on public.activity_log;
drop policy if exists activity_read_active_users on public.activity_log;
create policy activity_read_active_users on public.activity_log
for select to authenticated
using ((select public.is_active_user()));

drop policy if exists round_photos_read_active_users on public.round_photos;
create policy round_photos_read_active_users on public.round_photos
for select to authenticated
using ((select public.is_active_user()));

drop policy if exists round_photos_insert_own on public.round_photos;
create policy round_photos_insert_own on public.round_photos
for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and (select public.is_active_user())
  and split_part(storage_path, '/', 1) = (select auth.uid())::text
);

grant usage on schema public to authenticated;
grant usage on type public.app_role, public.round_status, public.display_condition,
  public.issue_status, public.issue_type to authenticated;

revoke all on table public.profiles, public.buildings, public.rooms, public.schedules,
  public.rounds, public.issues, public.activity_log, public.round_photos
  from anon, authenticated;

grant select on public.profiles, public.buildings, public.rooms, public.schedules,
  public.rounds, public.issues, public.activity_log, public.round_photos to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant insert, update, delete on public.buildings, public.rooms, public.schedules to authenticated;
grant insert on public.round_photos to authenticated;

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

create or replace function public.claim_round(p_round_id uuid)
returns public.rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  if not public.is_active_user() then
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
  if not public.is_active_user() then
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

  if p_personal_laptop_used or p_hdmi_connected then
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

create or replace function public.resolve_issue(p_issue_id uuid)
returns public.issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue public.issues;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can resolve issues.' using errcode = '42501';
  end if;

  update public.issues as i
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
  where i.id = p_issue_id and i.status = 'open'
  returning i.* into v_issue;

  if not found then
    raise exception 'The issue does not exist or has already been resolved.' using errcode = 'P0001';
  end if;

  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'issue_resolved', 'issue', v_issue.id,
    jsonb_build_object('round_id', v_issue.round_id, 'issue_type', v_issue.issue_type));

  return v_issue;
end;
$$;

revoke all on function public.ensure_rounds_for_date(date) from public, anon;
revoke all on function public.claim_round(uuid) from public, anon;
revoke all on function public.complete_round(uuid, boolean, boolean, boolean, public.display_condition, text) from public, anon;
revoke all on function public.resolve_issue(uuid) from public, anon;
grant execute on function public.ensure_rounds_for_date(date) to authenticated;
grant execute on function public.claim_round(uuid) to authenticated;
grant execute on function public.complete_round(uuid, boolean, boolean, boolean, public.display_condition, text) to authenticated;
grant execute on function public.resolve_issue(uuid) to authenticated;

-- Optional private bucket for check photos. Save only the storage path in round_photos.
insert into storage.buckets (id, name, public)
values ('round-photos', 'round-photos', false)
on conflict (id) do nothing;

drop policy if exists round_photos_storage_read on storage.objects;
create policy round_photos_storage_read on storage.objects
for select to authenticated
using (bucket_id = 'round-photos' and (select public.is_active_user()));

drop policy if exists round_photos_storage_insert_own on storage.objects;
create policy round_photos_storage_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'round-photos'
  and (select public.is_active_user())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Realtime carries shared round, issue, location, and schedule updates to clients.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['rounds', 'issues', 'buildings', 'rooms', 'schedules'] loop
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

