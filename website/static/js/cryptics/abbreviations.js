"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof document !== "undefined") {
    api.mount(document);
  }
  root.CrypticsAbbreviations = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DATA_URL = "/data/cryptics/abbreviations.json?v1.0.1";
  function pagePath(form) {
    const action = form.getAttribute("action") || "/cryptics/abbreviations/";
    return action.endsWith("/") ? action : action + "/";
  }
  const DEBOUNCE_MS = 150;

  function normaliseText(raw) {
    return String(raw)
      .trim()
      .toLowerCase()
      .replace(/[.,'\-/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function abbreviationKey(original) {
    if (/\s/.test(original)) {
      return "";
    }
    return String(original).toUpperCase().replace(/[^A-Z]/g, "");
  }

  function meaningMatches(means, queryNorm) {
    if (queryNorm === "") {
      return false;
    }
    const meaningWords = normaliseText(means).split(" ").filter(Boolean);
    const queryWords = queryNorm.split(" ").filter(Boolean);
    if (queryWords.length === 0 || queryWords.length > meaningWords.length) {
      return false;
    }
    const last = meaningWords.length - queryWords.length;
    for (let start = 0; start <= last; start += 1) {
      let matched = true;
      for (let offset = 0; offset < queryWords.length; offset += 1) {
        if (meaningWords[start + offset] !== queryWords[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return true;
      }
    }
    return false;
  }

  function parseLetters(raw) {
    const trimmed = String(raw).trim();
    if (trimmed === "") {
      return { ok: true, length: null };
    }
    if (!/^[1-6]$/.test(trimmed)) {
      return { ok: false, length: null };
    }
    return { ok: true, length: Number(trimmed) };
  }

  function compareRows(left, right) {
    if (left.abbr.length !== right.abbr.length) {
      return left.abbr.length - right.abbr.length;
    }
    if (left.abbr !== right.abbr) {
      return left.abbr < right.abbr ? -1 : 1;
    }
    const leftMeans = left.means.toLowerCase();
    const rightMeans = right.means.toLowerCase();
    if (leftMeans !== rightMeans) {
      return leftMeans < rightMeans ? -1 : 1;
    }
    return 0;
  }

  function entryVisible(entry, letters, category) {
    if (category && entry.category !== category) {
      return false;
    }
    if (letters.ok && letters.length !== null && entry.abbr.length !== letters.length) {
      return false;
    }
    return true;
  }

  function compareCompletions(left, right) {
    const leftNorm = normaliseText(left);
    const rightNorm = normaliseText(right);
    if (leftNorm.length !== rightNorm.length) {
      return leftNorm.length - rightNorm.length;
    }
    return leftNorm.localeCompare(rightNorm, "en");
  }

  function takeSuggestions(abbreviations, meanings, limit) {
    const cap = limit > 0 ? limit : 8;
    let abbreviationCount = Math.min(abbreviations.length, 4, cap);
    let meaningCount = Math.min(meanings.length, cap - abbreviationCount);
    if (abbreviationCount + meaningCount < cap) {
      abbreviationCount = Math.min(abbreviations.length, cap - meaningCount);
    }
    return abbreviations.slice(0, abbreviationCount).concat(meanings.slice(0, meaningCount));
  }

  function completeAbbreviations(entries, queryRaw, lettersRaw, kind, limit) {
    const trimmed = String(queryRaw).trim();
    if (trimmed === "") {
      return [];
    }
    const letters = parseLetters(lettersRaw);
    const queryNorm = normaliseText(trimmed);
    const abbrPrefix = abbreviationKey(trimmed);
    const category = kind && kind !== "all" ? kind : "";
    const byAbbr = new Map();
    const meanings = [];
    const meaningSeen = new Set();

    function addMeaning(text) {
      const key = normaliseText(text);
      if (key === "" || key === queryNorm || meaningSeen.has(key) || key.indexOf(queryNorm) !== 0) {
        return;
      }
      meaningSeen.add(key);
      meanings.push(text);
    }

    entries.forEach(function (entry) {
      if (!entryVisible(entry, letters, category)) {
        return;
      }
      if (abbrPrefix !== "" && entry.abbr.indexOf(abbrPrefix) === 0 && entry.abbr !== abbrPrefix) {
        if (!byAbbr.has(entry.abbr)) {
          byAbbr.set(entry.abbr, entry.means);
        }
      }
      if (queryNorm.length < 2) {
        return;
      }
      const meansNorm = normaliseText(entry.means);
      if (meansNorm.indexOf(queryNorm) === 0 && meansNorm !== queryNorm) {
        addMeaning(entry.means);
        return;
      }
      if (queryNorm.indexOf(" ") !== -1) {
        return;
      }
      entry.means.split(/[^A-Za-z]+/).forEach(function (part) {
        if (part.length > queryNorm.length && part.toLowerCase().indexOf(queryNorm) === 0) {
          addMeaning(part);
        }
      });
    });

    const abbreviations = [];
    byAbbr.forEach(function (hint, abbr) {
      abbreviations.push({ value: abbr, label: abbr, hint: hint });
    });
    abbreviations.sort(function (left, right) {
      if (left.value.length !== right.value.length) {
        return left.value.length - right.value.length;
      }
      return left.value < right.value ? -1 : 1;
    });
    meanings.sort(compareCompletions);
    const meaningItems = meanings.map(function (text) {
      return { value: text, label: text };
    });
    return takeSuggestions(abbreviations, meaningItems, limit);
  }

  function searchAbbreviations(entries, queryRaw, lettersRaw, kind) {
    const original = String(queryRaw);
    const trimmed = original.trim();
    const letters = parseLetters(lettersRaw);
    const queryNorm = normaliseText(trimmed);
    const abbr = abbreviationKey(original.trim());
    const category = kind && kind !== "all" ? kind : "";
    const written = [];
    const means = [];
    entries.forEach(function (entry) {
      if (!entryVisible(entry, letters, category)) {
        return;
      }
      if (queryNorm !== "" && meaningMatches(entry.means, queryNorm)) {
        written.push(entry);
      }
      if (abbr !== "" && entry.abbr === abbr) {
        means.push(entry);
      }
    });
    written.sort(compareRows);
    means.sort(compareRows);
    return { lettersOk: letters.ok, written: written, means: means, trimmed: trimmed };
  }

  function announcement(result) {
    const count = result.written.length + result.means.length;
    if (count === 0) {
      return "Nothing common for that.";
    }
    const noun = count === 1 ? "abbreviation" : "abbreviations";
    return count + " " + noun + " for " + result.trimmed;
  }

  function mount(doc) {
    const form = doc.getElementById("cryptics-abbreviations-form");
    const queryInput = doc.getElementById("cryptics-query");
    const lettersInput = doc.getElementById("cryptics-abbr-letters");
    const kindInput = doc.getElementById("cryptics-kind");
    const lettersError = doc.getElementById("cryptics-letters-error");
    const status = doc.getElementById("cryptics-status");
    const results = doc.getElementById("cryptics-results");
    const count = doc.getElementById("cryptics-count");
    const live = doc.getElementById("cryptics-live");
    if (!form || !queryInput || !lettersInput || !kindInput || !lettersError || !status || !results || !count || !live) {
      return;
    }

    let entriesPromise = null;
    let timer = 0;
    let requestId = 0;

    function loadEntries() {
      if (!entriesPromise) {
        entriesPromise = fetch(DATA_URL).then(function (response) {
          if (!response.ok) {
            throw new Error("load");
          }
          return response.json();
        }).then(function (payload) {
          return payload.entries || [];
        }).catch(function (error) {
          entriesPromise = null;
          throw error;
        });
      }
      return entriesPromise;
    }

    function writeUrl() {
      const params = new URLSearchParams();
      const query = queryInput.value.trim();
      const letters = lettersInput.value.trim();
      const kind = kindInput.value;
      if (query !== "") {
        params.set("q", query);
      }
      if (letters !== "") {
        params.set("letters", letters);
      }
      if (kind !== "" && kind !== "all") {
        params.set("kind", kind);
      }
      const queryString = params.toString();
      const path = pagePath(form);
      const next = queryString === "" ? path : path + "?" + queryString;
      if (window.location.pathname + window.location.search !== next) {
        window.history.replaceState(null, "", next);
      }
    }

    function setStatus(text) {
      status.textContent = text;
      status.hidden = text === "";
    }

    function setCount(text) {
      count.textContent = text;
      count.hidden = text === "";
    }

    function renderRows(heading, rows) {
      if (rows.length === 0) {
        return;
      }
      const title = doc.createElement("h4");
      title.className = "cryptics-group-heading";
      title.textContent = heading;
      results.appendChild(title);
      const list = doc.createElement("ul");
      list.className = "cryptics-abbr-list";
      rows.forEach(function (entry) {
        const item = doc.createElement("li");
        item.className = "cryptics-abbr-row";
        const tile = doc.createElement("span");
        tile.className = "cryptics-abbr-tile";
        tile.textContent = entry.abbr;
        const means = doc.createElement("span");
        means.className = "cryptics-abbr-means";
        means.textContent = entry.means;
        item.appendChild(tile);
        item.appendChild(means);
        if (entry.note) {
          const note = doc.createElement("span");
          note.className = "cryptics-abbr-note";
          note.textContent = entry.note;
          item.appendChild(note);
        }
        list.appendChild(item);
      });
      results.appendChild(list);
    }

    function searchNow() {
      const id = requestId + 1;
      requestId = id;
      window.clearTimeout(timer);
      writeUrl();
      const letters = parseLetters(lettersInput.value);
      if (!letters.ok) {
        lettersInput.setAttribute("aria-invalid", "true");
        lettersError.textContent = "Use a number from 1 to 6.";
        lettersError.hidden = false;
      } else {
        lettersInput.removeAttribute("aria-invalid");
        lettersError.hidden = true;
      }
      if (queryInput.value.trim() === "") {
        results.replaceChildren();
        setStatus("Look up a word from the clue, or the letters it might become.");
        setCount("");
        live.textContent = "";
        return;
      }
      loadEntries().then(function (entries) {
        if (id !== requestId) {
          return;
        }
        const result = searchAbbreviations(
          entries,
          queryInput.value,
          lettersInput.value,
          kindInput.value,
        );
        results.replaceChildren();
        renderRows("Can be written", result.written);
        renderRows("Can mean", result.means);
        const text = announcement(result);
        if (result.written.length + result.means.length === 0) {
          setStatus(text);
          setCount("");
        } else {
          setStatus("");
          setCount(text);
        }
        live.textContent = text;
      }).catch(function () {
        if (id !== requestId) {
          return;
        }
        results.replaceChildren();
        setCount("");
        setStatus("The word list did not load. Try again.");
        live.textContent = "The word list did not load. Try again.";
      });
    }

    function schedule() {
      window.clearTimeout(timer);
      timer = window.setTimeout(searchNow, DEBOUNCE_MS);
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      searchNow();
    });
    queryInput.addEventListener("input", schedule);
    lettersInput.addEventListener("input", schedule);
    const suggestApi = typeof globalThis !== "undefined" ? globalThis.CrypticsSuggest : undefined;
    if (suggestApi) {
      suggestApi.attach(doc, {
        input: queryInput,
        listId: "cryptics-query-suggestions",
        suggest: function (value) {
          if (value.trim() === "") {
            return [];
          }
          return loadEntries().then(function (entries) {
            return completeAbbreviations(entries, value, lettersInput.value, kindInput.value);
          });
        },
        onPick: function (value) {
          queryInput.value = value;
          queryInput.dispatchEvent(new Event("change", { bubbles: true }));
          queryInput.focus();
          searchNow();
        },
      });
    }
    kindInput.addEventListener("change", function () {
      searchNow();
    });

    if (queryInput.value.trim() !== "" || lettersInput.value.trim() !== "") {
      searchNow();
    }
  }

  return {
    mount: mount,
    normaliseText: normaliseText,
    searchAbbreviations: searchAbbreviations,
    completeAbbreviations: completeAbbreviations,
    announcement: announcement,
  };
});
