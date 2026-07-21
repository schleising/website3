# Premier League Season Rollover — 2025/26 Historic → 2026/27 Live

Status: **Phase 1 implemented** — deploy / worker restart still manual (Phase 2)  
Date: 2026-07-20  
Scope: Freeze the 2025/26 Premier League season as historic; seed and cut over to 2026/27 fixtures and table from football-data.org; crest audit; team-ID clash handling (prefer football-data.org IDs)

Related:

- `design/Football-API-Rate-Limiting.md` — API spacing; crests are **not** downloaded by the live worker
- `design/World-Cup.md` §7.3.1 — two-tier team ID strategy (same principle for PL historic vs live)
- `website/football/db_names.py` — `pl_database` / `web_database` split
- Auth token: `backend/src/secrets/football_api_token.txt` (existing worker secret; do not commit)

---

## 0. Operations constraints (this environment)


| Constraint                   | Rule                                                                                                                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App / worker host**        | The football website and backend worker do **not** run on the machine used for coding. **Deploy and worker/bet restarts are manual** — the agent must not assume a local restart will take effect. After code lands, hand off: deploy + restart worker (+ bet) on the real host. |
| **MongoDB**                  | Live data is on `**macmini2`**. Agent may make DB changes there (audits, remaps, drops of `live_pl_table`, etc.) when implementing.                                                                                                                                              |
| **football-data.org probes** | Allowed from this machine for prep/audit. **≥ 4 s between API calls** (same as the live worker limiter). Token: `backend/src/secrets/football_api_token.txt` — never commit.                                                                                                     |


---

## 1. Goal

After the 2025/26 Premier League season has finished:

1. **Historic freeze:** `2025_2026` match and table data stay readable in the season archive UI, with no further worker writes.
2. **New season live:** `2026_2027` fixtures and standings come from football-data.org and become the site’s current season (live scores, live table, notifications, bet service).
3. **Crests:** ensure every 2026/27 club has a local crest under `/images/football/crests/` (download offline if missing).
4. **Team IDs:** detect clashes between football-data.org IDs for 2026/27 and historic Mongo data; **prefer the football-data.org ID** for the live club and remapping historic conflicts.

Out of scope for this rollover:

- Changing how historic Division 1 seasons are labelled or imported
- Building the Future-Development “season archive browsing” UX beyond what already exists
- Re-enabling World Cup API polling

---

## 2. Current state (what we cut over from)

### 2.1 Databases and collections

All PL match/table data lives in MongoDB `pl_database` (after `scripts/migrate_football_databases.py`).


| Collection                                        | Role today                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `pl_matches_2025_2026`                            | Current-season fixtures (website + backend + bet hard-wire this name)    |
| `pl_table_2025_2026`                              | Official daily standings snapshot (backend writes)                       |
| `live_pl_table`                                   | Live standings overlay for SSR / WebSocket (singular — always “current”) |
| `pl_matches_{YYYY_YYYY}` / `pl_table_{YYYY_YYYY}` | Historic seasons discovered by listing `pl_matches_*`                    |
| `pl_team_primary_colours`                         | Kit colours keyed by `team_id` (cross-season)                            |


Still in `web_database`: `football_push_subscriptions`, `football_chatbot_api_keys`.

### 2.2 Hardcoded “current season” bindings

These must all move together:


| Location                            | What is hardcoded / derived                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `website/football/db_names.py`      | `CURRENT_PL_SEASON = "2026_2027"`; collection name helpers                                         |
| `website/football/__init__.py`      | `pl_matches_{CURRENT_PL_SEASON}`; `live_pl_table`                                                  |
| `backend/src/football/pl_season.py` | Season key; July–June match window; standings clamp `2026-08-25` (day after all clubs’ first game) |
| `backend/src/football/__init__.py`  | `pl_matches_*` / `pl_table_*` from `pl_season`; `live_pl_table`                                    |
| `bet/src/database.go`               | `CURRENT_PL_SEASON`; `pl_matches_` + season; `live_pl_table`                                       |


Website **discovery** of seasons is dynamic (`get_available_season_keys()` lists `pl_matches_`* in `pl_database`). “Current” for UI is `infer_current_season_key()` → `**CURRENT_PL_SEASON`** (rollover constant). That alone does **not** retarget the worker; website / backend / bet constants must change together.

### 2.3 Crest resolution

`Team.local_crest` maps the football-data.org crest URL basename to a local file, **preferring SVG**:

- API crest `…/64.svg` → serve `/images/football/crests/64.svg`
- API crest raster (`…/bournemouth.png`, gif/jpg/…) → serve `/images/football/crests/{stem}.svg` when that file exists, otherwise the raster filename
- Missing → `unknown_team.svg`

Assets live under `website/static/images/football/crests/`. Store **SVG where possible**; keep PNG/GIF/JPG only when no SVG exists. The live worker must **not** download crests (`Football-API-Rate-Limiting.md`).

### 2.4 Team ID surfaces that clash can break


| Surface                       | Risk if the same `team.id` means two different clubs   |
| ----------------------------- | ------------------------------------------------------ |
| Team cache / H2H / team pages | Last write wins across all seasons                     |
| Crest filename `{id}.svg` / `{id}.png` | Wrong badge |
| `pl_team_primary_colours`     | Wrong colour                                           |
| Push `team_ids`               | Wrong club’s alerts                                    |
| Bet service                   | Reads embedded team objects from current matches/table |


Historic seasons already mix football-data.org IDs (clubs that were / are in the live catalogue) with project-owned or named crest files for older Division 1 clubs — same idea as WC tier A / tier B (`World-Cup.md` §7.3.1).

---

## 3. Target state


| Item                | Target                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Historic season key | `2025_2026` — frozen; selectable in season picker; no live WS                                                              |
| Live season key     | `2026_2027` — worker + website defaults + bet                                                                              |
| New collections     | `pl_matches_2026_2027`, `pl_table_2026_2027`                                                                               |
| Live overlay        | `live_pl_table` rebuilt for 2026/27 (replace contents)                                                                     |
| API                 | `GET /v4/competitions/PL/matches?dateFrom=&dateTo=` and `GET /v4/competitions/PL/standings/?date=` (existing worker paths) |
| Optional one-shot   | `GET /v4/competitions/PL/teams` for crest/ID audit (not needed for ongoing worker)                                         |


Season window (confirmed from football-data.org probe, 2026-07-20 — competition `currentSeason` id **2502**):


| Field                                       | Value                                                |
| ------------------------------------------- | ---------------------------------------------------- |
| API `startDate` / first kickoff             | **2026-08-21**                                       |
| API `endDate` / last match                  | **2027-05-30**                                       |
| Matches in window `2026-07-01`→`2027-06-30` | **380** (all scheduled; 0 played at probe time)      |
| Standings pre-season clamp `date=`          | **2026-08-25** (day after **all** clubs’ first game) |


**Standings clamp rule (next rollover):** set `CURRENT_PL_STANDINGS_CLAMP_DATE` to **the day after every club has played their first match** of the new season (find the latest “first appearance” date across the 20 teams in the fixture list, then +1). Do **not** use `season.startDate` / first kickoff alone, and do **not** stop at “first matchday + 1” if later MD1 games exist — football-data.org can still serve the previous season’s table until all clubs have a new-season result row. For 2026/27: first kickoff 21 Aug; last MD1 games 24 Aug (Chelsea, Fulham) → clamp **25 Aug**.

Code date window for `get_season_matches` stays the July–June pattern: `2026-07-01` → `2027-06-30` (same shape as today’s bindings).

---

## 4. Approach overview

```text
1. Audit 2026/27 squad IDs + crests from API (read-only; ≥4s between calls)
2. Resolve team-ID issues on macmini2: §8.2 clashes (prefer football-data) + §8.3 same-club dual ids (historic → API)
3. Retarget code to CURRENT_PL_SEASON = 2026_2027
4. Hand off: deploy + restart worker (and bet) on the real host — not this machine
5. Offline crest download for any missing PNGs
6. Verify historic 2025/26 vs live 2026/27 UX (incl. unified Hull/Coventry H2H)
7. Soft: leave push subscription team_ids for relegated clubs; optional hard prune later
```

Prefer **code retarget + worker bootstrap** over a one-off full Mongo import for fixtures: the existing `Football.get_season_matches` / `get_table` path already upserts into the hardwired collections. A small **audit/seed helper script** is still useful for clash detection and crest gaps before cutover.

---

## 5. Freezing 2025/26 as historic

### 5.1 Data

- Leave `pl_matches_2025_2026` and `pl_table_2025_2026` in place.
- Confirm the final table snapshot is complete (worker already writes `pl_table_2025_2026` daily). If the season has just ended, run one last successful `get_table` **before** retargeting constants so the official snapshot is final.
- Do **not** delete or rename these collections.

### 5.2 Behaviour after cutover

Once defaults point at `2026_2027` and that collection exists:

- Season picker lists both; `2025_2026` is historic (`is_current_season == false`).
- Historic UX: static table/results, no live updates, no PL notification nav for that season (existing gates).
- Worker no longer writes `pl_matches_2025_2026` / `pl_table_2025_2026`.

No separate “museum flag” is required for PL — historic vs current is entirely “selected season == inferred current”.

---

## 6. Seeding 2026/27 fixtures and table

### 6.1 Collections

Create (or let first upsert create) in `pl_database`:

- `pl_matches_2026_2027`
- `pl_table_2026_2027`

Indexes are ensured at backend startup by `index_bootstrap.py` patterns (`^pl_matches_\d{4}_\d{4}$`, `^pl_table_\d{4}_\d{4}$`, `live_pl_table`).

### 6.2 Code retarget checklist

**Decided:** introduce a single constant `CURRENT_PL_SEASON = "2026_2027"` (or equivalent shared name) and derive collection names and date bounds from it so the next rollover is one edit. Change in one deploy:

1. Shared / duplicated season constant → `2026_2027`
2. `website/football/__init__.py` — default matches → `pl_matches_{CURRENT_PL_SEASON}`
3. `backend/src/football/__init__.py` — matches + official table → `*_2026_2027` via the same constant
4. `backend/src/football/football.py` — `get_season_matches` date window `2026-07-01`→`2027-06-30`; `get_table` pre-season clamp `**2026-08-25**` (day after all clubs’ first game)
5. `bet/src/database.go` — `PL_MATCHES_COLLECTION` derived from the same season key

### 6.3 Worker bootstrap

After **manual** deploy + worker restart on the real host (not this machine):

1. `get_table` → writes `pl_table_2026_2027` and refreshes `live_pl_table`
2. `get_season_matches` → full-window PL matches into `pl_matches_2026_2027`
3. `get_todays_matches` → live schedule as today

Respect the existing 4 s global rate limiter (`Football-API-Rate-Limiting.md`). Bootstrap is already staggered.

### 6.4 `live_pl_table`

This collection is **singular** and always means the live season.

- **Decided for cutover:** drop `live_pl_table` once on **macmini2** immediately before (or right after) the first new-season `get_table`, so relegated 2025/26 rows cannot linger; then let the worker refill it.
- Do not keep a `live_pl_table_2025_2026` — historic seasons use `pl_table_{season}` only.

### 6.5 Preconditions on football-data.org

**Already probed (2026-07-20)** with ≥4 s spacing:

- `GET /competitions/PL` — season id 2502, `startDate` 2026-08-21, `endDate` 2027-05-30
- `GET /competitions/PL/matches?dateFrom=2026-07-01&dateTo=2027-06-30` — **380** fixtures (first: Arsenal vs Coventry, 2026-08-21)
- `GET /competitions/PL/teams` — **20** clubs (ids include promoted **COV 1076**, **HUL 322**, **IPS 349**, **LEE 341**; among others)

Re-probe before cutover day if anything looks stale. Token: `backend/src/secrets/football_api_token.txt` (never commit).

---

## 7. Crests

### 7.1 Policy

- **Offline / one-shot only** — never download crests inside the live football worker.
- Store **SVG** named to match `Team.local_crest` (typically `{apiId}.svg` when the API crest is `{apiId}.svg`). Keep raster only when no SVG is available.

### 7.2 Audit + download workflow

1. After (or from a dry-run of) the first 2026/27 matches or `GET /competitions/PL/teams`, collect distinct `team.id` + crest URL.
2. For each team, check `website/static/images/football/crests/{id}.svg` first (then `.png` / other raster only if still referenced).
3. Missing: download from the API crest URL / `crests.football-data.org`, prefer SVG (convert only if the source has no SVG), commit assets to the repo.
4. Add or update `pl_team_primary_colours` for promoted clubs (manual or small helper — colours are not on the matches API).

### 7.3 Suggested script (implementation phase)

Add `scripts/fetch_pl_crests.py` (mirror spirit of `scripts/fetch_wc_flags.py`):

- Input: host + `pl_database` season key, or a JSON list from `/teams`
- Actions: report missing crests; optional `--download` to fetch and convert
- Output: checklist of IDs needing colour entries

---

## 8. Team ID clashes (prefer football-data.org)

### 8.1 Definitions

- **API set (A):** `(id, canonical_name, tla)` for all clubs in the 2026/27 PL competition from football-data.org.
- **Historic set (B):** `(id, name, tla)` from all `pl_matches_`* / `pl_table_`* **except** documents that already clearly refer to the **same club** as in A (same id + same normalised name/TLA).

**Clash:** an `id` appears in A and in B with a **different** club identity (normalised name / TLA mismatch). Typical case: a synthetic or recycled historic id equals a newly promoted club’s football-data.org id.

### 8.2 Resolution rule (decided)

**Prefer the football-data.org ID.**

1. Live 2026/27 club keeps the API `team.id` unchanged in new-season data and crest filename `{id}.svg` (PNG only if no SVG).
2. Historic documents that wrongly used that id for a **different** club are remapped to a **new stable project-owned id** (allocate from a reserved high range unused by football-data.org PL clubs, e.g. `90000+`, documented in the rollover notes).
3. Rename/move historic crest files if they were stored as `{oldId}.png` and now collide; update `pl_team_primary_colours` keys for remapped ids.
4. Do **not** change the live club’s API id to protect historic data.

Same club across seasons with the same API id is **not** a clash — leave alone.

### 8.3 Same club, different historic id (decided — required)

Phase 0 found clubs that are the **same identity** as a 2026/27 API club but stored under a project-owned historic id (`90000+` from the non–football-data import). Leaving both ids live would split H2H, team pages, colours, and crests.

**Rule:** remap historic documents **onto the football-data.org id** so the site has one id per club.

For this rollover (macmini2), before cutover:


| Club          | From (historic) | To (football-data) |
| ------------- | --------------- | ------------------ |
| Hull City     | `900011`        | `322`              |
| Coventry City | `900008`        | `1076`             |


Apply on **macmini2** across `pl_database`:

1. In all `pl_matches_*`: set `home_team.id` / `away_team.id` from old → new where the embedded team is that club; normalise `name` / `short_name` / `tla` toward API values where practical (`HUL` not `HC`; fuller club names OK).
2. In all `pl_table_*`: same for `team.id` (and name/tla fields).
3. `pl_team_primary_colours`: rekey `900011`→`322` and `900008`→`1076` (or copy colour then delete old row). Hex already known: Hull `#2266AA`, Coventry `#74A6CD`.
4. `web_database.football_push_subscriptions`: rewrite any `team_ids` entries `900011`→`322`, `900008`→`1076` if present.
5. Crest files: live assets are already `{322,1076}.svg`; historic named/legacy crests for these clubs need no id rename if unused after remap. Confirm team pages resolve via API crest basename (SVG preferred).
6. Re-scan: no remaining docs with `team.id` in `{900008, 900011}` for these clubs; team cache / H2H treats historic + live as one club.

This is **required for site consistency**, not optional. It is distinct from §8.2 (collision with a *different* club on the same id).

### 8.4 Detection procedure

One-shot audit (script or notebook) before cutover:

1. Load A from `GET /competitions/PL/teams` (or distinct teams from the 2026/27 matches response).
2. Scan B across `pl_database` historic collections.
3. Emit a report: `id`, API name, historic name(s), collection samples.
4. Also emit **same-club / different-id** pairs (name/TLA match, id ≠ API id) — remap per §8.3.
5. Human review → apply remaps in Mongo → re-run audit until clean.
6. Sanity: team cache build yields one club per id; H2H for Hull/Coventry includes historic seasons.

### 8.5 Push subscriptions

After cutover, the subscriptions UI is driven by the **current** table. Users may still hold relegated clubs’ ids in `football_push_subscriptions` (`web_database` on macmini2).

**Decided:** **soft** on cutover day — leave `team_ids` for relegated clubs; they simply won’t match current PL notify queries until the user updates preferences. Optional hard prune later (Phase 4).

**Exception:** as part of §8.3, rewrite Hull/Coventry historic ids in subscriptions to the football-data ids so preferences keep working for those clubs.

---

## 9. Implementation plan

### Phase 0 — Prep (no cutover)

- [x] Probe API (≥4 s): 380 fixtures; season **2502**; first kickoff **2026-08-21**; last MD1 **2026-08-24**; standings clamp **2026-08-25**; end **2027-05-30**
- [x] Team-ID clash audit against `pl_database` on **macmini2** — **no §8.2 clashes**; **§8.3 dual-id remap required** for Hull/Coventry
- [x] Crest gap report for 2026/27 squad — **all 20 clubs have a local crest that `Team.local_crest` will resolve**
- [x] Confirm final `pl_table_2025_2026` snapshot — **20 rows, all `played_games=38`** (champion Arsenal 85 pts; bottom West Ham / Burnley / Wolves relegated)
- [x] **Remap historic Hull/Coventry ids → football-data ids** on macmini2 (§8.3): `900011`→`322`, `900008`→`1076` (matches, tables, colours; no push subs held those ids) — applied 2026-07-20

#### Phase 0 findings (2026-07-20)

**Clash audit** (API `/competitions/PL/teams` vs all `pl_matches_`* / `pl_table_`* / `live_pl_table` on macmini2):


| Result                               | Detail                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------- |
| Collections scanned                  | 127 match + 127 table seasons; 65 distinct historic team ids           |
| Clashes (same id, different club)    | **None** — API ids 322 / 1076 are unused in historic docs              |
| Same club, same id (ok)              | 18 of 20 API clubs already present under football-data ids             |
| Same club, **different** historic id | **Hull** and **Coventry** (imported historic seasons use `90000+` ids) |


**Hull / Coventry ID map** — **remapped on macmini2 2026-07-20** (§8.3):


| Club          | football-data (canonical) | Former historic id | Result                                                       |
| ------------- | ------------------------- | ------------------ | ------------------------------------------------------------ |
| Hull City     | **322** (`HUL`)           | `900011`           | 190 match sides + 5 table rows; colour `#2266AA` on `322`    |
| Coventry City | **1076** (`COV`)          | `900008`           | 1390 match sides + 34 table rows; colour `#74A6CD` on `1076` |


Verify: zero leftover docs with `team.id` in `{900008, 900011}` for these clubs. Names/TLAs normalised to API values.

**Crests** under `website/static/images/football/crests/` (resolution prefers SVG; raster only when no SVG exists):

| Club | API id | API crest file | Local asset | Status |
| ---- | ------ | -------------- | ----------- | ------ |
| All except BOU | (numeric) | `{id}.png` / `{id}.svg` | `{id}.svg` served | OK |
| AFC Bournemouth | 1044 | `bournemouth.png` | `bournemouth.png` (no SVG yet) | OK (raster fallback) |
| Hull / Coventry | 322 / 1076 | `{id}.png` | `{id}.svg` | OK |


No crest downloads needed before cutover.

**Colours** (`pl_team_primary_colours` on macmini2) — §8.3 rekey done:


| team_id    | Club             | Colour                    |
| ---------- | ---------------- | ------------------------- |
| 322        | Hull City AFC    | `#2266AA` (from `900011`) |
| 1076       | Coventry City FC | `#74A6CD` (from `900008`) |
| (other 18) | —                | already present           |


**2025/26 table** (`pl_table_2025_2026`): complete final table, 38 games each.

### Phase 1 — Code

- [x] Introduce `CURRENT_PL_SEASON = "2026_2027"` and derive website / backend / bet collection names from it
- [x] Update season date window + standings clamp **2026-08-25** (day after all clubs’ first game) in `football.py` (via `pl_season.py`)
- [x] (Optional follow-up) `scripts/fetch_pl_crests.py` + clash audit script

**Code landed (2026-07-20):**


| Area                                               | Change                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `website/football/db_names.py`                     | `CURRENT_PL_SEASON`, `pl_matches_collection_name` / `pl_table_collection_name`                   |
| `website/football/__init__.py`                     | default matches → `pl_matches_2026_2027`                                                         |
| `website/football/football_db.py`                  | `infer_current_season_key` → `CURRENT_PL_SEASON`                                                 |
| `backend/src/football/pl_season.py`                | season key, July–June window, standings clamp **day after all clubs’ first game** (`2026-08-25`) |
| `backend/src/football/__init__.py` + `football.py` | collections + API date window / clamp                                                            |
| `bet/src/database.go`                              | `CURRENT_PL_SEASON` + derived matches collection                                                 |


Next rollover: edit `CURRENT_PL_SEASON` in the three places (website `db_names.py`, backend `pl_season.py`, bet `database.go`) and set `CURRENT_PL_STANDINGS_CLAMP_DATE` to **the day after every club’s first match** (not first kickoff alone — see §3).

### Phase 2 — Cutover (**manual deploy / restart on real host**)

Agent prepares code + any Mongo prep on macmini2; **you** deploy and restart:

- [x] Deploy code to the real host
- [x] Drop `live_pl_table` once on macmini2 (clean slate for 2026/27)
- [x] Restart football worker; wait for bootstrap `get_table` + `get_season_matches`
- [x] Redeploy / restart bet service
- [x] Confirm Hull/Coventry §8.3 remap already applied (no leftover `900011` / `900008` club rows)

### Phase 3 — Verify

- [x] Season picker: `2026_2027` current; `2025_2026` historic
- [x] `/football/` latest matches and live table update
- [x] Historic `?season=2025_2026` table/results static, no live WS
- [x] Team pages / H2H for Hull and Coventry include historic seasons under ids **322** / **1076** (not split on `900011` / `900008`)
- [x] Notifications list shows 2026/27 clubs
- [x] Bet service reads 2026/27 matches / live table
- [x] Access logs / worker logs: no writes to `pl_matches_2025_2026`

### Phase 4 — Cleanup (optional)

- [ ] Hard-prune stale push `team_ids` (soft leave-as-is is the cutover default)
- [ ] Document allocated synthetic ID range used for remaps
- [ ] Add a short “season rollover” subsection to Future-Development or this doc’s changelog

---

## 10. Risks and mitigations


| Risk                                      | Mitigation                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Fixtures not yet on API on cutover day    | Probe first; delay constant retarget until matches endpoint returns data                                 |
| Wrong standings clamp date                | Clamp to **day after all clubs’ first game**; earlier dates can return previous season                   |
| Relegated rows linger in `live_pl_table`  | Drop collection once before first new `get_table`                                                        |
| ID clash corrupts historic H2H            | Audit + remap **before** public cutover; prefer API id for live club                                     |
| Dual historic/API ids split one club      | **Required** §8.3 remap (`900011`→`322`, `900008`→`1076`) before cutover                                 |
| Missing crests → unknown badge            | Crest audit + offline download before announcing the new season                                          |
| Partial deploy (website vs worker vs bet) | Ship all constant changes in one release; **manual** restart of worker and bet together on the real host |
| Rate limit during bootstrap / probes      | Existing staggered bootstrap + **≥4 s** between API calls                                                |
| Agent restarts wrong host                 | Worker/site are not on the coding machine — hand off deploy/restart                                      |


---

## 11. Resolved decisions

1. **2025/26** remains in Mongo as a normal historic season (no deletion / rename).
2. **2026/27** becomes current via retargeted code + worker ingest from football-data.org (not a one-shot full fixture import).
3. Crests are filled **offline** as **SVG where possible** (raster only if no SVG); worker never downloads crests. `Team.local_crest` prefers `.svg`.
4. On team-ID clash (same id, different club), **prefer football-data.org ID** for the live club; remap conflicting historic data to a new project-owned id.
5. Same club under a historic `90000+` id and a football-data id: **remap historic → football-data id** (required for consistent H2H / team pages / colours). This rollover: Hull `900011`→`322`, Coventry `900008`→`1076`.
6. `live_pl_table` stays a **single** collection meaning “current season only”.
7. `CURRENT_PL_SEASON` single constant in the rollover PR; derive collection names / bounds from it.
8. Standings clamp date: **2026-08-25** = day after **all** clubs’ first game (last MD1 games **2026-08-24**, Chelsea/Fulham). Not first kickoff (`2026-08-21`) and not first-matchday+1 — earlier clamps can make football-data.org return the previous season’s table.
9. Drop `live_pl_table` once on cutover (macmini2), then refill via worker `get_table`.
10. Push subscriptions: **soft** leave-as-is for relegated clubs on cutover; optional hard prune later. Still rewrite Hull/Coventry historic ids per decision 5.
11. **Deploy / worker / bet restart:** manual on the real host (not the coding machine). Mongo changes: **macmini2**. API probes: allowed with **≥4 s** spacing.

---

## 12. Open items (at implementation)

1. Synthetic ID range for §8.2 collision remaps — **not needed for this rollover** (no same-id / different-club clashes). Keep the `90000+` convention in §8.2 for a future season if one appears. Note: `900008` / `900011` are **retired** by §8.3 onto API ids, not reused.
2. Whether to ship `scripts/fetch_pl_crests.py` / clash + dual-id audit script as a follow-up helper (audit was run ad hoc for Phase 0).

