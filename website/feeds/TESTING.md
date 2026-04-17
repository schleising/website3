# Feed Reader Testing

## Local Test Environment

The local feed-reader test environment is defined in `docker-compose-test.yaml`.

Services:
- `nginx`: local reverse proxy (localhost only) routing to FastAPI.
- `fastapi`: website service with feed routes and templates.
- `backend`: backend worker including the feed ingestion thread.
- `mongodb`: local MongoDB test instance.
- `feed-tests` (profile `tests`): automated unit test runner.

Files used by the test stack:
- `docker-compose-test.yaml`
- `test/nginx/nginx-test.conf`
- `test/config/website_db_server.txt`

## Start and Stop

Start runtime services:

```bash
docker compose -f docker-compose-test.yaml up --build -d nginx fastapi backend mongodb
```

Open the app:
- `http://127.0.0.1:8010/`

Stop services:

```bash
docker compose -f docker-compose-test.yaml down
```

Reset test database volumes:

```bash
docker compose -f docker-compose-test.yaml down -v
```

## Automated Tests

Run feed-reader automated tests:

```bash
docker compose -f docker-compose-test.yaml --profile tests run --rm feed-tests
```

Current automated suite:
- `website/tests/feeds/test_feed_helpers.py`
  - URL normalization validation.
  - Category color validation.
  - Deterministic category color stability.
  - OPML parsing behavior and error handling.
- `backend/src/tests/feed_worker/test_refresh_policy.py`
  - Force-refresh flag scheduling behavior.
  - 5-minute baseline fetch cadence guard behavior.
  - Retry-window interaction with forced refreshes.

## Backend Failure Simulation

The backend feed worker supports environment toggles in `docker-compose-test.yaml`:

- `FEEDS_FAILURE_MODE=none`: normal behavior.
- `FEEDS_FAILURE_MODE=timeout`: simulate request timeout failures.
- `FEEDS_FAILURE_MODE=http500`: simulate upstream HTTP failure.
- `FEEDS_FAILURE_MODE=malformed`: simulate malformed feed payload parsing.

You can also shorten polling intervals for faster testing:

- `FEEDS_CYCLE_INTERVAL_SECONDS` (default `15`)
- `FEEDS_FETCH_INTERVAL_SECONDS` (default `300`)
- `FEEDS_RETRY_AFTER_FAILURE_SECONDS` (default `900`)
- `FEEDS_SOFT_DELETE_DAYS` (default `7`)
- `FEEDS_HARD_DELETE_DAYS` (default `30`)

## Debugging

Inspect logs:

```bash
docker compose -f docker-compose-test.yaml logs -f nginx
```

```bash
docker compose -f docker-compose-test.yaml logs -f fastapi
```

```bash
docker compose -f docker-compose-test.yaml logs -f backend
```

```bash
docker compose -f docker-compose-test.yaml logs -f mongodb
```

## Traceability

### Test to Requirement Matrix

| Test ID | Automated | Requirement IDs | Notes |
| --- | --- | --- | --- |
| UT-FEEDS-001 | Yes | 44, 23 | OPML parsing and malformed XML handling.
| UT-FEEDS-002 | Yes | 51 | Category color normalization validation.
| UT-FEEDS-003 | Yes | 33, 64 | Feed URL normalization and validation for subscription flows.
| UT-FEEDS-004 | Yes | 46, 55, 23 | Backend source refresh policy (forced refresh and 5-minute cadence).
| IT-FEEDS-001 | Manual | 26, 27, 28, 35, 36, 37, 38, 39, 40, 41, 42, 43, 51 | Navigation/auth/sidebar/category/settings behavior across feed pages.
| IT-FEEDS-002 | Manual | 29, 30, 31, 32, 47, 48, 49, 50, 62, 63, 65, 66 | Reader rendering, polling stability, keyboard, read-state and API behavior.
| IT-FEEDS-003 | Manual | 46, 52, 53, 54, 55, 56, 57, 58, 59, 60 | Backend worker threading, immediate refresh trigger, dedupe, retention lifecycle.
| IT-FEEDS-004 | Manual | 45 | OPML export payload and interoperability checks.
| IT-FEEDS-005 | Manual | 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 61 | Test environment lifecycle, accessibility, and architecture evidence.
| IT-FEEDS-006 | Manual | 33, 34, 64 | Subscription persistence and per-user ownership isolation.

### Requirement to Test Matrix

| Requirement ID | Test IDs |
| --- | --- |
| 16 | IT-FEEDS-005 |
| 17 | IT-FEEDS-005 |
| 18 | IT-FEEDS-005 |
| 19 | IT-FEEDS-005 |
| 20 | IT-FEEDS-005 |
| 21 | IT-FEEDS-005 |
| 22 | UT-FEEDS-001, UT-FEEDS-002, UT-FEEDS-003, UT-FEEDS-004, IT-FEEDS-005 |
| 23 | UT-FEEDS-001, UT-FEEDS-002, UT-FEEDS-003, UT-FEEDS-004, IT-FEEDS-005 |
| 24 | IT-FEEDS-001, IT-FEEDS-002, IT-FEEDS-003, IT-FEEDS-004, IT-FEEDS-005, IT-FEEDS-006 |
| 25 | UT-FEEDS-001, UT-FEEDS-002, UT-FEEDS-003, UT-FEEDS-004, IT-FEEDS-005 |
| 26 | IT-FEEDS-001 |
| 27 | IT-FEEDS-001 |
| 28 | IT-FEEDS-001 |
| 29 | IT-FEEDS-002 |
| 30 | IT-FEEDS-002 |
| 31 | IT-FEEDS-002 |
| 32 | IT-FEEDS-002 |
| 33 | UT-FEEDS-003, IT-FEEDS-006 |
| 34 | IT-FEEDS-006 |
| 35 | IT-FEEDS-001 |
| 36 | IT-FEEDS-001 |
| 37 | IT-FEEDS-001 |
| 38 | IT-FEEDS-001 |
| 39 | IT-FEEDS-001 |
| 40 | IT-FEEDS-001 |
| 41 | IT-FEEDS-001 |
| 42 | IT-FEEDS-001 |
| 43 | IT-FEEDS-001 |
| 44 | UT-FEEDS-001, IT-FEEDS-001 |
| 45 | IT-FEEDS-004 |
| 46 | UT-FEEDS-004, IT-FEEDS-003 |
| 47 | IT-FEEDS-002 |
| 48 | IT-FEEDS-002 |
| 49 | IT-FEEDS-002 |
| 50 | IT-FEEDS-002 |
| 51 | UT-FEEDS-002, IT-FEEDS-001 |
| 52 | IT-FEEDS-003 |
| 53 | IT-FEEDS-003 |
| 54 | IT-FEEDS-003 |
| 55 | UT-FEEDS-004, IT-FEEDS-003 |
| 56 | IT-FEEDS-003 |
| 57 | IT-FEEDS-003 |
| 58 | IT-FEEDS-003 |
| 59 | IT-FEEDS-003 |
| 60 | IT-FEEDS-003 |
| 61 | IT-FEEDS-005 |
| 62 | IT-FEEDS-002 |
| 63 | IT-FEEDS-002 |
| 64 | UT-FEEDS-003, IT-FEEDS-006 |
| 65 | IT-FEEDS-002 |
| 66 | IT-FEEDS-002 |
