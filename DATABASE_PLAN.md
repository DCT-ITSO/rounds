# Rounds Supabase connection plan

## Selected architecture

The first client is an Electron desktop app connected directly to Supabase over HTTPS.

- Supabase Auth identifies Admin and IT Staff accounts.
- Supabase PostgreSQL stores profiles, buildings, rooms, recurring schedules, handoff rounds, issues, and activity.
- Supabase Storage stores private room-check photos.
- Supabase Realtime updates connected app instances.
- The publishable key is bundled through the local ignored `.env` configuration. It is public by design; Row Level Security is the access boundary. Never put a secret or service-role key in Electron.
- A later responsive web/PWA client can use this same database for phones.

## Implemented in this workspace

- Electron shell with context isolation and no Node integration in the renderer.
- Supabase Auth sign-in and persistent sessions.
- Supabase reads/writes for buildings, rooms, schedules, schedule imports, room rounds, issues, and history.
- Atomic round claiming, checklist completion, and issue resolution through the database RPCs.
- Private photo uploads and signed photo display.
- Realtime subscriptions for locations, schedules, rounds, and issues.
- Admin team listing; Admin account creation through a secured Edge Function.

## Database model

| Table | Purpose |
| --- | --- |
| `profiles` | Auth-linked name, email, role, and active status |
| `buildings`, `rooms` | Campus locations and equipment |
| `schedules` | Recurring instructor timetable entries |
| `rounds` | Date-specific handoff checks with room and schedule snapshots |
| `issues` | PC, personal laptop/HDMI, and display follow-up records |
| `activity_log` | Database-recorded round and issue actions |
| `round_photos` | Private Storage object paths and uploader information |

Weekdays use 0 for Sunday through 6 for Saturday. Schedule date and time values represent campus local time; the client computes due and overdue states using Asia/Manila.

## One-time setup after the original schema

1. Run `supabase/migrations/20261115_client_integration.sql` in Supabase SQL Editor. It syncs Auth emails to profiles, keeps checklist answers marked "Not checked" as unknown, adds the safe profile directory, and enables Realtime for locations and schedules.
2. Install project dependencies with `npm install`.
3. Deploy the account provisioning function:

   ```powershell
   npx supabase login
      npx supabase functions deploy create-staff --project-ref btxztxditpeloacqdftb
   ```

4. Launch the desktop app with `npm start`, then sign in with the existing Admin Auth account. The project URL and publishable key are loaded from the ignored `.env` file.

## Request flow

1. The app calls `ensure_rounds_for_date` for the current Asia/Manila date. The database creates one round for the first instructor in each room and additional rounds when the instructor changes.
2. A staff member claims a round through `claim_round`; the database update prevents two users from owning the same round.
3. The staff member records PC use, laptop/HDMI use, display condition, notes, and an optional photo. `complete_round` writes the check and any resulting issues together.
4. An Admin resolves open issues through `resolve_issue`; completed check history remains available.
5. Connected clients subscribe to Realtime changes and reload shared data.

## Remaining constraints

- The app needs internet access. Offline writes and synchronization are not implemented.
- The create-staff form requires the Edge Function to be deployed.
- Schedule overlap validation currently runs in the client before sending an insert. A database-side constraint or import RPC should be added before multiple Admins edit schedules concurrently.
- One-day schedule exceptions and push alerts while the app is closed are not implemented.
- The local Node/JSON preview remains separate and is not migrated automatically.
