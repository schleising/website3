"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof document !== "undefined") {
    api.mount(document);
  }
  root.CrypticsAnagram = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MAX_LETTERS = 24;
  const STORAGE_KEY = "cryptics.anagram.v1";
  const MOUSE_DRAG_PX = 4;
  const TOUCH_SCROLL_PX = 10;
  const LONG_PRESS_MS = 400;

  function copyTile(tile) {
    return {
      id: tile.id,
      letter: tile.letter,
      slot: tile.slot,
      locked: Boolean(tile.locked),
    };
  }

  function normalizeLetters(raw, selectionStart) {
    const source = String(raw);
    const caretAt = selectionStart == null ? source.length : selectionStart;
    let letters = "";
    let caret = 0;
    let seenCaret = false;
    let capped = false;

    for (let index = 0; index < source.length; index += 1) {
      if (index === caretAt) {
        caret = letters.length;
        seenCaret = true;
      }
      const character = source[index].toUpperCase();
      if (!/^[A-Z]$/.test(character)) {
        continue;
      }
      if (letters.length >= MAX_LETTERS) {
        capped = true;
        continue;
      }
      letters += character;
    }

    if (!seenCaret) {
      caret = letters.length;
    }
    return { letters: letters, capped: capped, caret: caret };
  }

  function enumerationMessage(sum, letterCount) {
    const verb = letterCount === 1 ? "is" : "are";
    const noun = letterCount === 1 ? "letter" : "letters";
    return `Enumeration adds up to ${sum}, but there ${verb} ${letterCount} ${noun}.`;
  }

  function invalidEnumeration() {
    return {
      ok: false,
      groups: null,
      separators: [],
      message: "Use a number, or groups such as 4,3 or 3-4.",
    };
  }

  function parseEnumeration(raw, letterCount) {
    let cleaned = String(raw).trim();
    if (cleaned.startsWith("(") && cleaned.endsWith(")") && cleaned.length >= 2) {
      cleaned = cleaned.slice(1, -1).trim();
    }
    if (cleaned === "") {
      return {
        ok: true,
        groups: letterCount > 0 ? [letterCount] : [],
        separators: [],
        message: "",
      };
    }
    if (!/^[\d,\-\s]+$/.test(cleaned)) {
      return invalidEnumeration();
    }

    const parts = cleaned.split(/(\d+)/).filter(function (part) {
      return part !== "";
    });
    if (parts.length === 0 || parts.length % 2 === 0 || !/^\d+$/.test(parts[0])) {
      return invalidEnumeration();
    }

    const groups = [];
    const separators = [];
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (index % 2 === 0) {
        if (!/^\d+$/.test(part)) {
          return invalidEnumeration();
        }
        const value = Number(part);
        if (!Number.isSafeInteger(value) || value < 1) {
          return invalidEnumeration();
        }
        groups.push(value);
        continue;
      }
      const compact = part.trim();
      if (compact === "") {
        separators.push(" ");
      } else if (compact === ",") {
        separators.push(" ");
      } else if (compact === "-") {
        separators.push("-");
      } else {
        return invalidEnumeration();
      }
    }

    const sum = groups.reduce(function (total, value) {
      return total + value;
    }, 0);
    if (sum !== letterCount) {
      return {
        ok: false,
        groups: null,
        separators: [],
        message: enumerationMessage(sum, letterCount),
        sum: sum,
      };
    }
    return { ok: true, groups: groups, separators: separators, message: "" };
  }

  function nextTileNumber(previous) {
    let max = 0;
    previous.forEach(function (tile) {
      const match = /^t(\d+)$/.exec(tile.id);
      if (match) {
        max = Math.max(max, Number(match[1]));
      }
    });
    return max + 1;
  }

  function letterCounts(letters) {
    const counts = new Map();
    for (const letter of letters) {
      counts.set(letter, (counts.get(letter) || 0) + 1);
    }
    return counts;
  }

  function syncTiles(previous, letters) {
    const required = letterCounts(letters);
    const sorted = previous.map(copyTile).sort(function (a, b) {
      return a.slot - b.slot;
    });
    const claimed = new Set();

    function claim(tile) {
      const remaining = required.get(tile.letter) || 0;
      if (remaining <= 0) {
        return;
      }
      required.set(tile.letter, remaining - 1);
      claimed.add(tile.id);
    }

    sorted.forEach(function (tile) {
      if (tile.locked) {
        claim(tile);
      }
    });
    sorted.forEach(function (tile) {
      if (!tile.locked) {
        claim(tile);
      }
    });

    const kept = sorted.filter(function (tile) {
      return claimed.has(tile.id);
    });
    let nextNumber = nextTileNumber(previous);
    const extras = [];
    for (const letter of letters) {
      const remaining = required.get(letter) || 0;
      if (remaining <= 0) {
        continue;
      }
      required.set(letter, remaining - 1);
      extras.push({
        id: "t" + nextNumber,
        letter: letter,
        slot: kept.length + extras.length,
        locked: false,
      });
      nextNumber += 1;
    }

    return kept.concat(extras).map(function (tile, slot) {
      return {
        id: tile.id,
        letter: tile.letter,
        slot: slot,
        locked: tile.locked,
      };
    });
  }

  function fisherYates(items, random) {
    const next = items.slice();
    for (let index = next.length - 1; index > 0; index -= 1) {
      let unit = random();
      if (!(unit >= 0) || unit >= 1) {
        unit = 0;
      }
      const swapIndex = Math.floor(unit * (index + 1));
      const swap = next[index];
      next[index] = next[swapIndex];
      next[swapIndex] = swap;
    }
    return next;
  }

  function letterSequence(tiles) {
    return tiles.map(function (tile) {
      return tile.letter;
    }).join("");
  }

  function rotateUntilDifferent(tiles) {
    const original = letterSequence(tiles);
    let current = tiles.slice();
    for (let step = 0; step < current.length; step += 1) {
      current = current.slice(1).concat(current[0]);
      if (letterSequence(current) !== original) {
        return current;
      }
    }
    return tiles;
  }

  function shuffleUnlocked(tiles, random) {
    const rng = random || Math.random;
    const ordered = tiles.map(copyTile).sort(function (a, b) {
      return a.slot - b.slot;
    });
    const unlocked = ordered.filter(function (tile) {
      return !tile.locked;
    });
    if (unlocked.length < 2) {
      return ordered;
    }
    const sequence = letterSequence(unlocked);
    if ([...sequence].every(function (letter) {
      return letter === sequence[0];
    })) {
      return ordered;
    }

    let mixed = fisherYates(unlocked.map(copyTile), rng);
    if (letterSequence(mixed) === sequence) {
      mixed = rotateUntilDifferent(mixed);
    }

    const unlockedSlots = unlocked.map(function (tile) {
      return tile.slot;
    });
    const placed = new Map(ordered.map(function (tile) {
      return [tile.slot, tile];
    }));
    mixed.forEach(function (tile, index) {
      const slot = unlockedSlots[index];
      placed.set(slot, {
        id: tile.id,
        letter: tile.letter,
        slot: slot,
        locked: false,
      });
    });
    return [...placed.values()].sort(function (a, b) {
      return a.slot - b.slot;
    });
  }

  function placeAndLock(tiles, tileId, targetSlot) {
    const next = tiles.map(copyTile);
    const dragged = next.find(function (tile) {
      return tile.id === tileId;
    });
    if (!dragged) {
      return next;
    }
    const sourceSlot = dragged.slot;
    if (!Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot >= next.length) {
      return next;
    }
    if (sourceSlot === targetSlot) {
      dragged.locked = true;
      return next;
    }
    const occupant = next.find(function (tile) {
      return tile.slot === targetSlot;
    });
    dragged.slot = targetSlot;
    dragged.locked = true;
    if (occupant && occupant !== dragged) {
      occupant.slot = sourceSlot;
      occupant.locked = false;
    }
    return next.sort(function (a, b) {
      return a.slot - b.slot;
    });
  }

  function unlockTile(tiles, tileId) {
    return tiles.map(function (tile) {
      if (tile.id !== tileId) {
        return copyTile(tile);
      }
      return {
        id: tile.id,
        letter: tile.letter,
        slot: tile.slot,
        locked: false,
      };
    });
  }

  function clearLocks(tiles) {
    return tiles.map(function (tile) {
      const copy = copyTile(tile);
      copy.locked = false;
      return copy;
    });
  }

  function slotLetters(tiles) {
    return tiles.slice().sort(function (a, b) {
      return a.slot - b.slot;
    }).map(function (tile) {
      return tile.letter;
    }).join("");
  }

  function tilesMatchLetters(tiles, letters) {
    if (!Array.isArray(tiles) || tiles.length !== letters.length) {
      return false;
    }
    const counts = letterCounts(letters);
    const slots = new Set();
    const ids = new Set();
    for (const tile of tiles) {
      if (!tile || typeof tile.id !== "string" || tile.id === "") {
        return false;
      }
      if (ids.has(tile.id) || typeof tile.letter !== "string" || !/^[A-Z]$/.test(tile.letter)) {
        return false;
      }
      const remaining = counts.get(tile.letter) || 0;
      if (remaining <= 0) {
        return false;
      }
      counts.set(tile.letter, remaining - 1);
      if (!Number.isInteger(tile.slot) || tile.slot < 0 || tile.slot >= letters.length || slots.has(tile.slot)) {
        return false;
      }
      if (typeof tile.locked !== "boolean") {
        return false;
      }
      ids.add(tile.id);
      slots.add(tile.slot);
    }
    return slots.size === letters.length;
  }

  function mount(doc) {
    const lettersInput = doc.getElementById("cryptics-letters");
    const enumerationInput = doc.getElementById("cryptics-enumeration");
    const lettersError = doc.getElementById("cryptics-letters-error");
    const enumerationError = doc.getElementById("cryptics-enumeration-error");
    const board = doc.getElementById("cryptics-board");
    const shuffleButton = doc.getElementById("cryptics-shuffle");
    const clearButton = doc.getElementById("cryptics-clear-locks");
    const hint = doc.getElementById("cryptics-hint");
    const live = doc.getElementById("cryptics-live");
    if (!(lettersInput instanceof HTMLInputElement)
      || !(enumerationInput instanceof HTMLInputElement)
      || !(lettersError instanceof HTMLElement)
      || !(enumerationError instanceof HTMLElement)
      || !(board instanceof HTMLElement)
      || !(shuffleButton instanceof HTMLButtonElement)
      || !(clearButton instanceof HTMLButtonElement)
      || !(hint instanceof HTMLElement)
      || !(live instanceof HTMLElement)) {
      return;
    }

    let letters = "";
    let enumeration = "";
    let tiles = [];
    let lettersCapped = false;
    let gesture = null;
    let pickupId = null;
    let touchBlocker = null;

    function escapeId(id) {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(id);
      }
      return id.replace(/[^a-zA-Z0-9_-]/g, "");
    }

    function announce(message) {
      live.textContent = "";
      if (message === "") {
        return;
      }
      window.requestAnimationFrame(function () {
        live.textContent = message;
      });
    }

    function prefersReducedMotion() {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function hintText() {
      const fine = window.matchMedia("(pointer: fine)").matches;
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      if (fine || !coarse) {
        return "Click a letter to lock or unlock it. Drag it onto a position to lock it there. Shuffle moves the others.";
      }
      return "Tap a letter to lock or unlock it. Hold, then drag it onto a position to lock it there. Shuffle moves the others.";
    }

    function persist() {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
          v: 1,
          letters: letters,
          enumeration: enumeration,
          tiles: tiles,
        }));
      } catch (error) {
        return;
      }
    }

    function restore() {
      try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY);
        if (!raw) {
          return;
        }
        const data = JSON.parse(raw);
        const normalized = normalizeLetters(data && data.letters ? data.letters : "");
        if (!data || data.v !== 1 || typeof data.letters !== "string" || typeof data.enumeration !== "string") {
          window.sessionStorage.removeItem(STORAGE_KEY);
          return;
        }
        if (normalized.letters !== data.letters || !tilesMatchLetters(data.tiles, data.letters)) {
          window.sessionStorage.removeItem(STORAGE_KEY);
          return;
        }
        letters = data.letters;
        enumeration = data.enumeration;
        tiles = data.tiles.map(copyTile).sort(function (a, b) {
          return a.slot - b.slot;
        });
        lettersInput.value = letters;
        enumerationInput.value = enumeration;
      } catch (error) {
        return;
      }
    }

    function setFieldError(input, errorElement, errorId, message) {
      if (message) {
        errorElement.hidden = false;
        errorElement.textContent = message;
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", errorId);
        return;
      }
      errorElement.hidden = true;
      errorElement.textContent = "";
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    }

    function tileById(tileId) {
      return tiles.find(function (tile) {
        return tile.id === tileId;
      });
    }

    function tileElement(tileId) {
      return board.querySelector('[data-tile-id="' + escapeId(tileId) + '"]');
    }

    function clearTarget() {
      board.querySelectorAll(".cryptics-slot.is-target").forEach(function (slot) {
        slot.classList.remove("is-target");
      });
    }

    function markTarget(slotIndex) {
      clearTarget();
      if (slotIndex == null || Number.isNaN(slotIndex)) {
        return;
      }
      const slot = board.querySelector('.cryptics-slot[data-slot="' + slotIndex + '"]');
      if (slot) {
        slot.classList.add("is-target");
      }
    }

    function slotAtPoint(x, y) {
      const slots = board.querySelectorAll(".cryptics-slot");
      for (const slot of slots) {
        const rect = slot.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return Number(slot.dataset.slot);
        }
      }
      return null;
    }

    function layoutGroups() {
      const parsed = parseEnumeration(enumeration, letters.length);
      const showLabels = parsed.ok && enumeration.trim() !== "" && letters.length > 0;
      if (!parsed.ok || letters.length === 0) {
        return {
          parsed: parsed,
          groups: letters.length > 0 ? [{ length: letters.length, label: "" }] : [],
          separators: [],
        };
      }
      return {
        parsed: parsed,
        groups: parsed.groups.map(function (length) {
          return { length: length, label: showLabels ? String(length) : "" };
        }),
        separators: parsed.separators,
      };
    }

    function appendGap(parent, kind, withLabel) {
      const gap = doc.createElement("div");
      gap.setAttribute("aria-hidden", "true");
      if (kind === "-") {
        gap.className = "cryptics-gap cryptics-gap-hyphen";
        const index = doc.createElement("span");
        index.className = "cryptics-slot-index";
        const hyphen = doc.createElement("span");
        hyphen.className = "cryptics-hyphen";
        hyphen.textContent = "-";
        gap.append(index, hyphen);
        if (withLabel) {
          const label = doc.createElement("span");
          label.className = "cryptics-group-label";
          gap.append(label);
        }
      } else {
        gap.className = "cryptics-gap cryptics-gap-space";
      }
      parent.append(gap);
    }

    function render(options) {
      const focusId = options && options.focusId
        ? options.focusId
        : (doc.activeElement && doc.activeElement.getAttribute
          ? doc.activeElement.getAttribute("data-tile-id")
          : null);
      const keepFocus = focusId
        && doc.activeElement !== lettersInput
        && doc.activeElement !== enumerationInput;

      board.replaceChildren();
      const layout = layoutGroups();
      if (letters.length === 0) {
        board.hidden = true;
      } else {
        board.hidden = false;
        let slotIndex = 0;
        layout.groups.forEach(function (group, groupIndex) {
          if (groupIndex > 0) {
            appendGap(board, layout.separators[groupIndex - 1] || " ", Boolean(group.label));
          }
          const groupElement = doc.createElement("div");
          groupElement.className = "cryptics-group";
          const slots = doc.createElement("div");
          slots.className = "cryptics-slots";
          for (let offset = 0; offset < group.length; offset += 1) {
            const tile = tiles.find(function (candidate) {
              return candidate.slot === slotIndex;
            });
            const slot = doc.createElement("div");
            slot.className = "cryptics-slot";
            slot.dataset.slot = String(slotIndex);
            const index = doc.createElement("span");
            index.className = "cryptics-slot-index";
            index.textContent = String(slotIndex + 1);
            const well = doc.createElement("span");
            well.className = "cryptics-well";
            const button = doc.createElement("button");
            button.type = "button";
            button.className = "cryptics-tile" + (tile && tile.locked ? " is-locked" : "");
            button.dataset.tileId = tile ? tile.id : "";
            button.draggable = false;
            button.textContent = tile ? tile.letter : "";
            const position = slotIndex + 1;
            const lockedText = tile && tile.locked ? ", locked" : "";
            button.setAttribute(
              "aria-label",
              "Position " + position + " of " + letters.length + ", " + (tile ? tile.letter : "") + lockedText,
            );
            if (tile && tile.locked) {
              button.setAttribute("aria-pressed", "true");
            }
            well.append(button);
            slot.append(index, well);
            slots.append(slot);
            slotIndex += 1;
          }
          groupElement.append(slots);
          if (group.label) {
            const label = doc.createElement("span");
            label.className = "cryptics-group-label";
            label.textContent = group.label;
            groupElement.append(label);
          }
          board.append(groupElement);
        });
      }

      shuffleButton.disabled = letters.length === 0;
      clearButton.disabled = !tiles.some(function (tile) {
        return tile.locked;
      });
      setFieldError(
        lettersInput,
        lettersError,
        "cryptics-letters-error",
        lettersCapped ? "24 letters maximum." : "",
      );
      const parsed = layout.parsed;
      setFieldError(
        enumerationInput,
        enumerationError,
        "cryptics-enumeration-error",
        enumeration.trim() !== "" && !parsed.ok ? parsed.message : "",
      );

      if (keepFocus) {
        const nextFocus = tileElement(focusId);
        if (nextFocus instanceof HTMLElement) {
          nextFocus.focus();
        }
      }
      if (pickupId) {
        const picked = tileById(pickupId);
        const focused = doc.activeElement;
        const focusedSlot = focused && focused.closest
          ? focused.closest(".cryptics-slot")
          : null;
        markTarget(focusedSlot ? Number(focusedSlot.dataset.slot) : (picked ? picked.slot : null));
      }
    }

    function captureRects(ids) {
      const rects = new Map();
      ids.forEach(function (id) {
        const element = tileElement(id);
        if (element) {
          rects.set(id, element.getBoundingClientRect());
        }
      });
      return rects;
    }

    function animateFrom(rects) {
      rects.forEach(function (rect, id) {
        const element = tileElement(id);
        if (!(element instanceof HTMLElement)) {
          return;
        }
        const next = element.getBoundingClientRect();
        const dx = rect.left - next.left;
        const dy = rect.top - next.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
          return;
        }
        element.style.transition = "none";
        element.style.transform = "translate(" + dx + "px, " + dy + "px)";
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            element.style.transition = "transform 180ms ease-out";
            element.style.transform = "";
            function clear() {
              element.style.transition = "";
              element.removeEventListener("transitionend", clear);
            }
            element.addEventListener("transitionend", clear);
          });
        });
      });
    }

    function finishGesture() {
      if (!gesture) {
        return;
      }
      window.clearTimeout(gesture.timer);
      doc.removeEventListener("pointermove", onPointerMove, true);
      doc.removeEventListener("pointerup", onPointerUp, true);
      doc.removeEventListener("pointercancel", onPointerCancel, true);
      if (touchBlocker) {
        doc.removeEventListener("touchmove", touchBlocker);
        touchBlocker = null;
      }
      gesture = null;
    }

    function commitPlace(tileId, targetSlot) {
      const placedLetter = tileById(tileId);
      tiles = placeAndLock(tiles, tileId, targetSlot);
      const placed = tileById(tileId);
      render({ focusId: tileId });
      if (placed && placedLetter) {
        announce(placed.letter + " locked in position " + (placed.slot + 1));
      }
      persist();
    }

    function toggleLock(tileId) {
      const tile = tileById(tileId);
      if (!tile) {
        render({ focusId: tileId });
        return;
      }
      if (tile.locked) {
        commitUnlock(tileId);
        return;
      }
      commitPlace(tileId, tile.slot);
    }

    function commitUnlock(tileId) {
      const tile = tileById(tileId);
      tiles = unlockTile(tiles, tileId);
      render({ focusId: tileId });
      if (tile) {
        announce(tile.letter + " unlocked");
      }
      persist();
    }

    function doShuffle() {
      if (gesture || letters.length === 0) {
        return;
      }
      pickupId = null;
      clearTarget();
      const before = slotLetters(tiles);
      const next = shuffleUnlocked(tiles);
      if (slotLetters(next) === before) {
        return;
      }
      const movingIds = tiles.filter(function (tile) {
        return !tile.locked;
      }).map(function (tile) {
        return tile.id;
      });
      const rects = prefersReducedMotion() ? null : captureRects(movingIds);
      tiles = next;
      render();
      if (rects) {
        animateFrom(rects);
      }
      announce("Shuffled");
      persist();
    }

    function blockTouchScroll(event) {
      if (gesture && (gesture.phase === "held" || gesture.phase === "dragging")) {
        event.preventDefault();
      }
    }

    function armTouch(tile) {
      if (!gesture || gesture.phase !== "pending") {
        return;
      }
      gesture.phase = "held";
      tile.classList.add("is-armed");
      try {
        if (typeof navigator.vibrate === "function") {
          navigator.vibrate(12);
        }
      } catch (error) {
        // Vibration is optional.
      }
      try {
        tile.setPointerCapture(gesture.pointerId);
      } catch (error) {
        // The pointer may already have ended.
      }
    }

    function startDrag(event) {
      if (!gesture) {
        return;
      }
      const tile = tileElement(gesture.tileId);
      if (!(tile instanceof HTMLElement)) {
        finishGesture();
        render();
        return;
      }
      window.clearTimeout(gesture.timer);
      const rect = tile.getBoundingClientRect();
      gesture.offsetX = gesture.startX - rect.left;
      gesture.offsetY = gesture.startY - rect.top;
      gesture.phase = "dragging";
      tile.classList.remove("is-armed");
      tile.classList.add("is-dragging");
      tile.style.position = "fixed";
      tile.style.left = "0px";
      tile.style.top = "0px";
      tile.style.zIndex = "40";
      tile.style.pointerEvents = "none";
      tile.style.transition = "none";
      const slot = tile.closest(".cryptics-slot");
      if (slot) {
        slot.classList.add("is-origin");
      }
      if (gesture.pointerType !== "touch") {
        try {
          tile.setPointerCapture(gesture.pointerId);
        } catch (error) {
          // Capture can fail if the pointer is already gone.
        }
      }
      moveDrag(event);
    }

    function moveDrag(event) {
      if (!gesture) {
        return;
      }
      const tile = tileElement(gesture.tileId);
      if (!(tile instanceof HTMLElement)) {
        return;
      }
      const x = event.clientX - gesture.offsetX;
      const y = event.clientY - gesture.offsetY;
      tile.style.transform = "translate(" + x + "px, " + y + "px) scale(1.06)";
      markTarget(slotAtPoint(event.clientX, event.clientY));
    }

    function onPointerMove(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) {
        return;
      }
      const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
      if (gesture.phase === "pending" && gesture.pointerType === "touch") {
        if (distance > TOUCH_SCROLL_PX) {
          const tile = tileElement(gesture.tileId);
          if (tile) {
            tile.classList.remove("is-armed");
          }
          finishGesture();
        }
        return;
      }
      if ((gesture.phase === "pending" || gesture.phase === "held") && distance >= MOUSE_DRAG_PX) {
        startDrag(event);
        return;
      }
      if (gesture.phase === "dragging") {
        moveDrag(event);
      }
    }

    function onPointerUp(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) {
        return;
      }
      const current = gesture;
      const tile = tileById(current.tileId);
      if (current.phase === "dragging") {
        const target = slotAtPoint(event.clientX, event.clientY);
        finishGesture();
        if (target == null) {
          render({ focusId: current.tileId });
          return;
        }
        commitPlace(current.tileId, target);
        return;
      }
      if (current.phase === "held") {
        finishGesture();
        if (tile) {
          commitPlace(current.tileId, tile.slot);
        } else {
          render();
        }
        return;
      }
      const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
      const threshold = current.pointerType === "touch" ? TOUCH_SCROLL_PX : MOUSE_DRAG_PX;
      const toggled = Boolean(tile && distance < threshold);
      finishGesture();
      if (toggled) {
        toggleLock(current.tileId);
      }
    }

    function onPointerCancel(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) {
        return;
      }
      const tileId = gesture.tileId;
      finishGesture();
      render({ focusId: tileId });
    }

    function onPointerDown(event) {
      const tileButton = event.target instanceof Element
        ? event.target.closest(".cryptics-tile")
        : null;
      if (!(tileButton instanceof HTMLElement) || !board.contains(tileButton)) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      if (gesture) {
        return;
      }
      pickupId = null;
      clearTarget();
      const tileId = tileButton.dataset.tileId || "";
      gesture = {
        pointerId: event.pointerId,
        tileId: tileId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        phase: "pending",
        timer: 0,
        offsetX: 0,
        offsetY: 0,
      };
      doc.addEventListener("pointermove", onPointerMove, true);
      doc.addEventListener("pointerup", onPointerUp, true);
      doc.addEventListener("pointercancel", onPointerCancel, true);
      if (event.pointerType === "touch") {
        touchBlocker = blockTouchScroll;
        doc.addEventListener("touchmove", touchBlocker, { passive: false });
        gesture.timer = window.setTimeout(function () {
          armTouch(tileButton);
        }, LONG_PRESS_MS);
      } else {
        event.preventDefault();
      }
      tileButton.focus();
    }

    function tilesInOrder() {
      return [...board.querySelectorAll(".cryptics-tile")];
    }

    function moveTileFocus(current, key) {
      const buttons = tilesInOrder();
      const index = buttons.indexOf(current);
      if (index < 0) {
        return;
      }
      if (key === "Home") {
        buttons[0].focus();
        return;
      }
      if (key === "End") {
        buttons[buttons.length - 1].focus();
        return;
      }
      if (key === "ArrowRight" || key === "ArrowLeft") {
        const nextIndex = index + (key === "ArrowRight" ? 1 : -1);
        if (nextIndex >= 0 && nextIndex < buttons.length) {
          buttons[nextIndex].focus();
        }
        return;
      }
      const rows = [];
      buttons.forEach(function (button) {
        const rect = button.getBoundingClientRect();
        const row = rows.find(function (candidate) {
          return Math.abs(candidate.top - rect.top) < 8;
        });
        if (row) {
          row.tiles.push({ button: button, rect: rect });
          return;
        }
        rows.push({ top: rect.top, tiles: [{ button: button, rect: rect }] });
      });
      rows.sort(function (a, b) {
        return a.top - b.top;
      });
      const rowIndex = rows.findIndex(function (row) {
        return row.tiles.some(function (item) {
          return item.button === current;
        });
      });
      const nextRow = rows[rowIndex + (key === "ArrowDown" ? 1 : -1)];
      if (!nextRow) {
        return;
      }
      const currentRect = current.getBoundingClientRect();
      const center = currentRect.left + currentRect.width / 2;
      let best = nextRow.tiles[0];
      let bestDistance = Infinity;
      nextRow.tiles.forEach(function (item) {
        const itemCenter = item.rect.left + item.rect.width / 2;
        const distance = Math.abs(itemCenter - center);
        if (distance < bestDistance) {
          best = item;
          bestDistance = distance;
        }
      });
      best.button.focus();
    }

    function isTypingTarget(target) {
      return target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable);
    }

    function onKeyDown(event) {
      if (event.key === "Escape" && gesture) {
        const tileId = gesture.tileId;
        event.preventDefault();
        finishGesture();
        render({ focusId: tileId });
        return;
      }
      if ((event.key === "s" || event.key === "S")
        && !event.metaKey && !event.ctrlKey && !event.altKey
        && !isTypingTarget(event.target)
        && !gesture
        && !pickupId) {
        event.preventDefault();
        doShuffle();
        return;
      }

      const button = event.target instanceof Element
        ? event.target.closest(".cryptics-tile")
        : null;
      if (!(button instanceof HTMLElement) || !board.contains(button)) {
        return;
      }
      const tileId = button.dataset.tileId || "";
      const tile = tileById(tileId);
      if (!tile) {
        return;
      }

      if (event.key === "Escape" && pickupId) {
        event.preventDefault();
        pickupId = null;
        clearTarget();
        announce("Cancelled");
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
        event.preventDefault();
        if (!pickupId) {
          pickupId = tileId;
          markTarget(tile.slot);
          announce("Picked up " + tile.letter + ". Choose a position.");
          return;
        }
        const slotElement = button.closest(".cryptics-slot");
        const targetSlot = slotElement ? Number(slotElement.dataset.slot) : tile.slot;
        const pickedId = pickupId;
        pickupId = null;
        clearTarget();
        commitPlace(pickedId, targetSlot);
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && !pickupId && tile.locked) {
        event.preventDefault();
        commitUnlock(tileId);
        return;
      }
      if (event.key === "ArrowRight"
        || event.key === "ArrowLeft"
        || event.key === "ArrowUp"
        || event.key === "ArrowDown"
        || event.key === "Home"
        || event.key === "End") {
        event.preventDefault();
        moveTileFocus(button, event.key);
        if (pickupId) {
          const focused = doc.activeElement;
          const slotElement = focused instanceof Element ? focused.closest(".cryptics-slot") : null;
          markTarget(slotElement ? Number(slotElement.dataset.slot) : null);
        }
      }
    }

    lettersInput.addEventListener("input", function () {
      if (gesture) {
        finishGesture();
      }
      pickupId = null;
      const selection = lettersInput.selectionStart == null
        ? lettersInput.value.length
        : lettersInput.selectionStart;
      const normalized = normalizeLetters(lettersInput.value, selection);
      if (lettersInput.value !== normalized.letters) {
        lettersInput.value = normalized.letters;
        lettersInput.setSelectionRange(normalized.caret, normalized.caret);
      }
      lettersCapped = normalized.capped;
      if (normalized.letters !== letters) {
        letters = normalized.letters;
        tiles = syncTiles(tiles, letters);
      }
      render();
      persist();
    });

    enumerationInput.addEventListener("input", function () {
      pickupId = null;
      enumeration = enumerationInput.value;
      render();
      persist();
    });

    shuffleButton.addEventListener("click", function () {
      if (gesture) {
        return;
      }
      pickupId = null;
      doShuffle();
    });

    clearButton.addEventListener("click", function () {
      if (gesture || !tiles.some(function (tile) { return tile.locked; })) {
        return;
      }
      pickupId = null;
      tiles = clearLocks(tiles);
      render();
      announce("Locks cleared");
      persist();
    });

    board.addEventListener("pointerdown", onPointerDown);
    board.addEventListener("contextmenu", function (event) {
      const tile = event.target instanceof Element ? event.target.closest(".cryptics-tile") : null;
      if (tile) {
        event.preventDefault();
      }
    });
    doc.addEventListener("keydown", onKeyDown);

    hint.textContent = hintText();
    restore();
    render();
  }

  return {
    normalizeLetters: normalizeLetters,
    parseEnumeration: parseEnumeration,
    syncTiles: syncTiles,
    shuffleUnlocked: shuffleUnlocked,
    placeAndLock: placeAndLock,
    unlockTile: unlockTile,
    clearLocks: clearLocks,
    mount: mount,
  };
});
