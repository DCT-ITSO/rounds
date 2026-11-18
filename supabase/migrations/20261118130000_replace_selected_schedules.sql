begin;

create or replace function public.replace_selected_schedules(p_old jsonb, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_archived integer;
  v_inserted integer;
  v_date date := (pg_catalog.now() at time zone 'Asia/Manila')::date;
begin
  if not public.is_admin() then
    raise exception 'Only an Admin can replace schedules.' using errcode = '42501';
  end if;

  if coalesce(jsonb_typeof(p_old), '') <> 'array' or coalesce(jsonb_typeof(p_rows), '') <> 'array' then
    raise exception 'Select schedules to replace and provide the replacement rows.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_old) = 0 or jsonb_array_length(p_rows) = 0 then
    raise exception 'Select schedules to replace and provide the replacement rows.' using errcode = '22023';
  end if;

  update public.schedules as s
  set is_archived = true
  from jsonb_to_recordset(p_old) as old(id uuid, updated_at timestamptz)
  where s.id = old.id and s.updated_at = old.updated_at and s.is_active and not s.is_archived;
  get diagnostics v_archived = row_count;
  if v_archived <> jsonb_array_length(p_old) then
    raise exception 'A selected schedule changed. Close the import, refresh, and select it again.' using errcode = 'P0001';
  end if;

  insert into public.schedules (
    room_id, instructor_name, course_name, section, days_of_week, start_time, end_time, effective_start, created_by
  )
  select incoming.room_id, incoming.instructor_name, incoming.course_name, incoming.section,
    incoming.days_of_week, incoming.start_time, incoming.end_time, v_date, auth.uid()
  from jsonb_to_recordset(p_rows) as incoming(
    room_id uuid, instructor_name text, course_name text, section text,
    days_of_week smallint[], start_time time, end_time time
  )
  join public.rooms r on r.id = incoming.room_id and r.is_active and not r.is_archived
  join public.buildings b on b.id = r.building_id and b.is_active and not b.is_archived
  order by incoming.room_id;
  get diagnostics v_inserted = row_count;
  if v_inserted <> jsonb_array_length(p_rows) then
    raise exception 'A replacement room is unavailable. Refresh and review the workbook.' using errcode = 'P0001';
  end if;
  return v_inserted;
end;
$$;

revoke all on function public.replace_selected_schedules(jsonb,jsonb) from public, anon;
grant execute on function public.replace_selected_schedules(jsonb,jsonb) to authenticated;

commit;
