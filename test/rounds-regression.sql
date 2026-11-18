-- Run on a disposable database after applying the schema and migrations.
begin;

do $$
declare
  admin_id uuid := gen_random_uuid();
  staff_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  building_id uuid;
  room_id uuid;
  slot_id uuid;
  original_id uuid;
  current_id uuid;
  issue_id uuid;
  campus_date date := (now() at time zone 'Asia/Manila')::date;
begin
  insert into auth.users (id, email) values
    (admin_id, admin_id || '@example.invalid'),
    (staff_id, staff_id || '@example.invalid'),
    (other_id, other_id || '@example.invalid');
  update public.profiles set role = 'admin' where id = admin_id;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);

  insert into public.buildings (code, name)
  values ('test-' || admin_id, 'Test building') returning id into building_id;
  insert into public.rooms (building_id, room_number, name)
  values (building_id, '201', 'Test lab') returning id into room_id;
  insert into public.schedules (room_id, instructor_name, course_name, days_of_week, start_time, end_time, effective_start)
  values (room_id, 'Instructor', 'Test course', array[extract(dow from campus_date)::smallint], '08:00', '09:00', campus_date)
  returning id into slot_id;

  select r.id into strict original_id
  from public.ensure_rounds_for_date(campus_date) as r where r.schedule_id = slot_id;
  perform set_config('request.jwt.claim.sub', staff_id::text, true);
  perform public.claim_round(original_id);
  perform set_config('request.jwt.claim.sub', other_id::text, true);
  begin
    perform public.claim_round(original_id);
    raise exception 'A second staff member claimed the same round' using errcode = 'XX000';
  exception when raise_exception then null;
  end;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform public.admin_update_staff(staff_id, 'Archived staff', true);
  assert (select r.status = 'pending' and r.claimed_by is null from public.rounds r where r.id = original_id),
    'Archiving did not release the claim';
  perform public.admin_update_staff(staff_id, 'Restored staff', false);

  update public.schedules set start_time = '09:00', end_time = '10:00' where id = slot_id;
  select r.id into strict current_id
  from public.ensure_rounds_for_date(campus_date) as r where r.schedule_id = slot_id;
  assert current_id <> original_id, 'A new time should receive a different round';
  assert (select r.status = 'cancelled' from public.rounds r where r.id = original_id),
    'An obsolete round remained available';

  update public.buildings set is_archived = true where id = building_id;
  assert not exists (select 1 from public.ensure_rounds_for_date(campus_date) r where r.schedule_id = slot_id),
    'An archived building kept a round available';
  update public.buildings set is_archived = false where id = building_id;
  assert (select r.status = 'pending' from public.ensure_rounds_for_date(campus_date) r where r.id = current_id),
    'Restoring the building did not restore the round';

  update public.schedules set is_archived = true where id = slot_id;
  assert not exists (select 1 from public.ensure_rounds_for_date(campus_date) r where r.schedule_id = slot_id),
    'An archived schedule kept a round available';
  update public.schedules set is_archived = false where id = slot_id;
  perform public.ensure_rounds_for_date(campus_date);

  perform set_config('request.jwt.claim.sub', other_id::text, true);
  perform public.claim_round(current_id);
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform public.admin_delete_staff(other_id);
  assert (select r.status = 'pending' and r.claimed_by is null from public.rounds r where r.id = current_id),
    'Deleting staff did not release the claim';

  perform set_config('request.jwt.claim.sub', staff_id::text, true);
  perform public.claim_round(current_id);
  perform public.complete_round(current_id, true, false, false, 'damaged', 'Screen damaged');
  select i.id into strict issue_id from public.issues i where i.round_id = current_id;
  begin
    perform public.resolve_issue(issue_id);
    raise exception 'Staff resolved an issue' using errcode = 'XX000';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  update public.schedules set course_name = 'Corrected title' where id = slot_id;
  assert (select count(*) = 1 from public.ensure_rounds_for_date(campus_date) r where r.schedule_id = slot_id),
    'Correcting only the course name duplicated a completed check';
  update public.schedules set start_time = '10:00', end_time = '11:00' where id = slot_id;
  assert (select count(*) = 2 from public.ensure_rounds_for_date(campus_date) r where r.schedule_id = slot_id),
    'Moving a completed class should retain history and generate a new round';
  begin
    perform public.admin_delete_staff(staff_id);
    raise exception 'A completer was permanently deleted' using errcode = 'XX000';
  exception when foreign_key_violation then null;
  end;
  perform public.resolve_issue(issue_id);
  assert (select i.status = 'resolved' from public.issues i where i.id = issue_id);
end;
$$;

rollback;
