document.addEventListener("readystatechange", event => {
    if (event.target.readyState === "complete") {
        initializeTodayScrollAnchor();
    }
});

function initializeTodayScrollAnchor() {
    const todayCard = document.getElementById("live-day-today");
    const visibilityThresholdPx = 14;

    if (!todayCard) {
        return;
    }

    const contentContainer = document.getElementById("content");
    const contentPad = document.querySelector(".football-content-pad");
    const returnButton = createReturnToTodayButton();

    if (contentContainer && returnButton) {
        contentContainer.appendChild(returnButton);
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const targetScrollTop = getTodayScrollTop(todayCard, contentContainer);

            if (contentContainer) {
                contentContainer.scrollTo({
                    top: targetScrollTop,
                    behavior: "auto",
                });
            } else {
                window.scrollTo({
                    top: targetScrollTop,
                    behavior: "auto",
                });
            }

            requestAnimationFrame(() => {
                const initialScrollTop = getCurrentScrollTop(contentContainer);

                if (!returnButton) {
                    return;
                }

                const updateButtonPosition = () => {
                    positionReturnButton(returnButton, contentContainer, contentPad);
                };

                const updateButtonVisibility = () => {
                    const currentScrollTop = getCurrentScrollTop(contentContainer);
                    const isAwayFromInitial = Math.abs(currentScrollTop - initialScrollTop) > visibilityThresholdPx;
                    returnButton.classList.toggle("is-visible", isAwayFromInitial);
                };

                returnButton.addEventListener("click", () => {
                    returnButton.classList.remove("is-visible");
                    const recenterScrollTop = getTodayScrollTop(todayCard, contentContainer);
                    scrollContainerTo(contentContainer, recenterScrollTop, "smooth");
                });

                const scrollEventTarget = contentContainer || window;
                scrollEventTarget.addEventListener("scroll", () => {
                    updateButtonVisibility();
                    updateButtonPosition();
                }, { passive: true });

                window.addEventListener("resize", () => {
                    updateButtonPosition();
                    updateButtonVisibility();
                });

                updateButtonPosition();
                updateButtonVisibility();
            });
        });
    });
}

const EARLIEST_MATCH_CLIP_TOLERANCE_PX = 12;

/**
 * Scroll offset for Today's matches.
 * Centre the day unless that would hide the earliest matches above the viewport.
 * In that case, pin the first unfinished match under the day heading.
 * Finished matches may sit above the fold.
 *
 * @param {HTMLElement} todayCard
 * @param {HTMLElement | null} contentContainer
 * @returns {number}
 */
function getTodayScrollTop(todayCard, contentContainer) {
    const centeredScrollTop = getTodayCenteredScrollTop(todayCard, contentContainer);
    const earliestMatch = todayCard.querySelector(".score-widget");
    if (!(earliestMatch instanceof HTMLElement)) {
        return centeredScrollTop;
    }

    if (!isElementAboveScrollport(
        earliestMatch,
        contentContainer,
        centeredScrollTop,
        EARLIEST_MATCH_CLIP_TOLERANCE_PX,
    )) {
        return centeredScrollTop;
    }

    const unfinishedMatch = findFirstUnfinishedMatch(todayCard);
    if (!(unfinishedMatch instanceof HTMLElement)) {
        return centeredScrollTop;
    }

    const heading = todayCard.querySelector(".football-day-heading");
    const headingHeight = heading instanceof HTMLElement
        ? heading.getBoundingClientRect().height
        : 0;
    return getElementAlignedScrollTop(unfinishedMatch, contentContainer, headingHeight);
}

/**
 * First match in Today that has not finished, in page order.
 *
 * @param {HTMLElement} todayCard
 * @returns {HTMLElement | null}
 */
function findFirstUnfinishedMatch(todayCard) {
    for (const match of todayCard.querySelectorAll(".score-widget")) {
        if (!(match instanceof HTMLElement)) {
            continue;
        }
        if (match.dataset.matchFinished !== "true") {
            return match;
        }
    }
    return null;
}

/**
 * @param {HTMLElement} element
 * @param {HTMLElement | null} contentContainer
 * @param {number} scrollTop
 * @param {number} tolerancePx
 * @returns {boolean}
 */
function isElementAboveScrollport(element, contentContainer, scrollTop, tolerancePx) {
    const scrollportTop = contentContainer
        ? contentContainer.getBoundingClientRect().top
        : 0;
    const elementTop = elementTopAtScroll(element, contentContainer, scrollTop);
    return elementTop < scrollportTop - tolerancePx;
}

/**
 * @param {HTMLElement} element
 * @param {HTMLElement | null} contentContainer
 * @param {number} scrollTop
 * @returns {number}
 */
function elementTopAtScroll(element, contentContainer, scrollTop) {
    const currentScroll = getCurrentScrollTop(contentContainer);
    return element.getBoundingClientRect().top - (scrollTop - currentScroll);
}

/**
 * Scroll offset that places an element `insetTop` pixels below the scrollport top.
 *
 * @param {HTMLElement} element
 * @param {HTMLElement | null} contentContainer
 * @param {number} insetTop
 * @returns {number}
 */
function getElementAlignedScrollTop(element, contentContainer, insetTop) {
    if (contentContainer) {
        const containerRect = contentContainer.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const nextScrollTop = contentContainer.scrollTop
            + (elementRect.top - containerRect.top)
            - insetTop;
        const maxScrollTop = Math.max(
            contentContainer.scrollHeight - contentContainer.clientHeight,
            0,
        );
        return Math.min(Math.max(nextScrollTop, 0), maxScrollTop);
    }

    const nextScrollTop = element.getBoundingClientRect().top + window.scrollY - insetTop;
    const maxScrollTop = Math.max(
        document.documentElement.scrollHeight - window.innerHeight,
        0,
    );
    return Math.min(Math.max(nextScrollTop, 0), maxScrollTop);
}

/**
 * Scroll offset that vertically centres Today's day group in the scroll container.
 *
 * @param {HTMLElement} todayCard
 * @param {HTMLElement | null} contentContainer
 * @returns {number}
 */
function getTodayCenteredScrollTop(todayCard, contentContainer) {
    if (contentContainer) {
        const containerRect = contentContainer.getBoundingClientRect();
        const cardRect = todayCard.getBoundingClientRect();
        const cardCenter = cardRect.top + (cardRect.height / 2);
        const viewportCenter = containerRect.top + (contentContainer.clientHeight / 2);
        const nextScrollTop = contentContainer.scrollTop + (cardCenter - viewportCenter);
        const maxScrollTop = Math.max(
            contentContainer.scrollHeight - contentContainer.clientHeight,
            0
        );
        return Math.min(Math.max(nextScrollTop, 0), maxScrollTop);
    }

    const cardRect = todayCard.getBoundingClientRect();
    const cardCenter = cardRect.top + window.scrollY + (cardRect.height / 2);
    const nextScrollTop = cardCenter - (window.innerHeight / 2);
    const maxScrollTop = Math.max(
        document.documentElement.scrollHeight - window.innerHeight,
        0
    );
    return Math.min(Math.max(nextScrollTop, 0), maxScrollTop);
}

function getCurrentScrollTop(contentContainer) {
    return contentContainer ? contentContainer.scrollTop : window.scrollY;
}

function scrollContainerTo(contentContainer, topValue, behaviorValue) {
    if (contentContainer) {
        contentContainer.scrollTo({
            top: topValue,
            behavior: behaviorValue,
        });
        return;
    }

    window.scrollTo({
        top: topValue,
        behavior: behaviorValue,
    });
}

function createReturnToTodayButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.id = "football-return-to-today";
    button.className = "football-return-to-today";
    button.setAttribute("aria-label", "Scroll back to Today");
    button.textContent = "Today";
    return button;
}

function positionReturnButton(button, contentContainer, contentPad) {
    if (!button || !contentContainer) {
        return;
    }

    const contentRect = contentContainer.getBoundingClientRect();
    const fallbackPadPx = 14;
    let insetPadPx = fallbackPadPx;

    if (contentPad) {
        const padStyle = window.getComputedStyle(contentPad);
        const parsedPad = parseFloat(padStyle.paddingTop);
        if (!Number.isNaN(parsedPad) && parsedPad > 0) {
            insetPadPx = parsedPad;
        }
    }

    button.style.top = `${Math.round(contentRect.top + insetPadPx)}px`;
    button.style.right = `${Math.max(Math.round(window.innerWidth - contentRect.right + insetPadPx), 8)}px`;
}
