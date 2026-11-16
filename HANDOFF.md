# Rounds Handoff

## Current state

- Branch: `main`.
- Base commit: `88cbfad` (`Refine core system UX`).
- The changes described below are local, uncommitted, and unpushed.
- No live Supabase migration or Edge Function redeployment was performed in this pass.

## Work completed locally

1. Fixed the shared list-control handler. It now reads `data-list-control`, so search, filters, sorting, and reset update list state across the app.
2. Added `npm test` with two Node built-in tests: list-control state wiring and service-role key detection.
3. Moved service-role key detection to `scripts/supabase-key.cjs`; both the browser build and Electron startup use it. Electron now refuses to launch with a Supabase secret/service-role key configured as the publishable key.
4. Added `supabase/migrations/20261116120000_prevent_schedule_overlaps.sql`. It serializes active schedule writes per room and rejects overlapping room schedules in the database.
5. Updated the legacy local JSON demo to hide unsupported record-management and role-preview controls, and corrected its demo notice.
6. Updated `create-staff` to check activity-log insertion and attempt to delete the newly created account if audit logging fails.
7. Updated `README.md` with the test command and the new migration.

## Files changed

- Modified: `README.md`, `app.js`, `electron/main.cjs`, `package.json`, `scripts/build-browser.cjs`, `supabase/functions/create-staff/index.ts`.
- Added: `scripts/supabase-key.cjs`, `supabase/migrations/20261116120000_prevent_schedule_overlaps.sql`, `test/list-controls.test.cjs`, `test/supabase-key.test.cjs`.

## Checks run

- `npm test`: passed, 2 tests.
- `node --check`: passed for `app.js`, `electron/main.cjs`, `scripts/build-browser.cjs`, and `scripts/supabase-key.cjs`.
- `git diff --check`: passed.
- The Electron/browser UI was not launched. The SQL migration was not run against Supabase, and the Edge Function was not checked or deployed with Deno.

## Required before production use

1. Review the changed files, then commit and push to `main`. GitHub Actions will run the Pages workflow after the push.
2. In Supabase Dashboard > SQL Editor, apply any not-yet-applied migrations in the order listed in `README.md`, including `20261116120000_prevent_schedule_overlaps.sql`.
3. The overlap migration does not alter existing schedule records. If it reports existing overlaps, inspect and correct those records after installing the trigger.
4. Redeploy the changed staff function. The previous deploy attempt used a 19-character project ref; the full ref is 20 characters and ends in `b`:

   ```powershell
   npx supabase functions deploy create-staff --project-ref btxztxditpeloacqdftb
   ```

   The CLI may print a deprecation warning for `--project-ref`; the previous attempt failed because the ref was missing its final character.

5. Confirm the GitHub Actions variables `ROUNDS_SUPABASE_URL` and `ROUNDS_SUPABASE_PUBLISHABLE_KEY` are set. Use a publishable key only.

## Remaining verification

- Run the app and confirm list filters change the visible rows, including the Schedule `Paused` filter.
- Apply the SQL migration in a safe Supabase environment and verify overlapping inserts and updates are rejected.
- Redeploy `create-staff`, then confirm an Admin can create a staff account and the activity entry appears.
- Confirm GitHub Pages completes its workflow after pushing the commit.
