# Design: Cryptics

Status: Anagram helper, thesaurus, and abbreviations implemented.  
Date: 2026-10-25  
Scope: Public crossword tools on the main site. The anagram helper, thesaurus, and abbreviation dictionary are built. Pattern search and the other scratch tools are still only sketched.

## 1. Goal

Add a public **Cryptics** section for solving cryptic crosswords. Anyone can open it. No account, no privilege flag, and no nginx login gate.

Version 1 ships one tool, the **Anagram helper**:

- Type or paste the fodder letters.
- Shuffle them into a new order.
- Click or tap a letter to lock or unlock it where it sits. Drag a letter onto a numbered position to lock it there. Further shuffles move only the unlocked letters.

Later tools sit in the same right nav. The thesaurus (§11) and the dictionary of common cryptic abbreviations (§12) are specified. Pattern search, hidden words, and similar scratch tools can follow the same way.

Non-goals for v1:

- A dictionary or “find the word” solver on the anagram board. That helper rearranges letters the solver already has. Synonyms and cryptic abbreviations are separate tools (§11 and §12). They do not search permutations of the board.
- Saving boards to an account, or syncing them between devices.
- A standalone host (`cryptics.schleising.net`), a PWA manifest, or the Converter design language.
- Clue parsing (anagram indicators, containers, reversals, charades).
- Checking the result against a word list.

## 2. Why this fits the current project

- Public pages already work with the global `get_current_active_user` dependency. A missing or invalid `token` cookie sets `request.state.user` to `None` and still renders the page. Blog, Aircraft, and Units all rely on that.
- Left nav in `website/templates/base.html` already shows Blog, Aircraft, and Units to anonymous visitors. Cryptics belongs in that same always-visible group.
- Right sidebar `{% block sidebar %}` is how Units switches quantity types. Cryptics uses it to switch tools.
- `/tools/` is the wrong prefix. Converter, Monitor, Logger, and Transcoder sit behind nginx `require=tools` and `can_use_tools` ([Website-Nginx-Auth.md](Website-Nginx-Auth.md)). Astronomy is the exception on that prefix, and it is a poor pattern to copy. Cryptics is a public section, so it is mounted at `/cryptics/` from `website/index.py`, the same way Units is mounted at `/units/`.
- The page extends `base.html` and uses the site tokens in `website/static/css/base.css` (`--brand`, `--surface`, `--line`, `--text`). It does not use the standalone webapp shell in [Webapp-Design-Language.md](Webapp-Design-Language.md).

The interaction itself is local. Shuffling and locking are pointer gestures, so the board runs in the browser. The server only sends the HTML shell, the script, and the stylesheet.

## 3. High-level architecture

```mermaid
flowchart LR
  subgraph browser [Browser]
    LeftNav["Left nav: Cryptics"]
    RightNav["Right nav: Anagrams"]
    Board["Letter board"]
    Logic["anagram.js pure helpers"]
    Store["sessionStorage"]
  end

  subgraph fastapi [FastAPI on www]
    Router["GET /cryptics/anagrams/"]
    Template["cryptics/anagrams.html extends base.html"]
  end

  LeftNav --> Router
  RightNav --> Router
  Router --> Template
  Template --> Board
  Board --> Logic
  Logic --> Store
```

There is no JSON API, no database collection, and no write to the account system. Letters never leave the browser.

```mermaid
flowchart TD
  Request["GET /cryptics/anagrams/"] --> Nginx["www nginx, no auth_request"]
  Nginx --> Dep["get_current_active_user"]
  Dep --> Cookie{"valid token cookie?"}
  Cookie -->|absent or invalid| Anonymous["request.state.user = None"]
  Cookie -->|valid active user| SignedIn["request.state.user = that user"]
  Anonymous --> Page["200 Anagrams page"]
  SignedIn --> Page
```

Signed-in users see the same board as anonymous users. `can_use_tools` is not read.

## 4. Scope

### In scope (v1)

- Public routes under `/cryptics/`.
- Left-nav entry **Cryptics**, visible logged out and logged in.
- Home-page card in the same public group as Units, Blog, and Aircraft.
- Right-nav entry **Anagrams**, current on the only v1 page.
- Client-side board: letter entry, optional enumeration, shuffle, drag-to-lock, tap-to-unlock.
- Mouse drag on fine pointers. Long-press then drag on coarse pointers.
- Keyboard equivalent of the drag.
- `sessionStorage` so a reload keeps the current board.
- Mobile layout inside the existing site chrome, with tiles that stay at least 44×44px.

### Out of scope (v1)

- Any tool other than Anagrams. The thesaurus and the abbreviation dictionary are specified in §11 and §12. Other follow-ons are listed in §10.
- Server-side anagram generation, wordlists, or clue markup.
- Shareable lock URLs. The path `/cryptics/anagrams/` is stable; the board state is not put in the query string.
- Accounts, CSRF, or rate limits. The page has no form POST.
- nginx `auth_request`, a new subdomain, or a service worker.

## 5. UX and navigation

### 5.1 Placement

| Surface | Behaviour |
|---------|-----------|
| Left nav | Always-visible **Cryptics** → `/cryptics/`. Place it after **Units**, outside the `{% if request.state.user %}` block in `base.html`. |
| Home | Public card **Cryptics** → `/cryptics/`, in `website/templates/index.html`, outside the logged-in branch. Short line: “Anagrams, synonyms, and cryptic abbreviations.” Icon: `website/static/images/home/cryptics.svg`, a row of letter tiles, same card size as Units. |
| Webapps grid | No card. Cryptics is a site section, not a tools-host or public PWA. |
| Right nav | **Anagrams** → `/cryptics/anagrams/`, with `is-current` and `aria-current="page"` on that page. |
| Header | `{% block header %}` reads **Cryptics**. The tool name sits in the page, as “Length” sits under the Units header. |
| Auth | None. Anonymous requests render the page. |

`/cryptics/` and `/cryptics` redirect **302** to `/cryptics/anagrams/`. Any other single segment (`/cryptics/patterns/`) is **404** until that tool exists.

The right nav order is Anagrams, Thesaurus, Abbreviations. The redirect from `/cryptics/` stays on Anagrams.

### 5.2 Chrome

Desktop, with the existing left and right sidebars:

```text
┌──────────────────────────────────────────────────────────────────┐
│ Cryptics                                                         │
├──────────────┬───────────────────────────────────┬───────────────┤
│ Home         │ Anagrams                          │ Anagrams      │
│ Webapps      │                                   │               │
│ Football     │ Letters                           │               │
│ Aircraft     │ ┌─────────────────────────────┐   │               │
│ Blog         │ │ LISTEN                      │   │               │
│ Units        │ └─────────────────────────────┘   │               │
│ Cryptics     │ Enumeration                       │               │
│ Login        │ ┌─────────────────────────────┐   │               │
│              │ │ 6                           │   │               │
│              │ └─────────────────────────────┘   │               │
│              │                                   │               │
│              │  1   2   3   4   5   6            │               │
│              │ [L] [I] [S] [T] [E] [N]           │               │
│              │                                   │               │
│              │ [ Shuffle ]   [ Clear locks ]     │               │
│              │                                   │               │
│              │ Click a letter to lock or unlock │               │
│              │ it. Drag it onto a position to    │               │
│              │ lock it there. Shuffle moves the  │               │
│              │ others.                           │               │
└──────────────┴───────────────────────────────────┴───────────────┘
```

The right nav has one item in v1. It is still rendered, so the next tool is an extra link rather than a new layout.

Mobile uses the existing header buttons that open the left and right sidebars. The working surface stacks, and the two actions become full-width:

```text
┌──────────────────────────────┐
│ ☰   Cryptics              ☰  │
├──────────────────────────────┤
│ Anagrams                     │
│                              │
│ Letters                      │
│ ┌──────────────────────────┐ │
│ │ CATER                    │ │
│ └──────────────────────────┘ │
│ Enumeration                  │
│ ┌──────────────────────────┐ │
│ │ 5                        │ │
│ └──────────────────────────┘ │
│                              │
│  1    2    3    4    5       │
│ [C]  [A]  [T]  [E]  [R]      │
│                              │
│ ┌──────────────────────────┐ │
│ │ Shuffle                  │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ Clear locks              │ │
│ └──────────────────────────┘ │
│                              │
│ Tap a letter to lock or     │
│ unlock it. Hold, then drag  │
│ it onto a position to lock  │
│ it there.                   │
└──────────────────────────────┘
```

The hint depends on the pointer. Fine pointers (mouse, trackpad) see the click-to-toggle sentence. Coarse pointers see the tap-to-toggle sentence. If both exist, show the click sentence and rely on long-press still working.

### 5.3 Page regions

One column, top to bottom:

1. Title **Anagrams**.
2. **Letters** field. This is the fodder.
3. **Enumeration** field, optional. Placeholder `6` or `4,3` or `3-4`.
4. The board: one slot per letter, numbered from 1.
5. **Shuffle** (primary) and **Clear locks** (secondary). **Clear locks** is disabled when nothing is locked.
6. One sentence of hint text, as above.
7. A polite live region for shuffle and lock announcements. Visually hidden.

Empty letters: hide the board and disable both buttons. Show the hint only. Do not render a row of blank slots that look like an answer grid waiting for a clue number.

### 5.4 Clear control

Every single-line text field has a clear control on the right, inside the box. It appears when the field has text. Activating it empties the field, leaves focus there, and runs the same update as deleting the text: the anagram board rebuilds, and a thesaurus or abbreviation search runs. The Kind menu has no clear control. `suggest.js` adds the control on each Cryptics page.

## 6. Anagram helper

### 6.1 Letters

The letters field is a single-line text input, `autocomplete="off"`, `autocapitalize="characters"`, `spellcheck="false"`, max length 24 after normalisation.

Normalise on each input event:

- Keep `A–Z` and `a–z` only. Drop spaces, punctuation, digits, and accents.
- Uppercase what remains.
- Write the normalised value back into the field, preserving the caret as closely as the stripped characters allow.
- Cap at **24** letters. Extra characters do not enter the field. If a paste exceeds 24, keep the first 24 and set `aria-invalid` on the field with the message “24 letters maximum.” Clear that message once the value is 24 or fewer by an edit that is already under the cap.

Duplicate letters stay. `LETTER` is six tiles, two of which are `T`. Tiles are instances, not unique characters.

Editing the field rebuilds the tiles and keeps locks when the multiset still contains them:

1. Walk the previous tiles in slot order. Keep a **locked** tile when its letter is still required.
2. Walk again and keep **unlocked** tiles for any letters still required.
3. Letters in the new string that were not claimed become new unlocked tiles, appended in the order they appear.
4. Renumber kept tiles, then new tiles, into slots `0 .. n-1`.

So fixing a typo at the end does not unpin a letter the solver has already placed. Deleting a letter shortens the board and closes the gap. Adding a letter puts it in the last slot, unlocked.

### 6.2 Enumeration

Optional. It only groups the slots. It does not change shuffle or lock rules.

Accepted forms, after trimming and stripping one pair of surrounding parentheses:

| Typed | Groups | Gap drawn between groups |
|-------|--------|--------------------------|
| empty | one group the length of the fodder | none |
| `6` | 6 | none |
| `4,3` or `4 3` | 4 then 3 | space |
| `3-4` | 3 then 4 | a hyphen character |
| `4,2,3` | 4, 2, 3 | spaces |
| `2-2,3` | 2, 2, 3 | hyphen, then space |

Grammar: one or more positive integers separated by a comma, a hyphen, or whitespace. Anything else is invalid (`7?`, `4,,3`, `0`, `4.2`).

The numbers must sum to the letter count. Otherwise the field is `aria-invalid` and the message is specific: “Enumeration adds up to 6, but there are 7 letters.” The board falls back to a single group for as long as the enumeration is empty, invalid, or the wrong length, and existing locks stay put. Shuffle remains available.

Slots are numbered `1..n` across the whole answer, including across gaps. A `(4,3)` answer uses positions 1–7, not 1–4 and 1–3.

```text
Valid 4,3

  1   2   3   4       5   6   7
 [C] [A] [R] [T]     [E] [N] [S]
 └──────── 4 ────────┘   └── 3 ─┘


Valid 3-4

  1   2   3   -   4   5   6   7
 [T] [I] [N]     [O] [P] [E] [N]


Mismatch: letters CATER (5), enumeration 4,3

 Enumeration adds up to 7, but there are 5 letters.

  1   2   3   4   5
 [C] [A] [T] [E] [R]
```

Group labels (`4`, `3`) sit under each group in muted text. The per-slot numbers stay, because locks are described by those numbers.

Wrapping: slots wrap to the next line rather than shrinking below 44px. A group stays on one line when it fits. A comma gap is about `1.75rem`, wider than the space between letters in a word. A hyphen gap is a hyphen glyph centred in a slot-sized column so the row still aligns. On a narrow screen a long single word may wrap mid-word.

### 6.3 Board model

```mermaid
flowchart TB
  Letters["Letters field"] --> Tiles["Tiles: id, letter, slot, locked"]
  Enumeration["Enumeration field"] --> Groups["Groups and gaps"]
  Tiles --> Slots["Slots 1..n, always filled"]
  Groups --> Slots
  Shuffle["Shuffle"] --> Unlocked["Unlocked tiles only"]
  Unlocked --> Slots
  Drag["Drop on a slot"] --> Lock["Dropped tile locked, displaced tile unlocked"]
  Lock --> Slots
```

Each tile:

| Field | Meaning |
|-------|---------|
| `id` | Stable id for that instance (`t1`, `t2`, …). Two `E`s never share an id. |
| `letter` | One uppercase `A–Z`. |
| `slot` | `0 .. n-1`. Exactly one tile per slot. |
| `locked` | When true, shuffle will not move this tile. |

The board is always a permutation of the current letters. There is no pool of spare tiles and no empty answer slot. “Position” means one of these slots.

Visual states of a tile:

```text
Unlocked              Locked                 Dragging                Drop target
┌──────────┐          ┌──────────┐           ┌──────────┐            ┌ ─ ─ ─ ─ ┐
│          │          │          │           │          │            │          │
│    L     │          │    S     │           │    L     │            │    T     │
│          │          │   ▔▔▔▔   │           │          │            │          │
└──────────┘          └──────────┘           └──────────┘            └ ─ ─ ─ ─ ┘
 white surface         brand border          follows the pointer     brand outline
                       brand bar under       source slot left empty  on the slot
                       the letter            at 1.06 scale            under the pointer
```

Locked tiles use `border-color: var(--brand)` and a 3px bar in `var(--brand)` along the bottom edge. Unlocked tiles use `var(--surface)` and `var(--line)`. The dragging tile is positioned with `transform` only. The source slot shows an empty well (surface, dashed `var(--line)`) until the pointer is released.

`Clear locks` sets `locked` false on every tile and leaves the order unchanged.

### 6.4 Shuffle

**Shuffle** asks for a new order of the unlocked letters.

```mermaid
flowchart TD
  Start["Shuffle activated"] --> Dragging{"A drag is in progress?"}
  Dragging -->|yes| Ignore["Leave the board unchanged"]
  Dragging -->|no| Enough{"Two or more unlocked tiles, and their letters are not all identical?"}
  Enough -->|no| Ignore
  Enough -->|yes| Mix["Fisher-Yates the unlocked letters"]
  Mix --> Changed{"Letter order differs from the current unlocked order?"}
  Changed -->|yes| Write["Write them back into the unlocked slots, left to right"]
  Changed -->|no| Rotate["Rotate that list until the order differs, then write"]
  Write --> Motion["Slide unlocked tiles into their new slots"]
  Rotate --> Motion
```

Locked tiles do not move, animate, or change id. Slots that are locked are skipped when the new letters are written back.

Worked example. Fodder `LISTEN`, no enumeration. The solver drops `S` on position 1 (the `L` that was there moves to position 3 and is unlocked), then long-presses `N` to lock it in place:

```text
Before shuffle

  1    2    3    4    5    6
 [S]  [I]  [L]  [T]  [E]  [N]
  ▔▔   ·    ·    ·    ·    ▔▔
 lock                      lock

After one shuffle (one possible result)

  1    2    3    4    5    6
 [S]  [T]  [E]  [I]  [L]  [N]
  ▔▔                            ▔▔
```

Positions 2–5 were the only ones free. `S` and `N` stayed. Another press of Shuffle produces a different order of `T`, `E`, `I`, `L` whenever one exists.

Identical unlocked letters (`AAA` with the fourth letter locked) make Shuffle a no-op, because no visible change is possible. The button stays enabled; the press simply does nothing.

Animation: record each unlocked tile’s rectangle, update the letters, then transform each tile from the old rectangle to the new one and clear the transform when the transition ends (about 180ms, ease-out). `prefers-reduced-motion: reduce` skips the transition and paints the new order immediately.

Shortcut: `s` activates Shuffle when focus is not in a text field, a select, or a textarea. The button remains the primary control.

The live region announces “Shuffled” after a shuffle that changed the order. It stays silent when the board does not change.

### 6.5 Locking a letter in a position

A letter becomes locked by being placed on a slot. Placement is a drag on a mouse, and a long-press followed by a drag on a touch screen. Releasing a long-press without leaving the tile locks that letter where it already sits, which is the touch equivalent of dropping on the current slot.

```mermaid
stateDiagram-v2
  [*] --> Resting
  Resting --> Pending: pointer down on a tile
  Pending --> Resting: released before a drag starts
  Pending --> Dragging: mouse or pen moves past 4px
  Pending --> Held: touch held for 400ms without scrolling away
  Held --> Dragging: finger moves
  Held --> Resting: finger released on the same tile
  Dragging --> Resting: released on a slot, or cancelled
```

Side effects on those transitions:

| Transition | Effect |
|------------|--------|
| Pending → Resting, pointer barely moved | Toggle that tile. A click or tap locks it in its current position, or unlocks it if it is already locked. |
| Pending → Resting, touch moved more than 10px before 400ms | Cancel. The browser may scroll. |
| Held → Resting, finger released on the same tile | Lock that tile in its current slot. |
| Dragging → Resting, released over a slot | Place that tile in the slot and lock it. See the swap rule below. |
| Dragging → Resting, released outside the board, or Escape | Cancel. Every tile returns to the slot and lock state it had at pointer down. |

Swap rule when the drop slot differs from the source slot:

- The dragged tile moves to the drop slot and becomes **locked**.
- The tile that occupied the drop slot moves to the source slot and becomes **unlocked**, even if it had been locked. The solver has replaced it.
- Every other tile is unchanged.

Dropping on the source slot locks the tile and moves nothing. That is how a mouse user pins a letter that is already in the right place: drag it a few pixels and release over its own slot, or use the keyboard shortcut below.

```mermaid
sequenceDiagram
  actor Pointer
  participant Tile
  participant Board

  Pointer->>Tile: pointer down
  alt mouse or pen
    Pointer->>Tile: move past 4px
    Tile->>Board: start drag immediately
  else touch
    Note over Tile: 400ms timer, cancel if movement exceeds 10px
    Tile->>Board: timer fired, vibrate 12ms, start drag
  end
  Pointer->>Board: move across position 4
  Board-->>Pointer: outline slot 4
  Pointer->>Board: release over slot 4
  Board->>Board: dragged letter locks in slot 4
  Board->>Board: letter that was in slot 4 moves to the vacated slot, unlocked
```

While a drag is active:

- The tile follows the pointer. Hit-testing uses the slot rectangles, not the floating tile, so the tile does not block the slot under the finger.
- The slot under the pointer gets a `var(--brand)` outline. Locked and unlocked slots are both legal targets.
- `Shuffle` and `Clear locks` do nothing until the gesture ends.
- Touch scrolling is suppressed only after the long-press has armed. Before that, a moving finger scrolls the page.
- `user-select: none` and `-webkit-touch-callout: none` on tiles, so a long-press does not select the letter or open the callout menu. `touch-action: manipulation` on the board.
- After the gesture arms, the touchmove listener is non-passive and calls `preventDefault` so the page does not scroll under the drag.
- A successful arm on a touch pointer may call `navigator.vibrate(12)` when the API exists. Ignore the rejection when it does not.

Mouse and pen skip the 400ms wait. Touch always waits, including on a device that also has a mouse. `pointerType` decides.

Click or tap without dragging toggles the lock on that tile. **Clear locks** unlocks every tile. Keyboard: Backspace or Delete on the focused tile unlocks it.

Dragging a locked tile to a new slot moves the lock with it. The old slot is not left locked, because the lock belongs to the tile.

The live region announces “S locked in position 1” or “S unlocked”. Position numbers are 1-based.

### 6.6 Keyboard

The board is one tab stop per tile, in slot order. Tiles are buttons.

| Key | When | Action |
|-----|------|--------|
| Arrow keys, Home, End | A tile is focused | Move focus between tiles. On a wrapped row, Left/Right follow slot order and Up/Down move by the visual row. |
| Enter or Space | A tile is focused | Pick up that letter. Focus moves with the arrow keys to choose a slot. Enter or Space drops it and locks it. |
| Escape | A letter is picked up | Cancel the pickup. |
| Backspace or Delete | A locked tile is focused, and no pickup is active | Unlock it. |
| `s` | Focus is outside the text fields | Shuffle. |

The pickup is the keyboard form of the drag. The same swap rule applies. A second Enter on the same tile locks it in place.

During pickup the live region says “Picked up S. Choose a position.” The focused slot is the drop target, with the same outline as a pointer hover.

### 6.7 Names and announcements

Each tile’s accessible name is built from its state, for example “Position 3 of 7, S, locked” or “Position 3 of 7, S”. Update the name when the letter or the lock changes.

The board container is labelled “Anagram board”. The visually hidden live region is `aria-live="polite"` and is not a second copy of the hint sentence.

### 6.8 Persistence

On every successful edit, shuffle, lock, or unlock, write one `sessionStorage` record:

```json
{
  "v": 1,
  "letters": "LISTEN",
  "enumeration": "3,3",
  "tiles": [
    {"id": "t3", "letter": "S", "slot": 0, "locked": true},
    {"id": "t2", "letter": "I", "slot": 1, "locked": false}
  ]
}
```

Key: `cryptics.anagram.v1`.

On load, restore it only when `v` is 1 and the tile letters are exactly the multiset of `letters`, with slots `0 .. n-1` each used once. Otherwise ignore the record and start empty. A failed `sessionStorage` (private mode, quota) leaves the tool working for the current view; swallow the exception.

The record lasts for the tab session. It is not copied to an account and not encoded in the URL.

### 6.9 Script unavailable

The letters field, enumeration field, and both buttons are in the HTML. Without JavaScript they do not shuffle. A `<noscript>` line under the title reads “Shuffling and locking run in this browser.” The server still returns 200.

## 7. Module shape

Keep the rules in pure functions in `website/static/js/cryptics/anagram.js`, with a thin DOM layer beside them. The pure functions:

| Function | Responsibility |
|----------|----------------|
| `normalizeLetters(raw)` | Uppercase `A–Z` only, capped at 24. Returns the string and whether the cap was hit. |
| `parseEnumeration(raw, letterCount)` | Groups, separators, and either ok or a message. Empty input is ok and means one group. |
| `syncTiles(previous, letters)` | Edit-stability rules in §6.1. |
| `shuffleUnlocked(tiles)` | §6.4. Returns the next tiles, or the same order when nothing visible can change. |
| `placeAndLock(tiles, tileId, targetSlot)` | §6.5 swap rule. |
| `unlockTile(tiles, tileId)` | Clear one lock. |
| `clearLocks(tiles)` | Clear every lock. |

`shuffleUnlocked` takes a `random` function defaulting to `Math.random`, so a caller can force the Fisher-Yates path in a console check. The DOM layer owns pointer state, focus, `sessionStorage`, and the live region. It does not reimplement the permutation.

No framework. One script, deferred, same pattern as `website/static/js/units/units-page.js`.

## 8. Files

| Piece | Location |
|-------|----------|
| Router | `website/cryptics/__init__.py`, `website/cryptics/router.py` |
| Template | `website/templates/cryptics/anagrams.html` extending `base.html` |
| Script | `website/static/js/cryptics/anagram.js` |
| Styles | `website/static/css/cryptics/cryptics.css`, plus existing `right-nav.css` |
| Home icon | `website/static/images/home/cryptics.svg` |
| Section icons | `website/static/icons/cryptics/` — a white letter tile with a C on the site blue. The anagrams page overrides the site favicon with the SVG and ICO, and links the 192px PNG as the Apple touch icon. No web manifest. |
| Mount | `app.include_router(cryptics_router)` in `website/index.py`, next to `units_router` |
| Left nav and home card | `website/templates/base.html`, `website/templates/index.html` |

Router sketch, public by virtue of having no access check of its own:

- `GET /cryptics/` and `GET /cryptics` → 302 `/cryptics/anagrams/`.
- `GET /cryptics/anagrams/` and `GET /cryptics/anagrams` → the template, context `{ "request": request }`.
- Do not import `require_user_management_access` or read `can_use_tools`.
- Do not attach a router-level `Depends` that redirects anonymous users.

The template sets the document title to `Anagrams · Cryptics`, a meta description along the lines of “Shuffle cryptic-crossword anagrams and lock letters in place.”, and `{% block sidebar %}` with the Anagrams link. Styles use the site tokens from `base.css`. Tile type is the site body face, about `1.25rem`, weight 600, uppercase.

Pyright should be clean on the new Python modules: typed route handlers, no unused imports.

Files for the thesaurus and the abbreviation dictionary are specified in §11 and §12.

## 9. Checks before calling v1 done

The project has no browser test runner. The router is a thin template response, so the meaningful checks are in the browser, anonymous, with no `token` cookie.

Route:

- `GET /cryptics/` redirects to `/cryptics/anagrams/`.
- `GET /cryptics/anagrams/` returns 200 for an anonymous client and does not redirect to `/account/login/`.
- The left nav shows **Cryptics** on that response.
- A signed-in user without `can_use_tools` also receives 200.

Board, on a desktop-width window and a phone-width window:

- Paste `listen to me!` and the field becomes `LISTENTOME` (10 letters).
- Paste a 30-letter string and the field stops at 24, with the maximum message.
- Enumeration `4,3` against 7 letters draws two groups. `3-4` draws a hyphen gap. `4,3` against 5 letters shows the sum message and a single row.
- Shuffle changes the order. A locked letter stays in its slot across several shuffles, including when other letters are duplicates (`LETTER`, lock one `T`).
- Shuffle with every letter locked, or with a single letter, leaves the board as it is.
- Drag `S` onto position 1. It locks, and the letter that was in position 1 occupies the old slot, unlocked. A second shuffle does not move `S`.
- Dropping back onto the same slot locks the letter in place.
- Click or tap a letter to lock it, and click or tap it again to unlock it. **Clear locks** unlocks all of them and does not reorder.
- Reload the tab. Letters, enumeration, order, and locks return. A new tab starts empty.
- With `prefers-reduced-motion: reduce`, a shuffle updates in place.

Touch, on a real phone or a coarse-pointer emulator:

- A short swipe on the page scrolls. It does not pick up a letter.
- A long-press of about half a second picks up the letter. Dragging it onto another position locks it there.
- A long-press released without moving locks the letter in its current position.
- The callout / text-selection menu does not take the gesture.

Keyboard:

- Tab to a tile, Enter, arrow to another position, Enter. The letter locks there.
- Escape cancels a pickup.
- Delete unlocks a focused locked tile.
- `s` shuffles when focus is not in a field, and does nothing while typing in Letters.

Logged-out home page shows the Cryptics card. Logged-out left nav shows Cryptics. Neither is wrapped in a user check.

## 10. Later tools

The right nav is the extension point. Each new tool is a route under `/cryptics/`, a sidebar link, and its own client script if it needs one. None of these require login. The anagram helper stays a shuffler: these tools do not add a “find this permutation” action to the board.

| Tool | Job |
|------|-----|
| Thesaurus | Specified in §11. Synonyms for a definition word, filtered by enumeration. |
| Abbreviations | Specified in §12. Common cryptic abbreviations, looked up from the clue word or from the letters. |
| Pattern | Enter a shape such as `A??E?` and the same lock-and-shuffle board, with given letters pre-locked. Still no wordlist unless a later design adds one on purpose. |
| Hidden word | Paste a clue and highlight a run of letters inside it. |
| Reversal and containers | Small scratch rows for a fodder written backwards, or a fodder split around a contained word. |

Shared rules for §11 and §12:

- Public GET pages on the existing router. No `can_use_tools` check, no account, no POST, no database collection.
- Header **Cryptics**, the same favicon block as Anagrams, styles added to `website/static/css/cryptics/cryptics.css`.
- The first of the two tools introduces `website/templates/cryptics/sidebar.html`. Anagrams switches to that partial in the same change. The partial marks the current tool with `is-current` and `aria-current="page"`. Order: Anagrams, Thesaurus, Abbreviations.
- `/cryptics/` keeps redirecting to `/cryptics/anagrams/`.
- Lookup state lives in the query string, so a reload keeps it and a link can be shared. `sessionStorage` is not used.
- The lists are static files under `website/static/data/cryptics/`. The browser downloads them and filters them. There is no search API.

A public `cryptics.schleising.net` host, mirroring Units, is a separate decision after the section is in use. It would still have no nginx auth gate. It is not required to ship any of these tools.

## 11. Thesaurus

A synonym list for the definition half of a clue. The solver types a word, optionally the enumeration, and reads other words for that meaning.

Illustration of a filled search. The words are layout samples; the shipped list is whatever the build produces from WordNet.

```text
┌──────────────────────────────────────────────────────────────────┐
│ Cryptics                                                         │
├──────────────┬───────────────────────────────────┬───────────────┤
│ …            │ Thesaurus                         │ Anagrams      │
│ Cryptics     │                                   │ Thesaurus     │
│              │ Word                              │ Abbreviations │
│              │ ┌─────────────────────────────┐   │               │
│              │ │ happy                       │   │               │
│              │ └─────────────────────────────┘   │               │
│              │ Length                            │               │
│              │ ┌─────────────────────────────┐   │               │
│              │ │ 5                           │   │               │
│              │ └─────────────────────────────┘   │               │
│              │                                   │               │
│              │ adjective                         │               │
│              │ enjoying or showing joy           │               │
│              │                                   │               │
│              │ [ merry · 5 ]                     │               │
│              │                                   │               │
│              │ 1 synonym                         │               │
└──────────────┴───────────────────────────────────┴───────────────┘
```

Length 5 keeps `merry` and hides a 4-letter synonym such as `glad`. Clearing Length shows every synonym in the sense, shorter ones first.

### 11.1 Routes and page

| Item | Value |
|------|-------|
| Paths | `GET /cryptics/thesaurus/` and `GET /cryptics/thesaurus` |
| Title | `Thesaurus · Cryptics` |
| Description | “Look up synonyms for cryptic-crossword definitions.” |
| Context | `{ "request": request, "q": <query or "">, "n": <length or ""> }` taken from the query string, trimmed. The template prefills the fields. It does not search. |
| Sidebar | `cryptics_tool` = `thesaurus` |

Regions, top to bottom:

1. Title **Thesaurus**.
2. **Word** field. Autofocus, `autocomplete="off"`, `autocapitalize="off"`, `spellcheck="false"`, `enterkeyhint="search"`. After two letters, a suggestion list opens under the field.
3. **Length** field, optional. Same placeholder as the anagram enumeration: `5 or 4,3 or 3-4`.
4. **Search**, a primary button, so the form has a real control. The form is `method="get"` and `action="/cryptics/thesaurus/"`.
5. Results, or one idle / empty sentence.
6. A polite live region, visually hidden.
7. Credit line, muted: “Synonyms from WordNet 3.1, Princeton University.”

`<noscript>` under the title: “Synonym lists are searched in this browser.”

Idle copy, when Word is empty: “Type a definition word. Add a length to match the enumeration.”

### 11.2 What a search returns

```mermaid
flowchart LR
  Fields["Word and length"] --> Script["thesaurus.js"]
  Script --> Shard["One letter shard"]
  Shard --> Senses["Senses for that headword"]
  Senses --> List["Synonyms kept by the length filter"]
  List --> URL["Query string q and n"]
```

The script reads the prefilled fields on load, debounces typing by 150ms, and searches immediately when **Search** is pressed or a synonym is activated. Each change replaces the query string with `replaceState` (`?q=happy&n=5`). Empty values are omitted. The path stays `/cryptics/thesaurus/`. A new history entry is not pushed for each keystroke.

Suggestions use the same shard. A row is a headword that starts with the normalised word and is longer than it. Shorter headwords come first, then alphabetical order, at most eight. One letter still searches, and the list stays closed. Arrow down and arrow up move through the rows. Enter on a highlighted row writes that headword into Word and searches. Enter with nothing highlighted searches the text already there. Escape closes the list. A pointer choice does the same as Enter on that row. A prefilled page leaves the list closed until the next edit, or until an arrow key asks for suggestions.

Word matching:

- Trim, strip one trailing `?` or `.`, lowercase.
- Look up that exact key in the shard.
- A key may be a lemma or an inflected form. When the key names a different lemma, the results start with the line “Showing senses of happy.”
- One letter is a legal query. An empty word clears the results and shows the idle sentence.
- No key: “No entry for that spelling.”

Length matching uses the anagram enumeration grammar from §6.2 (empty, `6`, `4,3`, `3-4`, and the same separators). The numbers are not required to relate to the query word. They describe the synonym.

Each synonym has a derived enumeration:

- Count `A–Z` and `a–z` only.
- Split on spaces into comma-separated groups.
- Split a group on hyphens into hyphen-separated counts.
- Drop any other character, including apostrophes, without opening a gap. `o'clock` derives `6`. `well-being` derives `4-5`. `prime minister` derives `5,8`.

| Length field | Which synonyms stay |
|--------------|---------------------|
| empty | all of them |
| a single number, such as `9` | total letter count equals that number |
| a pattern such as `4-5` or `5,8` | derived enumeration equals the pattern |
| invalid, including a half-typed `4,` | all of them, and the field is `aria-invalid` |

Invalid message: “Length should look like 5 or 4,3 or 3-4.” Results stay visible so a half-typed pattern does not blank the list. When the pattern is valid and every sense loses all of its synonyms, show “Nothing of that length.” and a button **Show every length** that clears the field and searches again.

### 11.3 Results

One block per sense, in the order stored in the shard.

- The heading is the part of speech (`adjective`, `noun`, `verb`, `adverb`, or whatever label the shard stores).
- The gloss is one sentence under the heading.
- Synonyms are buttons. The label is the word, then a muted enumeration (`merry · 5`, or `well-being · 4-5`). Accessible name: “Look up merry, 5 letters.”
- The current key is text in the list, with the suffix “this word”, and is not a button.
- Unfiltered order: letter count ascending, then alphabetical. Filtered order: alphabetical.
- Activating a synonym writes it into Word, leaves Length as it is, moves focus to Word, and searches immediately.
- The live region announces “12 synonyms” or “No entry for that spelling.” It stays quiet during the debounce.

Wrapping: buttons wrap inside the content column. They use the site `.btn` `.btn-outline-secondary` look, not the anagram tile, so a long phrase still fits.

### 11.4 Data

Source: Princeton WordNet 3.1. Senses stay separate, in WordNet’s order. The page serves generated shards, not the raw WordNet database.

| File | Role |
|------|------|
| `scripts/build_cryptics_thesaurus.py` | Reads a local WordNet checkout and writes the shards. The checkout is not committed. |
| `website/static/data/cryptics/thesaurus/a.json` … `z.json` | Headwords whose first letter is that character. |
| `website/static/data/cryptics/thesaurus/other.json` | Headwords that do not start with `a–z`. |
| `website/static/data/cryptics/thesaurus/british.json` | Hand-written aliases, committed. |
| `website/static/data/cryptics/thesaurus/LICENSE` | The WordNet copyright notice and license, copied unchanged. |

A shard is a JSON object. Each key is a lowercase headword. Each value is a list of senses:

```json
{
  "happy": [
    {
      "pos": "adjective",
      "gloss": "enjoying or showing joy",
      "words": ["glad", "cheerful", "happy", "joyful", "merry"]
    }
  ]
}
```

`words` includes the lemma itself. Gloss text is the first sentence of the WordNet gloss, trimmed.

The build also writes keys for WordNet’s exception-list inflections (`happier` → the senses of `happy`). Those values add `"lemma": "happy"` beside the sense list. Synonym lists are inlined, so one shard answers the query.

`british.json` is a flat object of British spelling to WordNet lemma, used when WordNet has no key of its own for the British spelling (`"colour": "color"`). The build copies that lemma’s senses into the British key and sets `lemma`. When WordNet already has the British key, the alias is ignored. Synonym spellings stay as WordNet stores them. The first version does not rewrite American spellings inside the lists.

The script fetches nothing at build time beyond the files in the local checkout. It fails if any shard exceeds 600KB gzipped. The largest letter in WordNet is about 530KB once glosses are trimmed to their first clause. It prints the key count and the largest shard.

At runtime the browser fetches `/data/cryptics/thesaurus/h.json` when the query starts with `h`, and keeps fetched shards in memory for the page view. A failed fetch shows “The word list did not load. Try again.” and leaves the fields as they are. A second attempt retries that shard.

### 11.5 Boundaries

This tool answers “what else means happy?”. It leaves the following to other tools, or out of the section:

- Letter patterns, anagrams, and “all words of length 5”.
- Gazetteers. Rivers, artists, birds, and cities are not senses, even where setters treat the category name as a definition (`flower` for a river).
- Cryptic abbreviations. Those are §12. `about` in the thesaurus returns ordinary synonyms; `about` in the abbreviation dictionary returns `C`, `CA`, and `RE`.
- Commercial crossword thesauruses. Their entries are not transcribed.

### 11.6 Files

| Piece | Location |
|-------|----------|
| Route | Two GET paths on `cryptics_router` |
| Template | `website/templates/cryptics/thesaurus.html` |
| Suggestions | `website/static/js/cryptics/suggest.js`, deferred |
| Script | `website/static/js/cryptics/thesaurus.js`, deferred, after `suggest.js` |
| Data | The shard directory in §11.4 |
| Sidebar | `website/templates/cryptics/sidebar.html` |

Pyright stays clean on the router and on `scripts/build_cryptics_thesaurus.py`.

### 11.7 Checks when this tool is built

- Anonymous `GET /cryptics/thesaurus/` returns 200 and does not redirect to login. The right nav marks Thesaurus current and still links to Anagrams and Abbreviations.
- `?q=happy&n=5` prefills both fields and, once the shard loads, shows only synonyms whose letter count is 5.
- `well-being` is offered as `4-5`. Length `9` and length `4-5` both keep it. Length `4,5` does not.
- A half-typed `4,` shows the length message and the unfiltered senses.
- Activating a synonym searches that word and leaves the length in place.
- Typing `happ` opens a list whose first row is `happy`. Typing `h` leaves the list closed. Choosing `happy` searches that word.
- `centres`, via `british.json`, shows the senses of `center`, with “Showing senses of center.” WordNet already has its own entry for `colour`, so that alias is ignored and the page shows WordNet’s senses for `colour` directly.
- An unknown spelling shows “No entry for that spelling.” An empty word shows the idle sentence.
- Reload keeps the query. A new tab opened on the bare path starts empty.
- With JavaScript disabled, the fields and the noscript line render, and no result list appears.
- The license file is served beside the shards, and the credit line is on the page.

## 12. Abbreviations

A dictionary of the short forms UK cryptic setters use often. One box answers both directions: the word in the clue, or the letters it might become.

```text
┌──────────────────────────────────────────────────────────────────┐
│ Cryptics                                                         │
├──────────────┬───────────────────────────────────┬───────────────┤
│ …            │ Abbreviations                     │ Anagrams      │
│ Cryptics     │                                   │ Thesaurus     │
│              │ Look up                           │ Abbreviations │
│              │ ┌─────────────────────────────┐   │               │
│              │ │ about                       │   │               │
│              │ └─────────────────────────────┘   │               │
│              │ Letters          Kind             │               │
│              │ ┌──────────┐    ┌──────────────┐  │               │
│              │ │ 1        │    │ All          │  │               │
│              │ └──────────┘    └──────────────┘  │               │
│              │                                   │               │
│              │ Can be written                    │               │
│              │ ┌───┐                             │               │
│              │ │ C │  about          circa       │               │
│              │ └───┘                             │               │
│              │                                   │               │
│              │ 1 abbreviation                    │               │
└──────────────┴───────────────────────────────────┴───────────────┘
```

The same page with `RA` and Letters left empty:

```text
Can mean
┌────┐
│ RA │  artist            Royal Academician
└────┘
┌────┐
│ RA │  Royal Artillery
└────┘
┌────┐
│ RA │  Royal Academy
└────┘
```

Those rows are examples of the entry shape. The committed JSON is the catalogue.

### 12.1 Routes and page

| Item | Value |
|------|-------|
| Paths | `GET /cryptics/abbreviations/` and `GET /cryptics/abbreviations` |
| Title | `Abbreviations · Cryptics` |
| Description | “Common cryptic-crossword abbreviations, both ways.” |
| Context | `{ "request": request, "q": …, "letters": …, "kind": … }` from the query string, trimmed. `kind` is omitted from the template when it is missing or `all`. |
| Sidebar | `cryptics_tool` = `abbreviations` |

Regions, top to bottom:

1. Title **Abbreviations**.
2. **Look up** field. Autofocus, `autocomplete="off"`, `autocapitalize="off"`, `spellcheck="false"`, `enterkeyhint="search"`. A suggestion list opens under the field while the catalogue can complete the text.
3. **Letters**, optional. A single width, placeholder `any`. Filters by how many letters the abbreviation has.
4. **Kind**, a `<select>` of All plus each category in §12.3. Default All.
5. **Search**, primary, in a `method="get"` form whose action is `/cryptics/abbreviations/`.
6. Up to two groups: **Can be written**, then **Can mean**.
7. A count line, then the credit.
8. A polite live region, visually hidden.

`<noscript>`: “The abbreviation list is searched in this browser.”

Idle copy: “Look up a word from the clue, or the letters it might become.”

Credit, muted: “A short list of abbreviations in regular UK cryptic use, written for this site.”

### 12.2 Search

```mermaid
flowchart TD
  Query["Look up, letters, kind"] --> Fetch["abbreviations.json, once"]
  Fetch --> Norm["Normalise the query"]
  Norm --> Written["Rows whose meaning contains the query"]
  Norm --> Means["Rows whose abbreviation equals the query letters"]
  Written --> Filters["Kind and letter-count filters"]
  Means --> Filters
  Filters --> Groups["Can be written, then Can mean"]
```

The script fetches `/data/cryptics/abbreviations.json` on the first search and reuses it. Debounce is 150ms. **Search** runs immediately. The query string is kept with `replaceState`: `?q=about&letters=1&kind=general`. Default and empty fields are omitted (`kind=all` is omitted).

Suggestions use that same list, and the same Letters and Kind filters. The keyboard matches the thesaurus: arrows move, Enter on a highlighted row fills Look up and searches, Enter with nothing highlighted searches the current text, and Escape closes the list. A prefilled page leaves the list closed until the next edit.

- From the first letter, when the query has no space: abbreviations that start with its `A–Z` letters. The abbreviation that equals those letters is left off. Each abbreviation appears once, with one of its meanings beside it.
- From two letters: a catalogue phrase that starts with the normalised query, or a word inside a phrase that starts with it. The exact query is left off.

Abbreviations take up to four of the eight places. Meanings fill what is left, and either side takes spare places when the other side is short. Shorter text comes first. `art` still matches no result row. The list can offer `artist` and `Artillery`, and choosing one runs that search.

Normalise the query: trim, lowercase, turn `.` `,` `-` `'` and `/` into spaces, collapse spaces.

**Can be written** — the query is a meaning. A row matches when the normalised query equals the normalised meaning, or appears inside it as a contiguous run of whole words. `artillery` matches `Royal Artillery`. `royal artillery` matches it. `art` matches neither `artist` nor `Royal Artillery`.

**Can mean** — the query is an abbreviation. Take the query’s `A–Z` letters only. If the original query contained a space, skip this group. Otherwise a row matches when those letters equal `abbr`. `ra`, `R.A.`, and `RA` all match `RA`.

A query may fill both groups. `a` can be a meaning (“a French”) and an abbreviation. **Can be written** comes first.

| Control | Effect |
|---------|--------|
| Letters empty | Keep every abbreviation length. |
| Letters `1` … `6` | Keep rows whose `abbr` has that length. |
| Letters anything else, including `0` or `12` | Ignore the filter, set `aria-invalid`, message “Use a number from 1 to 6.” |
| Kind All | Keep every category. |
| Kind set | Keep that category. |

Sort inside each group: shorter abbreviation first, then abbreviation A–Z, then meaning A–Z.

No rows: “Nothing common for that.” The live region announces “3 abbreviations for about” or that empty sentence.

Each row is one `<li>` whose text is the abbreviation, the meaning, and the note. The abbreviation is drawn as a tile (surface, line border, uppercase, the anagram tile face) and stays in the list item’s text. It is not a separate control. The note is muted. A missing note leaves that spot empty.

### 12.3 Catalogue

One JSON file, hand-written, committed:

`website/static/data/cryptics/abbreviations.json`

```json
{
  "v": 1,
  "entries": [
    {"abbr": "C", "means": "about", "category": "general", "note": "circa"},
    {"abbr": "CA", "means": "about", "category": "general"},
    {"abbr": "RE", "means": "about", "category": "general", "note": "regarding"},
    {"abbr": "AU", "means": "gold", "category": "chemistry", "note": "aurum"},
    {"abbr": "RA", "means": "artist", "category": "general", "note": "Royal Academician"}
  ]
}
```

| Field | Rule |
|-------|------|
| `abbr` | Uppercase `A–Z`, length 1–6. |
| `means` | Display phrase, 1–40 characters, with at least one letter. Stored in the case the page should show. |
| `category` | One of `general`, `chemistry`, `roman`, `chess`, `compass`, `foreign`, `rank`. |
| `note` | Optional. 1–40 characters. A reason, written for this site (`circa`, `aurum`, `Elizabeth Regina`). Omitted when there is nothing useful to add. |

The same pair of `abbr` and `means` appears once, compared with the meaning case-folded. The same abbreviation with different meanings is several rows. The same meaning with different abbreviations is several rows.

`scripts/check_cryptics_abbreviations.py` loads the file and exits non-zero on a broken rule. The router does not import it. Pyright stays clean on the script.

Inclusion: a row earns its place when solvers of UK cryptic puzzles (Times, Guardian, and the same tradition) are expected to recognise it. The committed file is the catalogue, and it runs to several hundred rows. Categories:

| Category | What belongs there | Examples of the shape |
|----------|--------------------|------------------------|
| general | Everyday setter short forms | about → C, CA, RE; queen → ER; sailor → AB |
| chemistry | Element symbols setters actually use | gold → AU; silver → AG; iron → FE; lead → PB |
| roman | The standard numerals | hundred → C; fifty → L; five → V; thousand → M |
| chess | Piece letters | king → K; bishop → B; knight → N |
| compass | Points of the compass | north → N; point → N, S, E, W |
| foreign | Articles and tiny function words from French, German, Spanish, and Latin | the French → LE, LA; a French → UN, UNE; the German → DER, DIE, DAS |
| rank | Ranks, arms, and services | able seaman → AB; gunners → RA; engineers → RE; navy → RN |

A new category means editing this table, the checker’s enum, and the Kind select in the same change.

Left out of this file:

- A transcription of Chambers, Bradford, or any other published abbreviation dictionary. Facts and setter conventions are rewritten in our own rows.
- Gazetteers. `flower` may have a row whose meaning is “a river”. The rivers themselves are not entries. `artist` is the meaning of `RA`, not a list of painters.
- Indicators that consume letters without producing a short form: anagram, container, reversal, deletion, homophone. Those are reading marks on a clue, not abbreviations.
- Generated dumps of states, counties, rivers, or airports. A handful of textbook forms (CA, NY) may be added as ordinary `general` rows when they are in regular use. They are typed in, not imported.

### 12.4 Files

| Piece | Location |
|-------|----------|
| Route | Two GET paths on `cryptics_router` |
| Template | `website/templates/cryptics/abbreviations.html` |
| Suggestions | `website/static/js/cryptics/suggest.js`, deferred |
| Script | `website/static/js/cryptics/abbreviations.js`, deferred, after `suggest.js` |
| Data | `website/static/data/cryptics/abbreviations.json` |
| Checker | `scripts/check_cryptics_abbreviations.py` |
| Sidebar | The partial from §11, if Thesaurus has already added it; otherwise this tool adds it |

### 12.5 Checks when this tool is built

- Anonymous `GET /cryptics/abbreviations/` returns 200. Abbreviations is current in the right nav. Anagrams and Thesaurus are still linked.
- `about` with Letters `1` shows `C` and hides `CA` and `RE`.
- `artillery` shows the Royal Artillery row under **Can be written**. `art` shows neither `artist` nor `Royal Artillery` in the results. The suggestion list can still offer `artist` and `Artillery`.
- Typing `ra` offers a longer abbreviation such as `RAC`. Choosing it fills Look up and searches.
- `r.a.` and `RA` show the same **Can mean** rows. `royal artillery` does not enter **Can mean**, because of the space.
- Kind `chemistry` with `gold` shows `AU` and hides a non-chemistry row for the same word, if one exists.
- Letters `12` shows the range message and the unfiltered rows.
- An unknown word shows “Nothing common for that.” An empty field shows the idle sentence.
- `?q=about&letters=1` survives a reload.
- The checker accepts the committed file and rejects a lowercase abbreviation, a duplicate pair, an unknown category, and a 7-letter abbreviation.
- With JavaScript disabled, the form renders and the noscript line is visible.
