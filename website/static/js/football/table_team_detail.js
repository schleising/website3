(() => {
    const COMPACT_QUERY = "(max-width: 75rem)";
    const DETAIL_ROW_EVENT = "football-table-row-updated";
    const LONG_PRESS_MS = 480;
    const MOVE_CANCEL_PX = 12;
    const CLICK_SUPPRESS_MS = 450;
    const OPEN_GUARD_MS = 320;

    let overlayElement = null;
    let sheetElement = null;
    let titleElement = null;
    let badgeElement = null;
    let closeButtonElement = null;
    let listElement = null;
    let fixturesLinkElement = null;
    let openRow = null;
    let lastFocusedElement = null;
    let compactMediaQuery = null;

    let longPressTimerId = null;
    let longPressRow = null;
    let longPressStartX = 0;
    let longPressStartY = 0;
    let longPressPointerId = null;
    let suppressNextClick = false;
    let suppressClickTimerId = null;
    let openGuardTimerId = null;

    function isCompactViewport() {
        if (!compactMediaQuery) {
            compactMediaQuery = window.matchMedia(COMPACT_QUERY);
        }
        return compactMediaQuery.matches;
    }

    function cellText(row, selector) {
        const element = row.querySelector(selector);
        if (!(element instanceof HTMLElement)) {
            return "";
        }
        return String(element.textContent || "").trim();
    }

    function getLiveMatchChipFromTarget(target) {
        if (!(target instanceof Element)) {
            return null;
        }
        return target.closest(".table-position-delta[data-live-match=\"true\"]");
    }

    function getRowFromTarget(target) {
        if (!(target instanceof Element)) {
            return null;
        }
        const row = target.closest(".table-container .data-row[data-team-id]");
        return row instanceof HTMLElement ? row : null;
    }

    function clearLongPressTimer() {
        if (longPressTimerId !== null) {
            window.clearTimeout(longPressTimerId);
            longPressTimerId = null;
        }
        longPressRow = null;
        longPressPointerId = null;
    }

    function ensureElements() {
        if (overlayElement && sheetElement) {
            return;
        }

        overlayElement = document.createElement("div");
        overlayElement.className = "table-team-detail-overlay";
        overlayElement.setAttribute("aria-hidden", "true");

        sheetElement = document.createElement("div");
        sheetElement.className = "table-team-detail-sheet";
        sheetElement.setAttribute("role", "dialog");
        sheetElement.setAttribute("aria-modal", "true");
        sheetElement.setAttribute("aria-labelledby", "table-team-detail-title");
        sheetElement.tabIndex = -1;

        sheetElement.innerHTML = `
            <div class="table-team-detail-header">
                <div class="table-team-detail-identity">
                    <img class="team-badge" alt="" hidden>
                    <h2 id="table-team-detail-title" class="table-team-detail-title"></h2>
                </div>
                <button type="button" class="table-team-detail-close" aria-label="Close team details">&times;</button>
            </div>
            <div class="table-team-detail-body">
                <dl class="table-team-detail-list"></dl>
                <div class="table-team-detail-actions">
                    <a class="table-team-detail-link" href="#">View fixtures</a>
                </div>
            </div>
        `;

        overlayElement.appendChild(sheetElement);

        titleElement = sheetElement.querySelector("#table-team-detail-title");
        badgeElement = sheetElement.querySelector(".table-team-detail-identity .team-badge");
        closeButtonElement = sheetElement.querySelector(".table-team-detail-close");
        listElement = sheetElement.querySelector(".table-team-detail-list");
        fixturesLinkElement = sheetElement.querySelector(".table-team-detail-link");

        closeButtonElement?.addEventListener("click", closeDetail);
        overlayElement.addEventListener("click", event => {
            if (event.target === overlayElement) {
                closeDetail();
            }
        });
    }

    function mountOverlayForRow(row) {
        if (!(overlayElement instanceof HTMLElement) || !(row instanceof HTMLElement)) {
            return;
        }

        const container = row.closest(".table-container");
        if (!(container instanceof HTMLElement)) {
            return;
        }

        if (overlayElement.parentElement !== container) {
            container.appendChild(overlayElement);
        }
    }

    function appendTextRow(label, value) {
        if (!(listElement instanceof HTMLElement) || value === "") {
            return;
        }

        const row = document.createElement("div");
        row.className = "table-team-detail-row";

        const term = document.createElement("dt");
        term.className = "table-team-detail-term";
        term.textContent = label;

        const description = document.createElement("dd");
        description.className = "table-team-detail-value";
        description.textContent = value;

        row.append(term, description);
        listElement.appendChild(row);
    }

    function appendFormRow(row) {
        if (!(listElement instanceof HTMLElement)) {
            return;
        }

        const sourceForm = row.querySelector(".form-container");
        if (!(sourceForm instanceof HTMLElement)) {
            return;
        }

        const clone = sourceForm.cloneNode(true);
        if (!(clone instanceof HTMLElement)) {
            return;
        }

        const text = String(clone.textContent || "").trim();
        if (text === "" || text === "-") {
            return;
        }

        const listRow = document.createElement("div");
        listRow.className = "table-team-detail-row table-team-detail-row--form";

        const term = document.createElement("dt");
        term.className = "table-team-detail-term";
        term.textContent = "Form";

        const description = document.createElement("dd");
        description.className = "table-team-detail-value table-team-detail-value--form";
        description.appendChild(clone);

        listRow.append(term, description);
        listElement.appendChild(listRow);
    }

    function renderFromRow(row) {
        ensureElements();
        if (!(row instanceof HTMLElement) || !(listElement instanceof HTMLElement)) {
            return;
        }

        const nameElement = row.querySelector(".team-name");
        const teamName = String(nameElement?.textContent || "").trim() || "Team";
        const crest = row.querySelector(".team-badge");
        const teamLink = row.querySelector("a.team-and-badge, a.team-name");

        if (titleElement instanceof HTMLElement) {
            titleElement.textContent = teamName;
        }

        if (badgeElement instanceof HTMLImageElement) {
            if (crest instanceof HTMLImageElement && crest.getAttribute("src")) {
                badgeElement.src = crest.getAttribute("src") || "";
                badgeElement.hidden = false;
            } else {
                badgeElement.removeAttribute("src");
                badgeElement.hidden = true;
            }
        }

        listElement.replaceChildren();

        appendTextRow("Position", cellText(row, ".table-position-value"));
        appendTextRow("Played", cellText(row, ".table-played"));
        appendTextRow("Won", cellText(row, ".table-won"));
        appendTextRow("Drawn", cellText(row, ".table-draw"));
        appendTextRow("Lost", cellText(row, ".table-lost"));
        appendTextRow("Goals for", cellText(row, ".table-goals-for"));
        appendTextRow("Goals against", cellText(row, ".table-goals-against"));
        appendTextRow("Goal difference", cellText(row, ".table-goal-difference"));
        appendTextRow("Points", cellText(row, ".table-points"));
        appendFormRow(row);

        const delta = row.querySelector(".table-position-delta");
        const scoreText = delta instanceof HTMLElement
            ? String(delta.textContent || "").trim()
            : "";
        if (scoreText) {
            const isLive = Boolean(row.querySelector(".live-indicator-dot"))
                || (delta instanceof HTMLElement && delta.getAttribute("data-live-match") === "true");
            appendTextRow(isLive ? "Live score" : "Today's score", scoreText);
        }

        if (fixturesLinkElement instanceof HTMLAnchorElement) {
            const href = teamLink instanceof HTMLAnchorElement
                ? teamLink.getAttribute("href")
                : null;
            if (href) {
                fixturesLinkElement.href = href;
                fixturesLinkElement.hidden = false;
                fixturesLinkElement.textContent = href.includes("/world-cup/")
                    ? "View team"
                    : "View fixtures";
            } else {
                fixturesLinkElement.hidden = true;
            }
        }
    }

    function clearClickSuppression() {
        suppressNextClick = false;
        if (suppressClickTimerId !== null) {
            window.clearTimeout(suppressClickTimerId);
            suppressClickTimerId = null;
        }
    }

    function armClickSuppression() {
        clearClickSuppression();
        suppressNextClick = true;
        suppressClickTimerId = window.setTimeout(() => {
            suppressNextClick = false;
            suppressClickTimerId = null;
        }, CLICK_SUPPRESS_MS);
    }

    function clearOpenGuard() {
        if (openGuardTimerId !== null) {
            window.clearTimeout(openGuardTimerId);
            openGuardTimerId = null;
        }
        overlayElement?.classList.remove("is-opening");
    }

    function armOpenGuard() {
        clearOpenGuard();
        if (!overlayElement) {
            return;
        }

        // Ignore the finger-up / ghost click that follows a long-press open.
        overlayElement.classList.add("is-opening");
        openGuardTimerId = window.setTimeout(() => {
            overlayElement?.classList.remove("is-opening");
            openGuardTimerId = null;
        }, OPEN_GUARD_MS);
    }

    function isDetailOpen() {
        return Boolean(overlayElement && overlayElement.classList.contains("is-open"));
    }

    function openDetail(row) {
        if (!(row instanceof HTMLElement) || !isCompactViewport()) {
            return;
        }

        ensureElements();
        mountOverlayForRow(row);
        openRow = row;
        lastFocusedElement = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        renderFromRow(row);

        if (overlayElement) {
            overlayElement.setAttribute("aria-hidden", "false");
            overlayElement.classList.remove("is-open");
            void overlayElement.offsetWidth;
            overlayElement.classList.add("is-open");
            armOpenGuard();
        }

        document.body.classList.add("table-team-detail-open");
        closeButtonElement?.focus();
    }

    function closeDetail() {
        if (!isDetailOpen()) {
            return;
        }

        clearOpenGuard();
        clearClickSuppression();
        overlayElement.classList.remove("is-open");
        overlayElement.setAttribute("aria-hidden", "true");
        document.body.classList.remove("table-team-detail-open");
        openRow = null;

        if (lastFocusedElement instanceof HTMLElement) {
            lastFocusedElement.focus();
        }
        lastFocusedElement = null;
    }

    function handlePointerDown(event) {
        if (!isCompactViewport() || event.button > 0) {
            return;
        }

        if (!(event.target instanceof Element)) {
            return;
        }

        if (getLiveMatchChipFromTarget(event.target)) {
            return;
        }

        const row = getRowFromTarget(event.target);
        if (!row) {
            return;
        }

        clearLongPressTimer();
        longPressRow = row;
        longPressPointerId = event.pointerId;
        longPressStartX = event.clientX;
        longPressStartY = event.clientY;

        longPressTimerId = window.setTimeout(() => {
            const targetRow = longPressRow;
            clearLongPressTimer();
            if (!(targetRow instanceof HTMLElement)) {
                return;
            }

            armClickSuppression();
            openDetail(targetRow);

            if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
                navigator.vibrate(12);
            }
        }, LONG_PRESS_MS);
    }

    function handlePointerMove(event) {
        if (longPressTimerId === null || event.pointerId !== longPressPointerId) {
            return;
        }

        const deltaX = Math.abs(event.clientX - longPressStartX);
        const deltaY = Math.abs(event.clientY - longPressStartY);
        if (deltaX > MOVE_CANCEL_PX || deltaY > MOVE_CANCEL_PX) {
            clearLongPressTimer();
        }
    }

    function handlePointerEnd(event) {
        if (event.pointerId !== longPressPointerId && longPressPointerId !== null) {
            return;
        }
        clearLongPressTimer();
    }

    function handleClickCapture(event) {
        if (!suppressNextClick) {
            return;
        }

        // Never block dismiss / in-sheet taps; only eat the post-long-press ghost click.
        if (overlayElement && event.target instanceof Node && overlayElement.contains(event.target)) {
            clearClickSuppression();
            return;
        }

        clearClickSuppression();
        event.preventDefault();
        event.stopPropagation();
    }

    function handleContextMenu(event) {
        if (!suppressNextClick && longPressTimerId === null) {
            return;
        }

        if (!(event.target instanceof Element) || !getRowFromTarget(event.target)) {
            return;
        }

        event.preventDefault();
    }

    function handleKeydown(event) {
        if (event.key !== "Escape") {
            return;
        }
        if (!isDetailOpen()) {
            return;
        }
        closeDetail();
    }

    function handleRowUpdated(event) {
        if (!(openRow instanceof HTMLElement) || !isDetailOpen()) {
            return;
        }

        const detail = event instanceof CustomEvent ? event.detail : null;
        const updatedRow = detail && detail.row instanceof HTMLElement
            ? detail.row
            : (event.target instanceof HTMLElement ? event.target : null);

        if (updatedRow && updatedRow === openRow) {
            renderFromRow(openRow);
        }
    }

    function handleViewportChange() {
        clearLongPressTimer();
        if (!isCompactViewport()) {
            closeDetail();
        }
    }

    document.addEventListener("pointerdown", handlePointerDown, { passive: true });
    document.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("pointerup", handlePointerEnd, { passive: true });
    document.addEventListener("pointercancel", handlePointerEnd, { passive: true });
    document.addEventListener("click", handleClickCapture, true);
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener(DETAIL_ROW_EVENT, handleRowUpdated);

    compactMediaQuery = window.matchMedia(COMPACT_QUERY);
    if (typeof compactMediaQuery.addEventListener === "function") {
        compactMediaQuery.addEventListener("change", handleViewportChange);
    } else if (typeof compactMediaQuery.addListener === "function") {
        compactMediaQuery.addListener(handleViewportChange);
    }
})();
