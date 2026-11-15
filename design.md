Act as a Senior Frontend Engineer and Expert UI Designer.
Your task is to build a complete responsive internal web app on the first attempt.
- App Theme: A shared campus IT room-rounds workspace driven by instructor handoffs and classroom PC/display checks.
- Sections to build: Sign-in; role-aware overview; room rounds queue and check form; schedule editor and Excel import; buildings and rooms; IT Staff accounts; check history and activity.

Generate the final code immediately following these definitions:

## Style

- **Name:** shadcn/ui (New York)
- **Type:** claude-artisan/flat-platform
- **Keywords:** shadcn/ui (New York), shadcn, new-york style, radix + tailwind, Neutral, refined, subtle borders and rings, Small radius (0.5rem), muted zinc/slate palette, Accessible Radix primitives, Understated developer-favorite polish, flat-platform
- **Era:** 2023–present
- **Light/Dark:** Light and dark themes are supported throughout the app. The initial theme follows the operating system preference; a user toggle persists the selected theme in this browser.

## Color Palette

- **Primary:** bg: #ffffff, surface: #ffffff, surface-strong: #f4f4f5, border: #e4e4e7
- **Secondary:** text: #09090b, text-muted: #71717a, primary: #18181b, accent: #2563eb, ring: #a1a1aa

## Visual Effects

Neutral, refined, subtle borders and rings, Small radius (0.5rem), muted zinc/slate palette, Accessible Radix primitives, Understated developer-favorite polish, shadow

## AI Visual Direction

shadcn/ui (New York), Neutral, refined, subtle borders and rings, Small radius (0.5rem), muted zinc/slate palette, Accessible Radix primitives, Understated developer-favorite polish, shadcn/ui showcase; Vercel/Cal.com-style apps.

## CSS Technical

```css
/* shadcn/ui (New York) — design tokens */
/* 2023–present | shadcn/ui (Radix + Tailwind) by shadcn, condensed */
:root {
  /* color: zinc palette, "New York" preset */
  --color-bg: #ffffff;
  --color-surface: #ffffff;
  --color-surface-strong: #f4f4f5;
  --color-border: #e4e4e7;
  --color-text: #09090b;
  --color-text-muted: #71717a;
  --color-primary: #18181b;
  --color-accent: #2563eb;
  --color-ring: #a1a1aa;
  /* radius: shadcn default is 0.5rem */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-pill: 999px;
  /* shadow: very subtle, never decorative */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.05);
  /* font */
  --font-sans: 'Geist', 'Inter', system-ui, -apple-system, sans-serif;
  --font-display: 'Geist', 'Inter', system-ui, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, 'SFMono-Regular', monospace;
  /* text */
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.375rem;
  --text-2xl: 1.75rem;
  --text-3xl: 2.25rem;
  --text-4xl: 3rem;
  --text-5xl: 4rem;
  /* space */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;
  --space-24: 96px;
  /* ease */
  --ease-standard: cubic-bezier(0.16, 1, 0.3, 1);
  /* extra: a subtle two-layer focus ring is the recurring signature move, not a gradient or texture */
  --ring-offset: 0 0 0 2px var(--color-bg);
  --ring: 0 0 0 4px color-mix(in srgb, var(--color-ring) 35%, transparent);
}

/* ============================================================
   Base component classes — shadcn/ui (New York)
   Signature move: a restrained two-layer focus ring (white offset +
   soft zinc ring) repeated identically on btn and input, plus a
   uniform 0.5rem radius and hairline 1px borders everywhere — subtle,
   refined, developer-favorite polish with no ornament beyond structure.
   ============================================================ */
body { margin: 0; color: var(--color-text); font-family: var(--font-sans); background: var(--color-bg); }
.nav { display: flex; gap: var(--space-4); align-items: center;
  padding: var(--space-3) var(--space-6); background: var(--color-surface);
  border-bottom: 1px solid var(--color-border); }
.btn {
  font: 500 var(--text-sm)/1 var(--font-sans); color: var(--color-text);
  padding: var(--space-2) var(--space-4); border-radius: var(--radius-md);
  background: var(--color-surface); border: 1px solid var(--color-border);
  box-shadow: var(--shadow-sm); cursor: pointer;
  transition: background-color .15s var(--ease-standard), box-shadow .15s var(--ease-standard);
}
.btn:hover { background: var(--color-surface-strong); }
.btn:active { background: #ececef; }
.btn:focus-visible { outline: none; box-shadow: var(--ring-offset), var(--ring); }
.btn[disabled] { opacity: .5; cursor: not-allowed; }
.btn--primary { background: var(--color-primary); color: #fafafa; border-color: var(--color-primary); }
.btn--primary:hover { background: #27272a; }
.card { background: var(--color-surface); color: var(--color-text);
  border: 1px solid var(--color-border); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm); padding: var(--space-6); }
.input { width: 100%; box-sizing: border-box; color: var(--color-text);
  font: var(--text-sm) var(--font-sans); padding: var(--space-2) var(--space-3);
  background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.input::placeholder { color: var(--color-text-muted); }
.input:focus { outline: none; box-shadow: var(--ring-offset), var(--ring); border-color: var(--color-ring); }
.badge { display: inline-flex; align-items: center; gap: .4em; font: 600 var(--text-xs) var(--font-sans);
  padding: .2em .7em; border-radius: var(--radius-pill); background: var(--color-surface-strong);
  border: 1px solid var(--color-border); color: var(--color-text); }
@media (prefers-reduced-motion: reduce) { .btn { transition: none; } }

/* Especificação de referência: references/00-flagship-implementation-specs/shadcn-ui.md */
```

## Design System Variables

```css
--bg: #ffffff, --fg: #09090b, --accent: #18181b, --surface: #ffffff, --radius: 0.5rem, --spacing: 16px, --font-display: 'Geist', 'Inter', system-ui, sans-serif, --font-body: 'Geist', 'Inter', system-ui, -apple-system, sans-serif
```

## Implementation Checklist

- WCAG AA contrast; visible focus; keyboard access; hover/pressed states; responsive layouts; and prefers-reduced-motion.
- Use the palette as CSS custom properties in `styles.css`. This app uses plain HTML, CSS, and JavaScript without a utility framework or build step.

## Execution Rules

1. Strictly follow the defined visual style.
2. Use high-quality inline SVG icons (Heroicons or Lucide style) — NEVER use emojis as icons.
3. Add `cursor-pointer` and smooth `hover` states (`transition-all`) on all interactive elements.
4. Required App Structure:
   - Sign-in with clear Admin and IT Staff entry.
   - Responsive workspace navigation and overview dashboard.
   - Room rounds queue, issue indicators, and fast room-check form.
   - Admin schedule management with manual entry and Excel import.
   - Building/room management, staff accounts, check history, and recent activity.
5. All text content must be in English.
6. The visual must be CLEARLY distinct — do not create a "default Bootstrap" design. Force the use of the provided design system variables.
7. Keep application styles in `styles.css`. Use inline SVG icons and lightweight CSS for layout, focus rings, and responsive behavior; avoid a runtime CSS framework dependency.
8. Full Responsiveness: Layout must adapt perfectly to Mobile, Tablet and Desktop (vertical stack on mobile).
9. Include basic SEO, Viewport and Open Graph meta tags in `<head>`.
10. Workspace shell must show prototype status and the live update connection state.
11. Make the creative decisions needed to deliver the complete, functional result now.


## Responsive Product UI Requirements

- Build responsive interfaces for desktop, tablet, and phone. The phone experience must be designed for the task, not just a desktop layout squeezed onto a smaller screen.
- Admin workflows include account management, building and room management, manual schedule entry, and Excel schedule import. These workflows should remain usable on smaller screens, while the main admin layout can prioritize desktop.
- Optimize the IT Staff experience for phones during room rounds. Show a short queue of rooms due now, with the building, room, expected instructor, and scheduled time clearly visible.
- Let IT Staff open a room check from the queue, record the PC and laptop/HDMI setup, report a display issue, add a short note or optional photo, and submit the result with a clear saved confirmation.
- Use large touch targets, concise labels, and a simple one-screen or short-step check flow that works while walking between rooms.
- Do not require QR codes. Staff select and confirm the room through the system.
- Sync claims, check results, and issue status across Admin and IT Staff accounts so another staff member can see who is handling a room and whether it has been checked.
- On narrow screens, present rooms and check status as readable cards or lists instead of compressing wide data tables. Keep keyboard access, visible focus, and WCAG AA contrast.
