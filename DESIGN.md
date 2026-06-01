# VibeBoard — Design System & UI Guide

Context for anyone (human or agent) building UI in this repo. Read this before
touching `public/`. The goal is that new UI is **indistinguishable** from what's
already there.

> **Two pages:**
> - `/` → `public/landing.html` — a **self-contained** marketing page (its own
>   inline `<style>`, no external JS). Mirrors app tokens but is intentionally
>   standalone so it loads instantly with zero dependencies.
> - `/app` → `public/index.html` — the kanban app: markup in `index.html`, styles
>   in `public/styles.css`, behavior in ordered `public/js/*.js` classic scripts.
>
> The app obeys: no bundler, no build step, no ES modules, no inline
> `<script>`/`<style>`. See `CLAUDE.md`.

---

## 1. Design principles

VibeBoard follows **ClickUp's design language** — colorful, structured, and built
around task clarity.

1. **Color carries meaning.** The purple accent (`--accent`) anchors primary
   actions and selected states. Priority, tags, agents, and status each have
   their own semantic colors — not decoration, but signal. Use color deliberately.
2. **Cards are the atoms.** Cards are white elevated surfaces (`--surface`) on a
   recessed board (`--bg`). Each card lifts off the background with a visible
   shadow. Hover increases elevation. Columns provide structure but don't compete
   for visual weight — they are containers, not cards.
3. **Sidebar follows the theme.** The left sidebar uses `--surface` and `--border`
   like all other panels — light in light mode, dark in dark mode.
4. **Rounded and approachable.** Cards `8px`, modals `8px`, buttons/inputs `6px`,
   tags/badges `4px`, pills `20px`. Consistent rounding signals modern, product-
   grade quality.
5. **Hierarchy through weight and color.** Use font-weight (400→500→600) and
   muted-vs-full text color. Body `12–13px`, badges `11px`, card titles `14px`,
   headings `16px`. Nothing larger than `16px` in the app.
6. **One primary action per surface.** Everything else is ghost/secondary. The
   accent should appear once or twice per screen, never as decoration.

---

## 2. Design tokens

All visual constants are CSS custom properties on `:root` in `styles.css`.
**Never hardcode a value a token exists for.** Add a token if one is missing.

### Color (light / dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F1F2F6` | `#1C1F26` | App canvas, board background |
| `--surface` | `#FFFFFF` | `#22262F` | Cards, modals, header, panels |
| `--surface-2` | `#F4F5F9` | `#292D38` | Hover state, featured |
| `--surface-3` | `#FFFFFF` | `#2E3240` | Popovers, dropdowns |
| `--surface-4` | `#ECEEF4` | `#262A34` | Column backgrounds, recessed inputs |
| `--border` | `#E0E2EA` | `#2D3240` | Default hairlines |
| `--border-strong` | `#C8CBDA` | `#3C4155` | Hover/focus borders |
| `--text` | `#1B2030` | `#D8DCE8` | Primary text |
| `--text-strong` | `#353D52` | `#B8BDD0` | Labels, secondary copy |
| `--text-muted` | `#6E7687` | `#7A8092` | Hints, timestamps, placeholders |
| `--accent` | `#7C69EF` | `#9B8FF0` | Primary buttons, selection, active |
| `--accent-hover` | `#6554C0` | `#B0A5F5` | Accent hover |
| `--accent-focus` | `#7C69EF` | `#9B8FF0` | Focus rings |
| `--accent-fg` | `#FFFFFF` | `#FFFFFF` | Text on accent |
| `--danger` | `#E53935` | `#FC5A5A` | Destructive, overdue, errors |
| `--danger-bg` | `#FDECEA` | `#2D1515` | Danger tinted background |
| `--active-ws` | `#16A34A` | `#16A34A` | Connected / running status |


**Semantic colors (badges; currently hardcoded — tokenize new ones):**
- **Priority:** high `#EF4444`, medium `#F97316`, low `#3B82F6`
- **Tags:** dynamic via `tagColor()` — deterministic HSL hash, solid fill, white text
- **Agents:** claude-code `#D97706`, opencode `#7C3AED`, codex `#0EA5E9`, command-code `#0D9488`
- **Run status:** ok `#16A34A`, fail `#EF4444`
- **Merged:** `#16A34A` text, no background
- **Blocked:** `#EF4444` tinted pill

### Geometry / scale

**Radius scale:**

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | `4px` | Tags, badges, small chips |
| `--radius-sm` | `6px` | Buttons, inputs, minor elements |
| `--radius-md` | `8px` | Cards, modals, dropdowns |
| `--radius-lg` | `10px` | Columns, large panels |
| `--radius-xl` | `16px` | Oversized panels (rare) |
| `--radius-pill` | `20px` | Pills, filter chips, queued badge |
| `--radius-card` | `var(--radius-md)` | Card alias |
| `--radius-col` | `var(--radius-lg)` | Column alias |

**Layout sizes:**

| Token | Value | Notes |
|---|---|---|
| `--col-width` | `280px` | Column width |
| `--header-h` | `48px` | Sticky header height |
| `--sidebar-w` | `260px` | Left workspace rail |

**Spacing rhythm:** 4 / 8 / 12 / 16 / 20 / 24 / 32px (4px base grid).

**Transitions:** `0.15s ease` for hover/focus; `0.2–0.3s ease` for panels and theme.

---

## 3. Typography

- **Font:** `'Inter', sans-serif` everywhere. `'JetBrains Mono'` for paths,
  branch names, agent output, version badge, config snippets.
- `body` sets `letter-spacing: -0.01em` + `-webkit-font-smoothing: antialiased`.
- **Weights:** 400 (body/default), 500 (labels/emphasis), 600 (headings only).

**App size scale:**

| Use | Size | Weight | Notes |
|---|---|---|---|
| Badge / timestamp | `11px` | 400 | Card meta, dates |
| Body / control | `12px` | 400 | Default UI text |
| Section label | `13px` | 500 | Column titles, sidebar items |
| Card title | `14px` | 500 | |
| Sidebar heading | `16px` | 600 | VibeBoard wordmark |
| Field label (eyebrow) | `11px` | 500 | `text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted)` |

---

## 4. Layout

```
┌── sidebar (fixed left, --sidebar-w 260px, --sidebar-bg, z50) ──┐
│  logo · v badge · workspace list · + New workspace · Settings   │
├── header (sticky, --header-h 48px, --surface, z100) ───────────┤
│  ☰ · search · filter chips              conn · Log · MCP · ★    │
├── board-wrap ───────────────────────────────────────────────────┤
│   board-inner (--bg canvas) → #board flex → columns             │
│     .column: --surface-4 bg, no border, --radius-col (10px)     │
│       .col-header: 12px 14px pad, dot + title + count           │
│       .cards-list: gap 10px, 8px h-padding                      │
│       .add-card-area: sticky bottom                              │
└─────────────────────────────────────────────────────────────────┘
  right: #card-sidebar (z60, 480px) | #log-sidebar (z59, 480px)
  overlay: mcp-banner (fixed under header, z90)
```

**z-index ladder:**
`50` sidebar · `59` log-sidebar · `60` card-sidebar · `90` mcp-banner ·
`100` header · `300` modal overlay · `400` mcp-modal · `500` toast · `600` shortcuts

---

## 5. Components

### Cards
- `background: var(--surface)` — white / dark-elevated
- `border: 1px solid var(--border)`, `border-radius: 8px`
- `box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)`
- Hover: `box-shadow: 0 4px 8px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)`
- `padding: 12px 14px`
- **Structure:** `[×del] [title-row: dot? + title] [desc-preview?] [footer: tags-row?, meta-row?]`
- **Footer meta** (what shows on card): agent badge · due date · blocked · merged/need-merge · running/queued
- **Footer meta** (sidebar only): run status ✓/✗ · usage $cost/tokens · branch pill · review badge · cycle warning

### Columns
- `background: var(--surface-4)` — subtle tint, **no border**
- `border-radius: var(--radius-col)` = `10px`
- No box-shadow — columns are containers, cards provide the elevation
- Col header padding: `12px 14px`; color dot `8px` circle + title `13px 500` + count muted
- Cards gap: `10px`

### Sidebar
- Follows theme: `background: var(--surface)` · `border-right: 1px solid var(--border)`
- Item hover: `var(--surface-4)` bg
- Active item: accent-tinted bg + `var(--accent)` text + `3px` left accent bar (`box-shadow: inset 3px 0 0 var(--accent)`)

### Header
- `height: 48px`, `background: var(--surface)`, `border-bottom: 1px solid var(--border)`
- Minimal shadow (dark mode only): `0 1px 3px rgba(0,0,0,0.2)`
- Search: `var(--surface-4)` background (recessed), `260px` wide
- Buttons: `.header-btn` ghost style

### Buttons

| Class | Style | Use |
|---|---|---|
| `.btn-primary` | Solid `--accent`, white, `opacity .85` hover | One primary action |
| `.btn-ghost` / `.header-btn` | Transparent + `--border`; hover: `--surface-4` fill | Secondary / neutral |
| `.btn-danger` | Transparent + `--danger` text; hover: `--danger-bg` fill | Destructive |

**Ghost hover recipe:** `background → var(--surface-4); color → var(--text); border-color → var(--border-strong)`

### Inputs
- Recessed (`var(--surface-4)` bg) for toolbar/search inputs
- Raised (`var(--surface)` bg) for modal/form inputs
- Border `--border`, focus border `--accent` (or `--border-strong` for secondary)
- Never use native `<select>` — use `vbSelect()` from `select.js`
- Never use native `confirm()`/`prompt()` — use `vbConfirm()`/`vbPrompt()` from `dialogs.js`

### Badges & pills
All `11px`, `font-weight: 400`, `border-radius: 4px`.

| Badge | Style |
|---|---|
| Tag | Solid `tagColor()` bg, white text |
| Agent | Solid agent-color bg, white text |
| Due date | Plain muted text; red when overdue |
| Blocked | `rgba(239,68,68,0.12)` bg, `#EF4444` text |
| Merged | `#16A34A` text, no bg |
| Need-merge | Amber tinted pill |
| Running dot | Pulsing `#3B82F6` circle |
| Queued | Muted bg + pulsing dot |
| Priority dot | `10×10px`, `border-radius: 3px`, inline with title |

### Feedback
- **Toasts** `showToast(msg, dur, type)` — bottom-right, types: `''` / `'success'` / `'error'`
- **Dialogs** `vbConfirm` / `vbPrompt` from `dialogs.js` — never native browser dialogs
- **Agent flash** — `card.agent-flash` class on card element via SSE
- **Connection dot** — gray → pulsing green in header

---

## 6. Theming

- Three modes: **System / Light / Dark** via `data-theme` on `:root`
- **Every dark override must be written twice:** once in `:root[data-theme="dark"]`
  and once in `@media (prefers-color-scheme: dark) { :root:not([...]) … }`.
  This is the #1 theming footgun — missing the media-query block breaks system-dark users.
- Sidebar uses standard app tokens (`--surface`, `--border`, etc.) and follows the theme automatically.

---

## 7. Responsive

Breakpoints: **768px** (tablet/mobile) · **480px** (small phone).
- Left rail: off-canvas drawer via `.mobile-menu-btn`
- Right sidebars: full-width
- Modals: `90vw / 85vh`
- Columns: `260px` → `220px`

---

## 8. Accessibility

- Focus rings: `:focus-visible { outline: 2px solid var(--accent) }`
- Cards: `role="button"`, `tabindex="0"`, Enter/Space open
- Modals/sidebars: trap focus, `role="dialog"`, `aria-modal`, restore focus on close
- No native `<select>` or dialogs (see §5 Inputs)
- Label icon-only controls with `aria-label`, not just `title`

---

## 9. Conventions & footguns

- **No inline styles for appearance.** State toggles (`style="display:none"`) OK; colors/fonts belong in `styles.css`.
- **Token-first.** Reach for an existing CSS variable before any literal.
- **Dark mode = two blocks** (see §6). Forgetting the `prefers-color-scheme` twin is the most common visual regression.
- **One primary action per surface.** Everything else is ghost/secondary.
- **Match the neighbors.** Reuse existing classes before inventing new ones.
- **Sidebar scope trick.** The sidebar overrides `--surface`, `--text`, `--border`, etc. inside `#workspace-sidebar` so all child components automatically pick up dark values without per-rule overrides.
