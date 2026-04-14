document.addEventListener("readystatechange", event => {
    if (event.target.readyState === "complete") {
        initialiseSeasonPopup();
    }
});

function initialiseSeasonPopup() {
    const openButton = document.getElementById("football-season-open");
    const closeButton = document.getElementById("football-season-close");
    const popupElement = document.getElementById("football-season-popup");
    const backdropElement = document.getElementById("football-season-backdrop");
    const seasonSelect = document.getElementById("football-season-select");

    if (!openButton || !closeButton || !popupElement || !backdropElement) {
        return;
    }

    const openPopup = () => {
        popupElement.classList.remove("hidden");
        backdropElement.classList.remove("hidden");
        openButton.setAttribute("aria-expanded", "true");
        backdropElement.setAttribute("aria-hidden", "false");
        document.body.classList.add("football-season-popup-open");

        if (seasonSelect) {
            seasonSelect.focus();
        }
    };

    const closePopup = () => {
        popupElement.classList.add("hidden");
        backdropElement.classList.add("hidden");
        openButton.setAttribute("aria-expanded", "false");
        backdropElement.setAttribute("aria-hidden", "true");
        document.body.classList.remove("football-season-popup-open");
        openButton.focus();
    };

    openButton.addEventListener("click", openPopup);
    closeButton.addEventListener("click", closePopup);
    backdropElement.addEventListener("click", closePopup);

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !popupElement.classList.contains("hidden")) {
            closePopup();
        }
    });
}
