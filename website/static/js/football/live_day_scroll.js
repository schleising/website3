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
            const targetScrollTop = getTodayCenteredScrollTop(todayCard, contentContainer);

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
                    const recenterScrollTop = getTodayCenteredScrollTop(todayCard, contentContainer);
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
