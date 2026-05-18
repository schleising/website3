(function () {
    "use strict";

    const root = document.getElementById("feeds-stats-root");
    if (!(root instanceof HTMLElement)) {
        return;
    }

    const statusNode = document.getElementById("feeds-stats-status");
    const windowDaysNode = document.getElementById("feeds-stats-window-days");
    const kpiContainer = document.getElementById("feeds-stats-kpis");
    const overallChart = document.getElementById("feeds-stats-overall-chart");
    const categoryBars = document.getElementById("feeds-stats-category-bars");
    const feedBars = document.getElementById("feeds-stats-feed-bars");
    const categoryTableBody = document.querySelector("#feeds-stats-category-table tbody");
    const feedTableBody = document.querySelector("#feeds-stats-feed-table tbody");

    const statsEndpoint = String(root.dataset.statsEndpoint || "/feeds/api/stats/").trim();

    function setStatus(message, isError) {
        if (!(statusNode instanceof HTMLElement)) {
            return;
        }

        statusNode.textContent = message;
        statusNode.classList.toggle("is-error", Boolean(isError));
    }

    function formatNumber(value) {
        return new Intl.NumberFormat().format(Number(value || 0));
    }

    function formatPercent(value) {
        return `${Number(value || 0).toFixed(1)}%`;
    }

    function renderKpis(overall) {
        if (!(kpiContainer instanceof HTMLElement)) {
            return;
        }

        const items = [
            ["Total Articles", formatNumber(overall.articles_total)],
            ["Articles (Window)", formatNumber(overall.articles_recent)],
            ["Frequency / Day", Number(overall.articles_per_day_recent || 0).toFixed(2)],
            ["Opened", formatNumber(overall.opened_total)],
            ["Saved", formatNumber(overall.saved_total)],
            ["Open Rate", formatPercent(overall.open_rate_percent)],
            ["Save Rate", formatPercent(overall.save_rate_percent)],
            ["Subscribed Feeds", formatNumber(overall.total_feeds)],
            ["Categories", formatNumber(overall.total_categories)],
        ];

        kpiContainer.innerHTML = "";
        items.forEach(item => {
            const card = document.createElement("div");
            card.className = "feeds-stats-kpi";

            const label = document.createElement("div");
            label.className = "feeds-stats-kpi-label";
            label.textContent = item[0];

            const value = document.createElement("div");
            value.className = "feeds-stats-kpi-value";
            value.textContent = item[1];

            card.appendChild(label);
            card.appendChild(value);
            kpiContainer.appendChild(card);
        });
    }

    function renderOverallChart(dailyPoints) {
        if (!(overallChart instanceof HTMLElement)) {
            return;
        }

        overallChart.innerHTML = "";

        const seriesDefs = [
            ["Published", "published_count", "is-published"],
            ["Opened", "opened_count", "is-opened"],
            ["Saved", "saved_count", "is-saved"],
        ];

        seriesDefs.forEach(def => {
            const row = document.createElement("div");
            row.className = "feeds-stats-series-row";

            const label = document.createElement("div");
            label.className = "feeds-stats-series-label";
            label.textContent = def[0];

            const bars = document.createElement("div");
            bars.className = "feeds-stats-series-bars";

            const values = dailyPoints.map(point => Number(point[def[1]] || 0));
            const maxValue = Math.max(1, ...values);

            values.forEach((value, index) => {
                const bar = document.createElement("span");
                bar.className = `feeds-stats-series-bar ${def[2]}`;
                bar.style.height = `${Math.max(6, Math.round((value / maxValue) * 64))}px`;
                bar.title = `${dailyPoints[index].day}: ${value}`;
                bars.appendChild(bar);
            });

            row.appendChild(label);
            row.appendChild(bars);
            overallChart.appendChild(row);
        });
    }

    function renderBarList(container, rows, metricKey) {
        if (!(container instanceof HTMLElement)) {
            return;
        }

        const topRows = rows.slice(0, 10);
        const maxMetric = Math.max(1, ...topRows.map(row => Number(row[metricKey] || 0)));

        container.innerHTML = "";
        topRows.forEach(row => {
            const item = document.createElement("div");
            item.className = "feeds-stats-bar-item";

            const label = document.createElement("div");
            label.className = "feeds-stats-bar-label";
            label.textContent = row.name;

            const barWrap = document.createElement("div");
            barWrap.className = "feeds-stats-bar-wrap";

            const bar = document.createElement("div");
            bar.className = "feeds-stats-bar-fill";
            bar.style.width = `${Math.max(4, Math.round((Number(row[metricKey] || 0) / maxMetric) * 100))}%`;

            const value = document.createElement("span");
            value.className = "feeds-stats-bar-value";
            value.textContent = formatNumber(row[metricKey]);

            bar.appendChild(value);
            barWrap.appendChild(bar);

            item.appendChild(label);
            item.appendChild(barWrap);
            container.appendChild(item);
        });
    }

    function renderTableRows(tbody, rows, isFeedTable) {
        if (!(tbody instanceof HTMLElement)) {
            return;
        }

        tbody.innerHTML = "";

        rows.forEach(row => {
            const tr = document.createElement("tr");

            const cells = isFeedTable
                ? [
                    row.name,
                    row.category_name || "-",
                    formatNumber(row.articles_total),
                    formatNumber(row.articles_recent),
                    formatNumber(row.opened_total),
                    formatNumber(row.saved_total),
                    formatPercent(row.open_rate_percent),
                    formatPercent(row.save_rate_percent),
                ]
                : [
                    row.name,
                    formatNumber(row.articles_total),
                    formatNumber(row.articles_recent),
                    formatNumber(row.opened_total),
                    formatNumber(row.saved_total),
                    formatPercent(row.open_rate_percent),
                    formatPercent(row.save_rate_percent),
                ];

            cells.forEach(value => {
                const td = document.createElement("td");
                td.textContent = value;
                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });
    }

    async function loadStats() {
        setStatus("Loading stats...", false);

        try {
            const response = await fetch(`${statsEndpoint}?window_days=30`, {
                method: "GET",
                cache: "no-store",
            });
            if (!response.ok) {
                throw new Error("Unable to load feed stats.");
            }

            const payload = await response.json();
            if (windowDaysNode instanceof HTMLElement) {
                windowDaysNode.textContent = String(payload.window_days || 30);
            }

            const overall = payload.overall || {};
            const perCategory = Array.isArray(payload.per_category) ? payload.per_category : [];
            const perFeed = Array.isArray(payload.per_feed) ? payload.per_feed : [];
            const daily = Array.isArray(overall.daily) ? overall.daily : [];

            renderKpis(overall);
            renderOverallChart(daily);
            renderBarList(categoryBars, perCategory, "articles_recent");
            renderBarList(feedBars, perFeed, "articles_recent");
            renderTableRows(categoryTableBody, perCategory, false);
            renderTableRows(feedTableBody, perFeed, true);

            setStatus("Stats updated.", false);
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to load feed stats.", true);
        }
    }

    loadStats();
})();
