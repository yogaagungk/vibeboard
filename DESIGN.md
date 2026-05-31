# VibeBoard - Design System & UI Guide

Context for anyone (human or agent) building UI in this repo. Read this before
touching `public/`. The goal is that new UI is **indistinguishable** from what's
already there.

> **Two pages:**
> - `/` → `public/landing.html` - a **self-contained** marketing page (its own
>   inline `<style>`, no external JS). It mirrors the app's tokens and dark theme
>   but is intentionally standalone so it loads instantly with zero dependencies.
> - `/app` → `public/index.html` - the kanban app: markup in `index.html`, styles
>   in `public/styles.css`, behavior in ordered `public/js/*.js` classic scripts.
>
> The app obeys: no bundler, no build step, no ES modules, no inline
> `<script>`/`<style>`. (The landing page's inline `<style>` is the one sanctioned
> exception - it's a single static file with no shared scope.) See `CLAUDE.md`.

---

## 1. Design principles

VibeBoard's look is **quiet, dense, and functional** - a developer tool, not a
consumer app. The palette is adapted from **Linear's design system** (same
product class: a developer issue/kanban tracker): a cool-neutral surface ladder
with a single **lavender-blue accent** (`#5e6ad2`).

1. **Calm base, one accent.** The base UI is a cool neutral ramp (near-white /
   near-black). The lavender-blue accent (`--accent`) is the *only* brand hue -
   reserved for the primary action, the active/selected state, focus rings, and
   the connection of agent activity. Everything else earns its color from
   meaning (priority, tags, agent identity, run status, danger), never decoration.
2. **Elevation by surface ladder, not shadow.** Depth comes from a hairline
   border + a step up the surface ladder (`--bg` canvas → `--surface` panel →
   `--surface-2` hover/featured → `--surface-3` popover), echoing Linear. Hover
   lifts by changing background, not by casting a shadow. Drop shadows are
   reserved for things that genuinely float over a scrim (modals, toasts,
   dropdown popover, dragging card). On dark, lifted panels carry a subtle white
   top edge-highlight (`--edge`) for the crisp "rendered" feel.
3. **One weight up for emphasis.** Hierarchy is font-weight (300→400→500) and
   muted-vs-full text color, not size jumps. Body is 12–13px; almost nothing is
   larger than 15px.
4. **Everything is reversible and obvious.** Inline-edit titles, toggles over
   checkboxes, toasts for feedback, explicit empty states.
5. **Respect the two surface patterns** (see §6): **modals** for transient
   create/config flows, **right sidebars** for persistent contextual detail.

---

## 2. Design tokens

All visual constants are CSS custom properties on `:root` in `styles.css`.
**Never hardcode a value that a token exists for.** If you need a new constant,
add a token rather than a literal.

### Color (light / dark)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f7f8f8` | `#08090a` | App background, recessed wells (inputs, cards-in-group) |
| `--surface` | `#ffffff` | `#141516` | Raised panels (surface-1): header, columns, cards, modals, sidebars |
| `--surface-2` | `#eef0f4` | `#1b1c1e` | One step up: card/feature hover, featured |
| `--surface-3` | `#ffffff` | `#202123` | Popovers / dropdown menus (the `vbSelect` list) |
| `--surface-4` | `#f5f6f6` | `#232427` | Deepest lifted surface (reserve for nested elevation; rare) |
| `--edge` | `0 0 0 0 transparent` | `inset 0 1px 0 rgba(255,255,255,.045)` | Top edge-highlight on lifted dark panels (list-safe, layer it before float shadows) |
| `--border` | `#e7e8ec` | `#23252a` | Default hairline |
| `--border-strong` | `#d3d5dc` | `#34343a` | Hover/focus borders, toggle track |
| `--text` | `#08090a` | `#f7f8f8` | Primary text |
| `--text-strong` | `#2b2f36` | `#d0d6e0` | Secondary copy on hero / large panels (between `--text` and `--text-muted`) |
| `--text-muted` | `#6b7079` | `#8a8f98` | Tertiary text, labels, placeholders, icons |
| `--accent` | `#5e6ad2` | `#5e6ad2` | Primary buttons, active/selected state, log chip |
| `--accent-hover` | `#5058c9` | `#828fff` | Accent hover (Linear's lighter-on-dark / deeper-on-light) |
| `--accent-focus` | `#5e69d1` | `#5e69d1` | Focus ring tint (slightly cooler than `--accent`) |
| `--accent-fg` | `#ffffff` | `#ffffff` | Text on `--accent` |
| `--danger` / `--danger-bg` | `#dc2626` / `#fee2e2` | `#f87171` / `#3b1515` | Destructive actions, overdue, errors |

> **Note:** `--accent` is the single brand hue (Linear's lavender-blue) and is
> the same in both themes - only the neutral ramp flips. Use it sparingly; if a
> screen looks "too purple," something non-primary is borrowing the accent.
>
> **Light theme is a VibeBoard addition.** Linear's marketing canvas ships dark
> only; the light ramp here mirrors the structure but isn't directly derived
> from Linear. Keep new tokens working in both, but treat dark as the canonical
> reference when there's any visual disagreement.

### Semantic color (used by badges/pills; currently hardcoded - prefer tokenizing new ones)
- **Priority:** high `#dc2626`, medium `#d97706`, low `#2563eb` (badges use a tinted bg + colored text; pickers use solid fill when active).
- **Tags:** feature `#7c3aed`, bug `#dc2626`, design `#db2777`, infra `#16a34a`, docs `#d97706`, api `#2563eb` (tokenized as `--tag-*`).
- **Agents:** claude-code `#d97706`, opencode `#7c3aed`, codex `#0ea5e9`, command-code `#0d9488` (badge labels CC / OC / CX / CD).
- **Status:** success/connected `#16a34a` (`--active-ws`), running/agent `#3b82f6`.

### Geometry / scale

**Radius scale** (Linear: `xs 4 / sm 6 / md 8 / lg 12 / xl 16 / pill`):

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | `4px` | Status badges, small chips |
| `--radius-sm` | `6px` | Inline tags |
| `--radius-md` | `8px` | Buttons, inputs, cards (alias `--radius-card`) |
| `--radius-lg` | `12px` | Columns, modal boxes (alias `--radius-col`) |
| `--radius-xl` | `16px` | Oversized panels (rare) |
| `--radius-pill` | `9999px` | Tag pills, queued chip, status pills |

**Layout sizes:**

| Token | Value | Notes |
|---|---|---|
| `--col-width` | `280px` | Column width (mobile drops to 220-260) |
| `--header-h` | `52px` | Sticky header height |
| `--sidebar-w` | `220px` | Left workspace rail |
| (right sidebars) | `480px` | Card-detail + log (literal; resizable for card) |

**Spacing rhythm:** 4 / 8 / 12 / 16 / 24 / 32px (Linear's 4px base, doubled
through 32). 6/10/14/20px steps still appear in older code but new code should
snap to the scale above. Component padding is typically 12-16px; gaps between
controls 8-12px.

**Transitions:** `0.15s` for hover/focus on controls; `0.2-0.3s` for theme and
panel slide. Easing is default/`ease`. Keep new transitions in this range.

---

## 3. Typography

- **Font:** **`'Inter', sans-serif`** everywhere (Linear's typeface is
  proprietary; Inter is its documented open substitute), with **`'JetBrains
  Mono'`** for paths, branch names, diffs, agent output, prompt text, version
  badge, and config snippets. `body` sets `letter-spacing:-0.01em` +
  `-webkit-font-smoothing:antialiased` - Inter wants both.
- **Weights:** 300 (descriptions, hints), 400 (default UI text/body), 500
  (labels, active/emphasis), **600 (headings - Linear caps display at 600, not
  700)**.
- **Negative tracking on display.** Headings tighten as they grow. Linear's
  reference scale is roughly:

  | Size | Tracking | Weight | Use |
  |---|---|---|---|
  | 80px | -3.0px | 600 | Hero (landing only) |
  | 56px | -1.8px | 600 | Section opener |
  | 40px | -1.0px | 600 | Sub-section |
  | 28px | -0.6px | 600 | Headline / CTA banner |
  | 22px | -0.4px | 500 | Card title |
  | 20px | -0.2px | 400 | Subhead, lead |
  | 18px | -0.1px | 400 | Hero subhead |
  | 16px | -0.05px | 400 | Body |
  | 14px | 0 | 400 | Body-sm |
  | 12px | 0 | 400 | Caption |

  In the app today: header title -0.3px, empty-state -0.5px. The landing page
  uses larger steps (-0.8px on section titles, -1.8px on hero). Keep new large
  headings on weight 600 + tracking proportional to size (~ -3.5% of px).
- **Sizes used in the app:** 9-10px (badges, pills, timestamps), 11px (hints,
  secondary), 12px (default control/body), 13px (card text, section body),
  14-18px (titles).
- **Uppercase micro-labels (eyebrows):** field/group labels use
  `font-size:11px; font-weight:500; text-transform:uppercase; letter-spacing:0.4px;
  color:var(--text-muted)` - see `.field-label`, `.sidebar-group-label`,
  `.nc-agent-box-label`. Linear eyebrows use *positive* tracking (+0.4px); the
  contrast against negative-tracked display marks them as taxonomy. Keep these
  sans (not mono). Reuse the classes; don't reinvent.

---

## 4. Theming

- Three modes: **System / Light / Dark**, set via `data-theme` on `:root`
  (`light`/`dark`) or absent (system).
- **Every dark override must be written twice** - once under
  `:root[data-theme="dark"]` and once under
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]):not([data-theme="dark"]) … }`.
  This is forced by the no-build constraint. When you add a dark-specific rule
  (e.g. a tinted badge bg), add **both** blocks or system-dark users get the
  light styling. This is the #1 theming footgun in this codebase.
- Prefer theming through tokens so a single `:root` override covers most cases;
  only duplicate when a value genuinely differs in dark (e.g. tinted overlays
  like `.priority-badge`, `.agent-permission-warning`, `.due-input.overdue`).

---

## 5. Layout & z-index

```
┌─ header (sticky, --header-h, z100) ───────────────────────────┐
│ conn-dot · ☰ · VibeBoard · Agent Log · MCP Setup · theme      │
├──────────┬────────────────────────────────────┬──────────────┤
│ workspace│ board-wrap                          │ card-sidebar │
│ sidebar  │  ├ board-toolbar (search)           │  (z60, 480px,│
│ (z50,    │  └ board-inner → columns → cards    │   resizable) │
│  220px)  │     · empty-state when no workspace │ OR log-      │
│          │                                     │  sidebar(z59)│
└──────────┴────────────────────────────────────┴──────────────┘
   mcp-banner: fixed under header (z90) when MCP unconfigured
```

**z-index scale** (keep new layers on this ladder):
`workspace-sidebar 50` · `log-sidebar 59` · `card-sidebar 60` · `mcp-banner 90` ·
`header 100` · `modal-overlay 300` · `mcp-modal 400` · `toast 500` ·
`shortcuts-overlay 600`.

- The card sidebar and log sidebar are **mutually exclusive** (opening one closes
  the other) and slide in via `transform: translateX`. The left rail and right
  panels offset their `top`/`height` when `body.mcp-banner-open`.

---

## 6. Component patterns

### Buttons (pick the right one - don't invent variants)
| Class | Look | Use |
|---|---|---|
| `.btn-primary` / `.btn-save` / `.empty-cta` | Solid `--accent`, white text, hover = `opacity .85` | The one primary action in a context |
| `.btn-ghost` / `.header-btn` / `.browse-btn` / `.card-move-btn` / `.output-toggle-btn` | Transparent, `--border`, muted text; hover fills `--bg` + `--text` + `--border-strong` | Secondary/neutral actions |
| `.btn-danger` | Transparent, `--danger` text; hover = `--danger-bg` | Destructive (Delete) |
| `.icon-btn` | 24px square, bordered, muted glyph | Icon-only (`+`, `↻`) - add a `title` |

**The universal ghost-hover recipe** (memorize it): `background→var(--bg);
color→var(--text); border-color→var(--border-strong)`. Almost every neutral
control uses exactly this. Exception: the **stop-agent** button keeps its danger
border on hover (no fill) - see `#card-stop-agent-btn:hover`.

**Active/selected state** (theme picker, agent picker, priority "None"):
`border-color + background: var(--accent); color: var(--accent-fg)`. Priority
high/medium/low use their semantic color as the active fill instead.

### Inputs
- Text inputs: `.ws-input` (compact, sidebar) or `.modal-path-input` /
  `.modal-textarea` (modal). Recessed `--bg`, `--border`, focus brightens to
  `--surface` + `--border-strong` (or `--accent` for `.ws-input`).
- Inline-edit titles (column titles, card/workspace name) are **borderless
  transparent inputs** that show a border only on `:focus`. This is the pattern
  for "click the text to rename."
- Toggles use `.toggle-switch` (a styled checkbox), **never** a raw checkbox.
  Pair with `.toggle-row` + `.toggle-row-label` + `.toggle-row-hint`.
- **Dropdowns: never use native `<select>`.** Its open option list is OS-rendered
  and can't be themed (it breaks the dark UI). Use `vbSelect({ options, value,
  placeholder, onChange, ariaLabel })` from `public/js/select.js` - a themed,
  keyboard-operable combobox whose popup is body-mounted with fixed positioning
  (never clipped by a scrolling sidebar). It returns a controller with
  `setOptions`, `setValue`, `setPlaceholder`, `getValue`. Mount `ctrl.el` into a
  container `<div>`. Used by the model pickers and the blocked-by picker.

### Containers
- **`.sidebar-group` / `.nc-agent-box`**: a recessed (`--bg`) bordered card that
  groups related fields, with an uppercase `…-label`. Use this to chunk forms in
  the card sidebar / new-card modal.
- **`.modal-box`**: `--surface`, 12px radius, `header / body / footer` rows.
  Header has a title (or inline-edit input) + `.modal-close-btn`. Footer is
  right-aligned via `.modal-spacer`; destructive action goes far-left.
- **Right sidebars** (`#card-sidebar`, `#log-sidebar`): `header / body(scroll) /
  footer` columns, slide in from the right, 480px.

### Badges & pills (footer of a card, header chips)
Small, `flex-shrink:0`, 9–10px. Families: `.tag-*`, `.priority-badge`,
`.card-agent-badge`, `.run-status-badge` (ok/fail), `.usage-badge`,
`.card-queued-pill` (pulsing dot), `.blocked-badge` (🔒), `.branch-badge`
(monospace), `.card-running-dot` (pulsing). When adding a new card signal, make
it a badge in this family and append it to `.card-footer` in `buildCard()`.

### Feedback
- **Toasts** (`showToast(msg, dur, type)`) bottom-right for transient
  confirmations/errors. `type` is `''` (neutral), `'success'` (green left bar),
  or `'error'` (red left bar). Auto-dismiss; pointer-events only on the toast.
- **Dialogs** - **never use native `confirm()`/`prompt()`/`alert()`.** Use the
  promise-based `vbConfirm(message, opts)` / `vbPrompt(message, opts)` from
  `public/js/dialogs.js` instead. They render a themed `.vb-dialog`, trap focus,
  and support Esc/Enter. Pass `{ title, confirmText, danger }` (set `danger:true`
  for destructive confirms - it gives a solid red confirm button).
- **Connection dot** in header reflects SSE state (gray → pulsing green).
- **Agent-flash** outline on a card when an agent touches it.
- Animations are subtle and short (`fadeIn`, `toastIn`, `pulse`,
  `running-pulse`). Keep new motion in the same vocabulary.

---

## 7. Responsive

Breakpoints: **768px** (tablet/mobile) and **480px** (small phone).
- Left rail becomes an off-canvas drawer toggled by `.mobile-menu-btn` (☰).
- Right sidebars and the card sidebar go full-width (`100vw`); resize handle hides.
- Modals go `90vw` / `85vh`. Columns shrink to 260 → 220px.
Test any new layout at 768 and 480 before considering it done.

---

## 8. Accessibility

**In place - keep it that way:**
- **Focus rings.** A `:focus-visible` outline (`2px solid var(--accent)`) covers
  buttons, cards, list items, selects and key inputs on both pages. New
  interactive elements inherit it via the element/class selectors - don't set
  `outline:none` without providing a `:focus-visible` alternative.
- **Cards are keyboard-operable** - `role="button"`, `tabindex="0"`, and
  Enter/Space open them. Build new interactive elements as real `<button>`s, or
  replicate this trio. Don't ship click-only `<div>`s.
- **Modals/sidebars** trap focus, set `role="dialog"`/`aria-modal`, restore focus
  on close, and reflect picker state via `aria-pressed` (see `app.js`
  `initModalA11y` / `syncAriaPressed`). New static modals should be added to the
  `dialogs` list in `initModalA11y`.
- **No native dialogs** - `vbConfirm`/`vbPrompt` only (see §6).

**Still to improve when you're in the area:**
- **Label icon-only controls** with `aria-label`, not just `title`.
- **Contrast:** `--text-muted` is borderline against `--bg` at small sizes. Don't
  use muted text smaller than 11px for anything load-bearing; never put muted
  text on `--bg` for primary content. (The landing page uses a slightly lighter
  muted value in dark mode for body-copy legibility.)

---

## 9. Conventions & footguns

- **No inline styles for *appearance*.** State toggles (`style="display:none"`)
  that JS flips are tolerated; styling (fonts, widths, colors) belongs in a class
  in `styles.css`. Several legacy inline styles in `index.html` violate this -
  don't add more.
- **Keep markup and behavior separated:** new DOM goes in `index.html` (static)
  or is built in a `public/js/*.js` file; element wiring/`addEventListener`
  lives in JS, never inline `onclick`.
- **Token-first:** reach for an existing CSS variable before any literal; add a
  token if one is missing. New semantic colors (priority/tag/agent) should become
  tokens rather than repeated hexes (current ones are partly hardcoded - a known
  debt).
- **Dark mode = two blocks** (see §4). Forgetting the `prefers-color-scheme`
  twin is the most common visual regression here.
- **One primary action per surface.** Everything else is ghost/secondary.
- **Match the neighbors.** Before adding a control, find the closest existing one
  and reuse its class. The system only stays coherent if new code copies the
  established pattern instead of introducing a parallel one.
