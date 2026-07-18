# Design: Replace Authentik with Website Login for Nginx-Gated Webapps

## 1. Goal

Replace Authentik forward-auth (`snippets/authentik.conf`) with the existing website account system (passkey login + JWT `token` cookie) for private webapps currently gated by nginx.

Unauthenticated users should be sent to `https://www.schleising.net/account/login/` with a safe `next` return URL, then return to the original app after login.

## 2. Current state

### Authentik gate (today)

`snippets/authentik.conf` uses nginx `auth_request`:

1. Subrequest to Authentik outpost: `/outpost.goauthentik.io/auth/nginx`
2. On `401` → internal redirect to Authentik start URL
3. On success → inject `X-authentik-*` headers and continue to upstream

Used by:

| Category | Hosts |
|----------|--------|
| Website tool subdomains | `monitor`, `converter`, `transcoder`, `logger` |
| External/private apps (tools-only after migration) | `pihole`, `plex`, `portainer`, `prowlarr`, `radarr`, `sonarr`, `tautulli`, `transmission`, `nas`, `router` |
| External/private app (explicit allow-list after migration) | `overseerr` |

### Website auth (already exists)

| Piece | Detail |
|-------|--------|
| Session | JWT in HTTP-only cookie `token` |
| Domain | `.schleising.net` (shared across subdomains) |
| Login | Passkeys via `/account/webauthn/...` on `www` |
| TTL | ~3 days (`User.token_expiry`) |
| Soft check | `GET /account/protected/` → user JSON or `null` with **HTTP 200 either way** |
| Tool privilege | `User.can_use_tools` |

Important gap: there is **no nginx-compatible auth gate endpoint** today. `/account/protected/` always returns 200, so it cannot drive `auth_request`.

### Apps already *not* using Authentik

- `feeds.schleising.net` / `football.schleising.net` — app-level login / public content
- `astronomy.schleising.net` — public tool surface
- `bet.schleising.net` — separate upstream (leave ungated)
- `www.schleising.net` — site login only where routes require it

### Apps to retire

- `srm-monitor.schleising.net` — appears in `/webapps` but should be removed entirely (not in current `nginx.conf`)

## 3. Proposed architecture

Use the same nginx pattern as Authentik, but point `auth_request` at FastAPI:

```text
Browser → nginx (app host)
            │
            ├─ auth_request → GET /account/nginx-auth/?require=tools|overseerr
            │                 (forwards Cookie: token=...)
            │
            ├─ 401 → 302 https://www.schleising.net/account/login/?next=<original URL>
            ├─ 403 → 302 https://www.schleising.net/account/access-denied/
            │         (Overseerr: …/account/access-denied/?app=overseerr)
            │
            └─ 200 → proxy_pass $upstream
```

```mermaid
sequenceDiagram
    participant B as Browser
    participant N as Nginx app host
    participant A as FastAPI /account
    participant U as Upstream app

    B->>N: GET https://overseerr.schleising.net/
    N->>A: auth_request GET /account/nginx-auth/?require=overseerr
    Note over N,A: Cookie token forwarded
    alt No/invalid token
        A-->>N: 401
        N-->>B: 302 www login?next=overseerr URL
        B->>A: Passkey login
        A-->>B: Set token cookie (.schleising.net)
        B->>N: Retry original URL
    else Valid token but can_use_overseerr is false
        A-->>N: 403
        N-->>B: 302 /account/access-denied/?app=overseerr
    else Valid token and can_use_overseerr is true
        A-->>N: 200 + X-Website-Username
        N->>U: proxy_pass
        U-->>B: App response
    end
```

## 4. Scope

### In scope

1. New FastAPI endpoint for nginx `auth_request`
2. New user privilege flag `can_use_overseerr` (default `false` if absent)
3. User management UI checkbox to grant/revoke Overseerr access (parallel to `can_use_tools`)
4. New nginx snippets replacing `authentik.conf` includes:
   - tools-only gate (most private apps)
   - Overseerr gate (`require=overseerr`)
5. Access Denied page for authenticated-but-not-allowed users (`403` path)
6. Login redirect using existing `next` allowlist (`*.schleising.net`)
7. Access-log username via website identity header instead of `$authentik_username`
8. Update `/webapps` listing:
   - show Overseerr only when `can_use_overseerr` is true (or always list but access still gated)
   - remove SRM Monitor
   - demote Authentik until retired later
9. Stop using Authentik outpost for these nginx hosts (keep Authentik running for now; full retirement later)

### Out of scope (initially)

- Changing feeds/football/astronomy auth models
- Replacing each upstream’s *own* login (Plex/NAS/Overseerr may still have local accounts)
- Header-based SSO into upstream accounts (gate-only; no identity headers required by upstreams)
- Full Authentik shutdown (keep for now, retire later)
- Gating `bet.schleising.net` (leave as today)

## 5. FastAPI / user model design

### New user field

Add to `User` / account documents (alongside `can_use_tools`):

```python
can_use_overseerr: bool = False
```

Rules:

- Missing field in MongoDB ⇒ treat as `false` (`bool(getattr(user, "can_use_overseerr", False))`)
- Independent of `can_use_tools` (tools users are not automatically granted Overseerr; grant explicitly)
- Editable only by users who can access user management (existing tools-gated `/account/users/` flow)

### User management UI

Mirror the existing `can_use_tools` checkbox pattern in `users.html` / user update form:

- Label e.g. **Overseerr access**
- Checkbox name `can_use_overseerr`
- Persist on user update the same way as tools access
- Optional badge on the users list (e.g. “Overseerr”) for visibility

### New auth endpoint

Suggested route:

```http
GET /account/nginx-auth/
```

Behaviour:

| Condition | Response |
|-----------|----------|
| Missing/invalid/expired `token` cookie | `401 Unauthorized` (empty body) |
| Valid session but fails privilege check | `403 Forbidden` |
| Valid session and privilege satisfied | `200 OK` |

Response headers on success (for nginx `auth_request_set` / access logs):

| Header | Source |
|--------|--------|
| `X-Website-Username` | JWT `sub` / `user.username` |
| `X-Website-Can-Use-Tools` | `true` / `false` |
| `X-Website-Can-Use-Overseerr` | `true` / `false` |

Upstream apps do **not** need these headers for SSO; they are for nginx logging and optional future use.

### Privilege modes

| Mode | Use for | Rule |
|------|---------|------|
| `tools` | All Authentik-gated private apps except Overseerr | Valid JWT **and** `can_use_tools` |
| `overseerr` | `overseerr.schleising.net` only | Valid JWT **and** `can_use_overseerr` |

Nginx subrequest targets:

- Tools-only: `/account/nginx-auth/?require=tools`
- Overseerr: `/account/nginx-auth/?require=overseerr`

Unknown/missing `require` values should fail closed (`403` or `400`), not default to open access.

### Overseerr special case

`overseerr.schleising.net` is the only external/private app shared with selected non-admin users.

- Gate with `require=overseerr`
- Requires a website account **and** explicit `can_use_overseerr=true`
- Anonymous users → login redirect
- Logged-in users without the flag → Access Denied page with Overseerr-specific copy
- `can_use_tools` alone is **not** sufficient
- After login, return to the Overseerr URL via `next=`

All other Authentik-gated hosts remain tools-only.

### Access Denied page

Add a dedicated page (recommended: `GET /account/access-denied/`) rather than sending denied users to `/webapps/`.

There is already a generic `403.html` (“Access Denied”); reuse its look-and-feel, but serve a route nginx can redirect to with optional app context.

| Case | Redirect target | Page message |
|------|-----------------|--------------|
| Tools / other gated apps | `/account/access-denied/` | “You do not have access.” |
| Overseerr | `/account/access-denied/?app=overseerr` | “You do not have access.” plus instruction to contact Steve via WhatsApp to request access |

Notes:

- Page requires a logged-in session (or at least can show the generic denial if anonymous)
- Keep actions like “Return Home” / “Browse Webapps”; do **not** send the user back into a login loop
- Overseerr WhatsApp contact details can be a hardcoded link/number in the template (or a small config constant)
- Optional: pass `next=` / original host for display only; do not auto-retry the gated app

### Security properties

- Endpoint must be **idempotent GET**, no CSRF
- Do **not** return user PII in body; headers only
- Validate JWT with existing `get_current_active_user` / cookie decode path
- Treat missing user as `401`, not redirect (nginx owns the redirect)
- Use `403` for authenticated-but-not-allowed so nginx can redirect to Access Denied without a login loop
- Bind checks to existing cookie domain policy (`.schleising.net`)
- Ensure FastAPI trusts `X-Forwarded-Host` / `X-Forwarded-Proto` from nginx (already required for cookie domain)

### Why not reuse `/account/protected/`

That endpoint returns `200` + `null` for anonymous users. nginx `auth_request` needs status-code gating (`2xx` allow, `401/403` deny). Keep `/account/protected/` for soft UI checks; add a dedicated gate.

## 6. Nginx design

### Snippets

Prefer two thin includes so each host is explicit:

1. `snippets/website-auth-tools.conf` — `require=tools`
2. `snippets/website-auth-overseerr.conf` — `require=overseerr`

Shared core can live in `snippets/website-auth-common.conf` if useful, with each include setting the require mode.

#### Tools-only (most hosts)

```nginx
auth_request /_website_auth;
error_page 401 = @website_signin;
error_page 403 = @website_no_access;

auth_request_set $website_username $upstream_http_x_website_username;

location = /_website_auth {
    internal;
    proxy_pass http://$macmini_ip:8081/account/nginx-auth/?require=tools;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Cookie $http_cookie;
    proxy_set_header Host www.schleising.net;
    proxy_set_header X-Original-URL $scheme://$host$request_uri;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
}

location @website_signin {
    internal;
    return 302 https://www.schleising.net/account/login/?next=$scheme://$host$request_uri;
}

location @website_no_access {
    internal;
    return 302 https://www.schleising.net/account/access-denied/;
}
```

#### Overseerr allow-list

Same as above, but:

```nginx
proxy_pass http://$macmini_ip:8081/account/nginx-auth/?require=overseerr;
```

and the denial redirect:

```nginx
location @website_no_access {
    internal;
    return 302 https://www.schleising.net/account/access-denied/?app=overseerr;
}
```

### Include sites

| Host | Include |
|------|---------|
| `monitor`, `converter`, `transcoder`, `logger` | `website-auth-tools.conf` |
| `pihole`, `plex`, `portainer`, `prowlarr`, `radarr`, `sonarr`, `tautulli`, `transmission`, `nas`, `router` | `website-auth-tools.conf` |
| `overseerr` | `website-auth-overseerr.conf` |

Replace each:

```nginx
include snippets/authentik.conf;
```

with the appropriate website-auth include.

### Logging

Update the `$log_user` map:

```nginx
map $website_username $log_user {
  ""      "-";
  default $website_username;
}
```

(or accept either `$website_username` / legacy `$authentik_username` during transition).

### Cookie / Host notes

- Auth subrequest **must forward** `Cookie` (`token`)
- Setting `Host` to `www.schleising.net` keeps FastAPI on the main site origin; cookie domain `.schleising.net` still matches
- Login `next` must remain absolute app URL (`https://overseerr.schleising.net/...` etc.) so post-login return works (already supported)

### Static assets under gated hosts

For `standard-website.conf` hosts (`monitor`, etc.), `auth_request` at server/location level currently protects everything including static files — same as Authentik today. Keep that behaviour unless you intentionally open public assets later.

## 7. Login / logout UX

### Login

1. User hits gated app without cookie → 302 to www login with `next`
2. Passkey login sets `token` on `.schleising.net`
3. Redirect back to app → auth_request succeeds **only if** the required privilege flag is set

### Logout

`GET /account/logout/` already clears domain cookie. After logout, gated apps should fail auth_request until login again.

Optional improvement: after logout, redirect to `/webapps/` rather than leaving users on a private app URL that immediately bounces back to login.

### Authenticated but not allowed

**Decision:** `403` → Access Denied page (not login, not `/webapps/`), to avoid loops.

| Gate | Redirect |
|------|----------|
| tools host + `can_use_tools == false` | `/account/access-denied/` |
| Overseerr + `can_use_overseerr == false` | `/account/access-denied/?app=overseerr` |

Default copy: **You do not have access.**

Overseerr copy: same baseline, plus ask the logged-in user to contact Steve via WhatsApp to request access.

## 8. Application tiers after migration

| Tier | Auth | Examples |
|------|------|----------|
| Public | None | astronomy, football (mostly), bet |
| Site login (app-enforced) | FastAPI route checks | feeds |
| Nginx gate: Overseerr allow-list | `/account/nginx-auth/?require=overseerr` | **Overseerr** (`can_use_overseerr`) |
| Nginx gate: tools | `/account/nginx-auth/?require=tools` | monitor/logger/… + *arr stack, NAS, router, etc. |
| Retire | Remove from webapps + infra | SRM Monitor |

## 9. Migration plan

### Phase 0 — Prep

Build and deploy the website-side pieces before changing any nginx auth includes.

#### Implementation checklist

- [ ] Add `can_use_overseerr: bool = False` to the user model
- [ ] Persist/load the field so missing MongoDB values are treated as `false`
- [ ] Add Overseerr checkbox to `/account/users/` (parallel to tools access)
- [ ] Wire user-update form save/load for `can_use_overseerr`
- [ ] Optional: users-list badge for Overseerr access
- [ ] Implement `GET /account/nginx-auth/` with `require=tools|overseerr`
- [ ] Auth gate reads live user record (not JWT-only claims) for privilege checks
- [ ] Fail closed on unknown/missing `require` values
- [ ] Return `401` when unauthenticated; `403` when authenticated but denied
- [ ] Emit `X-Website-Username` (and optional privilege headers) on `200`
- [ ] Implement `GET /account/access-denied/`
- [ ] Generic Access Denied copy: “You do not have access.”
- [ ] Overseerr variant (`?app=overseerr`) includes WhatsApp contact instructions
- [ ] Access Denied page does not redirect back into login loops
- [ ] Unit/integration tests for auth gate:
  - [ ] no cookie → 401
  - [ ] missing `can_use_overseerr` field → treated as false → 403 for Overseerr
  - [ ] user without Overseerr flag + `require=overseerr` → 403
  - [ ] user with Overseerr flag + `require=overseerr` → 200
  - [ ] non-tools user + `require=tools` → 403
  - [ ] tools user + `require=tools` → 200
- [ ] Confirm login `next=` allowlist accepts all gated hosts
- [ ] Remove SRM Monitor from `/webapps`
- [ ] Grant `can_use_overseerr` to intended users in production DB
- [ ] Deploy website/FastAPI changes and verify endpoints on www

### Phase 1 — Shadow / canary

Cut over one low-risk tools subdomain first.

#### Implementation checklist

- [ ] Add `snippets/website-auth-tools.conf` (and shared common snippet if used)
- [ ] Add `snippets/website-auth-overseerr.conf` (ready, not necessarily enabled yet)
- [ ] Update nginx `$log_user` map to prefer `$website_username`
- [ ] Switch **one** canary host (e.g. `logger` or `converter`) from `authentik.conf` to `website-auth-tools.conf`
- [ ] Reload nginx
- [ ] Anonymous visit → login redirect with correct `next`
- [ ] Tools user login → returns to canary app
- [ ] Non-tools logged-in user → Access Denied (generic copy)
- [ ] Logout on www → canary requires login again
- [ ] Access log shows website username for allowed requests
- [ ] Confirm Authentik still works on non-migrated hosts
- [ ] Keep `authentik.conf` available for quick rollback of the canary

### Phase 2 — Roll remaining website tool hosts

Migrate the remaining FastAPI tool subdomains.

#### Implementation checklist

- [ ] Switch `monitor.schleising.net` to `website-auth-tools.conf`
- [ ] Switch `converter.schleising.net` (if not canary) to `website-auth-tools.conf`
- [ ] Switch `transcoder.schleising.net` to `website-auth-tools.conf`
- [ ] Switch `logger.schleising.net` (if not canary) to `website-auth-tools.conf`
- [ ] Reload nginx
- [ ] Spot-check each host: anonymous → login; tools user → OK; non-tools → Access Denied
- [ ] Confirm static assets under these hosts still load for allowed users
- [ ] Confirm feeds/football/astronomy/bet unchanged

### Phase 3 — Roll external app proxies

Migrate private external apps, with Overseerr as the allow-list special case.

#### Implementation checklist

**Tools-gated external apps**

- [ ] Switch `pihole` to `website-auth-tools.conf`
- [ ] Switch `plex` to `website-auth-tools.conf` (confirm streaming still works)
- [ ] Switch `portainer` to `website-auth-tools.conf`
- [ ] Switch `prowlarr` to `website-auth-tools.conf`
- [ ] Switch `radarr` to `website-auth-tools.conf`
- [ ] Switch `sonarr` to `website-auth-tools.conf`
- [ ] Switch `tautulli` to `website-auth-tools.conf`
- [ ] Switch `transmission` to `website-auth-tools.conf`
- [ ] Switch `nas` to `website-auth-tools.conf`
- [ ] Switch `router` to `website-auth-tools.conf`
- [ ] Reload nginx after batch or per-host as preferred
- [ ] Spot-check each: anonymous → login; tools user → app loads; non-tools → Access Denied

**Overseerr allow-list**

- [ ] Confirm intended users already have `can_use_overseerr=true`
- [ ] Switch `overseerr` to `website-auth-overseerr.conf`
- [ ] Reload nginx
- [ ] Anonymous → login with Overseerr `next`
- [ ] User **with** Overseerr flag → app loads
- [ ] User **without** Overseerr flag (including tools-only) → Access Denied + WhatsApp message
- [ ] Toggle flag off/on in user management and confirm gate follows without re-login (live user lookup)

### Phase 4 — Stop nginx Authentik usage

Remove Authentik from the migrated nginx path while leaving Authentik itself running.

#### Implementation checklist

- [ ] Confirm no migrated host still includes `authentik.conf`
- [ ] Confirm no migrated host still depends on `/outpost.goauthentik.io`
- [ ] Leave `auth.schleising.net` / Authentik container running
- [ ] Keep Authentik card on `/webapps` for now (or mark as admin-only / legacy)
- [ ] Document rollback procedure (re-include `authentik.conf` per host)
- [ ] Monitor access/error logs for unexpected 401/403 spikes for a few days

### Phase 5 — Later (Authentik retirement)

Only after nothing else depends on Authentik.

#### Implementation checklist

- [ ] Confirm no remaining nginx hosts use Authentik outpost auth
- [ ] Confirm no other services/docs/bookmarks require Authentik SSO
- [ ] Remove Authentik from `/webapps`
- [ ] Remove or disable `auth.schleising.net` server block
- [ ] Shut down Authentik container/stack
- [ ] Archive/remove unused `snippets/authentik.conf` and related security snippets when safe
- [ ] Final smoke test of website-auth gated hosts after Authentik is gone

### Rollback

Keep `authentik.conf` in repo until Phase 4 is stable; revert a host by switching the include back.

#### Rollback checklist

- [ ] Restore `include snippets/authentik.conf;` on the affected host
- [ ] Remove/disable the website-auth include for that host
- [ ] Reload nginx
- [ ] Verify Authentik sign-in path works again for that host
- [ ] Note whether website auth gate / user flags should remain deployed (safe to leave)

## 10. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Auth subrequest misses cookies | Explicitly forward `Cookie`; test cross-subdomain |
| Login loop for denied users | Distinct `403` → Access Denied vs `401` → login |
| Overseerr open to all logged-in users | Explicit `can_use_overseerr`; default false; fail closed |
| Existing users missing the new field | Treat absent field as false; grant via user management before cutover |
| Tools users assume Overseerr access | Keep flags independent; document in UI label |
| Upstream still has weak/local auth | Nginx gate is perimeter only; keep upstream auth where needed |
| JWT expiry mid-session | Same 3-day TTL as site; 401 → login with `next` |
| Plex/large streaming + auth_request | Same as Authentik today; keep buffering settings |
| Internal endpoint abuse | Endpoint only returns auth status; no secrets; rate-limit optional |
| Host header confusion | Pin auth subrequest Host to www; document why |

## 11. Testing checklist

- Anonymous visit to tools host → login redirect with correct `next`
- Login as tools user → return to original deep link
- Login as non-tools user on tools host → Access Denied (“You do not have access.”), no login loop
- Anonymous visit to Overseerr → login redirect with Overseerr `next`
- Login as user **without** `can_use_overseerr` → Access Denied with WhatsApp contact message
- Login as user **with** `can_use_overseerr` → access granted
- Tools-only user without Overseerr flag → Overseerr Access Denied (WhatsApp variant)
- User management: toggle Overseerr checkbox persists and takes effect on next request (or after re-login if JWT omits claims — prefer reading live user record in auth gate)
- Logout on www → gated hosts require login again
- Access log shows website username
- Feeds/football/astronomy/bet unchanged
- SRM Monitor removed from `/webapps`

## 12. Resolved decisions

1. **Privilege default:** tools-only for all current Authentik hosts **except Overseerr**.
2. **Overseerr access:** explicit `can_use_overseerr` boolean on the user record; default/`missing` ⇒ `false`; set only via user management UI; not implied by `can_use_tools`.
3. **403 UX:** redirect to Access Denied page (`/account/access-denied/`), not `/webapps/`.
4. **403 copy:** default “You do not have access.”; Overseerr adds “contact Steve via WhatsApp to gain access.”
5. **Authentik:** keep running for now; retire later after nginx migration is stable.
6. **Identity headers:** gate-only; upstreams do not need username headers for SSO.
7. **Bet:** leave ungated.
8. **SRM Monitor:** retire completely (remove from webapps; not present in nginx config).

## 13. Suggested implementation order

1. User model + user management UI for `can_use_overseerr`
2. FastAPI `/account/nginx-auth/` (+ tests for `tools` and `overseerr`)
3. FastAPI `/account/access-denied/` (generic + Overseerr WhatsApp variant)
4. Grant Overseerr flag to intended users
5. `snippets/website-auth-tools.conf` and `snippets/website-auth-overseerr.conf`
6. Canary one tools host
7. Replace remaining tools Authentik includes
8. Migrate Overseerr with allow-list snippet
9. Logging map + webapps cleanup (SRM Monitor removal; Authentik kept for now)
10. Later: Authentik decommission

### Implementation note

The nginx auth gate should authorize from the **current user document** (or equivalent live lookup), not solely from JWT claims, so toggling `can_use_overseerr` in user management takes effect without forcing a re-login.
