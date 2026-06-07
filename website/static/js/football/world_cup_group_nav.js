(function () {
    const prevLink = document.querySelector('[data-world-cup-group-nav="prev"]');
    const nextLink = document.querySelector('[data-world-cup-group-nav="next"]');

    if (prevLink === null && nextLink === null) {
        return;
    }

    function isEditableTarget(target) {
        if (!(target instanceof Element)) {
            return false;
        }

        return target.closest(
            'input, textarea, select, button, a, [contenteditable=""], [contenteditable="true"]'
        ) !== null;
    }

    document.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
            return;
        }

        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
            return;
        }

        if (isEditableTarget(event.target)) {
            return;
        }

        const targetLink = event.key === "ArrowLeft" ? prevLink : nextLink;
        if (targetLink === null) {
            return;
        }

        event.preventDefault();
        window.location.assign(targetLink.href);
    });
})();
