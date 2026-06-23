(function () {
    const helpRoots = document.querySelectorAll("[data-standings-rules-help]");
    if (helpRoots.length === 0) {
        return;
    }

    function setAriaVisible(root, visible) {
        const button = root.querySelector(".world-cup-standings-rules-help-btn");
        const popup = root.querySelector(".world-cup-standings-rules-help-popup");
        if (!button || !popup) {
            return;
        }

        button.setAttribute("aria-expanded", visible ? "true" : "false");
        popup.setAttribute("aria-hidden", visible ? "false" : "true");
    }

    function isPopupVisible(root) {
        return (
            root.classList.contains("is-open") ||
            root.matches(":hover") ||
            root.contains(document.activeElement)
        );
    }

    function positionPopup(root) {
        const button = root.querySelector(".world-cup-standings-rules-help-btn");
        const popup = root.querySelector(".world-cup-standings-rules-help-popup");
        if (!button || !popup) {
            return;
        }

        const styles = getComputedStyle(root);
        const gap = parseFloat(styles.getPropertyValue("--wc-standings-rules-gap")) || 6.4;
        const margin = parseFloat(styles.getPropertyValue("--wc-standings-rules-margin")) || 16;
        const buttonRect = button.getBoundingClientRect();
        const popupWidth = popup.offsetWidth;
        const maxLeft = window.innerWidth - popupWidth - margin;

        let left = buttonRect.left - popupWidth - gap;
        if (left < margin) {
            left = Math.min(buttonRect.right + gap, maxLeft);
        }
        left = Math.max(margin, Math.min(left, maxLeft));

        popup.style.setProperty("--wc-standings-rules-left", `${left}px`);
    }

    function repositionVisiblePopups() {
        helpRoots.forEach((root) => {
            if (isPopupVisible(root)) {
                positionPopup(root);
            }
        });
    }

    function setPinned(root, pinned) {
        if (pinned) {
            positionPopup(root);
        }
        root.classList.toggle("is-open", pinned);
        setAriaVisible(root, pinned);
    }

    helpRoots.forEach((root) => {
        const button = root.querySelector(".world-cup-standings-rules-help-btn");
        if (!button) {
            return;
        }

        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const willOpen = !root.classList.contains("is-open");
            if (willOpen) {
                positionPopup(root);
            }
            setPinned(root, willOpen);
        });

        root.addEventListener("mouseenter", () => {
            positionPopup(root);
            setAriaVisible(root, true);
        });

        root.addEventListener("focusin", () => {
            positionPopup(root);
            setAriaVisible(root, true);
        });

        root.addEventListener("focusout", (event) => {
            if (!root.classList.contains("is-open") && !root.contains(event.relatedTarget)) {
                setAriaVisible(root, false);
            }
        });
    });

    document.addEventListener("click", (event) => {
        helpRoots.forEach((root) => {
            if (!root.contains(event.target)) {
                setPinned(root, false);
            }
        });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
            return;
        }
        helpRoots.forEach((root) => setPinned(root, false));
    });

    window.addEventListener("resize", repositionVisiblePopups);
    window.addEventListener("scroll", repositionVisiblePopups, true);
})();
