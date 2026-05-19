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
    /** @type {Record<string, any> | null} */
    let latestStatsPayload = null;
    /** @type {number | null} */
    let resizeRafId = null;

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

    function maxOverallChartDays() {
        if (window.matchMedia("(max-width: 52rem)").matches) {
            return 15;
        }

        return 30;
    }

    function getVisibleDailyPoints(dailyPoints) {
        const normalizedPoints = Array.isArray(dailyPoints) ? dailyPoints : [];
        const maxDays = maxOverallChartDays();
        if (normalizedPoints.length <= maxDays) {
            return normalizedPoints;
        }

        return normalizedPoints.slice(normalizedPoints.length - maxDays);
    }

    function renderStatsPayload(payload) {
        latestStatsPayload = payload && typeof payload === "object" ? payload : null;
        const safePayload = latestStatsPayload || {};

        if (windowDaysNode instanceof HTMLElement) {
            windowDaysNode.textContent = String(safePayload.window_days || 30);
        }

        const overall = safePayload.overall || {};
        const perCategory = Array.isArray(safePayload.per_category) ? safePayload.per_category : [];
        const perFeed = Array.isArray(safePayload.per_feed) ? safePayload.per_feed : [];
        const daily = getVisibleDailyPoints(Array.isArray(overall.daily) ? overall.daily : []);

        renderKpis(overall);
        renderOverallChart(daily);
        renderBarList(categoryBars, perCategory, "articles_recent");
        renderBarList(feedBars, perFeed, "articles_recent");
        renderTableRows(categoryTableBody, perCategory, false);
        renderTableRows(feedTableBody, perFeed, true);
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
            {
                key: "published",
                label: "Published",
                className: "is-published",
                getValue(pointData) {
                    return Math.max(0, Number(pointData.published_count || 0));
                },
            },
            {
                key: "opened",
                label: "Opened",
                className: "is-opened",
                getValue(pointData) {
                    return Math.max(0, Number(pointData.opened_count || 0));
                },
            },
            {
                key: "saved",
                label: "Saved",
                className: "is-saved",
                getValue(pointData) {
                    return Math.max(0, Number(pointData.saved_count || 0));
                },
            },
        ];
        const stackOrder = ["published", "opened", "saved"];
        const activeSeriesKeys = new Set(seriesDefs.map(def => def.key));
        const legend = document.createElement("div");
        legend.className = "feeds-stats-overall-legend";

        const legendTitle = document.createElement("div");
        legendTitle.className = "feeds-stats-overall-legend-title";
        legendTitle.textContent = "Key";
        legend.appendChild(legendTitle);

        seriesDefs.forEach(def => {
            const legendItem = document.createElement("button");
            legendItem.className = "feeds-stats-overall-legend-item";
            legendItem.type = "button";
            legendItem.dataset.seriesKey = def.key;
            legendItem.setAttribute("aria-pressed", "true");

            const swatch = document.createElement("span");
            swatch.className = `feeds-stats-overall-legend-swatch ${def.className}`;

            const text = document.createElement("span");
            text.textContent = def.label;

            legendItem.appendChild(swatch);
            legendItem.appendChild(text);
            legend.appendChild(legendItem);
        });

        const body = document.createElement("div");
        body.className = "feeds-stats-overall-body";

        const yAxis = document.createElement("div");
        yAxis.className = "feeds-stats-overall-y-axis";

        const stage = document.createElement("div");
        stage.className = "feeds-stats-overall-stage";

        const gridArea = document.createElement("div");
        gridArea.className = "feeds-stats-overall-grid-area";

        const gridLines = document.createElement("div");
        gridLines.className = "feeds-stats-overall-gridlines";

        const plot = document.createElement("div");
        plot.className = "feeds-stats-overall-plot";

        const xAxis = document.createElement("div");
        xAxis.className = "feeds-stats-overall-x-axis";

        /** @type {Array<{ segments: Map<string, HTMLElement> }>} */
        const daySegmentEntries = [];

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

            const barWrap = document.createElement("span");
            barWrap.className = "feeds-stats-series-bar-wrap is-stacked";

            /** @type {Map<string, HTMLElement>} */
            const segmentMap = new Map();
            stackOrder.forEach(key => {
                const def = seriesDefs.find(entry => entry.key === key);
                if (!def) {
                    return;
                }

                const bar = document.createElement("span");
                bar.className = `feeds-stats-series-bar ${def.className}`;
                bar.dataset.seriesKey = def.key;
                barWrap.appendChild(bar);
                segmentMap.set(def.key, bar);
            });

            dayBars.appendChild(barWrap);
            daySegmentEntries.push({ segments: segmentMap });

            dayGroup.appendChild(dayBars);
            plot.appendChild(dayGroup);

            const xTick = document.createElement("div");
            xTick.className = "feeds-stats-overall-x-tick";
            if (index === 0) {
                xTick.classList.add("is-first");
            }
            if (index === dailyPoints.length - 1) {
                xTick.classList.add("is-last");
            }
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

        function buildActiveScale() {
            const maxStackValue = Math.max(
                1,
                ...dailyPoints.map(pointData => {
                    return seriesDefs.reduce((total, def) => {
                        if (!activeSeriesKeys.has(def.key)) {
                            return total;
                        }
                        return total + def.getValue(pointData);
                    }, 0);
                })
            );

            return buildNiceAxisScale(maxStackValue);
        }

        function renderAxis(scale) {
            yAxis.innerHTML = "";
            gridLines.innerHTML = "";

            scale.tickValues.forEach((value, index) => {
                const tick = document.createElement("div");
                tick.className = "feeds-stats-overall-y-tick";
                tick.textContent = formatNumber(value);
                yAxis.appendChild(tick);

                const line = document.createElement("div");
                line.className = "feeds-stats-overall-gridline";
                if (index === scale.tickValues.length - 1 || value === 0) {
                    line.classList.add("is-baseline");
                }
                gridLines.appendChild(line);
            });
        }

        function updateOverallChartVisibility() {
            const scale = buildActiveScale();
            renderAxis(scale);

            daySegmentEntries.forEach((entry, index) => {
                const pointData = dailyPoints[index];
                seriesDefs.forEach(def => {
                    const bar = entry.segments.get(def.key);
                    if (!(bar instanceof HTMLElement)) {
                        return;
                    }

                    const isActive = activeSeriesKeys.has(def.key);
                    const value = isActive ? def.getValue(pointData) : 0;
                    const percentHeight = value <= 0
                        ? "0%"
                        : `${((value / scale.axisMax) * 100).toFixed(3)}%`;

                    bar.style.height = percentHeight;
                    bar.style.opacity = isActive ? "0.92" : "0";
                    bar.classList.toggle("is-hidden", !isActive || value <= 0);
                });
            });

            const legendItems = legend.querySelectorAll(".feeds-stats-overall-legend-item[data-series-key]");
            legendItems.forEach(item => {
                if (!(item instanceof HTMLButtonElement)) {
                    return;
                }

                const key = String(item.dataset.seriesKey || "").trim();
                const isActive = activeSeriesKeys.has(key);
                item.setAttribute("aria-pressed", isActive ? "true" : "false");
                item.classList.toggle("is-inactive", !isActive);
            });
        }

        legend.addEventListener("click", event => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const button = target.closest(".feeds-stats-overall-legend-item[data-series-key]");
            if (!(button instanceof HTMLButtonElement)) {
                return;
            }

            const seriesKey = String(button.dataset.seriesKey || "").trim();
            if (seriesKey === "") {
                return;
            }

            if (activeSeriesKeys.has(seriesKey)) {
                activeSeriesKeys.delete(seriesKey);
            } else {
                activeSeriesKeys.add(seriesKey);
            }

            updateOverallChartVisibility();
        });

        updateOverallChartVisibility();
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
            renderStatsPayload(payload);

            setStatus("Stats updated.", false);
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to load feed stats.", true);
        }
    }

    window.addEventListener("resize", () => {
        if (resizeRafId !== null) {
            window.cancelAnimationFrame(resizeRafId);
        }

        resizeRafId = window.requestAnimationFrame(() => {
            resizeRafId = null;
            if (latestStatsPayload !== null) {
                renderStatsPayload(latestStatsPayload);
            }
        });
    }, { passive: true });

    loadStats();
})();
