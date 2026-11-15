-- Apply once in Supabase SQL Editor after the original schema.sql.
-- Adds account email visibility for the Admin team page and permits "Not checked"
-- observations to remain unknown instead of being recorded as "No".

begin;

alter table public.profiles add column if not exists email text;
create unique index if not exists profiles_email_lower_unique
  on public.profiles (lower(email)) where email is not null;

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

drop view if exists public.profile_directory;
create view public.profile_directory
with (security_barrier = true)
as
select p.id, p.full_name, p.role
from public.profiles as p
where p.is_active = true
  and (select public.is_active_user());

revoke all on public.profile_directory from anon;
grant select on public.profile_directory to authenticated;

drop policy if exists activity_admin_read on public.activity_log;
drop policy if exists activity_read_active_users on public.activity_log;
create policy activity_read_active_users on public.activity_log
for select to authenticated
using ((select public.is_active_user()));

alter table public.rounds drop constraint if exists rounds_completion_has_check;
alter table public.rounds add constraint rounds_completion_has_check check (
  status <> 'completed' or (
    completed_by is not null
    and completed_at is not null
  )
);

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
