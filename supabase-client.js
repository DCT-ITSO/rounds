(function () {
  const config = window.roundsConfig || {};
  const sdk = window.supabase;
  let client = null;
  let lastState = null;

  function fail(message) {
    throw new Error(message);
  }

  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    window.roundsSupabaseSetupError = 'Supabase is not configured. Add the project URL and publishable key to the ignored .env file, then restart Rounds.';
    return;
  }
  if (!sdk || typeof sdk.createClient !== 'function') {
    window.roundsSupabaseSetupError = 'The Supabase client did not load. Run npm install, then restart Rounds.';
    return;
  }

  client = sdk.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true
    },
    realtime: { params: { eventsPerSecond: 10 } }
  });

  function unwrap(result, fallback) {
    if (result.error) fail(result.error.message || fallback || 'Supabase request failed.');
    return result.data;
  }

  function fromTime(value) {
    return value ? String(value).slice(0, 5) : '';
  }

  function fromProfile(profile, authUser) {
    return {
      id: profile.id,
      name: profile.full_name || authUser?.user_metadata?.full_name || 'IT Staff',
      email: profile.email || authUser?.email || '',
      role: profile.role,
      active: profile.is_active === true
    };
  }

  async function readCurrentUser() {
    const sessionResult = await client.auth.getSession();
    if (sessionResult.error) fail(sessionResult.error.message);
    if (!sessionResult.data.session) return null;

    const authResult = await client.auth.getUser();
    if (authResult.error || !authResult.data.user) {
      await client.auth.signOut();
      return null;
    }

    const result = await client.from('profiles')
      .select('*')
      .eq('id', authResult.data.user.id)
      .maybeSingle();
    const profile = unwrap(result, 'Could not load the account profile.');
    if (!profile) fail('This Auth user has no Rounds profile. Re-run schema.sql or contact the project Admin.');
    if (!profile.is_active) {
      await client.auth.signOut();
      fail('This Rounds account is inactive. Contact an Admin.');
    }
    return fromProfile(profile, authResult.data.user);
  }

  async function signIn(payload) {
    const result = await client.auth.signInWithPassword({
      email: String(payload.email || '').trim(),
      password: String(payload.password || '')
    });
    const authUser = unwrap(result, 'Sign-in failed.');
    const profileResult = await client.from('profiles')
      .select('*')
      .eq('id', authUser.user.id)
      .maybeSingle();
    const profile = unwrap(profileResult, 'Signed in, but the Rounds profile could not be loaded.');
    if (!profile) {
      await client.auth.signOut();
      fail('This Auth user has no Rounds profile. Re-run schema.sql or contact the project Admin.');
    }
    if (!profile.is_active) {
      await client.auth.signOut();
      fail('This Rounds account is inactive. Contact an Admin.');
    }
    if (!['admin', 'staff'].includes(profile.role)) {
      await client.auth.signOut();
      fail('This account does not have an Admin or IT Staff role.');
    }
    return { user: fromProfile(profile, authUser.user) };
  }

  function toBuilding(row) {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      floors: row.floors || 0,
      active: row.is_active,
      archived: row.is_archived === true
    };
  }

  function toRoom(row) {
    return {
      id: row.id,
      buildingId: row.building_id,
      roomNumber: row.room_number,
      name: row.name,
      floor: row.floor || '',
      equipment: row.equipment || [],
      active: row.is_active,
      archived: row.is_archived === true
    };
  }

  function toSchedule(row) {
    return {
      id: row.id,
      roomId: row.room_id,
      instructor: row.instructor_name,
      course: row.course_name,
      section: row.section || '',
      days: (row.days_of_week || []).map(Number),
      startTime: fromTime(row.start_time),
      endTime: fromTime(row.end_time),
      effectiveStart: row.effective_start,
      effectiveEnd: row.effective_end,
      active: row.is_active,
      archived: row.is_archived === true,
      revision: row.revision,
      updatedAt: row.updated_at
    };
  }

  function toMember(row) {
    return {
      id: row.id,
      name: row.full_name || 'IT Staff',
      email: row.email || '',
      role: row.role,
      active: row.is_active !== false,
      archived: row.is_archived === true
    };
  }

  function actionName(action) {
    const names = {
      rounds_generated: 'Room rounds generated',
      round_claimed: 'Room check claimed',
      round_completed: 'Room check completed',
      issue_resolved: 'Issue resolved',
      building_created: 'Building added',
      building_updated: 'Building updated',
      building_archived: 'Building archived',
      building_restored: 'Building restored',
      building_deleted: 'Building deleted',
      room_created: 'Room added',
      room_updated: 'Room updated',
      room_archived: 'Room archived',
      room_restored: 'Room restored',
      room_deleted: 'Room deleted',
      schedule_created: 'Schedule added',
      schedule_updated: 'Schedule updated',
      schedule_archived: 'Schedule archived',
      schedule_restored: 'Schedule restored',
      schedule_deleted: 'Schedule deleted',
      schedule_paused: 'Schedule paused',
      schedule_resumed: 'Schedule resumed',
      staff_created: 'IT Staff account created',
      staff_updated: 'IT Staff account updated',
      staff_archived: 'IT Staff account archived',
      staff_restored: 'IT Staff account restored',
      staff_deleted: 'IT Staff account deleted'
    };
    return names[action] || String(action || 'Workspace updated').replaceAll('_', ' ');
  }

  function auditDetail(row) {
    const details = row.details || {};
    if (details.room && details.instructor) return details.room + ' · ' + details.instructor;
    if (details.room) return details.room;
    if (details.date) return 'Rounds generated for ' + details.date;
    if (details.issue_type) return String(details.issue_type).replaceAll('_', ' ');
    if (details.name) return details.name;
    return row.entity_type ? String(row.entity_type).replaceAll('_', ' ') : 'Shared workspace update';
  }

  function toAudit(row, members) {
    const member = members.get(row.actor_id);
    return {
      id: row.id,
      actorId: row.actor_id,
      action: actionName(row.action),
      detail: auditDetail(row),
      actor: member?.name || 'IT Staff',
      createdAt: row.created_at
    };
  }

  function toTask(row, context) {
    const roomNow = context.rooms.get(row.room_id);
    const buildingNow = roomNow ? context.buildings.get(roomNow.buildingId) : null;
    const linkedIssues = context.issues.get(row.id) || [];
    const hasOpenIssue = linkedIssues.some(issue => issue.status === 'open');
    const issueStatus = hasOpenIssue ? 'open' : linkedIssues.length ? 'resolved' : null;
    const member = id => id ? context.members.get(id) || null : null;
    return {
      id: row.id,
      date: row.scheduled_date,
      claimedBy: row.claimed_by,
      completedBy: row.completed_by,
      completedAt: row.completed_at,
      issueStatus,
      check: {
        pcInUse: row.pc_in_use === null ? 'unknown' : row.pc_in_use ? 'yes' : 'no',
        laptopHdmi: row.personal_laptop_used || row.hdmi_connected ? 'yes' : row.personal_laptop_used === null ? 'unknown' : 'no',
        display: row.display_condition === 'not_checked' ? 'unknown' : row.display_condition,
        notes: row.notes || '',
        photo: ''
      },
      schedule: {
        instructor: row.instructor_snapshot,
        course: row.course_snapshot,
        section: row.section_snapshot || '',
        startTime: fromTime(row.scheduled_start),
        endTime: fromTime(row.scheduled_end)
      },
      room: {
        id: row.room_id,
        buildingId: roomNow?.buildingId,
        roomNumber: row.room_number_snapshot,
        name: row.room_name_snapshot,
        floor: row.room_floor_snapshot || roomNow?.floor || ''
      },
      building: {
        id: buildingNow?.id || row.building_code_snapshot,
        name: row.building_name_snapshot,
        code: row.building_code_snapshot
      },
      assignee: member(row.claimed_by),
      completer: member(row.completed_by)
    };
  }

  async function readRoundPhoto(id) {
    const result = await client.from('round_photos')
      .select('storage_path')
      .eq('round_id', id)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const photo = unwrap(result, 'Could not load the check photo.');
    if (!photo) return '';
    const signed = await client.storage.from('round-photos').createSignedUrl(photo.storage_path, 3600);
    return unwrap(signed, 'Could not open the check photo.').signedUrl;
  }

  async function loadOpenIssues(page, context) {
    const pageSize = 25;
    const rows = unwrap(await client.from('rounds')
      .select('*, issues!inner(id, status, description)')
      .eq('issues.status', 'open')
      .order('scheduled_date', { ascending: false })
      .order('id')
      .range(page * pageSize, (page + 1) * pageSize), 'Could not load open issues.');
    if (!rows.length && page > 0) return loadOpenIssues(0, context);
    const issues = new Map(rows.map(row => [row.id, row.issues]));
    return {
      page,
      hasMore: rows.length > pageSize,
      rounds: rows.slice(0, pageSize).map(row => ({
        ...toTask(row, { ...context, issues }),
        openIssues: row.issues.map(issue => issue.description)
      }))
    };
  }

  async function loadState(date, issuePage) {
    const user = await readCurrentUser();
    if (!user) fail('Your session expired. Sign in again.');

    unwrap(await client.rpc('ensure_rounds_for_date', { p_date: date }).select('id').limit(1), 'Could not create the rounds for today.');

    const base = await Promise.all([
      client.from('buildings').select('*').order('name'),
      client.from('rooms').select('*').order('room_number'),
      client.from('schedules').select('*').order('start_time'),
      client.from('rounds').select('*').eq('scheduled_date', date).neq('status', 'cancelled').order('scheduled_start'),
      client.from('rounds').select('*').eq('status', 'completed').order('completed_at', { ascending: false }).limit(100),
      client.from('profile_directory').select('*').order('full_name'),
      client.from('activity_log').select('*').order('created_at', { ascending: false }).limit(100)
    ]);

    const buildingsRows = unwrap(base[0], 'Could not load buildings.');
    const roomsRows = unwrap(base[1], 'Could not load rooms.');
    const schedulesRows = unwrap(base[2], 'Could not load schedules.');
    const todayRows = unwrap(base[3], 'Could not load today’s rounds.');
    const historyRows = unwrap(base[4], 'Could not load check history.');
    const directoryRows = unwrap(base[5], 'Could not load the staff directory.');
    const activityRows = unwrap(base[6], 'Could not load recent activity.');

    let adminProfiles = [];
    if (user.role === 'admin') {
      const result = await client.from('profiles').select('*').order('full_name');
      adminProfiles = unwrap(result, 'Could not load IT Staff accounts.') || [];
    }

    const members = new Map();
    for (const row of directoryRows.concat(adminProfiles)) members.set(row.id, toMember(row));
    const buildings = buildingsRows.map(toBuilding);
    const rooms = roomsRows.map(toRoom);
    const schedules = schedulesRows.map(toSchedule);
    const buildingMap = new Map(buildings.map(row => [row.id, row]));
    const roomMap = new Map(rooms.map(row => [row.id, row]));

    const allRoundRows = [...new Map(todayRows.concat(historyRows).map(row => [row.id, row])).values()];
    const roundIds = allRoundRows.map(row => row.id);
    let issueRows = [];
    if (roundIds.length) {
      const result = await client.from('issues')
        .select('*')
        .in('round_id', roundIds)
        .order('reported_at', { ascending: false });
      issueRows = unwrap(result, 'Could not load room issues.');
    }
    const issueMap = new Map();
    for (const issue of issueRows) {
      if (!issueMap.has(issue.round_id)) issueMap.set(issue.round_id, []);
      issueMap.get(issue.round_id).push(issue);
    }
    const context = { buildings: buildingMap, rooms: roomMap, members, issues: issueMap };
    const rounds = todayRows.map(row => toTask(row, context));
    const history = historyRows.map(row => toTask(row, context));
    const audit = activityRows.map(row => toAudit(row, members));
    if (!audit.length && user.role === 'staff') {
      for (const row of historyRows.slice(0, 20)) {
        const task = history.find(item => item.id === row.id);
        audit.push({
          action: 'Room check completed',
          detail: task ? task.room.name + ' · ' + task.schedule.instructor : row.room_name_snapshot,
          actor: task?.completer?.name || 'IT Staff',
          createdAt: row.completed_at
        });
      }
    }

    lastState = {
      user,
      buildings,
      rooms,
      schedules,
      rounds,
      history,
      openIssues: issuePage === null ? null : await loadOpenIssues(issuePage, context),
      users: adminProfiles.map(toMember),
      audit,
      demo: false
    };
    return lastState;
  }

  function parseBody(options) {
    if (!options?.body) return {};
    if (typeof options.body === 'object') return options.body;
    try {
      return JSON.parse(options.body);
    } catch {
      fail('The request data was not valid JSON.');
    }
  }

  function validateSchedule(payload, schedules, excludedId, pending) {
    const days = Array.isArray(payload.days) ? payload.days.map(Number) : [];
    if (!days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
      fail('Choose at least one valid weekday.');
    }
    const time = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!time.test(payload.startTime) || !time.test(payload.endTime)) fail('Enter valid start and end times.');
    if (payload.startTime >= payload.endTime) {
      fail('The schedule end time must be after its start time.');
    }
    if (!payload.roomId || !String(payload.instructor || '').trim() || !String(payload.course || '').trim()) {
      fail('Choose a room and enter an instructor and course.');
    }
    const room = lastState?.rooms.find(item => item.id === payload.roomId);
    const building = room && lastState?.buildings.find(item => item.id === room.buildingId);
    if (!room || room.active === false || room.archived || !building || building.active === false || building.archived) {
      fail('Choose a room in an active, non-archived building.');
    }
    const candidates = schedules.concat(pending || []);
    const overlap = candidates.find(item =>
      item.id !== excludedId &&
      item.roomId === payload.roomId &&
      item.active !== false &&
      item.archived !== true &&
      days.some(day => item.days.includes(day)) &&
      payload.startTime < item.endTime &&
      payload.endTime > item.startTime
    );
    if (overlap) {
      fail('This room already has an overlapping schedule on one or more selected days.');
    }
    return days;
  }

  function schedulePayload(payload, days, userId) {
    return {
      room_id: payload.roomId,
      instructor_name: String(payload.instructor).trim(),
      course_name: String(payload.course).trim(),
      section: String(payload.section || '').trim() || null,
      days_of_week: days,
      start_time: payload.startTime,
      end_time: payload.endTime,
      is_active: payload.active !== false,
      created_by: userId
    };
  }

  async function insertSchedule(payload) {
    const user = await readCurrentUser();
    if (!user || user.role !== 'admin') fail('Only an Admin can change schedules.');
    if (!lastState) fail('Refresh the workspace before changing schedules.');
    const days = validateSchedule(payload, lastState.schedules, null);
    const data = schedulePayload(payload, days, user.id);
    unwrap(await client.from('schedules').insert(data).select('*').single(), 'Could not add the schedule.');
    return { saved: true };
  }

  async function insertSchedules(payload) {
    const user = await readCurrentUser();
    if (!user || user.role !== 'admin') fail('Only an Admin can change schedules.');
    if (!lastState) fail('Refresh the workspace before changing schedules.');
    if (!Array.isArray(payload.schedules) || payload.schedules.length < 1 || payload.schedules.length > 100) {
      fail('Add between 1 and 100 schedule slots.');
    }
    const pending = [];
    const rows = payload.schedules.map(item => {
      const schedule = { ...item, roomId: payload.roomId };
      const days = validateSchedule(schedule, lastState.schedules, null, pending);
      pending.push({
        roomId: schedule.roomId,
        days,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        active: true,
        archived: false
      });
      return schedulePayload(schedule, days, user.id);
    });
    const inserted = unwrap(
      await client.from('schedules').insert(rows).select('id'),
      'Could not add the schedules.'
    );
    return { saved: true, created: Array.isArray(inserted) ? inserted.length : rows.length };
  }

  async function updateSchedule(id, payload) {
    const user = await readCurrentUser();
    if (!user || user.role !== 'admin') fail('Only an Admin can change schedules.');
    if (!lastState) fail('Refresh the workspace before changing schedules.');
    const days = validateSchedule(payload, lastState.schedules, id);
    const data = schedulePayload(payload, days, user.id);
    delete data.created_by;
    unwrap(await client.from('schedules').update(data).eq('id', id).select('*').single(), 'Could not update the schedule.');
    return { saved: true };
  }

  async function requireAdmin(message) {
    const user = await readCurrentUser();
    if (!user || user.role !== 'admin') fail(message || 'Only an Admin can manage workspace data.');
    return user;
  }

  function equipmentValues(value) {
    const items = Array.isArray(value) ? value : String(value || '').split(',');
    return [...new Set(items.map(item => String(item).trim()).filter(Boolean))];
  }

  async function updateBuilding(id, payload) {
    await requireAdmin();
    const data = {
      name: String(payload.name || '').trim(),
      code: String(payload.code || '').trim().toUpperCase(),
      floors: Number(payload.floors)
    };
    if (!data.name || !data.code || !Number.isInteger(data.floors) || data.floors < 1) {
      fail('Enter a building name, short code, and a positive floor count.');
    }
    const result = await client.from('buildings').update(data).eq('id', id).select('id').maybeSingle();
    if (!unwrap(result, 'Could not update the building.')) fail('This building was not found. Refresh the workspace and try again.');
    return { saved: true };
  }

  async function updateRoom(id, payload) {
    await requireAdmin();
    const data = {
      building_id: payload.buildingId,
      room_number: String(payload.roomNumber || '').trim(),
      name: String(payload.name || '').trim(),
      floor: String(payload.floor || '').trim() || null,
      equipment: equipmentValues(payload.equipment)
    };
    if (!data.building_id || !data.room_number || !data.name) fail('Choose a building and enter the room number and name.');
    const result = await client.from('rooms').update(data).eq('id', id).select('id').maybeSingle();
    if (!unwrap(result, 'Could not update the room.')) fail('This room was not found. Refresh the workspace and try again.');
    return { saved: true };
  }

  async function updateStaff(id, payload) {
    await requireAdmin();
    const current = lastState?.users.find(item => item.id === id);
    const result = await client.rpc('admin_update_staff', {
      p_profile_id: id,
      p_full_name: String(payload.name || '').trim(),
      p_archived: typeof payload.archived === 'boolean'
        ? payload.archived
        : current?.archived === true || current?.active === false
    });
    unwrap(result, 'Could not update the IT Staff account.');
    return { saved: true };
  }

  async function setArchived(entity, id, archived) {
    await requireAdmin();
    if (entity === 'users') {
      const staff = lastState?.users.find(item => item.id === id);
      if (!staff) fail('The IT Staff account is not in the current workspace data. Refresh and try again.');
      return updateStaff(id, { name: staff.name, archived });
    }
    const table = entity === 'buildings' ? 'buildings' : entity === 'rooms' ? 'rooms' : 'schedules';
    const values = { is_archived: archived };
    if (!archived && entity !== 'schedules') values.is_active = true;
    const result = await client.from(table).update(values).eq('id', id).select('id').maybeSingle();
    if (!unwrap(result, 'Could not change the archive state.')) fail('This record was not found. Refresh the workspace and try again.');
    return { saved: true };
  }

  async function deleteRecord(entity, id) {
    await requireAdmin('Only an Admin can delete workspace data.');
    if (entity === 'users') {
      unwrap(await client.rpc('admin_delete_staff', { p_profile_id: id }), 'Could not delete the IT Staff account.');
      return { deleted: true };
    }
    const table = entity === 'buildings' ? 'buildings' : entity === 'rooms' ? 'rooms' : 'schedules';
    const result = await client.from(table).delete().eq('id', id).select('id').maybeSingle();
    unwrap(result, 'Could not delete this record.');
    if (!result.data) fail('This record was not found. Refresh the workspace and try again.');
    return { deleted: true };
  }

  async function importSchedules(body) {
    const user = await readCurrentUser();
    if (!user || user.role !== 'admin') fail('Only an Admin can import schedules.');
    if (!lastState) fail('Refresh the workspace before importing schedules.');
    const sourceRows = Array.isArray(body.rows) ? body.rows : [];
    if (!sourceRows.length) fail('The file has no schedule rows to import.');

    const replacing = body.replaceSelection !== undefined;
    if (replacing && !Array.isArray(body.replaceSelection)) fail('Select schedules to replace.');
    const selected = new Map((body.replaceSelection || []).map(item => [item?.id, item?.updated_at]));
    if (replacing && !selected.size) fail('Select at least one schedule to replace.');
    const oldSchedules = lastState.schedules.filter(item => item.updatedAt && selected.get(item.id) === item.updatedAt && item.active && !item.archived);
    if (oldSchedules.length !== selected.size) fail('A selected schedule changed. Refresh and select it again.');
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const retained = replacing ? lastState.schedules.filter(item => !selected.has(item.id) && (!item.effectiveEnd || item.effectiveEnd >= date)) : lastState.schedules;

    const errors = [];
    const rows = [];
    const pending = [];
    for (let index = 0; index < sourceRows.length; index++) {
      const row = sourceRows[index];
      const building = lastState.buildings.find(item => item.active !== false && !item.archived && (item.name.toLowerCase() === String(row.building || '').trim().toLowerCase() || item.code.toLowerCase() === String(row.building || '').trim().toLowerCase()));
      const room = lastState.rooms.find(item => item.active !== false && !item.archived && item.buildingId === building?.id && item.roomNumber.toLowerCase() === String(row.room || '').trim().toLowerCase());
      if (!building || !room) {
        errors.push({ row: Number.isInteger(row.sourceRow) ? row.sourceRow : index + 2, error: 'Building or room was not found.' });
        continue;
      }
      const payload = {
        roomId: room.id,
        instructor: String(row.instructor || '').trim(),
        course: String(row.course || '').trim(),
        section: String(row.section || '').trim(),
        startTime: String(row.startTime || '').trim(),
        endTime: String(row.endTime || '').trim(),
        days: Array.isArray(row.days) ? row.days.map(Number) : []
      };
      try {
        const days = validateSchedule(payload, retained, null, pending);
        const data = schedulePayload(payload, days, user.id);
        rows.push(data);
        pending.push({
          id: 'import-' + index,
          roomId: payload.roomId,
          days,
          startTime: payload.startTime,
          endTime: payload.endTime,
          active: true
        });
      } catch (error) {
        errors.push({ row: Number.isInteger(row.sourceRow) ? row.sourceRow : index + 2, error: error.message });
      }
    }
    if (body.preview === true) return { errors };
    if (errors.length) {
      const error = new Error('Fix the schedule rows before importing.');
      error.errors = errors;
      throw error;
    }
    if (replacing) {
      const result = await client.rpc('replace_selected_schedules', {
        p_old: oldSchedules.map(item => ({ id: item.id, updated_at: item.updatedAt })),
        p_rows: rows
      });
      return { imported: unwrap(result, 'Could not replace the selected schedules.'), archived: oldSchedules.length };
    }
    const result = await client.from('schedules').insert(rows).select('id');
    unwrap(result, 'Could not import the schedules.');
    return { imported: rows.length };
  }

  async function createStaff(body) {
    const user = await readCurrentUser();
    if (!user || user.role !== 'admin') fail('Only an Admin can create IT Staff accounts.');
    const result = await client.functions.invoke('create-staff', {
      body: {
        full_name: String(body.name || '').trim(),
        email: String(body.email || '').trim().toLowerCase(),
        password: String(body.password || '')
      }
    });
    if (result.error) {
      let message = result.error.message || 'The account provisioning function could not be reached.';
      try {
        const response = result.error.context;
        const payload = response?.json ? await response.json() : null;
        if (payload?.error) message = payload.error;
      } catch {}
      if (/not found|function.*deploy/i.test(message)) {
        message = 'Deploy supabase/functions/create-staff before creating staff accounts.';
      }
      fail(message);
    }
    return result.data || { created: true };
  }

  function decodePhoto(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([\s\S]+)$/);
    if (!match) fail('The selected photo could not be read.');
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return { type: match[1], bytes };
  }

  async function completeRound(id, body) {
    const user = await readCurrentUser();
    if (!user) fail('Sign in again before saving the room check.');
    if (!['yes', 'no', 'unknown'].includes(body.pcInUse) || !['yes', 'no', 'unknown'].includes(body.laptopHdmi)) {
      fail('Answer each equipment question or choose Not checked.');
    }
    if (!['normal', 'attention', 'damaged', 'unknown'].includes(body.display)) {
      fail('Select a display condition before saving the room check.');
    }

    unwrap(await client.rpc('complete_round', {
      p_round_id: id,
      p_pc_in_use: body.pcInUse === 'unknown' ? null : body.pcInUse === 'yes',
      p_personal_laptop_used: body.laptopHdmi === 'unknown' ? null : body.laptopHdmi === 'yes',
      p_hdmi_connected: body.laptopHdmi === 'unknown' ? null : body.laptopHdmi === 'yes',
      p_display_condition: body.display === 'unknown' ? 'not_checked' : body.display,
      p_notes: String(body.notes || '')
    }), 'Could not save the room check.');

    let photoWarning = '';
    if (body.photo && String(body.photo).startsWith('data:')) {
      try {
        const photo = decodePhoto(body.photo);
        const extension = photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : 'jpg';
        const storagePath = user.id + '/' + id + '/' + crypto.randomUUID() + '.' + extension;
        const upload = await client.storage.from('round-photos').upload(storagePath, new Blob([photo.bytes], { type: photo.type }), {
          contentType: photo.type,
          cacheControl: '3600',
          upsert: false
        });
        if (upload.error) throw upload.error;
        const record = await client.from('round_photos').insert({
          round_id: id,
          storage_path: storagePath,
          uploaded_by: user.id
        });
        if (record.error) throw record.error;
      } catch (error) {
        photoWarning = 'The room check was saved, but its photo could not be uploaded: ' + error.message;
      }
    }
    return { saved: true, photoWarning };
  }

  async function resolveRound(id) {
    const user = await readCurrentUser();
    if (!user || user.role !== 'admin') fail('Only an Admin can resolve room issues.');
    const result = await client.from('issues')
      .select('id')
      .eq('round_id', id)
      .eq('status', 'open');
    const issues = unwrap(result, 'Could not load the open issues.');
    if (!issues.length) fail('This round has no open issue to resolve.');
    for (const issue of issues) {
      unwrap(await client.rpc('resolve_issue', { p_issue_id: issue.id }), 'Could not resolve the issue.');
    }
    return { resolved: issues.length };
  }

  async function request(url, options) {
    const method = String(options?.method || 'GET').toUpperCase();
    const parsed = new URL(url, window.location.href);
    const path = parsed.pathname;
    const body = parseBody(options);

    if (path === '/api/session' && method === 'GET') {
      return { user: await readCurrentUser() };
    }
    if (path === '/api/login' && method === 'POST') return signIn(body);
    if (path === '/api/logout' && method === 'POST') {
      const result = await client.auth.signOut();
      if (result.error) fail(result.error.message);
      lastState = null;
      return { signedOut: true };
    }
    if (path === '/api/state' && method === 'GET') {
      const date = parsed.searchParams.get('date');
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('A valid campus date is required.');
      const page = parsed.searchParams.get('issuePage');
      const issuePage = page === null ? null : Number(page);
      if (issuePage !== null && (!Number.isSafeInteger(issuePage) || issuePage < 0)) fail('Invalid issue page.');
      return loadState(date, issuePage);
    }
    if (path === '/api/buildings' && method === 'POST') {
      await requireAdmin();
      const data = {
        name: String(body.name || '').trim(),
        code: String(body.code || '').trim().toUpperCase(),
        floors: Number(body.floors)
      };
      unwrap(await client.from('buildings').insert(data).select('*').single(), 'Could not add the building.');
      return { saved: true };
    }
    if (path === '/api/rooms/bulk' && method === 'POST') {
      await requireAdmin();
      const buildingId = String(body.buildingId || '').trim();
      const requested = Array.isArray(body.rooms) ? body.rooms : [];
      if (!buildingId || !requested.length || requested.length > 250) fail('Choose a building and add between 1 and 250 rooms.');
      const building = unwrap(
        await client.from('buildings').select('id,floors,is_active').eq('id', buildingId).maybeSingle(),
        'Could not load the selected building.'
      );
      if (!building || !building.is_active) fail('Choose an active building before adding rooms.');
      const seen = new Set();
      const data = requested.map((room, index) => {
        const roomNumber = String(room?.roomNumber || '').trim();
        const name = String(room?.name || '').trim();
        const floor = String(room?.floor || '').trim();
        if (!roomNumber || !name || !/^\d+$/.test(floor) || Number(floor) < 1) {
          fail('Room ' + (index + 1) + ' needs a room number, name, and a valid floor.');
        }
        if (building.floors && Number(floor) > Number(building.floors)) {
          fail('Floor ' + floor + ' exceeds the ' + building.floors + ' floors in this building.');
        }
        const key = roomNumber.toLowerCase();
        if (seen.has(key)) fail('The batch contains the room number "' + roomNumber + '" more than once.');
        seen.add(key);
        return { building_id: buildingId, room_number: roomNumber, name, floor, equipment: equipmentValues(body.equipment) };
      });
      const existing = unwrap(
        await client.from('rooms').select('room_number').eq('building_id', buildingId),
        'Could not check existing room numbers.'
      ) || [];
      const existingNumbers = new Set(existing.map(room => String(room.room_number || '').trim().toLowerCase()));
      const duplicate = data.find(room => existingNumbers.has(room.room_number.toLowerCase()));
      if (duplicate) fail('Room number "' + duplicate.room_number + '" already exists in this building.');
      unwrap(await client.from('rooms').insert(data).select('id'), 'Could not add the rooms.');
      return { saved: true, created: data.length };
    }
    if (path === '/api/rooms' && method === 'POST') {
      await requireAdmin();
      const data = {
        building_id: body.buildingId,
        room_number: String(body.roomNumber || '').trim(),
        name: String(body.name || '').trim(),
        floor: String(body.floor || '').trim() || null,
        equipment: equipmentValues(body.equipment)
      };
      unwrap(await client.from('rooms').insert(data).select('*').single(), 'Could not add the room.');
      return { saved: true };
    }
    if (path === '/api/schedules/bulk' && method === 'POST') return insertSchedules(body);
    if (path === '/api/schedules' && method === 'POST') return insertSchedule(body);
    if (path === '/api/schedules/import' && method === 'POST') return importSchedules(body);
    if (path === '/api/users' && method === 'POST') return createStaff(body);

    const recordMatch = path.match(/^\/api\/(buildings|rooms|schedules|users)\/([^/]+)$/);
    if (recordMatch) {
      const entity = recordMatch[1];
      const id = decodeURIComponent(recordMatch[2]);
      if (method === 'PUT') {
        if (entity === 'buildings') return updateBuilding(id, body);
        if (entity === 'rooms') return updateRoom(id, body);
        if (entity === 'schedules') return updateSchedule(id, body);
        return updateStaff(id, body);
      }
      if (method === 'PATCH' && typeof body.archived === 'boolean') return setArchived(entity, id, body.archived);
      if (method === 'DELETE') return deleteRecord(entity, id);
    }

    const claimMatch = path.match(/^\/api\/rounds\/([^/]+)\/claim$/);
    if (claimMatch && method === 'POST') {
      unwrap(await client.rpc('claim_round', { p_round_id: decodeURIComponent(claimMatch[1]) }), 'Could not claim this room check.');
      return { claimed: true };
    }
    const completeMatch = path.match(/^\/api\/rounds\/([^/]+)\/complete$/);
    if (completeMatch && method === 'POST') return completeRound(decodeURIComponent(completeMatch[1]), body);
    const resolveMatch = path.match(/^\/api\/rounds\/([^/]+)\/resolve$/);
    if (resolveMatch && method === 'POST') return resolveRound(decodeURIComponent(resolveMatch[1]));
    const roundMatch = path.match(/^\/api\/rounds\/([^/]+)$/);
    if (roundMatch && method === 'GET') {
      const id = decodeURIComponent(roundMatch[1]);
      const round = [...(lastState?.rounds || []), ...(lastState?.history || []), ...(lastState?.openIssues?.rounds || [])].find(item => item.id === id);
      if (round) {
        try {
          const photo = await readRoundPhoto(id);
          return { round: { ...round, check: { ...round.check, photo } } };
        } catch {
          return { round, photoWarning: 'The room check photo could not be loaded.' };
        }
      }
      fail('This room check is not in the loaded history. Refresh the workspace and try again.');
    }
    fail('Unsupported Rounds request: ' + method + ' ' + path);
  }

  let liveChannel = null;
  function subscribe(onChange, onStatus) {
    if (liveChannel) client.removeChannel(liveChannel);
    const channel = client.channel('rounds-shared-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'issues' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'buildings' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_log' }, onChange)
      .subscribe(status => onStatus?.(status === 'SUBSCRIBED'));
    liveChannel = channel;
    return { unsubscribe: function () {
      if (liveChannel === channel) liveChannel = null;
      client.removeChannel(channel);
    } };
  }

  window.roundsSupabase = {
    api: request,
    subscribe,
    unsubscribe: function () {
      if (liveChannel) client.removeChannel(liveChannel);
      liveChannel = null;
    }
  };
})();
