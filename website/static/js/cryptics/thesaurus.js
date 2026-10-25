"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof document !== "undefined") {
    api.mount(document);
  }
  root.CrypticsThesaurus = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PAGE_PATH = "/cryptics/thesaurus/";
  const DEBOUNCE_MS = 150;
  const IDLE = "Type a definition word. Add a length to match the enumeration.";
  const LENGTH_MESSAGE = "Length should look like 5 or 4,3 or 3-4.";
  const LOAD_MESSAGE = "The word list did not load. Try again.";
  const MISSING = "No entry for that spelling.";
  const NONE_OF_LENGTH = "Nothing of that length.";

  function normaliseWord(raw) {
    let cleaned = String(raw).trim();
    if (cleaned.endsWith("?") || cleaned.endsWith(".")) {
      cleaned = cleaned.slice(0, -1).trim();
    }
    return cleaned.toLowerCase();
  }

  function shardName(word) {
    const first = word[0];
    if (first >= "a" && first <= "z") {
      return first;
    }
    return "other";
  }

  function letterCount(word) {
    const letters = String(word).match(/[A-Za-z]/g);
    return letters ? letters.length : 0;
  }

  function derivedEnumeration(word) {
    const groups = String(word).trim().split(/\s+/).filter(Boolean);
    const rendered = [];
    groups.forEach(function (group) {
      const parts = group.split("-");
      const counts = [];
      parts.forEach(function (part) {
        const count = letterCount(part);
        if (count > 0) {
          counts.push(String(count));
        }
      });
      if (counts.length > 0) {
        rendered.push(counts.join("-"));
      }
    });
    return rendered.join(",");
  }

  function invalidLength() {
    return { ok: false, mode: "all", pattern: "", count: 0 };
  }

  function parseLength(raw) {
    let cleaned = String(raw).trim();
    if (cleaned.startsWith("(") && cleaned.endsWith(")") && cleaned.length >= 2) {
      cleaned = cleaned.slice(1, -1).trim();
    }
    if (cleaned === "") {
      return { ok: true, mode: "all", pattern: "", count: 0 };
    }
    if (!/^[\d,\-\s]+$/.test(cleaned)) {
      return invalidLength();
    }
    const parts = cleaned.split(/(\d+)/).filter(function (part) {
      return part !== "";
    });
    if (parts.length === 0 || parts.length % 2 === 0 || !/^\d+$/.test(parts[0])) {
      return invalidLength();
    }
    const groups = [];
    const separators = [];
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (index % 2 === 0) {
        if (!/^\d+$/.test(part)) {
          return invalidLength();
        }
        const value = Number(part);
        if (!Number.isSafeInteger(value) || value < 1) {
          return invalidLength();
        }
        groups.push(value);
        continue;
      }
      const compact = part.trim();
      if (compact === "" || compact === ",") {
        separators.push(",");
      } else if (compact === "-") {
        separators.push("-");
      } else {
        return invalidLength();
      }
    }
    if (groups.length === 1) {
      return { ok: true, mode: "count", pattern: "", count: groups[0] };
    }
    let pattern = String(groups[0]);
    for (let index = 0; index < separators.length; index += 1) {
      pattern += separators[index] + String(groups[index + 1]);
    }
    return { ok: true, mode: "pattern", pattern: pattern, count: 0 };
  }

  function keepsWord(word, length) {
    if (!length.ok || length.mode === "all") {
      return true;
    }
    if (length.mode === "count") {
      return letterCount(word) === length.count;
    }
    return derivedEnumeration(word) === length.pattern;
  }

  function sensesOf(value) {
    if (Array.isArray(value)) {
      return { lemma: "", senses: value };
    }
    if (value && Array.isArray(value.senses)) {
      return { lemma: value.lemma || "", senses: value.senses };
    }
    return { lemma: "", senses: [] };
  }

  function compareWords(left, right, alphabeticalOnly) {
    if (!alphabeticalOnly) {
      const countGap = letterCount(left) - letterCount(right);
      if (countGap !== 0) {
        return countGap;
      }
    }
    return left.localeCompare(right, "en");
  }

  const keysByShard = new WeakMap();

  function shardKeys(shard) {
    if (!shard || typeof shard !== "object") {
      return [];
    }
    let keys = keysByShard.get(shard);
    if (!keys) {
      keys = Object.keys(shard);
      keysByShard.set(shard, keys);
    }
    return keys;
  }

  function completeWords(shard, raw, limit) {
    const prefix = normaliseWord(raw);
    const cap = limit > 0 ? limit : 8;
    if (prefix.length < 2) {
      return [];
    }
    const found = [];
    shardKeys(shard).forEach(function (key) {
      if (key.indexOf(prefix) === 0 && key !== prefix) {
        found.push(key);
      }
    });
    found.sort(function (left, right) {
      if (left.length !== right.length) {
        return left.length - right.length;
      }
      return left.localeCompare(right, "en");
    });
    return found.slice(0, cap).map(function (key) {
      return { value: key, label: key };
    });
  }

  function lookup(shard, word, length) {
    const entry = shard[word];
    if (!entry) {
      return null;
    }
    const parsed = sensesOf(entry);
    const alphabeticalOnly = length.ok && length.mode !== "all";
    const senses = [];
    parsed.senses.forEach(function (sense) {
      const words = (sense.words || []).filter(function (synonym) {
        return letterCount(synonym) > 0 && keepsWord(synonym, length);
      });
      words.sort(function (left, right) {
        return compareWords(left, right, alphabeticalOnly);
      });
      if (words.length > 0) {
        senses.push({ pos: sense.pos || "", gloss: sense.gloss || "", words: words });
      }
    });
    return { lemma: parsed.lemma, senses: senses };
  }

  function synonymCount(found) {
    return found.senses.reduce(function (total, sense) {
      return total + sense.words.length;
    }, 0);
  }

  function mount(doc) {
    const form = doc.getElementById("cryptics-thesaurus-form");
    const wordInput = doc.getElementById("cryptics-word");
    const lengthInput = doc.getElementById("cryptics-length");
    const lengthError = doc.getElementById("cryptics-length-error");
    const status = doc.getElementById("cryptics-status");
    const results = doc.getElementById("cryptics-results");
    const count = doc.getElementById("cryptics-count");
    const live = doc.getElementById("cryptics-live");
    if (!form || !wordInput || !lengthInput || !lengthError || !status || !results || !count || !live) {
      return;
    }

    const shards = new Map();
    let timer = 0;
    let requestId = 0;

    function loadShard(name) {
      if (!shards.has(name)) {
        const promise = fetch("/data/cryptics/thesaurus/" + name + ".json").then(function (response) {
          if (!response.ok) {
            throw new Error("load");
          }
          return response.json();
        }).catch(function (error) {
          shards.delete(name);
          throw error;
        });
        shards.set(name, promise);
      }
      return shards.get(name);
    }

    function writeUrl() {
      const params = new URLSearchParams();
      const word = wordInput.value.trim();
      const length = lengthInput.value.trim();
      if (word !== "") {
        params.set("q", word);
      }
      if (length !== "") {
        params.set("n", length);
      }
      const queryString = params.toString();
      const next = queryString === "" ? PAGE_PATH : PAGE_PATH + "?" + queryString;
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

    function showLengthError(length) {
      if (length.ok) {
        lengthInput.removeAttribute("aria-invalid");
        lengthError.hidden = true;
        return;
      }
      lengthInput.setAttribute("aria-invalid", "true");
      lengthError.textContent = LENGTH_MESSAGE;
      lengthError.hidden = false;
    }

    function enumerationLabel(word) {
      const derived = derivedEnumeration(word);
      if (derived.indexOf("-") !== -1 || derived.indexOf(",") !== -1) {
        return derived;
      }
      return String(letterCount(word));
    }

    function renderSenses(word, found) {
      if (found.lemma && found.lemma !== word) {
        const lemmaLine = doc.createElement("p");
        lemmaLine.className = "cryptics-lemma";
        lemmaLine.textContent = "Showing senses of " + found.lemma + ".";
        results.appendChild(lemmaLine);
      }
      found.senses.forEach(function (sense) {
        const block = doc.createElement("section");
        block.className = "cryptics-sense";
        const heading = doc.createElement("h4");
        heading.className = "cryptics-pos";
        heading.textContent = sense.pos;
        block.appendChild(heading);
        if (sense.gloss) {
          const gloss = doc.createElement("p");
          gloss.className = "cryptics-gloss";
          gloss.textContent = sense.gloss;
          block.appendChild(gloss);
        }
        const list = doc.createElement("div");
        list.className = "cryptics-synonyms";
        sense.words.forEach(function (synonym) {
          const label = enumerationLabel(synonym);
          if (synonym.toLowerCase() === word) {
            const current = doc.createElement("span");
            current.className = "cryptics-current";
            current.appendChild(doc.createTextNode(synonym + " · " + label + " "));
            const mark = doc.createElement("span");
            mark.className = "cryptics-enum";
            mark.textContent = "this word";
            current.appendChild(mark);
            list.appendChild(current);
            return;
          }
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "btn btn-outline-secondary cryptics-synonym";
          button.appendChild(doc.createTextNode(synonym + " "));
          const enumeration = doc.createElement("span");
          enumeration.className = "cryptics-enum";
          enumeration.textContent = "· " + label;
          button.appendChild(enumeration);
          const letters = letterCount(synonym);
          const noun = letters === 1 ? "letter" : "letters";
          button.setAttribute("aria-label", "Look up " + synonym + ", " + letters + " " + noun);
          button.addEventListener("click", function () {
            wordInput.value = synonym;
            wordInput.focus();
            searchNow();
          });
          list.appendChild(button);
        });
        block.appendChild(list);
        results.appendChild(block);
      });
    }

    function showNoneOfLength() {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline-secondary";
      button.textContent = "Show every length";
      button.addEventListener("click", function () {
        lengthInput.value = "";
        lengthInput.removeAttribute("aria-invalid");
        lengthError.hidden = true;
        searchNow();
      });
      results.appendChild(button);
    }

    function searchNow() {
      const id = requestId + 1;
      requestId = id;
      window.clearTimeout(timer);
      writeUrl();
      const length = parseLength(lengthInput.value);
      showLengthError(length);
      const word = normaliseWord(wordInput.value);
      if (word === "") {
        results.replaceChildren();
        setStatus(IDLE);
        setCount("");
        live.textContent = "";
        return;
      }
      const filter = length.ok ? length : { ok: true, mode: "all", pattern: "", count: 0 };
      loadShard(shardName(word)).then(function (shard) {
        if (id !== requestId) {
          return;
        }
        const found = lookup(shard, word, filter);
        results.replaceChildren();
        if (!found) {
          setStatus(MISSING);
          setCount("");
          live.textContent = MISSING;
          return;
        }
        if (found.senses.length === 0) {
          setStatus(NONE_OF_LENGTH);
          setCount("");
          showNoneOfLength();
          live.textContent = NONE_OF_LENGTH;
          return;
        }
        renderSenses(word, found);
        setStatus("");
        const total = synonymCount(found);
        const noun = total === 1 ? "synonym" : "synonyms";
        const text = total + " " + noun;
        setCount(text);
        live.textContent = text;
      }).catch(function () {
        if (id !== requestId) {
          return;
        }
        results.replaceChildren();
        setCount("");
        setStatus(LOAD_MESSAGE);
        live.textContent = LOAD_MESSAGE;
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
    wordInput.addEventListener("input", schedule);
    lengthInput.addEventListener("input", schedule);
    const suggestApi = typeof globalThis !== "undefined" ? globalThis.CrypticsSuggest : undefined;
    if (suggestApi) {
      suggestApi.attach(doc, {
        input: wordInput,
        listId: "cryptics-word-suggestions",
        suggest: function (value) {
          const word = normaliseWord(value);
          if (word.length < 2) {
            return [];
          }
          return loadShard(shardName(word)).then(function (shard) {
            return completeWords(shard, value);
          });
        },
        onPick: function (value) {
          wordInput.value = value;
          wordInput.focus();
          searchNow();
        },
      });
    }

    if (wordInput.value.trim() !== "" || lengthInput.value.trim() !== "") {
      searchNow();
    }
  }

  return {
    mount: mount,
    normaliseWord: normaliseWord,
    derivedEnumeration: derivedEnumeration,
    parseLength: parseLength,
    lookup: lookup,
    letterCount: letterCount,
    completeWords: completeWords,
  };
});
