# Product

<!-- impeccable:product-schema 1 -->

## Platform

Electron desktop client with a responsive browser build and Android wrapper from the shared UI.

## Stack

Current workspace: responsive HTML, CSS, and JavaScript UI with an Electron desktop shell connected in code to Supabase Auth, PostgreSQL, Storage, and Realtime. The Electron client uses Supabase APIs; it does not connect directly to PostgreSQL. A responsive web/PWA client or separate Android app is still needed for phones.

## Users

- **Admin (head):** creates IT Staff accounts, manages buildings and rooms, and maintains room schedules.
- **IT Staff:** use the shared system on desktop or phone to see due checks, record room conditions, and report issues.

## Product Purpose

Rounds helps an IT support office keep track of classroom checks around instructor changes. Admins add schedules manually or import them from Excel. The system surfaces rooms that need a check, and IT Staff record whether the classroom PC, laptop/HDMI setup, and display appear as expected. Success means staff can see which checks are due or complete and that reported display problems remain visible until resolved.

## Positioning

A schedule-driven room-check workflow that connects instructor handoffs to a shared IT rounds queue and an auditable room-condition record.

## Operating Context

IT Staff move between rooms in one or more buildings and may use phones while walking rounds. Multiple staff members use the same system, so a check claimed or completed by one person must be visible to the others. The school schedule is the expected-use source; the system does not detect who physically entered a room.

## Capabilities and Constraints

- Two roles only: Admin and IT Staff.
- Admin can create buildings and rooms, add and manage staff accounts, enter schedules manually, and import schedules in bulk from Excel.
- The dashboard shows upcoming, due, in-progress, completed, overdue, and issue-reported checks. In-app indicators mark due, overdue, and unresolved room checks; there are no push notifications when the app is closed.
- A new scheduled instructor in a room can create a check task. Consecutive sessions with the same instructor need not create a new handoff task.
- IT Staff can claim a task, record PC and laptop/HDMI use, report display condition, add notes, and attach an optional photo. The Activity page exposes the latest 100 completed checks. A round is flagged when the PC is not in use, a personal laptop is connected by HDMI, or the display needs attention.
- Updates are shared across accounts. Room selection is done in the app; QR codes are not required.
- Electron is the packaged desktop client. The responsive browser build can be hosted on GitHub Pages, and the Android wrapper uses the same Supabase project and UI.
- Admins can edit, pause, and resume recurring schedule entries. A one-day cancellation, substitution, or room change is not implemented; edits affect the recurring entry.
- A check becomes overdue 25 minutes after its scheduled start if no one completes it. This is a prototype default, not a campus policy.
- The local Node.js/JSON preview remains available, while the Electron client uses the configured Supabase project after its one-time SQL migration and Edge Function setup. School scheduling integration and push notification delivery remain out of scope for the first version.

## Evidence on Hand

No production schedule, room inventory, logo, testimonials, pricing, or deployment claims were provided. Any sample interface data must be labeled as demonstration data.

## Product Principles

- Put rooms needing attention ahead of administration tasks.
- Keep the room check fast to complete on a phone.
- Make schedule errors and room conflicts visible before they create missed checks.
- Keep reported issues visible until someone resolves them.
- Record expected schedule information separately from what staff observed.

## Accessibility & Inclusion

Follow WCAG AA contrast, visible keyboard focus, keyboard access, responsive behavior, and reduced-motion preferences. Mobile controls must have practical touch targets and readable labels.

