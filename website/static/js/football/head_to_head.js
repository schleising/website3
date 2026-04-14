document.addEventListener("readystatechange", event => {
    if (event.target.readyState === "complete") {
        bindCrestPreview("team-a-select", "team-a-crest");
        bindCrestPreview("team-b-select", "team-b-crest");
    }
});

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
