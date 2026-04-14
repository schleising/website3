document.addEventListener("readystatechange", event => {
    if (event.target.readyState === "complete") {
        initialiseInputCardToggle();
        bindCrestPreview("team-a-select", "team-a-crest");
        bindCrestPreview("team-b-select", "team-b-crest");
    }
});

function initialiseInputCardToggle() {
    const inputCard = document.getElementById("h2h-input-card");
    const toggleButton = document.getElementById("h2h-input-toggle");
    const toggleIcon = document.getElementById("h2h-input-toggle-icon");

    if (!inputCard || !toggleButton) {
        return;
    }

    const applyToggleState = isCollapsed => {
        inputCard.classList.toggle("collapsed", isCollapsed);
        toggleButton.setAttribute("aria-expanded", String(!isCollapsed));
        if (toggleIcon) {
            toggleIcon.textContent = isCollapsed ? "▼" : "▲";
        }
    };

    toggleButton.addEventListener("click", () => {
        applyToggleState(!inputCard.classList.contains("collapsed"));
    });

    toggleButton.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            applyToggleState(!inputCard.classList.contains("collapsed"));
        }
    });

    applyToggleState(inputCard.classList.contains("collapsed"));

    if (inputCard.dataset.autoCollapse === "true") {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                applyToggleState(true);
            });
        });
    }
}

function bindCrestPreview(selectId, crestId) {
    const selectElement = document.getElementById(selectId);
    const crestElement = document.getElementById(crestId);

    if (!selectElement || !crestElement) {
        return;
    }

    const applyPreview = () => {
        const selectedOption = selectElement.options[selectElement.selectedIndex];
        const crestPath = selectedOption ? selectedOption.dataset.crest : "";

        if (crestPath) {
            crestElement.src = crestPath;
            crestElement.classList.remove("hidden");
        } else {
            crestElement.removeAttribute("src");
            crestElement.classList.add("hidden");
        }
    };

    selectElement.addEventListener("change", applyPreview);
    applyPreview();
}
