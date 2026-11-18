import http from "node:http";
import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { scryptSync, timingSafeEqual } from "node:crypto";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
if (!new Set(["127.0.0.1", "::1", "localhost"]).has(HOST.toLowerCase())) {
  throw new Error("The local JSON prototype must bind to localhost. It uses demo credentials and is not safe to expose to a network.");
}
const SESSION_COOKIE = "rounds_session";
const sessions = new Map();
const eventClients = new Set();
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/theme-init.js", ["theme-init.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/supabase-client.js", ["supabase-client.js", "text/javascript; charset=utf-8"]],
  ["/node_modules/@supabase/supabase-js/dist/umd/supabase.js", ["node_modules/@supabase/supabase-js/dist/umd/supabase.js", "text/javascript; charset=utf-8"]],
  ["/node_modules/read-excel-file/bundle/read-excel-file.min.js", ["node_modules/read-excel-file/bundle/read-excel-file.min.js", "text/javascript; charset=utf-8"]],
  ["/node_modules/write-excel-file/bundle/write-excel-file.min.js", ["node_modules/write-excel-file/bundle/write-excel-file.min.js", "text/javascript; charset=utf-8"]]
]);

const uid = (prefix) => prefix + "_" + crypto.randomUUID().slice(0, 8);
const nowIso = () => new Date().toISOString();
const manilaDate = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const manilaTime = (date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
const shiftTime = (minutes) => {
  const value = new Date(Date.now() + minutes * 60_000);
  return manilaTime(value);
};
const weekdayFor = (dateKey) => new Date(dateKey + "T12:00:00Z").getUTCDay();
const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) => ({
  salt,
  hash: scryptSync(password, salt, 64).toString("hex")
});
const checkPassword = (password, user) => {
  const candidate = scryptSync(password, user.salt, 64);
  return timingSafeEqual(candidate, Buffer.from(user.passwordHash, "hex"));
};

function defaultStore() {
  const adminId = "user_admin";
  const staffId = "user_staff";
  const northId = "building_north";
  const scienceId = "building_science";
  const room201 = "room_nw201";
  const room202 = "room_nw202";
  const room204 = "room_nw204";
  const room305 = "room_sc305";
  const scheduleA = "schedule_nw201_a";
  const scheduleB = "schedule_nw201_b";
  const scheduleC = "schedule_nw202_a";
  const scheduleD = "schedule_nw204_a";
  const scheduleE = "schedule_nw204_b";
  const scheduleF = "schedule_sc305_a";
  const adminPass = hashPassword("rounds2026");
  const staffPass = hashPassword("rounds2026");
  const days = [0, 1, 2, 3, 4, 5, 6];
  const today = manilaDate();
  const currentDay = weekdayFor(today);

  const store = {
    users: [
      { id: adminId, name: "Morgan Lee", email: "admin@rounds.local", role: "admin", active: true, ...adminPass, createdAt: nowIso() },
      { id: staffId, name: "Alex Santos", email: "staff@rounds.local", role: "staff", active: true, ...staffPass, createdAt: nowIso() }
    ],
    buildings: [
      { id: northId, name: "North Wing", code: "NW", floors: 3, active: true, createdAt: nowIso() },
      { id: scienceId, name: "Science Building", code: "SCI", floors: 4, active: true, createdAt: nowIso() }
    ],
    rooms: [
      { id: room201, buildingId: northId, roomNumber: "201", name: "Computer Lab 201", floor: "2", equipment: ["PCs", "Display"], active: true },
      { id: room202, buildingId: northId, roomNumber: "202", name: "Lecture Room 202", floor: "2", equipment: ["PC", "TV"], active: true },
      { id: room204, buildingId: northId, roomNumber: "204", name: "Lecture Room 204", floor: "2", equipment: ["PC", "TV"], active: true },
      { id: room305, buildingId: scienceId, roomNumber: "305", name: "Computer Lab 305", floor: "3", equipment: ["PCs", "Display"], active: true }
    ],
    schedules: [
      { id: scheduleA, roomId: room201, instructor: "Prof. Maria Velasco", course: "Information Systems", section: "BSIT 3A", days, startTime: shiftTime(-90), endTime: shiftTime(-30), active: true },
      { id: scheduleB, roomId: room201, instructor: "Prof. Daniel Cruz", course: "Network Administration", section: "BSIT 3B", days, startTime: shiftTime(-30), endTime: shiftTime(30), active: true },
      { id: scheduleC, roomId: room202, instructor: "Prof. Janelle Reyes", course: "Database Management", section: "BSIT 2A", days, startTime: shiftTime(-60), endTime: shiftTime(20), active: true },
      { id: scheduleD, roomId: room204, instructor: "Prof. Anton Lim", course: "Web Development", section: "BSIT 2B", days, startTime: shiftTime(30), endTime: shiftTime(90), active: true },
      { id: scheduleE, roomId: room204, instructor: "Prof. Leah Tan", course: "Human Computer Interaction", section: "BSIT 2C", days, startTime: shiftTime(90), endTime: shiftTime(150), active: true },
      { id: scheduleF, roomId: room305, instructor: "Prof. Chris Domingo", course: "IT Infrastructure", section: "BSIT 4A", days, startTime: shiftTime(-40), endTime: shiftTime(35), active: true }
    ],
    rounds: [],
    audit: [
      { id: uid("audit"), action: "Workspace created", detail: "Sample rounds data is ready to explore.", actor: "Morgan Lee", createdAt: nowIso() }
    ],
    demo: true
  };

  const tasks = buildTasks(store, today);
  const pastTask = tasks.find((task) => task.scheduleId === scheduleA);
  if (pastTask) {
    pastTask.completedAt = new Date(Date.now() - 8 * 60_000).toISOString();
    pastTask.completedBy = staffId;
    pastTask.check = { pcInUse: "yes", laptopHdmi: "no", display: "normal", notes: "" };
  }
  const issueTask = tasks.find((task) => task.scheduleId === scheduleF);
  if (issueTask) {
    issueTask.completedAt = new Date(Date.now() - 3 * 60_000).toISOString();
    issueTask.completedBy = staffId;
    issueTask.issueStatus = "open";
    issueTask.check = { pcInUse: "yes", laptopHdmi: "yes", display: "attention", notes: "Display input cable looks loose." };
  }
  store.rounds = tasks;
  return store;
}

function buildTasks(store, dateKey) {
  const day = weekdayFor(dateKey);
  const grouped = new Map();
  for (const schedule of store.schedules.filter((item) => item.active && item.days.includes(day))) {
    if (!grouped.has(schedule.roomId)) grouped.set(schedule.roomId, []);
    grouped.get(schedule.roomId).push(schedule);
  }
  const output = [];
  for (const [roomId, list] of grouped) {
    list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    let previousInstructor = null;
    for (const schedule of list) {
      if (previousInstructor !== schedule.instructor) {
        const revision = Math.max(1, Number(schedule.revision) || 1);
        const id = revision > 1 ? schedule.id + "__v" + revision + "__" + dateKey : schedule.id + "__" + dateKey;
        const saved = store.rounds.find((item) => item.id === id);
        output.push(saved || {
          id,
          scheduleId: schedule.id,
          scheduleSnapshot: {
            instructor: schedule.instructor,
            course: schedule.course,
            section: schedule.section,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            revision
          },
          roomId,
          date: dateKey,
          createdAt: nowIso(),
          claimedBy: null,
          completedBy: null,
          completedAt: null,
          check: null,
          issueStatus: null
        });
      }
      previousInstructor = schedule.instructor;
    }
  }
  return output;
}

async function loadStore() {
  await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(STORE_PATH)) {
    const fresh = defaultStore();
    await writeFile(STORE_PATH, JSON.stringify(fresh, null, 2), "utf8");
    return fresh;
  }
  try {
    const parsed = JSON.parse(await readFile(STORE_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`The local data file has an invalid top-level structure and was left unchanged: ${STORE_PATH}`);
    }
    for (const key of ["users", "buildings", "rooms", "schedules", "rounds", "audit"]) {
      if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
        throw new Error(`The local data file has invalid ${key} data and was left unchanged: ${STORE_PATH}`);
      }
    }
    return { ...defaultStoreShape(), ...parsed };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`The local data file is invalid JSON and was left unchanged: ${STORE_PATH}`, { cause: error });
    }
    throw error;
  }
}
function defaultStoreShape() {
  return { users: [], buildings: [], rooms: [], schedules: [], rounds: [], audit: [], demo: false };
}
let store = await loadStore();
let persistQueue = Promise.resolve();

function persist() {
  const snapshot = JSON.stringify(store, null, 2);
  const temporaryPath = `${STORE_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const write = persistQueue.catch(() => {}).then(async () => {
    await writeFile(temporaryPath, snapshot, { encoding: "utf8", flag: "wx" });
    try {
      await rename(temporaryPath, STORE_PATH);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  });
  persistQueue = write;
  return write;
}
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active };
}
function userFromRequest(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(new RegExp("(^|;\\s*)" + SESSION_COOKIE + "=([^;]+)"));
  const sessionId = match ? decodeURIComponent(match[2]) : null;
  const userId = sessionId ? sessions.get(sessionId) : null;
  return store.users.find((user) => user.id === userId && user.active) || null;
}
function setCookie(res, sessionId) {
  res.setHeader("Set-Cookie", SESSION_COOKIE + "=" + encodeURIComponent(sessionId) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200");
}
function clearCookie(res) {
  res.setHeader("Set-Cookie", SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}
function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}
function broadcast() {
  for (const client of eventClients) {
    try { client.write("event: update\ndata: " + JSON.stringify({ at: nowIso() }) + "\n\n"); } catch {}
  }
}
function logAction(action, detail, actor) {
  store.audit.unshift({ id: uid("audit"), action, detail, actor: actor.name, createdAt: nowIso() });
  store.audit = store.audit.slice(0, 300);
}
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 6_000_000) {
      const error = new Error("Request is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(bytes);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}
function adminOnly(user) {
  return user && user.role === "admin";
}
function validTime(time) {
  return typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}
function overlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
function checkScheduleConflict(schedule, ignoreId = null, pending = []) {
  return [...store.schedules, ...pending].find((other) => {
    if (!other.active || other.archived || other.id === ignoreId || other.roomId !== schedule.roomId) return false;
    const sameDay = other.days.some((day) => schedule.days.includes(day));
    return sameDay && overlap(schedule.startTime, schedule.endTime, other.startTime, other.endTime);
  });
}
function getRoom(roomId) {
  const room = store.rooms.find((item) => item.id === roomId && item.active);
  const building = room && store.buildings.find((item) => item.id === room.buildingId && item.active);
  return building ? room : undefined;
}
function stateFor(user, dateKey) {
  const generated = buildTasks(store, dateKey);
  const existingIds = new Set(store.rounds.map((item) => item.id));
  for (const task of generated) {
    if (!existingIds.has(task.id)) store.rounds.push(task);
  }
  const tasks = generated.map((task) => {
    const schedule = store.schedules.find((item) => item.id === task.scheduleId);
    const scheduleSnapshot = task.scheduleSnapshot || schedule;
    const room = store.rooms.find((item) => item.id === task.roomId);
    const building = room && store.buildings.find((item) => item.id === room.buildingId);
    const assignee = store.users.find((item) => item.id === task.claimedBy);
    const completer = store.users.find((item) => item.id === task.completedBy);
    return {
      ...task,
      photoAvailable: Boolean(task.check?.photo),
      check: task.check ? { ...task.check, photo: "" } : null,
      schedule: scheduleSnapshot ? {
        id: schedule.id, instructor: scheduleSnapshot.instructor, course: scheduleSnapshot.course,
        section: scheduleSnapshot.section, startTime: scheduleSnapshot.startTime, endTime: scheduleSnapshot.endTime
      } : null,
      room: room ? { id: room.id, roomNumber: room.roomNumber, name: room.name, floor: room.floor } : null,
      building: building ? { id: building.id, name: building.name, code: building.code } : null,
      assignee: assignee ? publicUser(assignee) : null,
      completer: completer ? publicUser(completer) : null
    };
  }).filter((item) => item.schedule && item.room && item.building);
  const history = store.rounds.filter((item) => item.completedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 100).map((item) => {
    const schedule = store.schedules.find((entry) => entry.id === item.scheduleId);
    const scheduleSnapshot = item.scheduleSnapshot || schedule;
    const room = store.rooms.find((entry) => entry.id === item.roomId);
    const building = room && store.buildings.find((entry) => entry.id === room.buildingId);
    const completer = store.users.find((entry) => entry.id === item.completedBy);
    return {
      ...item,
      photoAvailable: Boolean(item.check?.photo),
      check: item.check ? { ...item.check, photo: "" } : null,
      schedule: scheduleSnapshot ? { id: schedule.id, instructor: scheduleSnapshot.instructor, course: scheduleSnapshot.course, section: scheduleSnapshot.section, startTime: scheduleSnapshot.startTime, endTime: scheduleSnapshot.endTime } : null,
      room: room ? { id: room.id, roomNumber: room.roomNumber, name: room.name, floor: room.floor } : null,
      building: building ? { id: building.id, name: building.name, code: building.code } : null,
      completer: completer ? publicUser(completer) : null
    };
  }).filter((item) => item.schedule && item.room && item.building);
  return {
    user: publicUser(user),
    date: dateKey,
    buildings: store.buildings.filter((item) => item.active),
    rooms: store.rooms.filter((item) => item.active),
    schedules: store.schedules,
    users: store.users.filter((item) => item.active).map(publicUser),
    rounds: tasks,
    history,
    audit: store.audit.slice(0, 100),
    demo: store.demo
  };
}
function validateSchedule(input, ignoreId = null, pending = []) {
  const room = getRoom(input.roomId);
  if (!room) return "Choose an active room.";
  if (!input.instructor?.trim()) return "Instructor name is required.";
  if (!input.course?.trim()) return "Course or class name is required.";
  if (!Array.isArray(input.days) || !input.days.length || input.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return "Choose at least one valid day.";
  if (!validTime(input.startTime) || !validTime(input.endTime) || input.endTime <= input.startTime) return "Enter a valid start and end time.";
  if (checkScheduleConflict(input, ignoreId, pending)) return "This room already has a schedule overlapping that time.";
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/api/session" && req.method === "GET") {
      const user = userFromRequest(req);
      return json(res, 200, { user: user ? publicUser(user) : null, demo: store.demo });
    }
    if (pathname === "/api/login" && req.method === "POST") {
      const body = await readJson(req);
      const email = String(body.email || "").trim().toLowerCase();
      const user = store.users.find((item) => item.email.toLowerCase() === email && item.active);
      if (!user || !checkPassword(String(body.password || ""), user)) return json(res, 401, { error: "Email or password is incorrect." });
      const sessionId = crypto.randomBytes(32).toString("hex");
      sessions.set(sessionId, user.id);
      setCookie(res, sessionId);
      return json(res, 200, { user: publicUser(user) });
    }
    if (pathname === "/api/logout" && req.method === "POST") {
      const cookie = req.headers.cookie || "";
      const match = cookie.match(new RegExp("(^|;\\s*)" + SESSION_COOKIE + "=([^;]+)"));
      if (match) sessions.delete(decodeURIComponent(match[2]));
      clearCookie(res);
      return json(res, 200, { ok: true });
    }

    const user = userFromRequest(req);
    if (pathname.startsWith("/api/") && !user) return json(res, 401, { error: "Sign in to continue." });

    if (pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write("event: ready\ndata: {}\n\n");
      eventClients.add(res);
      req.on("close", () => eventClients.delete(res));
      return;
    }
    if (pathname === "/api/state" && req.method === "GET") {
      const requestedDate = url.searchParams.get("date");
      if (requestedDate && requestedDate !== manilaDate()) {
        return json(res, 400, { error: "Rounds can only be generated for today." });
      }
      const dateKey = manilaDate();
      const result = stateFor(user, dateKey);
      await persist();
      return json(res, 200, result);
    }

    const roundDetailMatch = pathname.match(/^\/api\/rounds\/([^/]+)$/);
    if (roundDetailMatch && req.method === "GET") {
      const round = store.rounds.find((item) => item.id === roundDetailMatch[1]);
      if (!round) return json(res, 404, { error: "This room check could not be found." });
      const schedule = store.schedules.find((item) => item.id === round.scheduleId);
      const scheduleSnapshot = round.scheduleSnapshot || schedule;
      const room = store.rooms.find((item) => item.id === round.roomId);
      const building = room && store.buildings.find((item) => item.id === room.buildingId);
      const completer = store.users.find((item) => item.id === round.completedBy);
      if (!scheduleSnapshot || !room || !building) return json(res, 404, { error: "This room check no longer has a complete schedule or room record." });
      return json(res, 200, { round: { ...round, schedule: { id: round.scheduleId, ...scheduleSnapshot }, room, building, completer: completer ? publicUser(completer) : null } });
    }

    if (pathname === "/api/buildings" && req.method === "POST") {
      if (!adminOnly(user)) return json(res, 403, { error: "Admin access is required." });
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      const code = String(body.code || "").trim().toUpperCase();
      if (!name || !code) return json(res, 400, { error: "Building name and code are required." });
      if (store.buildings.some((item) => item.code.toLowerCase() === code.toLowerCase())) return json(res, 409, { error: "That building code already exists." });
      const building = { id: uid("building"), name, code, floors: Math.max(1, Number(body.floors) || 1), active: true, createdAt: nowIso() };
      store.buildings.push(building);
      logAction("Building added", name, user);
      await persist(); broadcast();
      return json(res, 201, { building });
    }

    if (pathname === "/api/rooms/bulk" && req.method === "POST") {
      if (!adminOnly(user)) return json(res, 403, { error: "Admin access is required." });
      const body = await readJson(req);
      const building = store.buildings.find((item) => item.id === body.buildingId && item.active);
      const requested = Array.isArray(body.rooms) ? body.rooms : [];
      if (!building) return json(res, 400, { error: "Choose an active building before adding rooms." });
      if (!requested.length || requested.length > 250) return json(res, 400, { error: "Add between 1 and 250 rooms at a time." });
      const seen = new Set();
      const rooms = [];
      for (let index = 0; index < requested.length; index++) {
        const item = requested[index] || {};
        const roomNumber = String(item.roomNumber || "").trim();
        const name = String(item.name || "").trim();
        const floor = String(item.floor || "").trim();
        if (!roomNumber || !name || !/^\d+$/.test(floor) || Number(floor) < 1) {
          return json(res, 400, { error: "Room " + (index + 1) + " needs a room number, name, and a valid floor." });
        }
        if (building.floors && Number(floor) > Number(building.floors)) {
          return json(res, 400, { error: "Floor " + floor + " exceeds the " + building.floors + " floors in this building." });
        }
        const key = roomNumber.toLowerCase();
        if (seen.has(key)) return json(res, 409, { error: 'The batch contains room number "' + roomNumber + '" more than once.' });
        seen.add(key);
        rooms.push({ roomNumber, name, floor });
      }
      const existing = new Set(store.rooms.filter((room) => room.buildingId === building.id).map((room) => String(room.roomNumber || "").trim().toLowerCase()));
      const duplicate = rooms.find((room) => existing.has(room.roomNumber.toLowerCase()));
      if (duplicate) return json(res, 409, { error: 'Room number "' + duplicate.roomNumber + '" already exists in this building.' });
      const equipment = Array.isArray(body.equipment) ? body.equipment : String(body.equipment || "").split(",");
      const equipmentValues = [...new Set(equipment.map((value) => String(value).trim()).filter(Boolean))];
      const created = rooms.map((room) => ({
        id: uid("room"),
        buildingId: building.id,
        roomNumber: room.roomNumber,
        name: room.name,
        floor: room.floor,
        equipment: equipmentValues,
        active: true
      }));
      store.rooms.push(...created);
      logAction("Rooms added", building.name + " · " + created.length + " rooms", user);
      await persist(); broadcast();
      return json(res, 201, { rooms: created, created: created.length });
    }
    if (pathname === "/api/rooms" && req.method === "POST") {
      if (!adminOnly(user)) return json(res, 403, { error: "Admin access is required." });
      const body = await readJson(req);
      const roomNumber = String(body.roomNumber || "").trim();
      const roomName = String(body.name || "").trim();
      const building = store.buildings.find((item) => item.id === body.buildingId && item.active);
      if (!building || !roomNumber || !roomName) return json(res, 400, { error: "Building, room number, and room name are required." });
      const duplicate = store.rooms.some((room) => room.buildingId === building.id && String(room.roomNumber || "").trim().toLowerCase() === roomNumber.toLowerCase());
      if (duplicate) return json(res, 409, { error: "That room number already exists in this building." });
      const equipment = Array.isArray(body.equipment) ? body.equipment : String(body.equipment || "").split(",");
      const room = { id: uid("room"), buildingId: building.id, roomNumber, name: roomName, floor: String(body.floor || "1"), equipment: [...new Set(equipment.map((value) => String(value).trim()).filter(Boolean))], active: true };
      store.rooms.push(room);
      logAction("Room added", building.name + " · " + roomNumber, user);
      await persist(); broadcast();
      return json(res, 201, { room });
    }

    if (pathname === "/api/schedules/bulk" && req.method === "POST") {
      if (!adminOnly(user)) return json(res, 403, { error: "Admin access is required." });
      const body = await readJson(req);
      if (!Array.isArray(body.schedules) || body.schedules.length < 1 || body.schedules.length > 100) {
        return json(res, 400, { error: "Add between 1 and 100 schedule slots." });
      }
      const pending = [];
      for (const item of body.schedules) {
        const schedule = {
          roomId: String(body.roomId || ""),
          instructor: String(item.instructor || "").trim(),
          course: String(item.course || "").trim(),
          section: String(item.section || "").trim(),
          days: Array.isArray(item.days) ? [...new Set(item.days.map(Number))] : [],
          startTime: String(item.startTime || ""),
          endTime: String(item.endTime || ""),
          active: true,
          revision: 1
        };
        const error = validateSchedule(schedule, null, pending);
        if (error) return json(res, 400, { error });
        pending.push(schedule);
      }
      const created = pending.map((schedule) => ({ ...schedule, id: uid("schedule") }));
      const room = getRoom(String(body.roomId || ""));
      store.schedules.push(...created);
      logAction("Schedules added", created.length + " time slots in room " + room.roomNumber, user);
      await persist(); broadcast();
      return json(res, 201, { created: created.length });
    }

    if (pathname === "/api/schedules" && req.method === "POST") {
      if (!adminOnly(user)) return json(res, 403, { error: "Admin access is required." });
      const body = await readJson(req);
      const schedule = {
        id: uid("schedule"),
        roomId: String(body.roomId || ""),
        instructor: String(body.instructor || "").trim(),
        course: String(body.course || "").trim(),
        section: String(body.section || "").trim(),
        days: Array.isArray(body.days) ? [...new Set(body.days.map(Number))] : [],
        startTime: String(body.startTime || ""),
        endTime: String(body.endTime || ""),
        active: true,
        revision: 1
      };
      const error = validateSchedule(schedule);
      if (error) return json(res, 400, { error });
      store.schedules.push(schedule);
      logAction("Schedule added", schedule.course + " · " + schedule.instructor, user);
      await persist(); broadcast();
      return json(res, 201, { schedule });
    }

    const scheduleMatch = pathname.match(/^\/api\/schedules\/([^/]+)$/);
    if (scheduleMatch && (req.method === "PUT" || req.method === "DELETE")) {
      if (!adminOnly(user)) return json(res, 403, { error: "Admin access is required." });
      const schedule = store.schedules.find((item) => item.id === scheduleMatch[1]);
      if (!schedule) return json(res, 404, { error: "This schedule could not be found." });
      const body = req.method === "PUT" ? await readJson(req) : {};
      const next = {
        ...schedule,
        roomId: String(body.roomId ?? schedule.roomId),
        instructor: String(body.instructor ?? schedule.instructor).trim(),
        course: String(body.course ?? schedule.course).trim(),
        section: String(body.section ?? schedule.section).trim(),
        days: Array.isArray(body.days) ? [...new Set(body.days.map(Number))] : schedule.days,
        startTime: String(body.startTime ?? schedule.startTime),
        endTime: String(body.endTime ?? schedule.endTime),
        active: req.method === "DELETE" ? false : body.active !== false
      };
      const scheduleDetailsChanged = next.roomId !== schedule.roomId || next.instructor !== schedule.instructor || next.course !== schedule.course || next.section !== schedule.section || next.startTime !== schedule.startTime || next.endTime !== schedule.endTime || JSON.stringify(next.days) !== JSON.stringify(schedule.days);
      const scheduleRevisionChanged = scheduleDetailsChanged || next.active !== schedule.active;
      next.revision = Math.max(1, Number(schedule.revision) || 1) + (scheduleRevisionChanged ? 1 : 0);
      if (next.active) {
        const error = validateSchedule(next, schedule.id);
        if (error) return json(res, 400, { error });
      }
      if (scheduleRevisionChanged) {
        const previousSnapshot = {
          instructor: schedule.instructor, course: schedule.course, section: schedule.section,
          startTime: schedule.startTime, endTime: schedule.endTime,
          revision: Math.max(1, Number(schedule.revision) || 1)
        };
        for (const round of store.rounds.filter((item) => item.scheduleId === schedule.id)) {
          round.scheduleSnapshot ||= previousSnapshot;
          if (!round.completedAt) round.voidedAt = nowIso();
        }
      }
      Object.assign(schedule, next);
      logAction(schedule.active ? (scheduleRevisionChanged && !scheduleDetailsChanged ? "Schedule resumed" : "Schedule updated") : "Schedule paused", schedule.course + " · " + schedule.instructor, user);
      await persist(); broadcast();
      return json(res, 200, { schedule });
    }

    if (pathname === "/api/schedules/import" && req.method === "POST") {
      if (!adminOnly(user)) return json(res, 403, { error: "Admin access is required." });
      const body = await readJson(req);
      if (body.replaceSelection !== undefined) return json(res, 400, { error: "Schedule replacement requires Supabase." });
      if (!Array.isArray(body.rows) || !body.rows.length) return json(res, 400, { error: "There are no schedule rows to import." });
      const prepared = [];
      const errors = [];
      body.rows.forEach((row, index) => {
        const building = store.buildings.find((item) => item.active && item.name.toLowerCase() === String(row.building || "").trim().toLowerCase());
        const room = building && store.rooms.find((item) => item.active && item.buildingId === building.id && item.roomNumber.toLowerCase() === String(row.room || "").trim().toLowerCase());
        const candidate = {
          id: uid("schedule"),
          roomId: room?.id || "",
          instructor: String(row.instructor || "").trim(),
          course: String(row.course || "").trim(),
          section: String(row.section || "").trim(),
          days: Array.isArray(row.days) ? row.days.map(Number) : [],
          startTime: String(row.startTime || ""),
          endTime: String(row.endTime || ""),
          active: true,
          revision: 1
        };
        let error = !building ? "Building not found." : !room ? "Room not found in that building." : validateSchedule(candidate);
        if (!error) {
          const conflict = [...store.schedules, ...prepared].find((item) => item.active && item.roomId === candidate.roomId &&
            item.days.some((day) => candidate.days.includes(day)) && overlap(candidate.startTime, candidate.endTime, item.startTime, item.endTime));
          if (conflict) error = "Overlaps another schedule for this room.";
        }
        if (error) errors.push({ row: Number.isInteger(row.sourceRow) ? row.sourceRow : index + 2, error });
        else prepared.push(candidate);
      });
      if (body.preview === true) return json(res, 200, { errors });
      if (errors.length) return json(res, 400, { error: "Fix the rows listed before importing.", errors });
      store.schedules.push(...prepared);
      logAction("Schedules imported", prepared.length + " schedule rows", user);
      await persist(); broadcast();
      return json(res, 201, { imported: prepared.length });
    }

    if (pathname === "/api/users" && req.method === "POST") {
      if (!adminOnly(user)) return json(res, 403, { error: "Admin access is required." });
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) return json(res, 400, { error: "Enter a name, valid email, and password with at least 8 characters." });
      if (store.users.some((item) => item.email.toLowerCase() === email)) return json(res, 409, { error: "An account with that email already exists." });
      const credentials = hashPassword(password);
      const staff = { id: uid("user"), name, email, role: "staff", active: true, ...credentials, createdAt: nowIso() };
      store.users.push(staff);
      logAction("IT Staff account added", name, user);
      await persist(); broadcast();
      return json(res, 201, { user: publicUser(staff) });
    }

    const roundMatch = pathname.match(/^\/api\/rounds\/([^/]+)\/(claim|complete|resolve)$/);
    if (roundMatch && req.method === "POST") {
      const [, roundId, action] = roundMatch;
      const body = await readJson(req);
      const round = store.rounds.find((item) => item.id === roundId);
      if (!round) return json(res, 404, { error: "This round could not be found. Refresh and try again." });
      if (action === "claim") {
        if (round.completedAt) return json(res, 409, { error: "This check has already been completed." });
        if (round.claimedBy && round.claimedBy !== user.id) return json(res, 409, { error: "Another staff member has already claimed this check." });
        round.claimedBy = user.id;
        round.claimedAt ||= nowIso();
        logAction("Room check claimed", "Room " + round.roomId, user);
      } else if (action === "complete") {
        const check = {
          pcInUse: String(body.pcInUse || "unknown"),
          laptopHdmi: String(body.laptopHdmi || "unknown"),
          display: String(body.display || "normal"),
          notes: String(body.notes || "").trim(),
          photo: typeof body.photo === "string" && body.photo.startsWith("data:image/") ? body.photo : ""
        };
        if (round.completedAt) return json(res, 409, { error: "This check has already been completed." });
        if (!adminOnly(user) && round.claimedBy !== user.id) return json(res, 409, { error: "Claim this room check before completing it." });
        if (!["yes", "no", "unknown"].includes(check.pcInUse) || !["yes", "no", "unknown"].includes(check.laptopHdmi)) {
          return json(res, 400, { error: "Answer each equipment question or choose Not checked." });
        }
        if (!["normal", "attention", "damaged", "unknown"].includes(check.display)) {
          return json(res, 400, { error: "Choose a valid display condition." });
        }
        if (check.photo.length > 2_500_000) return json(res, 400, { error: "Photo is too large. Use an image under 2 MB." });
        round.check = check;
        round.completedBy = user.id;
        round.completedAt = nowIso();
        round.claimedBy = user.id;
        round.issueStatus = check.display === "attention" || check.display === "damaged" || check.laptopHdmi === "yes" || check.pcInUse === "no" ? "open" : null;
        logAction(round.issueStatus ? "Room issue reported" : "Room check completed", "Room " + round.roomId, user);
      } else {
        if (!adminOnly(user)) return json(res, 403, { error: "Admin access is required to resolve an issue." });
        if (round.issueStatus !== "open") return json(res, 409, { error: "This room check has no open issue." });
        round.issueStatus = "resolved";
        round.resolvedAt = nowIso();
        round.resolvedBy = user.id;
        logAction("Room issue resolved", "Room " + round.roomId, user);
      }
      await persist(); broadcast();
      return json(res, 200, { ok: true });
    }

    if (pathname.startsWith("/api/")) return json(res, 404, { error: "That action is not available." });

    const file = STATIC_FILES.get(pathname);
    if (!file) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" }); return res.end("Not found"); }
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", "Allow": "GET, HEAD", "X-Content-Type-Options": "nosniff" }); return res.end("Method not allowed"); }
    const [relative, contentType] = file;
    const target = path.join(ROOT, relative);
    let data;
    try { data = await readFile(target); }
    catch { res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" }); return res.end("Rounds assets are not installed. Run npm install first."); }
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (error) {
    const status = error.status || 500;
    json(res, status, { error: error.message || "Something went wrong." });
  }
});

server.listen(PORT, HOST, () => {
  console.log("Rounds prototype running at http://localhost:" + PORT);
  console.log("Demo admin: admin@rounds.local / rounds2026");
  console.log("Demo IT staff: staff@rounds.local / rounds2026");
});

