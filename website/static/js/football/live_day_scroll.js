document.addEventListener("readystatechange", event => {
    if (event.target.readyState === "complete") {
        scrollTodayCardToTop();
    }
});

function scrollTodayCardToTop() {
    const todayCard = document.querySelector('[data-live-day-today="true"]');
    const topGapPx = 14;

    if (!todayCard) {
        return;
    }

    const contentContainer = document.getElementById("content");

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (contentContainer) {
                const targetTop = todayCard.offsetTop - contentContainer.offsetTop;
                contentContainer.scrollTo({
                    top: Math.max(targetTop - topGapPx, 0),
                    behavior: "auto",
                });
                return;
            }

            const cardTop = todayCard.getBoundingClientRect().top + window.scrollY;
            window.scrollTo({
                top: Math.max(cardTop - topGapPx, 0),
                behavior: "auto",
            });
        });
    });
}
