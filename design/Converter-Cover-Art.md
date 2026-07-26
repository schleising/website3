# Design: Cover Art for Converter Films & TV Shows

**Status: Implemented** (website3 Converter UI + art package). This document is the design record and as-built notes.

## 1. Goal

Show poster / cover art next to Converter UI entries (queue, converted list, and the live “Now converting” stage) so each file is visually identifiable as a film or TV episode — not just a basename and stats.

Cover art should:

- Appear for both **Films** and **TV**
- Stay **fast** on the websocket-driven dashboard (no per-row blocking lookups on every ping)
- Degrade gracefully when art is missing or lookup fails
- Reuse library identity already implied by `/Media/Films/...` and `/Media/TV/...` paths

Non-goals for v1 (still deferred):

- Editing metadata or replacing Plex/Radarr/Sonarr as the library of record
- Cover art on Media Manager (can follow the same pattern later)
- Perfect episode-level stills (season/show poster is enough for TV in v1)

---



## 2. Current state (as built)



### Converter role

Converter is a **read-mostly dashboard** over MongoDB `media.media_collection`. Conversion workers and the folder walker live in the sibling repo `convert-to-h265`. Website3 does not read video files from disk for Converter.

### What the UI shows

Websocket payloads send **basename** (`filename`), plus `display_title`, `media_kind`, and cover-art fields. Full POSIX paths stay server-side in Mongo for identity parse / resolve only.


| Surface                           | Shown                                    | Art slot                              |
| --------------------------------- | ---------------------------------------- | ------------------------------------- |
| Activity rows (converted / queue) | `display_title`, facts, % / est. save    | Fixed 2:3 slot, `object-fit: contain` |
| Now converting                    | Poster + title + per-line stats + % hero | Same card-like grid as activity rows  |
| Statistics                        | Aggregates only                          | N/A                                   |


Queue rows also include the **active converting/copying** file(s) at the top with `queue_status` of `converting` / `copying` / `queued`.

Relevant code:

- Art package: `website/tools/converter/art/`
- Models: `website/tools/converter/database/models.py`
- WS messages: `website/tools/converter/messages/messages.py`
- UI rows: `website/static/js/tools/converter/utils.js`
- WS loop / live stage: `website/static/js/tools/converter/websocket.js`
- Layout lock / mobile chrome: `website/static/js/tools/converter/page-layout.js`
- Styles: `website/static/css/tools/converter/main.css`



### Path conventions (already reliable)

Library roots scanned by the walker:

- `/Media/Films/...`
- `/Media/TV/...`

Typical shapes:

```text
/Media/Films/1917 (2019)/1917 (2019) Bluray-1080p.mkv
/Media/TV/100 Foot Wave/Season 1/100 Foot Wave - S01E01 - Chapter I – Sea Monsters WEBDL-1080p.mkv
```



### Artwork infrastructure (shipped)

- Mongo collection `cover_art_cache`
- Named Docker volume `converter_art_cache` → `/var/cache/converter-art`
- Lazy Arr resolver (Radarr/Sonarr) with TMDB fallback
- `GET /tools/converter/art/{cache_key}` (relative client URLs `art/...` under the Converter page)
- Placeholder: `/icons/tools/converter/art-placeholder.svg`
- FastAPI entrypoint ensures cache dir ownership before dropping to app user
- Retention purge: unused posters removed after **14 days** (access refreshed on serve)



### Related surface

Media Manager (`/media`) already exposes full `filename`, `display_name`, and `parent_directory`. **Sharing the art service with Media Manager remains deferred.**

---



## 3. Options for art source


| Option                                  | Pros                                                                                       | Cons                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **A. Radarr + Sonarr APIs**             | Already indexed against this library; posters match what you manage; no second metadata DB | Couples Converter to Arr availability; needs API keys; TV episode vs series poster choice        |
| **B. Plex API**                         | Same library, rich art, already running                                                    | Heavier API; auth token; library section IDs; more moving parts                                  |
| **C. TMDB (direct)**                    | Clean posters, well documented                                                             | Needs parsing + matching; rate limits; API key; may disagree with Arr naming                     |
| **D. Filesystem sidecars**              | Simple if present                                                                          | Often absent today; website has no media disk mount for serving; walker would need to copy/index |
| **E. Hybrid: Arr first, TMDB fallback** | Best hit rate                                                                              | More code paths                                                                                  |


**Decision: Option E (Radarr/Sonarr first, TMDB fallback).** Shipped.

Rationale: the library is already curated in Arr. Path → Arr item is usually a direct match. TMDB covers items not yet in Arr or lookup misses. Avoid serving from NAS video mounts in the website container.

**TV art (v1):** use the **series poster only** (not season or episode stills).

---



## 4. Architecture (as built)

```text
Mongo FileData.filename (full path)
        │
        ▼
┌───────────────────────┐
│ Media identity parse  │  kind=film|tv, title, year, series, season, episode
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│ Cover art resolver    │  cache → enqueue Arr/TMDB → placeholder until ready
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│ Art cache store       │  Mongo metadata + files on named volume
└──────────┬────────────┘
           │
           ▼
Converter WS payloads include cover_art_url / status / key (+ identity fields)
        │
        ▼
UI <img> in file rows / live stage (lazy; WS updates URL when resolve completes)
```

```mermaid
sequenceDiagram
    participant W as convert-to-h265 walker
    participant M as Mongo media_collection
    participant C as Converter API / WS
    participant R as Art resolver
    participant A as Radarr/Sonarr/TMDB
    participant U as Browser

    W->>M: upsert FileData (full path)
    U->>C: ping / set_files_view
    C->>M: query converted / queue / converting
    C->>R: resolve_art_for_display_many(paths)
    alt cache ready
        R-->>C: cover_art_url (art/{key})
    else miss / stale negative
        R->>R: enqueue async resolve
        R-->>C: placeholder (+ pending/missing/error status)
        R->>A: lookup by parsed identity
        A-->>R: poster URL or image bytes
        R->>R: write cache + disk
    end
    C-->>U: WS rows with cover_art_url
    U->>U: render thumbnail; swap src when URL changes
    U->>C: GET art/{cache_key}
    C->>C: touch last_accessed_at; FileResponse
```





### Design principles

1. **Parse once, cache until retention** — art lookup is not on the hot ping path after warm-up.
2. **Stable same-origin URLs** — relative `art/{urlencoded-key}` under the Converter page (avoids nginx path doubling on `converter.schleising.net`).
3. **Identity is derived from path**, not basename — full path stays server-side.
4. **UI never blocks on art** — missing art → placeholder; rows render immediately; later pings upgrade the URL when ready.

---



## 5. Media identity



### Parsed shape

```python
class MediaIdentity(BaseModel):
    kind: Literal["film", "tv", "unknown"]
    title: str                    # film title or show name
    year: int | None = None       # films; sometimes shows
    season: int | None = None
    episode: int | None = None
    episode_title: str | None = None
    source_path: str              # full Mongo filename
    display_title: str            # human label for UI
    cache_key: str                # stable key for art cache
```

Implemented in `website/tools/converter/art/identity.py` (unit tests in `website/tests/test_converter_media_identity.py`).

### Parsing rules (v1)


| Path signal                       | Result                            |
| --------------------------------- | --------------------------------- |
| Contains `/Films/` (or `\Films\`) | `kind=film`                       |
| Contains `/TV/`                   | `kind=tv`                         |
| Else                              | `kind=unknown` → no remote lookup |


**Film**

1. Prefer parent folder name: `Title (Year)` → title + year
2. Else basename: strip extension, quality tokens (`Bluray-1080p`, `WEBDL-1080p`, …), then `Title (Year)` / `Title Year`

**TV**

1. Show = folder under `/TV/` (or parent of `Season N`)
2. Season from `Season N` folder or `Sxx` in basename
3. Episode from `SxxExx` in basename
4. Episode title = text between `SxxExx -`  and quality token when present



### Cache key

Examples:

- Film: `film:1917:2019`
- TV show poster (v1 default): `tvshow:100-foot-wave`

Normalize with lowercase, trimmed punctuation, collapsed whitespace.

---



## 6. Art cache & serving



### Mongo collection

DB: `media`  
Collection: `cover_art_cache`


| Field              | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `cache_key`        | Unique                                    |
| `kind`             | `film` / `tv` / `unknown`                 |
| `provider`         | `radarr` / `sonarr` / `tmdb` / `none`     |
| `provider_id`      | Arr/TMDB id                               |
| `remote_url`       | Original poster URL                       |
| `local_path`       | Path under cache volume                   |
| `status`           | `ready` / `missing` / `error` / `pending` |
| `last_attempt_at`  | For negative-cache backoff                |
| `last_accessed_at` | Refreshed when image is served            |
| `updated_at`       | Last write                                |
| `content_type`     | Served `Content-Type`                     |
| `error_detail`     | Optional error text                       |


Negative cache:

- `missing` TTL: **7 days**
- `error` TTL: **2 minutes** (short so transient permission/network failures retry quickly)



### Retention

Ready posters and cache rows unused for **14 days** (by `last_accessed_at`, else `updated_at`) are purged on a background loop (startup + every 6 hours), including orphan files in the cache directory. Converted list is last 7 days; 14-day retention is intentional headroom.

### HTTP surface


| Endpoint                               | Purpose                                    |
| -------------------------------------- | ------------------------------------------ |
| `GET /tools/converter/art/{cache_key}` | Serve cached image (or 302 to placeholder) |


Client field (relative to Converter page):

```json
"cover_art_url": "art/film%3A1917%3A2019",
"cover_art_status": "ready",
"cover_art_key": "film:1917:2019"
```

Browser caching: `Cache-Control: public, max-age=86400` on successful serves. Access time is touched on serve so visible titles keep their art through retention.

### Download vs proxy

Posters are downloaded once into the local cache directory and served from disk. Hot path never streams Arr/TMDB.

Config:

- `SONARR_URL` — `http://steveds920:8989`
- `RADARR_URL` — `http://steveds920:7878`
- API keys in `website/secrets/arr-keys.txt` (gitignored), mounted read-only into the container
- `TMDB_API_KEY` optional (also readable from keys file as `tmdb_key` / `tmdb_api_key`)
- `CONVERTER_ART_CACHE_DIR` — default `/var/cache/converter-art`



### Docker Compose

```yaml
fastapi:
  environment:
    - CONVERTER_ART_CACHE_DIR=/var/cache/converter-art
    - SONARR_URL=http://steveds920:8989
    - RADARR_URL=http://steveds920:7878
  volumes:
    - ./website:/app:ro
    - converter_art_cache:/var/cache/converter-art:rw
    - ./website/secrets/arr-keys.txt:/run/secrets/arr-keys.txt:ro

volumes:
  converter_art_cache:
```

Same volume/env applied in `docker-compose-test.yaml`. Entrypoint chowns the cache dir then `su-exec`s to the app user so the named volume is writable.

### Obtaining Sonarr and Radarr API keys

Both apps expose a long-lived API key under **Settings → General**.

#### Sonarr

1. Open [https://sonarr.schleising.net](https://sonarr.schleising.net) and sign in (tools auth).
2. Go to **Settings** → **General**.
3. Unlock if needed, scroll to **Security**, copy **API Key**.



#### Radarr

1. Open [https://radarr.schleising.net](https://radarr.schleising.net) and sign in (tools auth).
2. Go to **Settings** → **General**.
3. Unlock if needed, scroll to **Security**, copy **API Key**.



#### Store keys locally

```text
sonarr_key=paste_sonarr_api_key_here
radarr_key=paste_radarr_api_key_here
```

Optional TMDB:

```text
tmdb_key=paste_tmdb_api_key_here
```

Probe before/after wiring:

```bash
python3 scripts/probe_sonarr_cover_art.py
```

---



## 7. Resolver algorithm

For a full path:

1. Parse `MediaIdentity`. If `unknown` → placeholder, stop.
2. Lookup `cover_art_cache` by `cache_key`.
3. If `ready` and file exists → return local URL.
4. If `missing`/`error` and within backoff TTL → placeholder.
5. Else enqueue async resolve (never await remote HTTP on the WS hot path):
  - **Film:** Radarr → TMDB fallback
  - **TV:** Sonarr series poster → TMDB fallback
6. Persist cache row; download image bytes when URL found.
7. Later pings return `art/{cache_key}` once ready; UI updates `img.src` in place.

**All art logic stays in website3** (no walker hooks in `convert-to-h265`).

---



## 8. Websocket / API contract


| Field              | Meaning                                                     |
| ------------------ | ----------------------------------------------------------- |
| `filename`         | Basename only                                               |
| `display_title`    | Primary UI label (no path)                                  |
| `media_kind`       | `film` | `tv` | `unknown`                                   |
| `cover_art_url`    | Relative `art/...` or placeholder                           |
| `cover_art_status` | `ready` / `pending` / `missing` / `error…` (debug-friendly) |
| `cover_art_key`    | Cache key (for logging / correlation)                       |
| `queue_status`     | Queue rows only: `queued` | `converting` | `copying`        |


Applied to `ConvertingFileData`, `ConvertedFileData`, and `FileToConvertData`.

### Web push

Conversion success/failure pushes are sent by **convert-to-h265** (`cover_art.py` + `send_notification`).

Notification image fetches usually have **no tools-auth cookies**, so pushes must **not** use `/tools/converter/art/{cache_key}`.

As built:

1. Look up `cover_art_cache` by the same cache key rules as website3.
2. If `status=ready` and `remote_url` is public `https://` (typical Arr `remoteUrl` / TMDB CDN), use that for `icon` and `image`.
3. Otherwise fall back to absolute Converter PWA icon/badge URLs on `https://converter.schleising.net`.
4. Converter service workers (`static/tools/converter/sw.js` and `static/sw.js`) pass `image` through to `showNotification`.

---



## 9. UI design (as built)



### Layout chrome

- Desktop: header + Now Converting fixed; Activity scrolls in `.main-scroll`. Overview opens from an Activity toolbar button.
- Mobile: document scroll (pull-to-refresh); header + Now Converting in sticky/fixed `.page-chrome` with height synced via `page-layout.js`.



### Activity rows

```text
┌──────┬──────────────────────────────────────────┬────────┐
│ POST │ Converted · Show Name · S01E02           │  42%   │
│ ER   │ facts: sizes · duration · codecs         │ saved  │
│      │ ████████░░░░  4.2 GB → 2.4 GB            │        │
└──────┴──────────────────────────────────────────┴────────┘
```

- Poster slot: fixed width (~5rem / ~4.25rem mobile), stretched row height, `object-fit: contain` (no crop; no separate art background)
- Size bar fill tracks **saved %** (longer = more compression)
- Queue: active jobs first with status **Converting** / **Copying**; remainder **Queued**
- `loading="lazy"`; decorative `alt=""`



### Now converting

Same grid language as activity cards:

- Poster left; title + **one-stat-per-line** facts; hero shows phase (**Copying** / **Converting**) above percentage, then “complete”
- Progress bar full width under the row
- Job tabs share a row with the “Now converting” kicker



### Display title

Prefer `display_title` as the heading. Basename available via filename popup when useful.

### Overview dialog — extra stats (pick list)

Overview is now a popup, so there is room for more KPIs. **Already shown:** total files, converted, in queue, size before/after, space saved, % saved, total conversion time. Errors appear only when `conversion_errors > 0`.

**Chosen and implemented:**

- [x] Films converted (`films_converted`)
- [x] Films in queue (`films_to_convert`)
- [x] TV converted (`tv_converted`)
- [x] TV in queue (`tv_to_convert`)
- [x] Films vs TV share of converted library (`converted_media_mix`)
- [x] Films vs TV share of remaining queue (`queue_media_mix`)

**Already computed in** `StatisticsMessage` **but not shown in the UI:**

- [ ] Remaining library size before conversion (TB) (`total_size_before_conversion_tb`)
- [ ] Remaining library size after conversion (TB) (`total_size_after_conversion_tb`)
- [ ] Conversions by backend (`conversions_by_backend` — e.g. Mac mini vs others)
- [ ] Always show conversion errors (including `0`)

**Library split (remaining unchecked):**

- [ ] *(none — films/TV counts and mixes shipped above)*

**Pace & forecasts:**

- [ ] Converted today
- [ ] Converted this week
- [ ] Converted this month
- [ ] Space saved this week
- [ ] Space saved this month
- [ ] Average conversion time per file
- [ ] Median conversion time per file
- [ ] Estimated time to clear the queue (from recent average / median)
- [ ] Average encode speed (from `speed` when present)

**Compression quality:**

- [ ] Average % saved (mean across converted files, not just total-bytes %)
- [ ] Best single-file % saved
- [ ] Worst single-file % saved (among successful converts)
- [ ] Estimated space still to save (from queue estimates)

**Queue / library character:**

- [ ] Currently converting / copying count (explicit, separate from “in queue”)
- [ ] Queue size in GB (sum of current / pre sizes)
- [ ] Largest N files still queued (names + sizes — compact list, not a KPI tile)
- [ ] Resolution mix in queue (e.g. 1080p / 2160p counts)
- [ ] Source codec mix still queued (e.g. h264 vs other)

**Cover art / identity (optional):**

- [ ] Ready cover-art cache entries
- [ ] Missing / failed cover-art lookups

Check the items to add; leave the rest unchecked.

---



## 10. Security & ops

- Art endpoints sit behind the same **tools auth** as Converter (`converter.schleising.net`).
- Do not expose Arr/TMDB API keys to the browser.
- Cap download size (`MAX_POSTER_BYTES`) and content-type (`image/jpeg`, `image/png`, `image/webp`).
- Rate-limit via single async worker queue; respect TMDB limits.
- Disk: 14-day unused retention keeps the named volume bounded.
- Logging: enqueue / ready / miss / errors at INFO; hot-path batch noise at DEBUG.

---



## 11. Alternatives considered


| Idea                                      | Why not (for v1)                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| Hotlink Arr/TMDB URLs in `img src`        | Fragile URLs, possible auth/CORS, no offline dashboard cache                     |
| Serve posters from `/Media/...` via nginx | Website/Converter hosts don’t consistently mount library; sidecars often missing |
| Only basename fuzzy match to TMDB         | High false positives without year/show folder context                            |
| Episode stills from TMDB                  | Extra lookups; series poster is enough for queue scanning                        |
| `object-fit: cover` for posters           | Rejected — crops posters; use **contain** in a fixed slot                        |


---



## 12. Implementation phases



### Phase 0 — Identity without art

- [x] Shared path parser module (unit tests for Films/TV fixtures)
- [x] Add `media_kind`, `display_title` to WS payloads; keep `filename` as basename (no path in UI)
- [x] UI shows `display_title` when present



### Phase 1 — Cache + placeholder UI

- [x] `cover_art_cache` collection + local cache dir
- [x] Add named volume `converter_art_cache` to `docker-compose.yaml` and `docker-compose-test.yaml` (`/var/cache/converter-art:rw`)
- [x] Set `CONVERTER_ART_CACHE_DIR=/var/cache/converter-art` for `fastapi`
- [x] Set `SONARR_URL` / `RADARR_URL` to `http://steveds920:8989` / `http://steveds920:7878` for `fastapi`
- [x] `GET /tools/converter/art/{cache_key}`
- [x] WS `cover_art_url` (placeholder until resolver fills cache)
- [x] Row + live-stage thumbnail layout (fixed slot, contain, no layout blowout)



### Phase 2 — Arr resolver

- [x] Radarr/Sonarr client config (keys from secrets file; LAN `steveds920` hosts)
- [x] Async resolve queue; hot path cache-only
- [x] TV: series poster only
- [x] Download posters; mark `ready` / `missing`
- [x] Verify against real `/Media/Films` and `/Media/TV` samples



### Phase 3 — TMDB fallback + polish

- [x] TMDB search fallback
- [x] Negative-cache TTL (`missing` 7d, `error` 2m)
- [x] Retention purge for unused ready art (14 days; replaces unbounded disk growth)
- [x] In-process refresh helper (`refresh_art_for_path`) for retries after fixes



### Phase 4 — Optional enhancements (still out of scope)

- [ ] Season posters or episode stills
- [ ] Share art service with Media Manager
- [x] Art in web push notification images for completed converts
- [ ] Background sweeper over all distinct paths in `media_collection` (lazy WS resolve is sufficient for v1)

---



## 13. Test plan

- [x] Parser fixtures: film folder year, film basename-only year, TV `SxxExx`, multi-season paths, unknown paths
- [x] Obtain Arr API keys and run `scripts/probe_sonarr_cover_art.py` (covers Sonarr + Radarr)
- [x] Resolver: Arr hit, Arr miss → TMDB hit, total miss → placeholder
- [x] WS: payloads include art URL without remote calls when cache warm; UI upgrades when resolve completes
- [x] UI: contain sizing, placeholder, dark/light, mobile scroll / PTR, live + activity layouts
- [x] Auth: art endpoint behind tools auth with Converter
- [x] Failure: Arr/cache issues → short error TTL / placeholder; dashboard still usable

---



## 14. Decisions


| Topic                   | Decision                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Primary art source      | **Arr first (Radarr/Sonarr), TMDB fallback**                                                                      |
| TV art granularity (v1) | **Series poster only**                                                                                            |
| WS / UI filenames       | Show `display_title` (and basename if needed); **never show full paths**                                          |
| Cache storage           | **Named Docker volume** `converter_art_cache` → `/var/cache/converter-art` on `fastapi`; keep `./website:/app:ro` |
| Cross-repo prefetch     | **No** — all art logic stays in **website3**                                                                      |
| Media Manager           | **Later** — not part of this project                                                                              |
| Arr URL from Docker     | `http://steveds920:8989` and `http://steveds920:7878`                                                             |
| Poster fit              | `object-fit: contain` in a fixed slot (no crop; no art-only background)                                           |
| Art URL shape           | **Relative** `art/{key}` from Converter page                                                                      |
| Push notification art   | Prefer public **HTTPS** `remote_url` from cache; never tools-auth art paths                                       |
| Cache retention         | **14 days** unused (`last_accessed_at` / `updated_at`)                                                            |
| Queue list              | Include **converting/copying** rows with appropriate status                                                       |


---



## 15. Success criteria

- ≥90% of Films/TV rows in Converter show correct (or clearly matching) cover art after cache warm-up
- Ping/WS latency unchanged when cache is warm (no remote calls on hot path)
- No intrinsic-size layout blowout when images load (fixed art slot + contain)
- Unknown/non-library paths never spam external APIs (negative cache)
- Dashboard remains usable when Arr/TMDB are down
- Unused posters do not accumulate indefinitely (14-day purge)

