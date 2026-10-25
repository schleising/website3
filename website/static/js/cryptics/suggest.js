"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.CrypticsSuggest = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEBOUNCE_MS = 150;
  const LIMIT = 8;

  function attach(doc, options) {
    const input = options && options.input;
    const suggest = options && options.suggest;
    const onPick = options && options.onPick;
    const anchor = input && input.parentElement;
    if (!doc || !input || !anchor || typeof suggest !== "function" || typeof onPick !== "function") {
      return {
        close: function () {},
        refresh: function () {},
      };
    }

    const listId = options.listId || input.id + "-suggestions";
    const list = doc.createElement("ul");
    list.id = listId;
    list.className = "cryptics-suggestions";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Suggestions");
    list.hidden = true;
    doc.body.appendChild(list);

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", listId);
    input.setAttribute("aria-expanded", "false");

    let items = [];
    let active = -1;
    let requestId = 0;
    let timer = 0;
    let blurTimer = 0;
    let composing = false;
    let highlightOnOpen = "";

    function setOpen(open) {
      list.hidden = !open;
      input.setAttribute("aria-expanded", open ? "true" : "false");
      if (!open) {
        active = -1;
        input.removeAttribute("aria-activedescendant");
      }
    }

    function close() {
      items = [];
      list.replaceChildren();
      setOpen(false);
    }

    function paintActive(fromKeyboard) {
      Array.prototype.forEach.call(list.children, function (option, index) {
        const selected = index === active;
        option.classList.toggle("is-active", selected);
        option.setAttribute("aria-selected", selected ? "true" : "false");
      });
      if (active >= 0) {
        input.setAttribute("aria-activedescendant", listId + "-" + active);
        const current = list.children[active];
        if (fromKeyboard && current && current.scrollIntoView) {
          current.scrollIntoView({ block: "nearest" });
        }
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }

    function place() {
      const rect = input.getBoundingClientRect();
      const gap = 6;
      const below = window.innerHeight - rect.bottom - gap - 8;
      const above = rect.top - gap - 8;
      const preferBelow = below >= 160 || below >= above;
      const space = Math.max(120, preferBelow ? below : above);
      list.style.left = Math.max(8, rect.left) + "px";
      list.style.width = rect.width + "px";
      list.style.maxHeight = space + "px";
      if (preferBelow) {
        list.style.top = rect.bottom + gap + "px";
        list.style.bottom = "auto";
      } else {
        list.style.top = "auto";
        list.style.bottom = window.innerHeight - rect.top + gap + "px";
      }
    }

    function render(nextItems) {
      items = nextItems;
      list.replaceChildren();
      if (items.length === 0) {
        setOpen(false);
        return;
      }
      place();
      items.forEach(function (item, index) {
        const option = doc.createElement("li");
        option.id = listId + "-" + index;
        option.className = "cryptics-suggestion";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        const label = doc.createElement("span");
        label.className = "cryptics-suggestion-label";
        label.textContent = item.label || item.value;
        option.appendChild(label);
        if (item.hint) {
          const hint = doc.createElement("span");
          hint.className = "cryptics-suggestion-hint";
          hint.textContent = item.hint;
          option.appendChild(hint);
        }
        option.addEventListener("mousedown", function (event) {
          event.preventDefault();
        });
        option.addEventListener("mouseenter", function () {
          active = index;
          paintActive(false);
        });
        option.addEventListener("click", function () {
          pick(index);
        });
        list.appendChild(option);
      });
      setOpen(true);
      paintActive(false);
    }

    function pick(index) {
      const item = items[index];
      if (!item) {
        return;
      }
      window.clearTimeout(blurTimer);
      window.clearTimeout(timer);
      requestId += 1;
      close();
      onPick(item.value);
    }

    function refresh(value) {
      const id = requestId + 1;
      requestId = id;
      let pending;
      try {
        pending = suggest(value);
      } catch (error) {
        close();
        return;
      }
      Promise.resolve(pending).then(function (next) {
        if (id !== requestId || input.value !== value) {
          return;
        }
        if (doc.activeElement !== input) {
          close();
          return;
        }
        const rows = Array.isArray(next) ? next.slice(0, LIMIT) : [];
        if (highlightOnOpen === "first") {
          active = rows.length > 0 ? 0 : -1;
        } else if (highlightOnOpen === "last") {
          active = rows.length > 0 ? rows.length - 1 : -1;
        } else {
          active = -1;
        }
        highlightOnOpen = "";
        render(rows);
      }).catch(function () {
        if (id !== requestId) {
          return;
        }
        highlightOnOpen = "";
        close();
      });
    }

    function schedule() {
      highlightOnOpen = "";
      window.clearTimeout(timer);
      const value = input.value;
      timer = window.setTimeout(function () {
        refresh(value);
      }, DEBOUNCE_MS);
    }

    function move(direction) {
      if (list.hidden || items.length === 0) {
        highlightOnOpen = direction > 0 ? "first" : "last";
        window.clearTimeout(timer);
        refresh(input.value);
        return;
      }
      if (active === -1) {
        active = direction > 0 ? 0 : items.length - 1;
      } else {
        active = (active + direction + items.length) % items.length;
      }
      paintActive(true);
    }

    input.addEventListener("compositionstart", function () {
      composing = true;
    });
    input.addEventListener("compositionend", function () {
      composing = false;
      schedule();
    });
    input.addEventListener("input", function () {
      if (!composing) {
        schedule();
      }
    });
    input.addEventListener("keydown", function (event) {
      if (composing || event.isComposing) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        move(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Escape") {
        if (!list.hidden) {
          event.preventDefault();
          window.clearTimeout(timer);
          requestId += 1;
          close();
        }
        return;
      }
      if (event.key === "Enter") {
        if (!list.hidden && active >= 0) {
          event.preventDefault();
          pick(active);
          return;
        }
        window.clearTimeout(timer);
        requestId += 1;
        close();
      }
    });
    input.addEventListener("blur", function () {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(function () {
        if (doc.activeElement !== input) {
          requestId += 1;
          close();
        }
      }, 180);
    });
    window.addEventListener("resize", function () {
      if (!list.hidden) {
        place();
      }
    });
    doc.addEventListener("scroll", function () {
      if (!list.hidden) {
        place();
      }
    }, true);

    return {
      close: close,
      refresh: function () {
        if (doc.activeElement !== input) {
          return;
        }
        window.clearTimeout(timer);
        refresh(input.value);
      },
    };
  }

  return {
    attach: attach,
  };
});
