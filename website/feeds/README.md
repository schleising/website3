# RSS Feed Reader

## Requirements

### General

1. All reads and writes to the database shall be performed through the FastAPI API, and not directly from the frontend
2. All data sent to or read from the database shall be validated and sanitized to prevent security vulnerabilities
3. All data sent to or read from the database shall be implemented as Pydantic models to ensure data integrity and consistency
4. All data sent to or read from the client shall be validated and sanitized to prevent security vulnerabilities
5. All data sent to or read from the client shall be implemented as Pydantic models to ensure data integrity and consistency
6. The feed reader shall be implemented as a page on the main site and retain the look and feel of the rest of the site, including the left and right menus
7. The feed reader shall be usable on both desktop and mobile devices, with a responsive design that adapts to different screen sizes
8. All client reads shall use the Fetch API to call the FastAPI endpoints, with appropriate error handling and user feedback for failed requests
9. All client writes shall use the Fetch API to call the FastAPI endpoints, with appropriate error handling and user feedback for failed requests
10. Where possible, Javascript code shall be minimised in favour of server-side rendering and FastAPI endpoints to maintain a clear separation of concerns and reduce the attack surface of the frontend, but any necessary Javascript code shall follow best practices for security and maintainability, including proper validation, sanitization, and error handling of user input and API responses
11. Javascript code shall use JSDoc comments for all functions and methods, and include type annotations for all parameters and return values to ensure code clarity and maintainability
12. Python code shall use type annotations for all functions and methods, and include docstrings that describe the purpose, parameters, and return values of each function to ensure code clarity and maintainability
13. All code shall follow the existing style and conventions of the codebase, including naming conventions, file organization, and formatting, to ensure consistency across the project
14. Where possible, new code shall be implemented in a way that allows for easy testing and maintainability, including modular design, separation of concerns, and adherence to SOLID principles
15. Where possible, new code shall be implemented with performance and scalability in mind, including efficient database queries, caching strategies, and asynchronous processing where appropriate
16. A local docker-compose-test.yaml file shall be provided that includes the necessary services and configuration to run the feed reader feature in a local development environment, including nginx with appropriate config file and a MongoDB instance with the appropriate collections and indexes, and any necessary environment variables or configuration files
17. The test environment shall be configured to allow for easy testing and debugging of the feed reader feature, including access to logs, database data, and the ability to simulate different scenarios such as feed fetch failures or large numbers of subscriptions
18. The test environment shall be documented with instructions on how to set up and run the feed reader feature, including any necessary dependencies, configuration steps, and troubleshooting tips
19. The test environment shall be designed to closely mirror the production environment to ensure that tests are representative and reliable, while still allowing for flexibility and ease of use for developers
20. The test environment shall be maintained and updated as needed to ensure that it remains functional and relevant as the feed reader feature evolves and new requirements are added
21. The test environment shall only be accessible from the local machine to prevent unauthorized access and ensure the security of the development environment
22. Automated tests shall be written to be run in the test environment
23. The tests shall ensure coverage of all requirements, including edge cases and error scenarios, to ensure the robustness and reliability of the feed reader feature
24. Requirements that cannot be automatically tested in the test environment shall be documented with justification and a plan for manual testing to ensure that they are still verified and validated as part of the development process
25. Test results shall be documented and a Test -> Requirement and Requirement -> Test traceability matrix shall be maintained to ensure that all requirements are covered by tests and that all tests are linked to specific requirements for easy reference and validation

### UI and Functionality Reqs

26. The feed reader links shall appear between Football and OpenSky Database in the left menu and the home page
27. The feed reader shall only be available to logged in users
28. The feed reader shall be available at the URL path `/feeds/`
29. The feed reader shall display unread articles in full width cards on the feed reader page, with the oldest articles appearing at the top of the list
30. The feed reader shall auto refresh every 10 seconds to check for new feeds
31. The feed reader shall allow the user to move through feeds using j (next) and k (previous) keys, and open the selected feed in a new tab using the spacebar or enter key
32. The feed reader shall allow the user to add new RSS feeds by entering a URL and clicking an "Add" button, all feeds should be added to a category
33. The user added feeds shall be stored in the database for each user and persist across sessions
34. A user shall only be able to view and modify their own feeds, not the feeds of other users
35. The right menu shall display a list of feed categories and an unread article count for each category
36. clicking on a category shall filter the feed reader to only show articles from that category
37. The right menu shall have an all feeds category that shows all articles regardless of category with an unread article count for all feeds
38. The right menu shall have a Recently Read category that shows all articles that have been marked as read in the last 7 days, sorted by most recently read first 
39. It shall be possible to "mute" and "unmute" categories
40. Articles from a muted category shall not appear in the feed reader, whichever category is currrently selected, but the unread article count for that category shall still be displayed in the right menu
41. Muting and unmuting categories shall be implemented as a user preference stored in the database, and shall persist across sessions
42. The feed reader shall have a settings page where users can manage their feed preferences, including muting and unmuting categories
43. The feed reader shall import OPML files from Feedly and Inoreader, and add the feeds to the user's subscriptions with appropriate category assignments based on the OPML structure
44. The feed reader shall export the user's feed subscriptions and categories as an OPML file that can be imported into other feed readers
45. Categories shall have colours that are consistent across the feed reader and the right menu, and these colours shall be stored in the database as a user preference for each category

### Backend Reqs

46. Backend code shall be implemented in the backend/src/feeds directory, with appropriate subdirectories for database models, API endpoints, and background tasks
47. The backend code shall be implemented as a new thread that runs alongside the existing backend code, and shall not interfere with the existing functionality of the site
48. The backend code shall be responsible for creating a mongodb feeds database and the necessary collections and indexes to store feed data, user subscriptions, and read/unread status of articles
49. The backend code shall fetch subscribed feeds once every 5 minutes and store the feed data in the database
50. The backend shall only fetch each subscription once, even if multiple users are subscribed to the same feed, to avoid unnecessary network requests and reduce load on the feed servers
51. The feeds shall be fetched and stored in the database in a way that allows for efficient querying and filtering by category, read/unread status, and other relevant criteria
52. The backend shall mark articles as deleted after 7 days
53. The backend shall permanently delete articles that have been marked as deleted for more than 30 days
54. The backend shall not delete or purge articles that are still marked as unread by any user, even if they are older than the retention thresholds, to prevent data loss of unread articles

### FastAPI Reqs

55. FastAPI code shall be implemented in the website/feeds directory, with appropriate subdirectories for API endpoints and database models
56. The FastAPI code shall mark articles as read when the user clicks on them in the feed reader UI, and this information shall be stored in the database
57. The FastAPI code shall provide an API endpoint to retrieve the list of feeds and their associated articles for the logged in user, with support for filtering by category and read/unread status
58. The FastAPI code shall provide an API endpoint to add new feed subscriptions for the logged in user, which shall validate the feed URL and return an appropriate response if the URL is invalid or the feed cannot be fetched
59. The FastAPI code shall provide an API endpoint to mark articles as read for the logged in user, which shall update the database accordingly and return an appropriate response if the article ID is invalid or the user is not authorized to modify the article's read status
60. The FastAPI code shall provide an API endpoint to retrieve the list of feed categories and their associated unread article counts for the logged in user, which shall return an appropriate response if the user is not authorized to access the feed data

## Design

This section provides a full implementation design for review only.
No application code is included in this document.

### 1. Design Goals

1. Keep the feed reader fully integrated into the main site layout and auth model.
2. Enforce strict server-side ownership checks and Pydantic validation for every read/write boundary.
3. Centralize feed fetching in backend worker threads so the frontend never touches RSS sources directly.
4. Preserve responsive behavior with clear desktop/mobile parity.
5. Make feed ingestion and querying efficient at scale using deduped fetches, retention policies, and indexes.
6. Support standards-compatible OPML interoperability for import/export with category preservation.
7. Prefer server-side rendering and minimize JavaScript to reduce frontend attack surface.
8. Enforce explicit typing, documentation, and codebase conventions for maintainable implementation.
9. Support category color preferences that are consistent across feed cards and right menu.
10. Protect unread content from retention purges until all users have marked it as read.

### 2. High-Level Architecture

```mermaid
flowchart LR
	 Browser["Main Site Feed Reader UI"] -->|Initial request| FastAPI["FastAPI Feed Endpoints (/feeds/*)"]
	 FastAPI -->|SSR HTML templates| Browser
	 Browser -->|Minimal Fetch API calls| FastAPI
	 Settings["Feed Settings (Add/Mute/Color/OPML)"] -->|Fetch API + file upload/download| FastAPI
	 FastAPI -->|Read/Write via Pydantic models| FeedDB[("MongoDB: feeds database")]
	 Worker["Backend Feed Worker Thread"] -->|Every 5 min fetch unique subscriptions| Sources["External RSS/Atom Feeds"]
	 Sources -->|Feed payloads| Worker
	 Worker -->|Upsert feed sources and articles| FeedDB
	 Worker -->|Retention with unread safety rules| FeedDB
	 FastAPI -->|Unread counts, articles, settings| Browser
	 FastAPI -->|OPML 2.0 import/export| Settings
```

#### 2.1 Component Responsibilities

1. Frontend page (`/feeds/`):
	1. Renders unread article cards full-width, oldest first.
	2. Polls every 10 seconds for updates.
	3. Handles keyboard navigation (`j`, `k`, `Enter`, `Space`).
	4. Uses SSR for initial render and minimal JavaScript for incremental interactions.
	5. Uses only Fetch API calls to FastAPI for all reads/writes.
2. FastAPI layer (`website/feeds`):
	1. Authenticates user context.
	2. Validates request and response models using Pydantic.
	3. Applies authorization rules so users only access their own subscriptions/preferences/read state.
	4. Returns category counts and article lists with filtering.
	5. Serves server-rendered templates for primary page loads.
3. Backend worker (`backend/src/feeds`):
	1. Runs in a dedicated thread alongside existing backend behavior.
	2. Fetches each unique subscribed feed once every 5 minutes.
	3. Upserts source metadata and normalized articles.
	4. Applies retention lifecycle rules while preserving unread articles.
4. MongoDB feeds database:
	1. Stores global feed/article data.
	2. Stores per-user subscriptions, categories, mute and color preferences, and read state.

#### 2.2 OPML Interoperability Flow

```mermaid
sequenceDiagram
	autonumber
	participant U as User
	participant UI as Feed Settings Page
	participant API as FastAPI /feeds
	participant DB as MongoDB

	U->>UI: Upload OPML file
	UI->>API: POST /feeds/api/opml/import (multipart)
	API->>API: Validate XML and normalize outlines
	API->>DB: Upsert categories
	API->>DB: Upsert subscriptions by canonical feed URL
	DB-->>API: Import summary (created, updated, skipped)
	API-->>UI: 200 + summary payload

	U->>UI: Export subscriptions
	UI->>API: GET /feeds/api/opml/export
	API->>DB: Query user categories and subscriptions
	DB-->>API: Structured subscription set
	API->>API: Build OPML 2.0 document
	API-->>UI: application/xml download
```

### 3. Data Model Design

```mermaid
erDiagram
	 USER ||--o{ FEED_CATEGORY : defines
	 USER ||--o{ USER_FEED_SUBSCRIPTION : owns
	 USER ||--o{ USER_ARTICLE_STATE : tracks
	 FEED_SOURCE ||--o{ FEED_ARTICLE : publishes
	 FEED_SOURCE ||--o{ USER_FEED_SUBSCRIPTION : subscribed_by
	 FEED_CATEGORY ||--o{ USER_FEED_SUBSCRIPTION : groups
	 FEED_ARTICLE ||--o{ USER_ARTICLE_STATE : status_for

	 USER {
		  string user_id PK
		  string username
	 }
	 FEED_CATEGORY {
		  string category_id PK
		  string user_id FK
		  string name
		  boolean muted
		  string color_hex
		  int sort_order
		  datetime created_at
		  datetime updated_at
	 }
	 FEED_SOURCE {
		  string feed_id PK
		  string normalized_url UK
		  string title
		  string etag
		  string last_modified
		  datetime last_fetched_at
		  string fetch_status
		  datetime created_at
		  datetime updated_at
	 }
	 USER_FEED_SUBSCRIPTION {
		  string subscription_id PK
		  string user_id FK
		  string feed_id FK
		  string category_id FK
		  datetime created_at
		  datetime updated_at
	 }
	 FEED_ARTICLE {
		  string article_id PK
		  string feed_id FK
		  string dedupe_key UK
		  string title
		  string link
		  string author
		  datetime published_at
		  datetime fetched_at
		  boolean is_deleted
		  datetime deleted_at
	 }
	 USER_ARTICLE_STATE {
		  string state_id PK
		  string user_id FK
		  string article_id FK
		  boolean is_read
		  datetime read_at
		  datetime created_at
		  datetime updated_at
	 }
```

#### 3.1 Collection Notes

1. `feed_source`:
	1. One document per canonical feed URL.
	2. Shared by all users to satisfy deduped fetching.
2. `feed_article`:
	1. Global article cache keyed by `feed_id + dedupe_key`.
	2. Includes retention lifecycle markers.
3. `user_feed_subscription`:
	1. Maps users to feeds and categories.
4. `feed_category`:
	1. User-owned categories, mute state, and color preference.
5. `user_article_state`:
	1. Per-user read/unread lifecycle.
	2. Supports recently read queries for last 7 days.

#### 3.2 Index Plan

1. `feed_source`:
	1. Unique: `normalized_url`.
2. `feed_article`:
	1. Unique: `(feed_id, dedupe_key)`.
	2. Query: `(published_at)`.
	3. Query: `(is_deleted, deleted_at)` for retention scans.
3. `user_feed_subscription`:
	1. Unique: `(user_id, feed_id)`.
	2. Query: `(user_id, category_id)`.
4. `feed_category`:
	1. Unique: `(user_id, name)`.
	2. Query: `(user_id, muted, sort_order)`.
	3. Query: `(user_id, color_hex)` for settings and consistency checks.
5. `user_article_state`:
	1. Unique: `(user_id, article_id)`.
	2. Query: `(user_id, is_read, read_at)`.
	3. Query: `(article_id, is_read)` to support unread-preservation retention checks.

### 4. Backend Worker Design (`backend/src/feeds`)

```mermaid
sequenceDiagram
	 autonumber
	 participant W as Feed Worker Thread
	 participant DB as MongoDB
	 participant R as RSS Feed Server

	 loop Every 5 minutes
		  W->>DB: Read active subscriptions and dedupe by feed URL
		  DB-->>W: Unique feed list with ETag/Last-Modified metadata
		  par For each unique feed
				W->>R: GET feed URL (conditional headers)
				alt 304 Not Modified
					 R-->>W: Not Modified
				else 200 OK
					 R-->>W: Feed document
					 W->>DB: Upsert FEED_SOURCE metadata
					 W->>DB: Upsert FEED_ARTICLE by stable dedupe key
				else Network or parse failure
					 R-->>W: Error or invalid payload
					 W->>DB: Record fetch failure and next retry window
				end
		  end
		  W->>DB: Mark articles deleted when age > 7 days
		  W->>DB: Find deleted articles older than 30 days
		  W->>DB: Purge only if no USER_ARTICLE_STATE remains unread
	 end
```

#### 4.1 Threading and Isolation

1. Worker starts as a dedicated background thread in backend startup.
2. It does not block HTTP request processing.
3. It uses independent DB sessions/clients with retry/backoff.

#### 4.2 Feed Deduplication Strategy

1. Build canonical feed URL (normalize scheme, host case, trailing slash, query ordering where safe).
2. Resolve all user subscriptions to unique canonical URLs.
3. Fetch each unique feed once per cycle.
4. Fan out resulting articles to all subscribed users through query joins (no duplicate network fetch).

#### 4.3 Retention Guard Rules

1. Soft-delete threshold remains 7 days for aging articles.
2. Hard-delete threshold remains 30 days only for soft-deleted articles.
3. Hard delete is blocked if any user still has the article marked unread.
4. Purge and read-state cleanup run in a transaction-like batch to avoid orphaned state.

### 5. FastAPI Design (`website/feeds`)

#### 5.1 Route Structure

1. Page routes:
	1. `GET /feeds/`: main feed reader page.
	2. `GET /feeds/settings/`: feed settings page.
2. API routes:
	1. `GET /feeds/api/articles`: list articles with filters.
	2. `GET /feeds/api/categories`: list categories with unread counts and mute state.
	3. `POST /feeds/api/subscriptions`: add subscription with category assignment.
	4. `POST /feeds/api/articles/{article_id}/read`: mark article as read.
	5. `POST /feeds/api/categories/{category_id}/mute`: mute category.
	6. `POST /feeds/api/categories/{category_id}/unmute`: unmute category.
	7. `POST /feeds/api/categories/{category_id}/color`: update category color preference.
	8. `POST /feeds/api/opml/import`: import subscriptions/categories from OPML.
	9. `GET /feeds/api/opml/export`: export subscriptions/categories as OPML.

#### 5.2 API Query Semantics

1. Category filter values:
	1. `all`: all non-muted categories.
	2. specific category id: only that category, unless muted.
	3. `recently-read`: read items in last 7 days, newest first, excluding muted categories.
2. Primary article listing for main reader:
	1. unread only by default.
	2. oldest first (ascending publication date).
3. Mute behavior:
	1. muted categories are excluded from article results in all filters.
	2. unread counts remain visible in right menu.
4. Category presentation metadata:
	1. category payloads include `color_hex` so right menu and feed cards stay visually consistent.

#### 5.3 Pydantic Models

1. Request models:
	1. Add subscription payload.
	2. Mark read payload.
	3. Category mute/unmute payload.
	4. Category color update payload.
	5. OPML import options payload (duplicate policy, default category policy).
2. Response models:
	1. Article card model.
	2. Category count model.
	3. Standard operation result model.
	4. Category metadata model with mute state and color.
	5. OPML import summary model (created feeds/categories, skipped duplicates, errors).
3. Validation rules:
	1. Feed URL must be `http/https`, normalized, length-limited.
	2. Category IDs and article IDs must be valid object IDs/UUIDs.
	3. User-scoped resources must enforce owner equality with authenticated user.
	4. OPML documents must be well-formed XML with supported outline attributes and size limits.
	5. Category color must be a normalized hex color string (for example `#1F6FEB`).

#### 5.4 OPML Import and Export Contract

1. Import (`POST /feeds/api/opml/import`):
	1. Accept `multipart/form-data` with an OPML file and optional import settings.
	2. Support Feedly/Inoreader OPML outline conventions:
		1. category/group outlines without `xmlUrl`.
		2. feed outlines with `xmlUrl`, optional `title`/`text`.
	3. Normalize feed URLs to canonical form before dedupe checks.
	4. Create missing categories and map imported feeds to those categories.
	5. Return deterministic summary payload with counts and per-item errors.
2. Export (`GET /feeds/api/opml/export`):
	1. Return `application/xml` OPML 2.0 document.
	2. Emit categories as parent outlines and subscribed feeds as child outlines.
	3. Include all user subscriptions and category associations, including muted categories and category colors where supported by reader extensions.
	4. Sort categories and feeds for stable output so repeated exports are diff-friendly.

### 6. Frontend UX and Interaction Design

#### 6.1 Navigation and Access

1. Add `Feeds` nav entry between Football and OpenSky Database:
	1. Left menu.
	2. Home page links.
2. Only render feeds links and page content for logged-in users.
3. Non-authenticated requests redirect to login with `next=/feeds/`.

#### 6.2 Main Reader Layout

1. Keep existing site shell (header, left menu, right menu, footer).
2. Main content region:
	1. full-width article cards.
	2. oldest unread at top.
3. Right sidebar:
	1. `All Feeds` with unread total.
	2. category list with unread count each.
	3. `Recently Read` bucket (7-day window).
	4. muted categories visually indicated.
	5. category color chips/markers consistent with feed cards.

#### 6.3 Keyboard and Interaction Rules

1. `j`: move selection to next visible article card.
2. `k`: move selection to previous visible article card.
3. `Enter` or `Space`:
	1. open selected article link in new tab.
	2. mark article as read via API.
4. Category click:
	1. apply category filter.
	2. keep muted exclusion logic.

#### 6.4 Polling and UI Consistency

1. Poll interval: 10 seconds.
2. Polling request includes current category/filter context.
3. Preserve current keyboard selection where possible after refresh.
4. Show non-blocking error banner/toast if refresh fails.

#### 6.5 Settings and OPML Workflows

1. Settings page includes:
	1. Add feed URL with category assignment.
	2. Import OPML action (file picker + submit).
	3. Export OPML action (download current user subscriptions/categories).
	4. Category mute/unmute controls.
	5. Category color picker with reset-to-default option.
2. Import UX behavior:
	1. Show import preview summary after successful parse.
	2. Display created/updated/skipped counts and actionable error rows.
	3. Refresh category counts and unread views after successful import.
	4. Assign deterministic fallback colors to newly created categories when color is absent.

#### 6.6 Rendering and JavaScript Strategy

1. Render primary feed list and menus server-side for initial page load.
2. Restrict JavaScript to:
	1. keyboard navigation,
	2. polling refresh,
	3. OPML upload/download interactions,
	4. category color picker interactivity.
3. Keep JavaScript modules small and page-scoped to limit surface area.
4. All JavaScript functions include JSDoc with typed params and return values.
5. All JavaScript user input and API responses are validated and sanitized before use.

```mermaid
sequenceDiagram
	 autonumber
	 participant U as User
	 participant UI as Feed Reader Page
	 participant API as FastAPI /feeds
	 participant DB as MongoDB

	 U->>UI: Open /feeds/
	 UI->>API: GET /feeds/api/categories
	 API->>DB: Aggregate unread counts per category
	 DB-->>API: Category counts and mute flags
	 API-->>UI: Categories response
	 UI->>API: GET /feeds/api/articles?category=all&status=unread
	 API->>DB: Query unread articles oldest-first
	 DB-->>API: Article cards
	 API-->>UI: Articles response
	 loop Every 10 seconds
		  UI->>API: GET /feeds/api/articles?cursor=last_seen
		  API->>DB: Fetch deltas for current filter
		  DB-->>API: New or changed articles
		  API-->>UI: Delta response
	 end
	 U->>UI: j/k and Enter or Space
	 UI->>API: POST /feeds/api/articles/{articleId}/read
	 API->>DB: Upsert USER_ARTICLE_STATE
	 DB-->>API: Updated read state
	 API-->>UI: 200 OK
```

### 7. Security and Data Integrity

1. All frontend reads/writes use Fetch -> FastAPI only.
2. Every endpoint:
	1. authenticates session.
	2. validates payload with Pydantic.
	3. sanitizes free-text fields.
	4. enforces user ownership in DB query predicate.
3. Server never trusts category IDs/article IDs from client without owner checks.
4. Output models are Pydantic-serialized to avoid accidental leakage.
5. Add rate limits for subscription creation and read-write bursts.

### 8. Retention and Data Lifecycle

1. Worker marks articles as logically deleted after 7 days (`is_deleted=true`, `deleted_at=now`).
2. Worker evaluates hard-delete candidates with `is_deleted=true` and `deleted_at < now-30d`.
3. Candidates are only purged when no user has an unread state for that article.
4. User read-state records are removed only for safely purged articles.
5. Articles that remain unread for any user are retained regardless of age.

### 9. Error Handling and Resilience

1. Feed fetch failure:
	1. store last failure reason/timestamp in `feed_source`.
	2. continue processing other feeds.
2. Invalid feed URL at subscription time:
	1. return 400 with actionable message.
3. Temporary API failure during polling:
	1. show warning toast.
	2. keep last successful article list.
4. Worker retry/backoff:
	1. exponential backoff per source on repeated failures.
5. OPML import failure:
	1. return 400 for malformed XML or unsupported structure.
	2. return 413 for oversized files.
	3. return per-item validation errors without aborting entire import when possible.
6. Category color update failure:
	1. return 400 for invalid color format.
	2. return 403 for category ownership mismatch.

### 10. Monitoring and Auditability

1. Structured logs:
	1. feed fetch attempts/results.
	2. subscription add/remove actions.
	3. article read mutations.
2. Metrics:
	1. fetch success rate.
	2. fetch duration.
	3. new article ingest count.
	4. API latency/error rate.
	5. OPML import success/failure count and item-level rejection rate.
	6. OPML export count and average generation latency.
	7. retention skip count due to unread-preservation guard.
	8. category color update count and validation failure rate.

### 11. Engineering Standards and Conventions

#### 11.1 JavaScript Standards

1. All functions and methods use JSDoc comments.
2. JSDoc includes explicit parameter and return typing.
3. JavaScript modules follow least-privilege patterns and avoid unnecessary global state.

#### 11.2 Python Standards

1. All functions and methods include Python type annotations.
2. Public and internal functions include docstrings describing purpose, parameters, and return values.
3. Endpoint handlers and service-layer logic keep explicit types across request, domain, and response boundaries.

#### 11.3 Codebase Consistency

1. New code follows existing file layout and naming conventions in website and backend repositories.
2. Formatting and style align with existing project standards.
3. New modules are organized by responsibility to preserve clarity.

### 12. Testability and Maintainability

1. Prefer service-layer abstractions to isolate parsing, validation, persistence, and transport.
2. Keep endpoint handlers thin and delegate business logic to testable modules.
3. Design import/export and retention logic as deterministic units that can be tested with fixtures.
4. Favor composable interfaces and dependency boundaries that support SOLID-style extension.

### 13. Performance and Scalability

1. Preserve deduplicated feed fetch strategy to minimize external requests.
2. Use targeted indexes to support unread/category filters and retention guards.
3. Keep polling deltas narrow and query plans bounded by user scope.
4. Use short-lived caching where appropriate (for example category unread aggregates) with safe invalidation on user mutations.
5. Use asynchronous processing where appropriate for feed ingestion and OPML parsing.
6. Keep SSR-first approach for fast first render and reduced frontend compute cost.

### 14. Traceability Table: Requirements -> Design

| Requirement | Requirement Summary | Design References |
| --- | --- | --- |
| 1 | DB access via FastAPI only | 2.1, 5.1, 7 |
| 2 | Validate/sanitize DB data | 5.3, 7 |
| 3 | Pydantic models for DB data | 5.3, 7 |
| 4 | Validate/sanitize client data | 5.3, 6.4, 7 |
| 5 | Pydantic models for client data | 5.3, 7 |
| 6 | Main-site page and menus | 2.1, 6.2 |
| 7 | Responsive desktop/mobile | 6.2, 6.4 |
| 8 | Client reads via Fetch + errors | 2.1, 6.4, 9 |
| 9 | Client writes via Fetch + errors | 2.1, 6.3, 6.5, 9 |
| 10 | Minimize JavaScript, SSR-first, secure JS practices | 2, 6.6, 7, 11.1 |
| 11 | JSDoc with typed params and returns | 6.6, 11.1 |
| 12 | Python type annotations and docstrings | 11.2 |
| 13 | Follow existing codebase style and conventions | 11.3 |
| 14 | Modular, maintainable, SOLID-oriented design | 12 |
| 15 | Performance and scalability focus | 3.2, 4.2, 10, 13 |
| 16 | Nav placement between Football/OpenSky | 6.1 |
| 17 | Logged-in users only | 6.1, 7 |
| 18 | Reader URL `/feeds/` | 5.1, 6.1 |
| 19 | Unread cards, oldest first | 2.1, 5.2, 6.2 |
| 20 | 10-second auto refresh | 2.1, 6.4 |
| 21 | j/k + enter/space behavior | 2.1, 6.3 |
| 22 | Add feed URL + category | 5.1, 5.3, 6.5 |
| 23 | User subscriptions persist | 3.1, 3.2 |
| 24 | User data isolation | 5.3, 7 |
| 25 | Right menu categories + unread count | 2.1, 5.1, 6.2 |
| 26 | Category click filters feeds | 5.2, 6.3 |
| 27 | All Feeds category + unread count | 5.2, 6.2 |
| 28 | Recently Read last 7 days, newest first | 5.2, 6.2 |
| 29 | Mute/unmute categories | 5.1, 6.5 |
| 30 | Muted categories hidden but counts shown | 5.2, 6.2 |
| 31 | Mute persistence in DB | 3.1, 5.1, 6.5 |
| 32 | Settings page for preferences | 5.1, 6.5 |
| 33 | OPML import (Feedly/Inoreader) + categories | 2.2, 5.1, 5.3, 5.4, 6.5 |
| 34 | OPML export of subscriptions/categories | 2.2, 5.1, 5.4, 6.5 |
| 35 | Category colors consistent and persisted per user | 3.1, 5.1, 5.3, 6.2, 6.5 |
| 36 | Backend code in `backend/src/feeds` | 2.1, 4 |
| 37 | Backend thread parallel to existing site | 4.1 |
| 38 | MongoDB feeds DB + collections/indexes | 3, 3.2 |
| 39 | Fetch subscribed feeds every 5 minutes | 4 |
| 40 | Deduped fetch for shared subscriptions | 4.2 |
| 41 | Efficient query/filter storage | 3.2, 4.2, 5.2, 13 |
| 42 | Mark articles deleted after 7 days | 4, 8 |
| 43 | Permanently delete after 30 days | 4, 8 |
| 44 | Never purge unread articles for any user | 4.3, 8 |
| 45 | FastAPI code in `website/feeds` | 2.1, 5 |
| 46 | Mark article read on click | 5.1, 6.3 |
| 47 | Endpoint for feeds/articles with filters | 5.1, 5.2 |
| 48 | Endpoint to add subscriptions + URL validation | 5.1, 5.3, 9 |
| 49 | Endpoint to mark read with validation/auth checks | 5.1, 5.3, 7, 9 |
| 50 | Endpoint for categories + unread count + auth | 5.1, 5.2, 7 |

### 15. Traceability Table: Design -> Requirements

| Design Section | Requirement IDs |
| --- | --- |
| 1. Design Goals | 1, 6, 7, 10, 15, 33, 34, 35, 44 |
| 2. High-Level Architecture | 1, 6, 8, 9, 10, 17, 36, 37, 38, 39, 45 |
| 2.1 Component Responsibilities | 1, 6, 8, 9, 10, 17, 19, 25, 35, 36, 37, 45 |
| 2.2 OPML Interoperability Flow | 33, 34 |
| 3. Data Model Design | 23, 31, 35, 38, 41 |
| 3.1 Collection Notes | 23, 31, 35, 38 |
| 3.2 Index Plan | 23, 38, 41, 44 |
| 4. Backend Worker Design | 36, 37, 39, 40, 41, 42, 43, 44 |
| 4.1 Threading and Isolation | 37 |
| 4.2 Feed Deduplication Strategy | 40, 41 |
| 4.3 Retention Guard Rules | 42, 43, 44 |
| 5. FastAPI Design | 1, 2, 3, 4, 5, 24, 45, 46, 47, 48, 49, 50 |
| 5.1 Route Structure | 1, 18, 22, 29, 32, 33, 34, 35, 46, 47, 48, 49, 50 |
| 5.2 API Query Semantics | 19, 25, 26, 27, 28, 30, 35, 47, 50 |
| 5.3 Pydantic Models | 2, 3, 4, 5, 24, 33, 35, 48, 49 |
| 5.4 OPML Import and Export Contract | 33, 34 |
| 6. Frontend UX and Interaction Design | 6, 7, 10, 16, 17, 19, 20, 21, 22, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 46 |
| 6.1 Navigation and Access | 16, 17, 18 |
| 6.2 Main Reader Layout | 6, 7, 19, 25, 27, 28, 30, 35 |
| 6.3 Keyboard and Interaction Rules | 21, 26, 46 |
| 6.4 Polling and UI Consistency | 8, 9, 20 |
| 6.5 Settings and OPML Workflows | 22, 29, 31, 32, 33, 34, 35 |
| 6.6 Rendering and JavaScript Strategy | 10, 11 |
| 7. Security and Data Integrity | 1, 2, 3, 4, 5, 10, 17, 24, 49, 50 |
| 8. Retention and Data Lifecycle | 42, 43, 44 |
| 9. Error Handling and Resilience | 8, 9, 48, 49 |
| 10. Monitoring and Auditability | 15, 41, 44 |
| 11. Engineering Standards and Conventions | 11, 12, 13 |
| 11.1 JavaScript Standards | 11 |
| 11.2 Python Standards | 12 |
| 11.3 Codebase Consistency | 13 |
| 12. Testability and Maintainability | 14 |
| 13. Performance and Scalability | 15, 41 |

### 16. Phased Delivery Plan (No Code in This Step)

1. Phase 1: Data schemas, indexes, and feed worker thread skeleton.
2. Phase 2: FastAPI endpoints and ownership validation.
3. Phase 3: Feed reader page, right-menu filters, category colors, and polling.
4. Phase 4: Keyboard navigation, settings page, mute/unmute UX, OPML import/export UX.
5. Phase 5: Retention guard implementation for unread preservation and cleanup safety.
6. Phase 6: Monitoring, quality-gate checks (typing, docs, JSDoc), and requirement acceptance checklist.

