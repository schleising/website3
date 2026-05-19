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

    function formatShortDay(dayValue) {
        const rawDay = String(dayValue || "").trim();
        if (rawDay === "") {
            return "";
        }

        const parsed = new Date(`${rawDay}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime())) {
            return rawDay;
        }

        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
        }).format(parsed);
    }

    function buildNiceAxisScale(maxValue) {
        const normalizedMax = Math.max(1, Number(maxValue || 0));
        const roughStep = normalizedMax / 4;
        const magnitude = 10 ** Math.floor(Math.log10(Math.max(roughStep, 1)));
        const normalizedStep = roughStep / magnitude;

        let stepMultiplier = 1;
        if (normalizedStep > 5) {
            stepMultiplier = 10;
        } else if (normalizedStep > 2) {
            stepMultiplier = 5;
        } else if (normalizedStep > 1) {
            stepMultiplier = 2;
        }

        const step = Math.max(1, stepMultiplier * magnitude);
        const axisMax = Math.max(step, Math.ceil(normalizedMax / step) * step);
        const tickValues = [];

        for (let value = axisMax; value >= 0; value -= step) {
            tickValues.push(value);
        }

        if (tickValues[tickValues.length - 1] !== 0) {
            tickValues.push(0);
        }

        return {
            axisMax,
            tickValues,
        };
    }

    function shouldShowXAxisLabel(index, total) {
        if (total <= 8) {
            return true;
        }

        const cadence = total <= 16 ? 3 : 5;
        return index === 0 || index === total - 1 || index % cadence === 0;
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

        const overallMaxValue = Math.max(
            1,
            ...seriesDefs.flatMap(def => dailyPoints.map(point => Number(point[def[1]] || 0)))
        );
        const scale = buildNiceAxisScale(overallMaxValue);
        const legend = document.createElement("div");
        legend.className = "feeds-stats-overall-legend";

        const legendTitle = document.createElement("div");
        legendTitle.className = "feeds-stats-overall-legend-title";
        legendTitle.textContent = "Key";
        legend.appendChild(legendTitle);

        seriesDefs.forEach(def => {
            const legendItem = document.createElement("div");
            legendItem.className = "feeds-stats-overall-legend-item";

            const swatch = document.createElement("span");
            swatch.className = `feeds-stats-overall-legend-swatch ${def[2]}`;

            const text = document.createElement("span");
            text.textContent = def[0];

            legendItem.appendChild(swatch);
            legendItem.appendChild(text);
            legend.appendChild(legendItem);
        });

        const body = document.createElement("div");
        body.className = "feeds-stats-overall-body";

        const yAxis = document.createElement("div");
        yAxis.className = "feeds-stats-overall-y-axis";

        scale.tickValues.forEach(value => {
            const tick = document.createElement("div");
            tick.className = "feeds-stats-overall-y-tick";
            tick.textContent = formatNumber(value);
            yAxis.appendChild(tick);
        });

        const stage = document.createElement("div");
        stage.className = "feeds-stats-overall-stage";

        const gridArea = document.createElement("div");
        gridArea.className = "feeds-stats-overall-grid-area";

        const gridLines = document.createElement("div");
        gridLines.className = "feeds-stats-overall-gridlines";
        scale.tickValues.forEach((value, index) => {
            const line = document.createElement("div");
            line.className = "feeds-stats-overall-gridline";
            if (index === scale.tickValues.length - 1 || value === 0) {
                line.classList.add("is-baseline");
            }
            gridLines.appendChild(line);
        });

        const plot = document.createElement("div");
        plot.className = "feeds-stats-overall-plot";

        const xAxis = document.createElement("div");
        xAxis.className = "feeds-stats-overall-x-axis";

        dailyPoints.forEach((pointData, index) => {
            const dayGroup = document.createElement("div");
            dayGroup.className = "feeds-stats-overall-day";
            dayGroup.title = [
                pointData.day,
                `Published: ${formatNumber(pointData.published_count)}`,
                `Opened: ${formatNumber(pointData.opened_count)}`,
                `Saved: ${formatNumber(pointData.saved_count)}`,
            ].join("\n");

            const dayBars = document.createElement("div");
            dayBars.className = "feeds-stats-overall-day-bars";

            seriesDefs.forEach(def => {
                const value = Number(pointData[def[1]] || 0);
                const barWrap = document.createElement("span");
                barWrap.className = "feeds-stats-series-bar-wrap";

                const bar = document.createElement("span");
                bar.className = `feeds-stats-series-bar ${def[2]}`;
                bar.style.height = value <= 0
                    ? "0rem"
                    : `${Math.max(0.5, (value / scale.axisMax) * 100).toFixed(3)}%`;

                barWrap.appendChild(bar);
                dayBars.appendChild(barWrap);
            });

            dayGroup.appendChild(dayBars);
            plot.appendChild(dayGroup);

            const xTick = document.createElement("div");
            xTick.className = "feeds-stats-overall-x-tick";
            xTick.textContent = shouldShowXAxisLabel(index, dailyPoints.length)
                ? formatShortDay(pointData.day)
                : "";
            xAxis.appendChild(xTick);
        });

        gridArea.appendChild(gridLines);
        gridArea.appendChild(plot);
        stage.appendChild(gridArea);
        stage.appendChild(xAxis);
        body.appendChild(yAxis);
        body.appendChild(stage);

        overallChart.appendChild(legend);
        overallChart.appendChild(body);
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
