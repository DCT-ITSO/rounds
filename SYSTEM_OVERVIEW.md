# Rounds System Overview

Rounds is a shared campus IT workspace for managing classroom handoffs and room-condition checks. Admins maintain buildings, rooms, staff accounts, and recurring class schedules. IT Staff use the rounds queue to check equipment and report issues.

## How a room round works

1. An Admin creates schedules manually or imports them from Excel/CSV.
2. Rounds generates that day's checks from schedule handoffs. Consecutive sessions with the same instructor do not need a new handoff check.
3. An IT Staff member claims a check and records PC use, personal laptop/HDMI use, display condition, notes, and an optional photo.
4. The system keeps reported issues open until an Admin resolves them.
5. Check history and team activity provide a shared record of completed work and administrative changes.

## Roles

| Role | Main access |
| --- | --- |
| Admin | Manage buildings, rooms, recurring schedules, and IT Staff accounts; review activity; resolve issues. |
| IT Staff | View assigned workspace rounds, claim and complete checks, and review room-check history. |

## Architecture

- **Interface:** `index.html`, `app.js`, and `styles.css` provide the shared responsive interface.
- **Data and sign-in:** `supabase-client.js` connects to Supabase Auth, Postgres through the Data API, private photo storage, Realtime, and database RPCs. Row Level Security protects database access.
- **Desktop:** `electron/main.cjs` serves the renderer from a local-only static server. `electron/preload.cjs` exposes only the Supabase configuration needed by the client.
- **Browser:** `scripts/build-browser.cjs` creates `dist`, bundles browser dependencies, and injects the configured project URL and publishable key. `.github/workflows/deploy-pages.yml` builds and deploys the site to GitHub Pages on pushes to `main`.
- **Android:** Capacitor uses the same web interface. `npm run android:debug` prepares the web assets, syncs Android, and builds a debug APK.
- **Legacy prototype:** `server.mjs` starts a separate local JSON demo on port `4173`. It is not used by Electron or the Supabase browser build. The local demo hides record-management actions it does not implement.

## Main project files

| File or folder | Purpose |
| --- | --- |
| `app.js` | Pages, list controls, forms, dialogs, and UI event handling. |
| `supabase-client.js` | Supabase authentication, reads, writes, photo handling, and realtime updates. |
| `schema.sql` | Base database schema, security policies, and room-round RPCs. |
| `supabase/migrations/` | Follow-up database changes; apply them in the order documented in `README.md`. |
| `supabase/functions/create-staff/` | Admin-only creation of IT Staff Auth accounts. |
| `electron/` | Electron desktop shell and preload. |
| `mobile/` and `android/` | Capacitor preparation script and Android project. |
| `scripts/build-browser.cjs` | GitHub Pages/browser build. |
| `test/` | Node built-in regression tests. |

## Recent engineering changes

- Connected search, filters, sorting, and reset controls to their list state across rounds, schedules, buildings and rooms, team, activity, and history.
- Added a regression test for list-control state updates.
- Added database-side schedule-overlap protection for concurrent schedule writes.
- Shared service-role key detection between browser and Electron startup so a service-role key is rejected before it reaches the renderer.
- Removed nonfunctional role-preview controls and unsupported edit/archive/delete actions from the legacy local demo.
- Made staff account creation check its activity-log write and attempt cleanup if that audit write fails.
- Added a `test` script using Node's built-in test runner.

## Local commands

Requirements: Node.js 22.12 or newer.

```powershell
npm install
npm start
npm test
npm run web:build
npm run android:debug
```

Use only the Supabase publishable key in `.env` or GitHub Actions variables. Never place a service-role key in the Electron app, browser build, or Android app.

## Current limits

- Schedules are recurring entries; one-day substitutions and cancellations are not implemented.
- The app uses campus time in `Asia/Manila` and marks a check overdue 25 minutes after its scheduled start.
- Notifications appear in the app while it is open. Push notifications and school scheduling-system integration are not included.
- Electron is a desktop client. The hosted browser build or Android wrapper is needed for phone use.
