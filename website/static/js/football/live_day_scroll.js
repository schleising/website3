document.addEventListener("readystatechange", event => {
    if (event.target.readyState === "complete") {
        initializeTodayScrollAnchor();
    }
});

function initializeTodayScrollAnchor() {
    const todayCard = document.getElementById("live-day-today");
    const topGapPx = 14;
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
            const targetScrollTop = getTodayTargetScrollTop(todayCard, contentContainer, topGapPx);

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
                    scrollContainerTo(contentContainer, initialScrollTop, "smooth");
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

function getTodayTargetScrollTop(todayCard, contentContainer, topGapPx) {
    if (contentContainer) {
        const targetTop = todayCard.offsetTop - contentContainer.offsetTop;
        return Math.max(targetTop - topGapPx, 0);
    }

    const cardTop = todayCard.getBoundingClientRect().top + window.scrollY;
    return Math.max(cardTop - topGapPx, 0);
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
