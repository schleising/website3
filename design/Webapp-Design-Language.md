# Design Language: Standalone Webapps

**Status:** Reference (Converter as source of truth)  
**Audience:** New and existing **standalone webapps** on `*.schleising.net` (tools hosts and similar PWAs).  
**Out of scope:** The main marketing / account site (`www.schleising.net`) and pages that intentionally extend the site `base.html` chrome (today: Feeds, Units, Football). Those keep the blue site shell until/unless they become standalone hosts.

Converter (`converter.schleising.net`) is the **canonical** expression of this language: a full-viewport native-style shell, not a short webpage. Other standalone tools (Monitor, Transcoder, Logger, Astronomy, …) should converge on it over time rather than invent a parallel system.

---

## 1. Goals

A webapp should feel like a **native app** installed on the device — a focused instrument that owns the whole screen — not a scrollable webpage that ends halfway down, and not a dashboard of cards.

- **Full-bleed frame** — the UI always fills the viewport (`100%` / `100dvh`), even when there is little or no content. Empty space belongs *inside* the app chrome (panels, washes), never as bare document leftover below a short page.
- **Brand first** — product name is the hero of the first viewport.
- **Calm density** — one job per section; one primary action group in the top bar.
- **Atmospheric, not flat** — soft paper gradients and tinted radial washes; frosted surfaces that extend through the full height.
- **Readable in light and dark** — theme tokens, not hard-coded greys.
- **Installable** — PWA-ready (manifest, icons, theme-color, standalone display, optional SW shell cache).

Non-goals:

- Matching `www` blue brand / `base.css` tokens.
- Document-flow layouts that shrink to content height and leave empty browser canvas below.
- Purple / indigo “AI default” themes, cream+terracotta brochure looks, or dense broadsheet layouts.
- Decorative card grids in the hero, floating badges, or stat strips that compete with the brand.

---

## 2. Reference implementation

| Piece | Location |
| ----- | -------- |
| Tokens + layout + components | `website/static/css/tools/converter/main.css` |
| Shared `@font-face` | `website/static/css/tools/fonts.css` |
| Page shell | `website/templates/tools/converter/converter.html` |
| Theme persistence | `website/static/js/tools/converter/theme-toggle.js` |
| Mobile chrome height sync | `website/static/js/tools/converter/page-layout.js` |

When this document and Converter disagree, **update the document** after changing Converter — do not silently fork another app’s palette.

---

## 3. First viewport & brand

```text
┌─────────────────────────────────────────────┐
│  Converter                    ●  ☾  Subscribe│
│  (huge display title)                       │
│─────────────────────────────────────────────│
│  [optional live stage — only when relevant] │
│─────────────────────────────────────────────│
│  Activity …                                 │
└─────────────────────────────────────────────┘
```

Rules:

- **Brand test:** remove the nav/actions; the first viewport must still be recognisably this product. The display title carries the brand, not a tiny eyebrow alone.
- First viewport budget: brand, at most one short supporting line if needed, one action cluster (theme / subscribe / status), and at most **one** live/primary working surface. No KPI strips or secondary promos in the hero.
- Prefer **hiding** empty live stages (`hidden`) over placeholder skeletons that look like content.
- Do not overlay detached chips, promo stickers, or floating badges on hero media.

---

## 4. Colour tokens

Define semantic CSS variables on `:root` and override the same names under `body.dark-mode` (and `html.dark-mode` for root background). Apps may retint **accent** slightly for identity, but keep the **ink / paper / surface / line** structure and the cool green-teal family unless there is a strong product reason (e.g. Astronomy’s night mode is a documented exception, not the default for new apps).

### 4.1 Light (Converter)

| Token | Value | Role |
| ----- | ----- | ---- |
| `--ink` | `#12201c` | Primary text |
| `--ink-muted` | `#5a6b64` | Secondary text, kickers’ companions |
| `--paper` | `#e8efe9` | Page wash start |
| `--paper-deep` | `#d5e0d7` | Page wash end / html fallback |
| `--surface` | `rgba(255, 255, 255, 0.72)` | Frosted panels |
| `--surface-strong` | `rgba(255, 255, 255, 0.92)` | Buttons, stronger plates |
| `--line` | `rgba(18, 32, 28, 0.12)` | Hairlines |
| `--line-strong` | `rgba(18, 32, 28, 0.2)` | Borders on controls |
| `--live` | `#0f8f7a` | Accent / active / progress |
| `--live-deep` | `#0a6b5c` | Accent text, kickers |
| `--live-soft` | `rgba(15, 143, 122, 0.12)` | Soft fills, pills |
| `--saved` | `#1b8a4f` | Positive / success metric |
| `--saved-soft` | `rgba(27, 138, 79, 0.12)` | Success wash |
| `--queue` | `#b56a12` | Waiting / warning-adjacent |
| `--queue-soft` | `rgba(181, 106, 18, 0.14)` | Queue wash |
| `--danger` | `#b42318` | Errors |
| `--danger-soft` | `rgba(180, 35, 24, 0.1)` | Error wash |
| `--shadow` | `0 18px 40px rgba(18, 32, 28, 0.08)` | Soft elevation |

### 4.2 Dark (Converter)

| Token | Value |
| ----- | ----- |
| `--ink` | `#e8f2ec` |
| `--ink-muted` | `#9bb0a5` |
| `--paper` | `#0d1512` |
| `--paper-deep` | `#09100d` |
| `--surface` | `rgba(22, 34, 29, 0.88)` |
| `--surface-strong` | `rgba(30, 44, 38, 0.95)` |
| `--line` | `rgba(232, 242, 236, 0.1)` |
| `--line-strong` | `rgba(232, 242, 236, 0.18)` |
| `--live` | `#2dceb2` |
| `--live-deep` | `#1aa991` |
| `--live-soft` | `rgba(45, 206, 178, 0.14)` |
| `--saved` | `#4ad48a` |
| `--queue` | `#e0a24a` |
| `--danger` | `#ff7a6e` |
| `--shadow` | `0 18px 40px rgba(0, 0, 0, 0.35)` |

### 4.3 Theme-color / OS chrome

Keep `meta theme-color` in sync with paper:

- Light: `#e8efe9` (`--paper`)
- Dark: `#0d1512` (`--paper`)

Also set `document.documentElement.style.backgroundColor` and `color-scheme` so overscroll / browser chrome do not flash the wrong plate.

---

## 5. Typography

| Role | Token / face | Usage |
| ---- | ------------ | ----- |
| Display | `--font-display`: **Schibsted Grotesk** | Brand title, section titles, pills, primary buttons, KPI values |
| Body | `--font-body`: **Inter** | Facts, secondary copy, popovers |

Load faces via shared `fonts.css` (do not re-declare `@font-face` per app).

### Scale (Converter reference)

| Element | Treatment |
| ------- | --------- |
| Brand title | `clamp(2.4rem, 6vw, 3.4rem)`, weight 800, tracking `-0.06em`, line-height ~0.92 |
| Section title | ~`1.35rem`, weight 750, tracking `-0.03em` |
| Section / brand kicker | `0.68rem`, weight 700, uppercase, tracking `0.14em`, colour `--live-deep` |
| Control labels | ~`0.8–0.84rem`, weight 700, display face |
| Muted facts | body face, `--ink-muted`, tabular nums where values compare |

Avoid Inter/Roboto as the **display** face for new work; older tools still on Roboto/Inter should migrate toward Schibsted + Inter when restyled.

---

## 6. Atmosphere & surfaces

### Page background

Layered wash (not a flat fill):

1. Soft radial of `--live` (top-left, low opacity)
2. Soft radial of `--queue` / warm accent (top-right, lower opacity)
3. Linear gradient `--paper` → `--paper-deep` (~165°)

Dark mode uses the same structure with darker papers and brighter accent radials at lower strength.

### Panels

Primary content blocks (live stage, activity, dialogs):

- `background: var(--surface)`
- `border: 0.0625rem solid var(--line)`
- `border-radius: var(--radius-lg)` (~`1.35rem`)
- `box-shadow: var(--shadow)`
- Optional `backdrop-filter: blur(10px)`

Radii scale: `--radius-lg` panels, `--radius-md` inner plates, `--radius-sm` tight chips. Prefer **999px** pills for controls, not large rounded “cards” for every metric.

### Cards policy

- Default: **no cards**. Rows and sections are enough.
- Cards only when they bound a clear interaction (e.g. a dialog panel, a selectable tile).
- If removing border/shadow/radius does not hurt understanding, remove them.
- Never put a card around the hero brand.

---

## 7. Layout shell

### Native app frame (required)

Treat the viewport as the app window. Designs must assume **sparse content is common** (empty queue, connecting, idle) and still look complete.

| Do | Don’t |
| -- | ----- |
| Lock `html` / `body` to `height: 100%` / `100dvh` with a painted paper wash | Let the body grow only as tall as its children |
| Use a flex column `.shell` that fills the viewport (`flex: 1`, `min-height: 0`) | End the layout after the last widget and leave grey/white void under it |
| Stretch the primary panel to consume remaining height | Size panels to “hug” a short list |
| Scroll **inside** lists / detail panes | Scroll the whole document as the default (except deliberate mobile PTR chaining) |
| Put empty/connecting copy *inside* the stretched panel | Show a short centred message floating on the page background with no frame |

Manifest / meta should reinforce the illusion: `"display": "standalone"` (or `display_override`), matching `theme-color` / status bar, and no browser-like page margins outside the shell gutters.

### Desktop

```text
html/body  →  height 100% / 100dvh, overflow hidden (app canvas)
  .shell   →  column flex, fills viewport, max-width 72rem, centred, padding 1rem
    .page-chrome  →  topbar (+ optional live stage), flex-shrink 0
    .main-scroll  →  flex 1, min-height 0, overflow hidden
      primary panel flex 1 → fills remaining height even if list is empty
      inner list scrolls only when overflow exists
```

- Side and bottom padding match the **shell gutter** (`1rem` on desktop). Bottom does **not** grow when side margins appear from centering on ultra-wide viewports.
- Prefer pinning chrome and scrolling **lists inside** panels over scrolling the whole page.
- Wide gutters outside the centred `72rem` shell still show the **same paper wash** as the app — never a different document colour that reveals “website behind the app”.

### Mobile (≤ ~44rem)

- Fixed `.page-chrome` (topbar + live stage) with background matching the page wash.
- Sync chrome height into `--page-chrome-height` (see `page-layout.js`) and pad `.shell` top accordingly.
- Shell height `100dvh`; primary panel fills remainder **whether or not** the list has rows; list scrolls inside.
- Preserve native **pull-to-refresh** where possible: list `overscroll-behavior-y: auto` so a pull at scroll-top can chain to the document.
- Bottom gutter matches side gutter (`0.65rem`) plus `env(safe-area-inset-bottom)`.

### Safe areas

Account for notch / home indicator on padding and fixed chrome. A thin `body::after` can paint the bottom safe-area in the paper colour so OS chrome does not show a foreign colour.

---

## 8. Core components

### Top bar

- Brand block left: optional kicker + **large** brand title.
- Actions right: connection/status affordance, theme switch, primary text button (e.g. Subscribe).
- Status as a **small coloured dot** (online / connecting / offline) with `aria-label` / `title`, not a verbose banner.

### Kickers & section titles

- Kicker: uppercase micro-label in `--live-deep`.
- Title: display face; one purpose per section.

### Segmented control

Pill track (`--line` border, soft fill) with active segment as solid surface + light shadow. Dark mode active segment uses a muted green plate, not pure white.

### Count / value pills

Soft `--live-soft` fill, `--live-deep` text, tabular nums, pill radius.

### Primary / secondary buttons

Pill shape, `--surface-strong`, `--line-strong` border, display face, slight lift on hover (`translateY(-1px)`), accent border on hover. Disabled → reduced opacity, no lift.

### Theme switch

Dedicated track + thumb control (sun/moon), not a generic checkbox. Persist per-app key in `localStorage` (e.g. `converter.theme`); honour `prefers-color-scheme` when unset.

### Dialogs

Native `<dialog>` with frosted panel, shared radii/borders. Lazy-mount heavy inner DOM when first opened if the content is costly.

### Lists / rows

- One composition per row: identity (optional media), title + facts, trailing metric.
- Media slots: fixed aspect (e.g. posters **2:3**), size by **width**, height from `aspect-ratio` — do not stretch the slot to row height (that creates letterboxing when width grows).
- Prefer `object-fit: contain` for artwork that must not crop.
- Decorative images: empty `alt`, `loading="lazy"`, `decoding="async"`.

### Empty / connecting states

Short centred status copy **inside** the already full-height primary panel (“Connecting…”, “Nothing in the queue”). The panel and page wash still fill the viewport — emptiness is a state of the instrument, not a short webpage.

Do **not** flash fake skeleton cards that look like real rows. Do **not** collapse the shell so the browser canvas shows below the message.

### Progress

Native `<progress>` restyled with accent gradient fills; track uses a quiet line wash.

---

## 9. Motion

Ship a few intentional motions; avoid noise.

| Pattern | Guidance |
| ------- | -------- |
| Row enter | Short stagger (~30ms) fade/slide, respect `prefers-reduced-motion` |
| Hover | 140–160ms ease on colour, border, slight translate |
| Theme | Instant token swap (no long page fade) |
| Live updates | Patch text/attributes in place; avoid full list remount when only art/status changes |

Do not: continuous glows, parallax stacks, or attention-seeking pulses on idle UI.

---

## 10. Console & quiet runtime

User-facing JS should log **warnings and errors only**. No “opening websocket”, “registering service worker”, or per-row debug spam in production paths.

---

## 11. PWA & assets

- Per-host `server_name` with tools auth as today.
- Manifest + icons under `static/manifests/…` and `static/icons/…`.
- **Cache-bust** immutable assets with dated filenames or query versions (`main.css?v=…`, `…-20260725.svg`).
- Service worker may warm an app shell; bump cache version when shell URLs change.
- `theme-color` / Apple status bar updated with theme toggle.

---

## 12. Anti-patterns

- Short content-height pages with empty browser canvas underneath (“looks like a website”).
- Hugging panels that collapse when lists are empty instead of filling remaining height.
- Flat single-colour page backgrounds.
- Default system stacks (Inter/Roboto/Arial) as the brand display face.
- Purple-on-white or purple→indigo gradient themes.
- Warm cream paper + terracotta + high-contrast serif brochure look.
- Dense newspaper columns / zero-radius broadsheet chrome.
- Hero built from inset media cards, collages, or floating image tiles.
- Stats, schedules, or secondary marketing in the first viewport.
- Multi-layer drop shadows and glow-as-identity.
- Emoji as UI ornament.
- Verbose connection banners when a status dot will do.
- Stretching poster/media slots to full row height while using `object-fit: contain` (width-only growth → empty side gutters).

---

## 13. Adoption checklist (porting another webapp)

Use when restyling Monitor, Transcoder, Logger, Astronomy, or a new tools host:

1. [ ] Standalone HTML shell (not `base.html`) on its own host; `"display": "standalone"` in the manifest.
2. [ ] Viewport-locked frame (`100dvh` / flex shell) — full height even with empty content; no document leftover below.
3. [ ] Link `fonts.css`; set `--font-display` / `--font-body` to Schibsted + Inter.
4. [ ] Copy Converter semantic colour tokens (light + dark); retint accent only if needed.
5. [ ] Page wash = dual radials + paper gradient; panels = frosted surface + line + radius-lg (panels stretch to fill).
6. [ ] Brand title is hero-scale in the top bar; kickers uppercase micro-labels.
7. [ ] Theme toggle with `localStorage` + `theme-color` sync.
8. [ ] Desktop: pinned chrome, panel fills height, list scrolls inside.
9. [ ] Mobile: fixed chrome + `--page-chrome-height`; preserve PTR if the app relies on it.
10. [ ] Segmented controls / pills / primary buttons match Converter geometry.
11. [ ] Quiet console; empty states inside the full-height panel (no fake cards, no collapsed shell).
12. [ ] Manifest, icons, SW shell versioning aligned with Converter practice.

---

## 14. Per-webapp adoption

Status relative to this language. Converter is the reference; others list concrete work to converge.

### 14.1 Converter — reference (nearly complete)

Canonical host: `converter.schleising.net`.

| Area | Status |
| ---- | ------ |
| Fonts, ink/paper tokens, wash, frosted panels | Done |
| Hero brand, kickers, segmented + count pills | Done |
| `100dvh` shell, mobile fixed chrome + `page-layout.js` | Done |
| Dark mode + theme-color sync, quiet console, SW shell cache | Done |

**Remaining polish**

- [ ] Align initial HTML `theme-color` / Apple meta with `--paper` (`#e8efe9` / `#0d1512`) so first paint matches JS.
- [ ] Update `converter-*.webmanifest` `theme_color` / `background_color` away from legacy blue (`#d7edf7` / `#ebf6fc`) to paper tokens.
- [ ] Paint light-mode `body::after` safe-area strip with paper (dark mode already does).
- [ ] Optional: extract shared `webapp-tokens.css` / `webapp-shell.css` once another app adopts (§15).

---

### 14.2 Monitor

**Current feel.** Cool mint/sky sensor dashboard with sticky header and a grid of chart cards. Closer to Converter than Logger, but still a content-tall webpage with Inter/Roboto and a parallel HSL token system.

**Key paths:** `templates/tools/monitor/monitor.html`, `static/css/tools/monitor/monitor.css`, `static/js/tools/monitor/theme-toggle.js`, `monitor.js`, `fonts.css`, `manifests/tools/monitor/…`, `static/tools/monitor/sw.js`.

**Gaps**

- Fonts: Inter display / Roboto body (Schibsted loaded, unused).
- Tokens: `--bg-0` / `--panel` / `--accent` (HSL cyan), not `--ink` / `--paper` / `--live`; dark is blue-grey, not `#0d1512`.
- Shell: `min-height: 100%` / `100vh`, max-width `~118rem` — not locked `100dvh` flex fill; no `.shell` / `.page-chrome` / `.main-scroll` / `--page-chrome-height`.
- Brand: `h1` ~`1.5–2.2rem`; period + overlay controls sit in the hero row (crowds first viewport).
- Components: chart **cards** with hover lift; period toggle is near-segmented but not Converter geometry; no section kickers / count pills as specified.
- Dark mode: present (`monitor.theme`) but paper/`theme-color` values diverge; `prefers-color-scheme` on `:root` can fight class theme; no Apple status-bar sync.
- Mobile: sticky header only — not fixed chrome + shell padding + PTR/list overscroll pattern.
- PWA: standalone yes; manifest still `#edf2fd`; SW is push-only (no shell warm); SW register `console.log`s.

**Changes needed**

| Priority | Work |
| -------- | ---- |
| Must | Schibsted + Inter; map tokens to Converter semantics; viewport-locked flex shell; hero-scale brand; move period/overlays out of brand row into one working surface; quiet console; sync meta/`theme_color` to `--paper`. |
| Should | Restyle period control → `.segmented`; frosted `--surface` panels; inner scroll for chart stack; chrome height sync (`page-layout` pattern); refresh manifesto/icons; drop redundant `prefers-color-scheme` `:root` dark once class-driven theme wins. |
| Later | Shared tokens/shell CSS; optional SW shell precache; light-mode safe-area paint. |

---

### 14.3 Transcoder

**Current feel.** Light cyan single-job instrument. Idle empty panel is short, so the page hugs content and leaves browser canvas — the opposite of a native full-height frame. No dark mode.

**Key paths:** `templates/tools/transcoder/transcoder.html`, `static/css/tools/transcoder/main.css`, `transcoder.js` / `scope.js`, `fonts.css`, transcoder manifest + `static/tools/transcoder/sw.js`.

**Gaps**

- Fonts: Inter / Roboto.
- Tokens: cyan `--bg-*` / `--panel` / `--accent` — light only.
- Shell: not overflow-locked; empty state `min-height: ~14rem` — collapses when idle.
- Brand: `h1` ~`1.5–2rem`; `.hero-kicker` exists in CSS but unused in HTML; no topbar actions (theme / status).
- Components: nested key-value **mini-cards**; empty-state badge chip; solid gradient progress pill vs soft Converter pills; panels are gradient plates, not frosted `--surface` + blur recipe.
- Dark mode: absent.
- Mobile: padding tweaks only.
- PWA: standalone; stale `#edf2fd` theme; SW console spam; no shell cache.

**Changes needed**

| Priority | Work |
| -------- | ---- |
| Must | `100dvh` shell; idle + live panels stretch to remaining height; Schibsted + Inter + Converter tokens; dark mode + theme switch + paper `theme-color`; quiet console. |
| Should | Hero brand scale + brand kicker; flatten key-value into rows (not card grid); Converter progress / pills; empty state inside full-height panel (drop badge chip); add Subscribe/status if product needs them. |
| Later | Manifest/icon dating + SW shell warm; shared shell CSS. |

---

### 14.4 Logger

**Current feel.** Cyan brochure dashboard: hero copy + subtitle + “Tracked events” KPI card, then action card + activity grid. Own host/PWA, but first viewport and scrolling read as a webpage form, not a native instrument. No dark mode.

**Key paths:** `templates/tools/logger/logger-base.html` (+ `logger.html`, `stats.html`), `static/css/tools/logger/main.css`, `logger.js` / `stats.js`, logger manifest + SW.

**Gaps**

- Fonts: Inter / Roboto.
- Tokens: same tools-era cyan family.
- Shell: `.outer` is `height: 100%; overflow: auto` — **whole-page scroll**, not pinned chrome + inner list fill.
- Brand / first viewport: kicker + title + long subtitle + hero KPI card (violates budget); title ~`2.1rem`. Stats page repeats compact hero pattern.
- Components: action/hero-stat **cards**; solid accent gradient buttons (not surface pills); event grid is table-like; kickers don’t match size/tracking/`--live-deep`.
- Dark mode: none.
- Mobile chrome / PTR pattern: none.
- PWA: standalone; stale blue theme colours; SW `console.log`s.

**Changes needed**

| Priority | Work |
| -------- | ---- |
| Must | Clear KPI/subtitle from first viewport; hero brand title; Converter fonts + tokens; dark mode + theme toggle; viewport shell with activity as stretch panel + inner scroll; quiet console. |
| Should | Add-event as toolbar (not marketing card); pill buttons; Converter kickers/section titles on logger + stats; frosted panels. |
| Later | Popovers → frosted `<dialog>`; shared tokens; manifest/icon refresh. |

---

### 14.5 Astronomy

**Current feel.** Night-sky specialist with dark / stargazing dual theme and a card grid over a scrollable page. Strong product mood, but typography/tokens/shell diverge from Converter; warm stargazing palette is a deliberate night identity (allowed as an exception) and should not become the default for other apps.

**Key paths:** `templates/tools/astronomy/astronomy.html`, `static/css/tools/astronomy/main.css` only (no `fonts.css`), `theme-toggle.js`, `main.js`, `manifests/tools/astronomy/astronomy.webmanifest`.

**Gaps**

- Fonts: Roboto / system — **no** `fonts.css`.
- Tokens: `--bg` / `--panel` / `--accent`; stargazing warm ember; “dark” is navy slate (`#0f213a`), not Converter paper. Toggle is **dark ↔ stargazing**, not light ↔ dark; `color-scheme` always dark.
- Shell: content-height `.app-shell`; document scrolls; no `100dvh` fill / pinned chrome / `--page-chrome-height`.
- Brand: “Astronomical Data” at ~`1.6–2.4rem` — fails brand test; location card occupies early viewport ahead of sky.
- Components: default **cards** (`.card`, controls, sun/moon); squared gradient buttons; no segmented / count-pill language.
- PWA: standalone + `display_override`; theme colours are navy, not a dual paper system; uses generic tools SW.

**Changes needed**

| Priority | Work |
| -------- | ---- |
| Must | Link `fonts.css`; Schibsted + Inter; viewport shell (pin chrome, stretch primary sky surface, scroll inside); hero-scale brand (“Astronomy”); one primary working surface (sky / live data). |
| Should | Keep stargazing as documented night accent *or* retint toward cool greens that still share `--ink`/`--paper` structure; consider a true light/day mode; reduce card chrome to sections/rows; Converter-like controls + theme-switch geometry; align `theme-color` with chosen tokens. |
| Later | Encoded night-mode override set in shared tokens; AR/fullscreen polish under the same surface language. |

---

### 14.6 Feeds, Units, Football — site-embedded (deferred)

These extend `base.html` / www blue chrome (`feed-base.html`, units templates, `football-base.html`). **Out of scope** while they remain embedded.

If a host ever becomes standalone (`feeds.…` / `units.…` already are web-app-capable in places, but still site-skinned), apply §13 in full: drop site header/nav, adopt Schibsted + Inter + ink/paper (or a deliberate product accent that still uses the same token *structure*), `100dvh` shell, theme toggle, frosted panels, retarget manifests away from site blues (`#eef4ff` / `#2a5b90`).

Do **not** force this language onto pages that stay inside the www shell.

---

## 15. Future extraction (optional)

When two or more apps fully adopt this language, consider:

- `website/static/css/tools/webapp-tokens.css` — shared `:root` / `.dark-mode` variables  
- `website/static/css/tools/webapp-shell.css` — `.shell`, `.topbar`, kickers, theme switch, segmented, pills  

Keep app-specific layout and domain components local. Do not force Feeds/Units/Football onto this stack while they remain embedded in the www chrome.

---

## 16. Related docs

- Converter feature / as-built: `design/Converter-Cover-Art.md`
- Fonts: `website/static/css/tools/fonts.css`
- Site (www) tokens — **different system**: `website/static/css/base.css`
