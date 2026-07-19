# Future Development Ideas

Loose ideas for evolving [schleising.net](https://www.schleising.net) — not a committed roadmap. Mix of polish on what already exists and bigger new bets. Pick whatever feels worth the time.

---

## Updates to existing areas

### Account & access

- Finish the password → passkey migration story: retire `hashed_password`, drop migrate UI once no legacy accounts remain, and update design docs that still assume the old model.
- Finer-grained privileges beyond `can_use_tools` / `can_use_overseerr` (e.g. per-webapp or per-tool flags) if more people ever get accounts.
- Passkey management UX: rename credentials, see last-used, revoke from a phone that was lost.
- Session / device list (“signed in on…”) with remote revoke.
- Optional TOTP or recovery codes as a belt-and-braces path alongside email recovery.
- Audit log of privilege changes and nginx-auth denials for the tools/Overseerr gates.

### Football — Premier League

- Restore PL as the default football entry once World Cup 2026 ends (home link, left nav, `/football/` redirect, PWA `start_url`) — already noted as intentional post-tournament cleanup.
- Season archive browsing (past seasons’ tables, results, H2H) without relying only on the chatbot History API.
- Richer stats surfaces: form streaks, goal difference trends, referee / venue filters if the API data supports them.
- Better mobile PWA install and offline-ish recent scores cache.
- Push notification preferences: per-team goal alerts vs kick-off vs final whistle; quiet hours.
- Betting page polish: clearer coupling to live match state, and a thin design note so the Go service doesn’t stay a black box.

### Football — World Cup

- Post-tournament “museum mode”: freeze 2026 as historic, keep bracket/TV/stadium pages readable without live polling.
- Reusable tournament shell for future competitions (Euros, Club World Cup, etc.) instead of a one-off WC stack.
- Compare editions (e.g. England path 1966 vs 2022 vs 2026) using the historic import data already in place.
- Export bracket / group tables as image or PDF for sharing.
- Reconcile `Football-API-Rate-Limiting.md` with the limiter that already ships in the backend; keep or drop the temporary request-logging flag deliberately.

### Feeds

- Close the requirements ↔ test matrix gaps (reqs ~84–98) and promote more IT cases off the “manual / not run” list.
- Reader enhancements: full-text extract where feeds are truncated, reading time estimates, “mark all below as read”, saved-for-later that outlives the 7-day recently-read window.
- Smart refresh: per-feed cadence based on update history; backoff for dead hosts; admin visibility into fetch errors.
- Shared / family subscriptions with separate read state per user.
- Metrics the feeds README already hints at: fetch success rate, queue depth, retention purge counts.
- Rate limits on subscription writes and OPML import size, as a hardening pass.
- Bring the feeds README “extension plan” language in line with what already shipped (search, etc.).

### Blog & markdown

- Draft / publish workflow with scheduled publish.
- Tags, series, and a simple archive index beyond a flat list.
- Markdown editor: autosave, conflict detection, image upload to a media store, and “publish to blog” as a first-class action.
- Atom/RSS feed of blog posts for the feeds reader (eat your own dogfood).

### Aircraft / OpenSky

- Live map view (positions over time) alongside the existing lookup / autocomplete.
- Watchlists with alerts when a tail number appears.
- Richer aircraft history pages (flights seen, last spotted).

### Home tools (converter, transcoder, monitor, logger, media)

- Unified tools dashboard: one status page for queues, host services, and recent failures instead of hopping between converter / transcoder / media.
- Monitor: alerting thresholds (email or push) when sensors leave a band; multi-day / multi-sensor comparison presets.
- Logger: tags, export CSV, recurring event templates.
- Media queue: clearer job history, retry, and cancel; less reliance on opaque `host.docker.internal` behaviour.
- Astronomy: expand beyond sunrise/sunset (moon phase, ISS passes, simple sky chart for the home location).

### Webapps hub & home lab

- Health badges on the webapps page (up / down / auth required) using cheap probes.
- Grouping and favourites so Plex / *arr / NAS / Pi-hole don’t feel like a flat list.
- Document the nginx-auth + Overseerr onboarding path as a short user-facing guide, not only design notes.

### Platform & quality

- Broader automated coverage outside feeds and World Cup (PL UI smoke tests, account flows, tools WS).
- Restore or vendor `shared/football` sources cleanly if the working tree is still bytecode-only.
- Structured logging / light metrics for FastAPI + backend workers (even a simple `/metrics` scrape).
- Dependency and image update cadence; pin review for FastAPI / Motor / webauthn bumps.
- Local “full stack” compose profile that mirrors production nginx-auth more closely for non-feeds features.

---

## Completely new areas

Greenfield sections of the site — new domains, not dashboards that stitch together football / feeds / tools / lab apps. Each could earn its own nav entry and URL prefix.

### Learning & practice

- **Flashcards / spaced repetition** — decks you own, SM-2 or similar scheduling, keyboard-first review UI.
- **Language drills** — vocab lists, cloze deletions, listening clips you upload; progress per language.
- **Coding kata runner** — paste a problem, submit solutions, keep a personal streak and solution archive (offline-friendly, no leetcode scrape required).
- **Course notebook** — structured notes for a book or MOOC you’re working through: modules, checkboxes, “next session” bookmark.

### Money & life admin (private)

- **Budget / envelope tracker** — categories, monthly caps, simple CSV import from a bank export; no bank login integration required.
- **Subscription ledger** — recurring costs, renewal dates, “cancel candidates” sorted by annual waste.
- **Warranty & purchase log** — what you bought, where, serial numbers, expiry of guarantee.
- **Bill calendar** — upcoming payments with reminders (email or site notification), separate from any sports calendar.

### Health & habits (keep it light)

- **Habit streak board** — daily check-ins with a brutalist/minimal calendar heat map; no social features.
- **Workout log** — sets/reps or time-on-feet, PRs, simple charts; import from a CSV if you already track elsewhere.
- **Sleep / mood check-in** — one-tap evening score with optional note; weekly trend only.
- **Recipe box** — ingredients, method, tags (“weekday”, “batch cook”); shopping list generated from checked recipes.
- **Pantry / freezer inventory** — what’s in stock, use-by dates, “cook from what we have”.

### Creative & making

- **Sketch / doodle pad** — canvas with layers saved to your account; export PNG.
- **Music practice log** — pieces, tempos, recordings upload, “bars that need work”.
- **Chord / scale reference** — interactive fretboard or keyboard diagrams you can bookmark sets of.
- **Writing room** — long-form private drafts with word targets and distraction-free mode (not the public blog).
- **Prompt / idea garden** — random stimulus cards for writing, drawing, or side projects when you’re stuck.

### Knowledge & reference

- **Personal wiki** — linked pages, backlinks, full-text search; garden of notes that isn’t chronological like a blog.
- **Decision journal** — record choices, expected outcomes, revisit later and score yourself.
- **Reading list / book shelf** — to-read, reading, finished, ratings, quotes; optional ISBN lookup.
- **Quote wall** — lines you want to keep, tagged and searchable.
- **How-I-did-it runbooks** — personal ops manuals (“replace disk in NAS”, “renew domain”) as checklist pages.

### Local & outdoors

- **Walks & rides** — GPX upload, distance/elevation, gallery of route maps; no aircraft overlap required.
- **Places database** — cafes, viewpoints, parking tips; private ratings and “take visitors here”.
- **Tide / surf / weather desk** — location-centric marine or hill weather if that matches hobbies (Met Office / Admiralty style data).
- **Garden planner** — beds, what you planted when, harvest notes, frost dates for your postcode.
- **Stargazing planner** — dark-sky windows, planet visibility, meteor showers (broader than today’s sunrise tool).

### Games & playful toys

- **Crossword / word game host** — daily puzzle you generate or import; shared solve with household accounts.
- **Board game library** — games you own, plays logged, “who taught whom”, random picker weighted by time since last play.
- **Chess / puzzle arena** — tactics trainer backed by a puzzle DB you curate; ratings optional.
- **Escape-room style text adventures** — short browser adventures you write for friends/family logins.
- **Bingo / scorecard generator** — for trips, weddings, Christmas films, etc.

### Family & social (small circle)

- **Shared shopping / todo lists** — realtime enough for two people in a supermarket; passkey accounts only.
- **Gift idea bank** — per person, with “already given” history across years.
- **Family recipe inheritance** — scanned cards + typed versions, attribution to whose handwriting.
- **RSVP / mini event pages** — private links for a BBQ or games night (who’s coming, what they’re bringing).
- **Kid activity roulette** — rainy-day activity picker with age tags and indoor/outdoor flags.

### Collecting & hobbies

- **Stamp / coin / card inventory** — catalog with photos, condition, value estimates you enter.
- **Wine / whisky cellar** — bottles, ratings, “drink before”, cellar location.
- **Plant / aquarium log** — species, water changes, dosing, photos over time.
- **Model / maker project tracker** — BOM, hours, next step, reference links for scale models or electronics builds.
- **Film photography roll tracker** — camera, stock, frames, scan links, which roll is still in the camera.

### Utilities people actually open weekly

- **Unit / timezone / colour converter** — ugly-useful pocket tools page with shareable URLs for a result.
- **Regex & JSON playground** — private history of snippets you reuse.
- **QR / vCard generator** — for guests on home Wi‑Fi or event check-in.
- **Countdown / milestone pages** — public or private “days until…” with a clean full-bleed design.
- **Random decision helpers** — weighted coin flips, team picker, “what should we watch” from a list you maintain.

### Civic / curiosity (public-friendly)

- **Election / local council tracker** — your ward, upcoming consultations, how you voted last time (private).
- **Planning application watch** — postcodes you care about; weekly digest of new applications.
- **Historical maps overlay** — old OS sheets vs modern for places you know.
- **Name / etymology toys** — surname maps, place-name meanings, lightly academic and fun.
- **Public domain bookshelf** — curated host of texts you like (Project Gutenberg style), reader UI of your own.

### Weird / experimental (high novelty)

- **Generative art gallery** — server-side or client canvas pieces with seed URLs you can favourite.
- **Soundboard / ambient mixer** — rain + café + fire layers; save presets.
- **One-pixel / tiny social** — absurdly constrained guestbook or pixel canvas for logged-in users.
- **Time-capsule messages** — write to future-you; unlock on a date.
- **Dream log** — morning capture with tags and fuzzy search; no analysis claims, just a vault.
- **Contraption simulator** — small physics or logic toys (Rube Goldberg lite, circuit sandbox) as a playground section.

---

## How to use the new-areas list

- Prefer ideas you’d open **on their own** even if football and feeds disappeared.
- A good candidate usually needs: one clear URL (`/recipes/`, `/wiki/`, `/walks/`), its own data model, and a reason to return weekly.
- Ignore anything that only exists to summarise other apps on the site — those belong under “updates to existing areas”, not here.

Treat this file as a menu, not a backlog commitment. Strike through or delete ideas as they ship or get rejected.
