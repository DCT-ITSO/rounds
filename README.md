# Rounds

Rounds is a shared room-check workspace for campus IT. The Electron app signs in with Supabase Auth, stores shared records in Supabase, and receives live updates for room checks and issues.

## Start the Electron app

Requirements: Node.js 22.12 or newer.

```powershell
npm install
npm start
```

Use the Admin account created in Supabase Auth to sign in. Do not start the connected app with `node server.mjs`; that command starts the old local JSON prototype on port `4173`. It is separate from Supabase and is not used by Electron.

## Supabase setup

The project URL and publishable key are read from the ignored `.env` file. The key is a client-side publishable key; database access is controlled by Row Level Security. Never put a Supabase secret or service-role key in `.env`, Electron, or renderer code.

The base project schema and client integration migration have already been applied. Run [20261115120000_admin_data_management.sql](supabase/migrations/20261115120000_admin_data_management.sql) and [20261115130000_limit_round_generation_to_today.sql](supabase/migrations/20261115130000_limit_round_generation_to_today.sql) once each in Supabase Dashboard > SQL Editor. The first adds archive states, safe staff account management, audit entries for Admin data changes, and Realtime updates for workspace activity. The second prevents authenticated clients from generating round records for arbitrary dates.

Confirm the first account has the `admin` role in `public.profiles`. The schema’s Auth trigger creates new accounts as `staff` by default.

Deploy the Admin-only staff account function from this folder:

```powershell
npx supabase login
npx supabase functions deploy create-staff --project-ref btxztxditpeloacqdftb
```

The function verifies the caller’s active Admin profile before creating an IT Staff Auth account and records the creator in the activity feed. Its service-role credential stays in Supabase’s function environment. Redeploy after updating it: npx supabase functions deploy create-staff --project-ref btxztxditpeloacqdftb

## Connected features

- Sign-in and session persistence through Supabase Auth.
- Admin-managed buildings, rooms, and recurring schedules.
- Manual schedule entry and Excel/CSV bulk import with room and overlap checks.
- Date-specific instructor handoff rounds generated from schedules.
- Atomic round claiming and completion through database functions.
- Room PC use, personal laptop/HDMI use, display condition, notes, and optional private photos.
- Open issue tracking and Admin resolution.
- Shared round and issue updates through Supabase Realtime.
- Check history and Admin team activity.

## Phone access

The Electron build runs on desktop. The interface has narrow-screen layouts, but Electron itself is not an Android app and the local Electron window is not accessible from phones. Phone use needs the companion web/PWA client hosted on HTTPS and connected to the same Supabase project.

## Browser build and GitHub Pages

The Electron app uses a local static server and preload configuration. Build a browser-ready copy, with its SDK files bundled under `dist/vendor` and Supabase's client configuration injected at build time, by running:

```powershell
npm run web:build
```

The browser build uses `ROUNDS_SUPABASE_URL` and `ROUNDS_SUPABASE_PUBLISHABLE_KEY` from `.env` or the build environment. Only use the Supabase publishable key; never use a secret or service-role key in a browser build.

GitHub Pages deployment is configured by `.github/workflows/deploy-pages.yml`. In the GitHub repository, add Actions variables named `ROUNDS_SUPABASE_URL` and `ROUNDS_SUPABASE_PUBLISHABLE_KEY` under Settings > Secrets and variables > Actions > Variables. Push to `main` or run the workflow manually from the Actions tab. GitHub Pages serves the browser app at `https://dct-itso.github.io/rounds/`.

Set Settings > Pages > Build and deployment > Source to **GitHub Actions**. The first successful run publishes the site; later pushes to `main` redeploy it.

In Supabase Dashboard > Authentication > URL Configuration, set the Site URL to `https://dct-itso.github.io/rounds/` and add `https://dct-itso.github.io/rounds/**` to Redirect URLs for password reset and invite links.

## Local JSON prototype

`server.mjs` remains available for the earlier local-only prototype. It stores records in `data/store.json`, uses demo accounts, and binds to port `4173`. It does not use Supabase. If that port is already in use, an earlier prototype server is still running.
