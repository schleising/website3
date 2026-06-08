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

    function setPinned(root, pinned) {
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
            setPinned(root, !root.classList.contains("is-open"));
        });

        root.addEventListener("focusin", () => {
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
})();
