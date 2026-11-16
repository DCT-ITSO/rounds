begin;

create or replace function public.prevent_room_schedule_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active and not new.is_archived then
    perform pg_catalog.pg_advisory_xact_lock(736218, pg_catalog.hashtext(new.room_id::text));

    if exists (
      select 1
      from public.schedules as s
      where s.room_id = new.room_id
        and s.id is distinct from new.id
        and s.is_active = true
        and s.is_archived = false
        and s.days_of_week && new.days_of_week
        and new.start_time < s.end_time
        and new.end_time > s.start_time
        and (new.effective_end is null or s.effective_start <= new.effective_end)
        and (s.effective_end is null or new.effective_start <= s.effective_end)
    ) then
      raise exception 'This room already has an overlapping schedule on one or more selected days.'
        using errcode = '23P01';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_room_schedule_overlap() from public, anon, authenticated;

drop trigger if exists schedules_prevent_room_overlap on public.schedules;
create trigger schedules_prevent_room_overlap
before insert or update
on public.schedules
for each row execute function public.prevent_room_schedule_overlap();

do $$
begin
  if exists (
    select 1
    from public.schedules as a
    join public.schedules as b
      on b.room_id = a.room_id
      and b.id > a.id
      and b.is_active = true
      and b.is_archived = false
      and b.days_of_week && a.days_of_week
      and a.start_time < b.end_time
      and a.end_time > b.start_time
      and (a.effective_end is null or b.effective_start <= a.effective_end)
      and (b.effective_end is null or a.effective_start <= b.effective_end)
    where a.is_active = true
      and a.is_archived = false
  ) then
    raise notice 'Existing overlapping schedules were left unchanged. Archive or edit those records to clear the conflicts.';
  end if;
end;
$$;

commit;
