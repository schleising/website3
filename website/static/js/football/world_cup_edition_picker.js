document.addEventListener("DOMContentLoaded", function() {
    const openButton = document.getElementById("world-cup-edition-open");
    const closeButton = document.getElementById("world-cup-edition-close");
    const popup = document.getElementById("world-cup-edition-popup");
    const backdrop = document.getElementById("world-cup-edition-backdrop");

    if (openButton == null || popup == null || backdrop == null) {
        return;
    }

    function openPopup() {
        popup.classList.remove("hidden");
        backdrop.classList.remove("hidden");
        openButton.setAttribute("aria-expanded", "true");
    }

    function closePopup() {
        popup.classList.add("hidden");
        backdrop.classList.add("hidden");
        openButton.setAttribute("aria-expanded", "false");
    }

    openButton.addEventListener("click", openPopup);
    if (closeButton != null) {
        closeButton.addEventListener("click", closePopup);
    }
    backdrop.addEventListener("click", closePopup);
});
