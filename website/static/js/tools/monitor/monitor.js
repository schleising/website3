const serviceWorkerPath = '/sw.js?v=tools-webapp-v25';
const chartSettingsStorageKey = 'monitor.chartSettings';

// The chart data to be fetched from the server
/**
 * @type {Array<{device_id: string, data: Array<{timestamp: string, temp: number, humidity: number}>}>}
 */
var deviceData = null;

/**
 * One thermostat timeline for every room chart. The wash reads hvac_status.
 * The heating-time dialog loads its own span.
 * @type {{
 *   device_name: string,
 *   device_id: string,
 *   changes: Array<{
 *     timestamp: string,
 *     hvac_status: string,
 *     mode?: string | null,
 *     heat_celsius?: number | null,
 *     cool_celsius?: number | null,
 *   }>
 * } | null}
 */
let heatingSeries = null;

/**
 * @type {Map<string, DOMMatrix>} 
 */
var transformationMatrices = new Map();

/** @type {'daily' | 'weekly'} */
let chartPeriod = 'daily';
let showPreviousPeriod = false;
let smoothCharts = false;

/** @type {string[]} */
let chartOrder = [];

/**
 * @type {{
 *   container: HTMLElement,
 *   pointerId: number,
 *   charts: HTMLElement,
 *   lastTarget: HTMLElement | null,
 * } | null}
 */
let activeChartDrag = null;

// Scale the time data by 1000 to convert from milliseconds to seconds
const timeScale = 1000;
const dayMs = 24 * 60 * 60 * 1000;
const weekMs = 7 * dayMs;

// x and y border padding
const xPadding = 30;
const yPadding = 40;
let isReloadingForUpdate = false;

/** @type {Map<string, {temperature: number, timestamp: string}>} */
const latestSensorReadings = new Map();

/** @type {{device_id: string, scrubTimestamp: number} | null} */
let activeScrubState = null;

/**
 * @param {number} value
 * @returns {string}
 */
function formatTemperature(value) {
    return value.toFixed(1) + "°C";
}

/**
 * @param {string} device_id
 * @returns {Array<{timestamp: string, temp: number, humidity: number}>}
 */
function getDeviceTimeseries(device_id) {
    const device = deviceData?.find(element => element.device_id === device_id);
    return device?.data ?? [];
}

/**
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @param {Date} targetTime
 * @returns {number | null}
 */
function getClosestTemperatureAtTime(data, targetTime) {
    if (data.length === 0) {
        return null;
    }

    const targetMs = targetTime.getTime();
    let closestPoint = data[0];
    let closestDistance = Math.abs(new Date(closestPoint.timestamp).getTime() - targetMs);

    for (const point of data) {
        const distance = Math.abs(new Date(point.timestamp).getTime() - targetMs);
        if (distance < closestDistance) {
            closestPoint = point;
            closestDistance = distance;
        }
    }

    return closestPoint.temp;
}

/**
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @returns {number | null}
 */
function getHistoricTemperatureAtNow(data) {
    if (!showPreviousPeriod) {
        return null;
    }

    const now = new Date();
    const currentBounds = getPeriodBounds(chartPeriod, 0);
    const previousBounds = getPeriodBounds(chartPeriod, 1);
    const elapsedMs = now.getTime() - currentBounds.start.getTime();
    const historicTarget = new Date(previousBounds.start.getTime() + elapsedMs);
    const previousData = filterDataForPeriod(data, chartPeriod, 1);

    return getClosestTemperatureAtTime(previousData, historicTarget);
}

/**
 * @param {string} device_id
 * @param {number} currentTemp
 * @param {number | null | undefined} overlayTemp
 */
function updateTemperatureReadout(device_id, currentTemp, overlayTemp = null) {
    const readout = document.getElementById("temperature-" + device_id);
    if (readout == null) {
        return;
    }

    const currentValue = readout.querySelector(".temperature-current-value");
    const overlayValue = readout.querySelector(".temperature-overlay-value");
    if (currentValue == null || overlayValue == null) {
        return;
    }

    currentValue.textContent = formatTemperature(currentTemp);

    if (showPreviousPeriod && overlayTemp != null) {
        overlayValue.textContent = formatTemperature(overlayTemp);
        overlayValue.hidden = false;
    } else {
        overlayValue.textContent = "";
        overlayValue.hidden = true;
    }
}

/**
 * @param {string} device_id
 */
function restoreLiveReadouts(device_id) {
    const latestReading = latestSensorReadings.get(device_id);
    if (latestReading == null) {
        return;
    }

    const time = document.getElementById("time-" + device_id);
    if (time != null) {
        time.innerText = new Date(latestReading.timestamp)
            .toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    const historicTemp = getHistoricTemperatureAtNow(getDeviceTimeseries(device_id));
    updateTemperatureReadout(device_id, latestReading.temperature, historicTemp);
}

/**
 * @param {SVGPolylineElement | null} polyline
 * @param {number} mouseX
 * @returns {SVGPoint | null}
 */
function getClosestPointByX(polyline, mouseX) {
    if (polyline == null || polyline.points.length === 0) {
        return null;
    }

    let closestPoint = polyline.points[0];
    let closestDistance = Math.abs(closestPoint.x - mouseX);

    for (let i = 1; i < polyline.points.length; i++) {
        const point = polyline.points[i];
        const distance = Math.abs(point.x - mouseX);
        if (distance < closestDistance) {
            closestPoint = point;
            closestDistance = distance;
        }
    }

    return closestPoint;
}

/**
 * @param {SVGElement} svg
 * @param {string} className
 * @param {SVGPoint} point
 */
function setScrubMarker(svg, className, point) {
    let marker = svg.querySelector("." + className);
    if (marker == null) {
        marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        marker.setAttribute("class", className);
        marker.setAttribute("r", "5");
        svg.appendChild(marker);
    }

    marker.setAttribute("cx", String(point.x));
    marker.setAttribute("cy", String(point.y));
}

/**
 * @param {SVGElement} svg
 */
function clearScrubMarkers(svg) {
    svg.querySelectorAll(".temperature-circle-current, .temperature-circle-overlay").forEach(marker => {
        marker.remove();
    });
}

/**
 * @param {string} device_id
 * @param {number} chartX
 */
function applyScrubAtChartX(device_id, chartX) {
    const svg = document.getElementById("chart-" + device_id);
    const matrix = transformationMatrices.get(device_id);
    if (svg == null || matrix == null) {
        return;
    }

    const currentPolyline = svg.querySelector('.temperature-current') ?? svg.querySelector('.temperature');
    const closestCurrentPoint = getClosestPointByX(currentPolyline, chartX);
    if (closestCurrentPoint == null) {
        return;
    }

    clearScrubMarkers(svg);

    const currentOriginalPoint = matrix.inverse().transformPoint(closestCurrentPoint);
    let overlayTemp = null;

    const overlayPolyline = svg.querySelector('.temperature-overlay');
    const closestOverlayPoint = getClosestPointByX(overlayPolyline, chartX);
    if (showPreviousPeriod && closestOverlayPoint != null) {
        setScrubMarker(svg, "temperature-circle-overlay", closestOverlayPoint);
        overlayTemp = matrix.inverse().transformPoint(closestOverlayPoint).y;
    }

    setScrubMarker(svg, "temperature-circle-current", closestCurrentPoint);
    updateTemperatureReadout(device_id, currentOriginalPoint.y, overlayTemp);

    const time = document.getElementById("time-" + device_id);
    if (time != null) {
        time.innerText = new Date(currentOriginalPoint.x * timeScale)
            .toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    activeScrubState = { device_id, scrubTimestamp: currentOriginalPoint.x };
}

/**
 * @param {string} device_id
 */
function restoreActiveScrubMarkers(device_id) {
    if (activeScrubState == null || activeScrubState.device_id !== device_id) {
        return;
    }

    const matrix = transformationMatrices.get(device_id);
    if (matrix == null) {
        return;
    }

    const chartX = matrix.transformPoint(
        new DOMPoint(activeScrubState.scrubTimestamp, 0)
    ).x;

    applyScrubAtChartX(device_id, chartX);
}

/**
 * @param {string} device_id
 */
function clearChartScrub(device_id) {
    const svg = document.getElementById("chart-" + device_id);
    if (svg != null) {
        clearScrubMarkers(svg);
    }

    if (activeScrubState?.device_id === device_id) {
        activeScrubState = null;
        restoreLiveReadouts(device_id);
    }
}

/**
 * @param {'daily' | 'weekly'} period
 * @returns {number}
 */
function getPeriodDurationMs(period) {
    return period === 'daily' ? dayMs : weekMs;
}

/**
 * Rolling window bounds ending at now for the current period, or the
 * immediately preceding window of equal length for periodOffset 1.
 *
 * @param {'daily' | 'weekly'} period
 * @param {number} periodOffset 0 for current period, 1 for previous
 * @returns {{start: Date, end: Date}}
 */
function getPeriodBounds(period, periodOffset) {
    const now = new Date();
    const durationMs = getPeriodDurationMs(period);
    const end = new Date(now.getTime() - periodOffset * durationMs);
    const start = new Date(end.getTime() - durationMs);
    return { start, end };
}

/**
 * Turn heating changes into runs. The wash clips these to getPeriodBounds.
 * The heating-time dialog clips each slot on its own.
 *
 * Walk every change, including rows before the window, then clip. Only a
 * transition into HEATING opens a run. A later HEATING row leaves it open.
 * OFF and COOLING close it at that timestamp. A run still open at the end of
 * the series extends to the end of the bounds it was given. Start is
 * inclusive and end is exclusive.
 *
 * @param {Array<{timestamp: string, hvac_status: string}>} changes
 * @param {{start: Date, end: Date}} periodBounds
 * @returns {Array<{start: Date, end: Date}>}
 */
function heatingRuns(changes, periodBounds) {
    if (periodBounds == null) {
        return [];
    }

    const windowStartMs = periodBounds.start.getTime();
    const windowEndMs = periodBounds.end.getTime();

    const ordered = changes
        .map(change => ({
            timeMs: new Date(change.timestamp).getTime(),
            heating: change.hvac_status === "HEATING",
        }))
        .filter(change => Number.isFinite(change.timeMs))
        .sort((left, right) => left.timeMs - right.timeMs);

    /** @type {Array<{start: Date, end: Date}>} */
    const runs = [];
    /** @type {number | null} */
    let runStartMs = null;

    /**
     * @param {number} startMs
     * @param {number} endMs
     */
    function clipAndPush(startMs, endMs) {
        const clippedStart = Math.max(startMs, windowStartMs);
        const clippedEnd = Math.min(endMs, windowEndMs);
        if (clippedStart < clippedEnd) {
            runs.push({
                start: new Date(clippedStart),
                end: new Date(clippedEnd),
            });
        }
    }

    for (const change of ordered) {
        if (change.heating) {
            if (runStartMs == null) {
                runStartMs = change.timeMs;
            }
            continue;
        }

        if (runStartMs != null) {
            clipAndPush(runStartMs, change.timeMs);
            runStartMs = null;
        }
    }

    if (runStartMs != null) {
        clipAndPush(runStartMs, windowEndMs);
    }

    return runs;
}

/**
 * @param {number} durationMs
 * @returns {string}
 */
function formatHeatingDuration(durationMs) {
    if (!(durationMs > 0)) {
        return "0 min";
    }
    if (durationMs < 60 * 1000) {
        return "< 1 min";
    }

    const totalMinutes = Math.round(durationMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) {
        return `${Math.max(totalMinutes, 1)} min`;
    }
    if (minutes === 0) {
        return `${hours} h`;
    }
    return `${hours} h ${minutes} min`;
}

/**
 * Heating-time dialog. Ranges and views are lists: a new one is an entry,
 * not a new control in the template. Drawing does not fetch or clip.
 */

const HEATING_SVG_NS = "http://www.w3.org/2000/svg";
const HEATING_WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HEATING_HEATMAP_MAX_HOURS = 7;

/**
 * @typedef {{start: Date, end: Date}} HeatingWindow
 * @typedef {{key: string, label: string, tick: boolean, start: Date, end: Date}} HeatingSlot
 * @typedef {HeatingSlot & {durationMs: number | null, index: number}} HeatingMeasuredSlot
 * @typedef {{
 *   id: string,
 *   label: string,
 *   unit: 'minutes' | 'hours',
 *   axisMax: number | null,
 *   window: (cursor: Date) => HeatingWindow,
 *   step: (cursor: Date, direction: number) => Date,
 *   slots: (bounds: HeatingWindow) => HeatingSlot[],
 *   legend: (bounds: HeatingWindow, which: 'current' | 'previous') => string,
 *   pagerLabel: (bounds: HeatingWindow) => string,
 * }} HeatingTimeRange
 * @typedef {{
 *   id: string,
 *   label: string,
 *   ranges: string[],
 *   previous: boolean,
 *   pager: boolean,
 *   draw: (host: HTMLElement, model: HeatingTimeModel) => void,
 * }} HeatingTimeView
 * @typedef {{
 *   range: HeatingTimeRange,
 *   view: HeatingTimeView,
 *   bounds: HeatingWindow,
 *   showPrevious: boolean,
 *   slots: HeatingMeasuredSlot[],
 *   previousSlots: Array<HeatingMeasuredSlot | null> | null,
 * }} HeatingTimeModel
 */

/** @type {HeatingTimeRange[]} */
const heatingTimeRanges = [
    {
        id: "day",
        label: "Day",
        unit: "minutes",
        axisMax: 60,
        window(cursor) {
            const start = startOfLocalDay(cursor);
            const end = new Date(start);
            end.setDate(end.getDate() + 1);
            return { start, end };
        },
        step(cursor, direction) {
            const next = startOfLocalDay(cursor);
            next.setDate(next.getDate() + direction);
            return next;
        },
        slots(bounds) {
            /** @type {HeatingSlot[]} */
            const slots = [];
            for (let hour = 0; hour < 24; hour += 1) {
                const start = new Date(bounds.start);
                start.setHours(hour, 0, 0, 0);
                const end = new Date(start);
                end.setHours(hour + 1, 0, 0, 0);
                slots.push({
                    key: String(hour),
                    label: String(hour).padStart(2, "0"),
                    tick: hour % 6 === 0,
                    start,
                    end,
                });
            }
            return slots;
        },
        legend(bounds, which) {
            const live = heatingWindowContainsNow(bounds, new Date());
            if (which === "previous") {
                const prior = new Date(bounds.start);
                prior.setDate(prior.getDate() - 1);
                return live ? "Yesterday" : formatHeatingDay(prior);
            }
            return live ? "Today" : formatHeatingDay(bounds.start);
        },
        pagerLabel(bounds) {
            return formatHeatingDay(bounds.start);
        },
    },
    {
        id: "week",
        label: "Week",
        unit: "hours",
        axisMax: null,
        window(cursor) {
            const start = startOfLocalWeek(cursor);
            const end = new Date(start);
            end.setDate(end.getDate() + 7);
            return { start, end };
        },
        step(cursor, direction) {
            const next = startOfLocalWeek(cursor);
            next.setDate(next.getDate() + direction * 7);
            return next;
        },
        slots(bounds) {
            /** @type {HeatingSlot[]} */
            const slots = [];
            for (let index = 0; index < 7; index += 1) {
                const start = new Date(bounds.start);
                start.setDate(start.getDate() + index);
                const end = new Date(start);
                end.setDate(end.getDate() + 1);
                slots.push({
                    key: String(index),
                    label: HEATING_WEEKDAY_LABELS[index],
                    tick: true,
                    start,
                    end,
                });
            }
            return slots;
        },
        legend(bounds, which) {
            const live = heatingWindowContainsNow(bounds, new Date());
            if (which === "previous") {
                const prior = this.window(new Date(bounds.start.getTime() - 1));
                return live ? "Last week" : formatHeatingWeek(prior);
            }
            return live ? "This week" : formatHeatingWeek(bounds);
        },
        pagerLabel(bounds) {
            return formatHeatingWeek(bounds);
        },
    },
    {
        id: "month",
        label: "Month",
        unit: "hours",
        axisMax: null,
        window(cursor) {
            const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
            const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
            return { start, end };
        },
        step(cursor, direction) {
            return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
        },
        slots(bounds) {
            /** @type {HeatingSlot[]} */
            const slots = [];
            const cursor = new Date(bounds.start);
            while (cursor < bounds.end) {
                const start = new Date(cursor);
                const end = new Date(cursor);
                end.setDate(end.getDate() + 1);
                const day = start.getDate();
                slots.push({
                    key: String(day),
                    label: String(day),
                    tick: day === 1 || day % 5 === 0,
                    start,
                    end,
                });
                cursor.setDate(cursor.getDate() + 1);
            }
            return slots;
        },
        legend(bounds, which) {
            const live = heatingWindowContainsNow(bounds, new Date());
            if (which === "previous") {
                const prior = this.window(new Date(bounds.start.getTime() - 1));
                return live ? "Last month" : formatHeatingMonth(prior);
            }
            return live ? "This month" : formatHeatingMonth(bounds);
        },
        pagerLabel(bounds) {
            return formatHeatingMonth(bounds);
        },
    },
];

/** @type {HeatingTimeView[]} */
const heatingTimeViews = [
    {
        id: "bars",
        label: "Bars",
        ranges: ["day", "week", "month"],
        previous: true,
        pager: true,
        draw: drawHeatingBars,
    },
    {
        id: "total",
        label: "Total",
        ranges: ["day", "week", "month"],
        previous: true,
        pager: true,
        draw: drawHeatingTotal,
    },
    {
        id: "heatmap",
        label: "Heatmap",
        ranges: ["month"],
        previous: false,
        pager: true,
        draw: drawHeatingHeatmap,
    },
];

const heatingTime = {
    rangeId: heatingTimeRanges[0].id,
    viewId: heatingTimeViews[0].id,
    cursor: new Date(),
    /** @type {string | null} */
    rangeBeforeLock: null,
};

/** @type {{device_name: string, changes: Array<{timestamp: string, hvac_status: string}>} | null} */
let heatingTimeSeries = null;
let heatingTimeLoadedSince = "";
let heatingTimePaintedKey = "";
let heatingTimeFetchId = 0;

/**
 * @param {Date} date
 * @returns {Date}
 */
function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Monday is the first day of the week.
 * @param {Date} date
 * @returns {Date}
 */
function startOfLocalWeek(date) {
    const start = startOfLocalDay(date);
    const day = start.getDay();
    const delta = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + delta);
    return start;
}

/**
 * @param {HeatingWindow} bounds
 * @param {Date} now
 * @returns {boolean}
 */
function heatingWindowContainsNow(bounds, now) {
    const time = now.getTime();
    return bounds.start.getTime() <= time && time < bounds.end.getTime();
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatHeatingDay(date) {
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * @param {HeatingWindow} bounds
 * @returns {string}
 */
function formatHeatingWeek(bounds) {
    const last = new Date(bounds.end.getTime() - 1);
    return `${formatHeatingDay(bounds.start)} – ${formatHeatingDay(last)}`;
}

/**
 * @param {HeatingWindow} bounds
 * @returns {string}
 */
function formatHeatingMonth(bounds) {
    return bounds.start.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/**
 * @param {string} id
 * @returns {HeatingTimeRange}
 */
function heatingTimeRangeById(id) {
    const range = heatingTimeRanges.find(item => item.id === id);
    if (range == null) {
        return heatingTimeRanges[0];
    }
    return range;
}

/**
 * @param {string} id
 * @returns {HeatingTimeView}
 */
function heatingTimeViewById(id) {
    const view = heatingTimeViews.find(item => item.id === id);
    if (view == null) {
        return heatingTimeViews[0];
    }
    return view;
}

/**
 * @param {string} viewId
 */
function selectHeatingTimeView(viewId) {
    const view = heatingTimeViewById(viewId);
    if (!view.ranges.includes(heatingTime.rangeId)) {
        if (heatingTime.rangeBeforeLock == null) {
            heatingTime.rangeBeforeLock = heatingTime.rangeId;
        }
        heatingTime.rangeId = view.ranges[0];
    } else if (
        heatingTime.rangeBeforeLock != null
        && view.ranges.includes(heatingTime.rangeBeforeLock)
    ) {
        heatingTime.rangeId = heatingTime.rangeBeforeLock;
        heatingTime.rangeBeforeLock = null;
    }
    heatingTime.viewId = view.id;
}

/**
 * @returns {Date}
 */
function heatingTimeQueryStart() {
    const range = heatingTimeRangeById(heatingTime.rangeId);
    const view = heatingTimeViewById(heatingTime.viewId);
    let cursor = heatingTime.cursor;
    if (view.previous) {
        cursor = range.step(cursor, -1);
    }
    return range.window(cursor).start;
}

/**
 * @param {HeatingSlot[]} slots
 * @param {Array<{timestamp: string, hvac_status: string}>} changes
 * @param {Date} now
 * @returns {HeatingMeasuredSlot[]}
 */
function measureHeatingSlots(slots, changes, now) {
    const nowMs = now.getTime();
    return slots.map((slot, index) => {
        if (slot.start.getTime() > nowMs) {
            return { ...slot, index, durationMs: null };
        }
        const end = new Date(Math.min(slot.end.getTime(), nowMs));
        const runs = heatingRuns(changes, { start: slot.start, end });
        return { ...slot, index, durationMs: heatingOnTimeMs(runs) };
    });
}

/**
 * @param {Array<{start: Date, end: Date}>} runs
 * @returns {number}
 */
function heatingOnTimeMs(runs) {
    return runs.reduce((total, run) => total + (run.end.getTime() - run.start.getTime()), 0);
}

/**
 * @param {HeatingMeasuredSlot[]} currentSlots
 * @param {HeatingMeasuredSlot[]} previousMeasured
 * @returns {Array<HeatingMeasuredSlot | null>}
 */
function alignHeatingSlots(currentSlots, previousMeasured) {
    const byKey = new Map(previousMeasured.map(slot => [slot.key, slot]));
    return currentSlots.map(slot => {
        const match = byKey.get(slot.key);
        if (match == null) {
            return null;
        }
        return { ...match, index: slot.index };
    });
}

/**
 * @returns {HeatingTimeModel}
 */
function buildHeatingTimeModel() {
    const range = heatingTimeRangeById(heatingTime.rangeId);
    const view = heatingTimeViewById(heatingTime.viewId);
    const now = new Date();
    const bounds = range.window(heatingTime.cursor);
    const changes = heatingTimeSeries == null ? [] : heatingTimeSeries.changes;
    const slots = measureHeatingSlots(range.slots(bounds), changes, now);
    const showPrevious = view.previous;
    /** @type {Array<HeatingMeasuredSlot | null> | null} */
    let previousSlots = null;
    if (showPrevious) {
        const priorBounds = range.window(range.step(heatingTime.cursor, -1));
        const measured = measureHeatingSlots(range.slots(priorBounds), changes, now);
        previousSlots = alignHeatingSlots(slots, measured);
    }
    return {
        range,
        view,
        bounds,
        showPrevious,
        slots,
        previousSlots,
    };
}

/**
 * @param {number} durationMs
 * @param {'minutes' | 'hours'} unit
 * @returns {number}
 */
function heatingSlotValue(durationMs, unit) {
    return durationMs / (unit === "minutes" ? 60000 : 3600000);
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function heatingAxisCeiling(values) {
    const peak = values.reduce((max, value) => Math.max(max, value), 0);
    if (peak <= 0) {
        return 1;
    }
    const padded = peak * 1.15;
    const power = 10 ** Math.floor(Math.log10(padded));
    const fraction = padded / power;
    const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return nice * power;
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatHeatingAxisTick(value) {
    if (Math.abs(value - Math.round(value)) < 0.05) {
        return String(Math.round(value));
    }
    return value.toFixed(1);
}

/**
 * @param {string} name
 * @param {Record<string, string | number | null | undefined>} attrs
 * @param {string} [text]
 * @returns {SVGElement}
 */
function heatingSvg(name, attrs, text) {
    const element = document.createElementNS(HEATING_SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) {
        if (value != null) {
            element.setAttribute(key, String(value));
        }
    }
    if (text != null) {
        element.textContent = text;
    }
    return element;
}

/**
 * @param {HeatingTimeModel} model
 * @param {boolean} cumulative
 * @returns {number}
 */
function heatingChartAxisMax(model, cumulative) {
    if (!cumulative && model.range.axisMax != null) {
        return model.range.axisMax;
    }
    /** @type {number[]} */
    const values = [];
    const series = cumulative ? heatingCumulative(model.slots) : [model.slots.map(slot => ({
        slot,
        totalMs: slot.durationMs ?? 0,
    }))];
    for (const segment of series) {
        for (const point of segment) {
            if (point.slot.durationMs == null && !cumulative) {
                continue;
            }
            values.push(heatingSlotValue(cumulative ? point.totalMs : (point.slot.durationMs ?? 0), model.range.unit));
        }
    }
    if (model.showPrevious && model.previousSlots != null) {
        const previous = cumulative
            ? heatingCumulative(model.previousSlots)
            : [model.previousSlots.filter(slot => slot != null).map(slot => ({
                slot,
                totalMs: slot.durationMs ?? 0,
            }))];
        for (const segment of previous) {
            for (const point of segment) {
                const duration = cumulative ? point.totalMs : (point.slot.durationMs ?? 0);
                if (point.slot.durationMs == null && !cumulative) {
                    continue;
                }
                values.push(heatingSlotValue(duration, model.range.unit));
            }
        }
    }
    return heatingAxisCeiling(values);
}

/**
 * @param {Array<HeatingMeasuredSlot | null>} slots
 * @returns {Array<Array<{slot: HeatingMeasuredSlot, totalMs: number}>>}
 */
function heatingCumulative(slots) {
    /** @type {Array<Array<{slot: HeatingMeasuredSlot, totalMs: number}>>} */
    const segments = [];
    /** @type {Array<{slot: HeatingMeasuredSlot, totalMs: number}>} */
    let segment = [];
    let totalMs = 0;
    for (const slot of slots) {
        if (slot == null) {
            if (segment.length > 0) {
                segments.push(segment);
                segment = [];
            }
            continue;
        }
        if (slot.durationMs == null) {
            break;
        }
        totalMs += slot.durationMs;
        segment.push({ slot, totalMs });
    }
    if (segment.length > 0) {
        segments.push(segment);
    }
    return segments;
}

/**
 * @param {HTMLElement} host
 * @param {HeatingTimeModel} model
 * @param {boolean} cumulative
 */
function drawHeatingSeries(host, model, cumulative) {
    host.replaceChildren();
    const width = Math.max(280, host.clientWidth);
    const height = 248;
    const pad = { top: 22, right: 8, bottom: 28, left: 36 };
    const axisMax = heatingChartAxisMax(model, cumulative);
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const slotCount = Math.max(model.slots.length, 1);
    const slotWidth = plotWidth / slotCount;

    /**
     * @param {number} value
     * @returns {number}
     */
    function yAt(value) {
        const clamped = Math.max(0, Math.min(axisMax, value));
        return pad.top + plotHeight * (1 - clamped / axisMax);
    }

    /**
     * @param {number} index
     * @returns {number}
     */
    function slotLeft(index) {
        return pad.left + slotWidth * index;
    }

    const svg = heatingSvg("svg", {
        class: "heating-time-chart",
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        role: "img",
        "aria-label": model.range.pagerLabel(model.bounds),
    });
    const unit = model.range.unit === "minutes" ? "Minutes" : "Hours";
    svg.append(heatingSvg("text", { x: pad.left, y: 14 }, unit));

    const ticks = model.range.axisMax === 60 ? [0, 30, 60] : [0, axisMax / 2, axisMax];
    for (const tick of ticks) {
        const y = yAt(tick);
        svg.append(heatingSvg("line", {
            class: "heating-time-grid",
            x1: pad.left,
            x2: width - pad.right,
            y1: y,
            y2: y,
        }));
        svg.append(heatingSvg("text", {
            x: pad.left - 6,
            y: y + 4,
            "text-anchor": "end",
        }, formatHeatingAxisTick(tick)));
    }
    svg.append(heatingSvg("line", {
        class: "heating-time-axis",
        x1: pad.left,
        x2: width - pad.right,
        y1: yAt(0),
        y2: yAt(0),
    }));

    const pointer = document.createElement("p");
    pointer.className = "heating-time-pointer";

    /**
     * @param {Element} mark
     * @param {string} active
     * @returns {boolean}
     */
    function markIsLit(mark, active) {
        if (mark.getAttribute("data-mark") === active) {
            return true;
        }
        return active.startsWith("slot-") && mark.getAttribute("data-slot") === active.slice(5);
    }

    /**
     * @param {string} active
     */
    function pointAt(active) {
        svg.classList.add("is-pointing");
        const series = active.startsWith("c-") ? "current" : active.startsWith("p-") ? "previous" : null;
        for (const mark of svg.querySelectorAll(".heating-mark")) {
            mark.classList.toggle("is-lit", markIsLit(mark, active));
        }
        for (const line of svg.querySelectorAll(".heating-line-current, .heating-line-previous")) {
            const lineSeries = line.classList.contains("heating-line-current") ? "current" : "previous";
            line.classList.toggle("is-lit", series == null || lineSeries === series);
        }
    }

    function clearPoint(next) {
        if (next instanceof Element && svg.contains(next) && next.classList.contains("heating-time-hit")) {
            return;
        }
        svg.classList.remove("is-pointing");
        for (const mark of svg.querySelectorAll(".is-lit")) {
            mark.classList.remove("is-lit");
        }
    }

    /**
     * @param {SVGElement} target
     * @param {string} text
     * @param {string} active
     */
    function bindPointer(target, text, active) {
        const show = () => {
            pointer.textContent = text;
            pointAt(active);
        };
        target.addEventListener("pointerenter", show);
        target.addEventListener("focus", show);
        target.addEventListener("pointerleave", event => {
            if (document.activeElement === target) {
                return;
            }
            clearPoint(event.relatedTarget);
        });
        target.addEventListener("blur", event => {
            clearPoint(event.relatedTarget);
        });
    }

    /**
     * @param {HeatingMeasuredSlot} slot
     * @param {number} durationMs
     * @param {'current' | 'previous'} which
     * @returns {string}
     */
    function pointerText(slot, durationMs, which) {
        const legend = model.range.legend(model.bounds, which);
        return `${legend} ${slot.label} · ${formatHeatingDuration(durationMs)}`;
    }

    if (cumulative) {
        drawHeatingCumulativeLines(svg, model, yAt, slotLeft, slotWidth, bindPointer, pointerText);
    } else {
        drawHeatingBarPairs(svg, model, yAt, slotLeft, slotWidth, bindPointer, pointerText);
    }

    for (const slot of model.slots) {
        if (!slot.tick) {
            continue;
        }
        svg.append(heatingSvg("text", {
            x: slotLeft(slot.index) + slotWidth / 2,
            y: height - 8,
            "text-anchor": "middle",
        }, slot.label));
    }

    host.append(svg);
    appendHeatingLegend(host, model);
    host.append(pointer);
}

/**
 * @param {SVGElement} svg
 * @param {HeatingTimeModel} model
 * @param {(value: number) => number} yAt
 * @param {(index: number) => number} slotLeft
 * @param {number} slotWidth
 * @param {(target: SVGElement, text: string, active: string) => void} bindPointer
 * @param {(slot: HeatingMeasuredSlot, durationMs: number, which: 'current' | 'previous') => string} pointerText
 */
function drawHeatingBarPairs(svg, model, yAt, slotLeft, slotWidth, bindPointer, pointerText) {
    const gap = Math.min(3, slotWidth * 0.08);
    const barWidth = Math.max(2, (slotWidth - gap * 3) / 2);
    const baseline = yAt(0);
    for (const slot of model.slots) {
        const left = slotLeft(slot.index) + gap;
        if (slot.durationMs != null) {
            const value = heatingSlotValue(slot.durationMs, model.range.unit);
            const y = yAt(value);
            if (value > 0) {
                svg.append(heatingSvg("rect", {
                    class: "heating-bar-current heating-mark",
                    "data-mark": `c-${slot.index}`,
                    x: left,
                    y,
                    width: barWidth,
                    height: Math.max(0, baseline - y),
                    rx: 1.5,
                }));
            }
            const hit = heatingSvg("rect", {
                class: "heating-time-hit",
                x: slotLeft(slot.index),
                y: 16,
                width: model.showPrevious ? slotWidth / 2 : slotWidth,
                height: baseline - 16,
                tabindex: "0",
                role: "img",
                "aria-label": pointerText(slot, slot.durationMs, "current"),
            });
            bindPointer(hit, pointerText(slot, slot.durationMs, "current"), `c-${slot.index}`);
            svg.append(hit);
        }
        const previous = model.previousSlots == null ? null : model.previousSlots[slot.index];
        if (model.showPrevious && previous != null && previous.durationMs != null) {
            const value = heatingSlotValue(previous.durationMs, model.range.unit);
            const y = yAt(value);
            const x = left + barWidth + gap;
            if (value > 0) {
                svg.append(heatingSvg("rect", {
                    class: "heating-bar-previous heating-mark",
                    "data-mark": `p-${slot.index}`,
                    x,
                    y,
                    width: barWidth,
                    height: Math.max(0, baseline - y),
                    rx: 1.5,
                }));
            }
            const hit = heatingSvg("rect", {
                class: "heating-time-hit",
                x: slotLeft(slot.index) + slotWidth / 2,
                y: 16,
                width: slotWidth / 2,
                height: baseline - 16,
                tabindex: "0",
                role: "img",
                "aria-label": pointerText(previous, previous.durationMs, "previous"),
            });
            bindPointer(hit, pointerText(previous, previous.durationMs, "previous"), `p-${slot.index}`);
            svg.append(hit);
        }
    }
}

/**
 * @param {Array<{slot: HeatingMeasuredSlot, totalMs: number}>} points
 * @param {(value: number) => number} yAt
 * @param {(index: number) => number} slotLeft
 * @param {number} slotWidth
 * @param {'minutes' | 'hours'} unit
 * @returns {string}
 */
function heatingLinePoints(points, yAt, slotLeft, slotWidth, unit) {
    return points.map(point => {
        const x = slotLeft(point.slot.index) + slotWidth / 2;
        const y = yAt(heatingSlotValue(point.totalMs, unit));
        return `${x},${y}`;
    }).join(" ");
}

/**
 * @param {SVGElement} svg
 * @param {HeatingTimeModel} model
 * @param {(value: number) => number} yAt
 * @param {(index: number) => number} slotLeft
 * @param {number} slotWidth
 * @param {(target: SVGElement, text: string, active: string) => void} bindPointer
 * @param {(slot: HeatingMeasuredSlot, durationMs: number, which: 'current' | 'previous') => string} pointerText
 */
function drawHeatingCumulativeLines(svg, model, yAt, slotLeft, slotWidth, bindPointer, pointerText) {
    const baseline = yAt(0);
    /**
     * @param {Array<Array<{slot: HeatingMeasuredSlot, totalMs: number}>>} segments
     * @param {'current' | 'previous'} which
     */
    /**
     * @param {number} index
     * @returns {number | null}
     */
    function previousTotalAt(index) {
        if (!model.showPrevious || model.previousSlots == null) {
            return null;
        }
        let totalMs = 0;
        for (const slot of model.previousSlots) {
            if (slot == null || slot.durationMs == null) {
                if (slot != null && slot.durationMs == null) {
                    break;
                }
                continue;
            }
            totalMs += slot.durationMs;
            if (slot.index === index) {
                return totalMs;
            }
        }
        return null;
    }

    /**
     * @param {Array<Array<{slot: HeatingMeasuredSlot, totalMs: number}>>} segments
     * @param {'current' | 'previous'} which
     * @param {boolean} hits
     */
    function drawSegments(segments, which, hits) {
        const lineClass = which === "current" ? "heating-line-current" : "heating-line-previous";
        const dotClass = which === "current" ? "heating-dot-current" : "heating-dot-previous";
        for (const segment of segments) {
            if (segment.length === 0) {
                continue;
            }
            svg.append(heatingSvg("polyline", {
                class: `${lineClass} heating-mark`,
                points: heatingLinePoints(segment, yAt, slotLeft, slotWidth, model.range.unit),
            }));
            for (const point of segment) {
                const x = slotLeft(point.slot.index) + slotWidth / 2;
                const y = yAt(heatingSlotValue(point.totalMs, model.range.unit));
                const seriesMark = which === "current" ? "c" : "p";
                svg.append(heatingSvg("circle", {
                    class: `${dotClass} heating-mark`,
                    "data-mark": `${seriesMark}-${point.slot.index}`,
                    "data-slot": String(point.slot.index),
                    cx: x,
                    cy: y,
                    r: 3.2,
                }));
                if (!hits) {
                    continue;
                }
                let text = pointerText(point.slot, point.totalMs, which);
                const prior = previousTotalAt(point.slot.index);
                if (prior != null) {
                    text = `${text} · ${pointerText(point.slot, prior, "previous")}`;
                }
                const hit = heatingSvg("rect", {
                    class: "heating-time-hit",
                    x: slotLeft(point.slot.index),
                    y: 16,
                    width: slotWidth,
                    height: Math.max(0, baseline - 16),
                    tabindex: "0",
                    role: "img",
                    "aria-label": text,
                });
                bindPointer(hit, text, `slot-${point.slot.index}`);
                svg.append(hit);
            }
        }
    }

    if (model.showPrevious && model.previousSlots != null) {
        drawSegments(heatingCumulative(model.previousSlots), "previous", false);
    }
    drawSegments(heatingCumulative(model.slots), "current", true);
}

/**
 * @param {HTMLElement} host
 * @param {HeatingTimeModel} model
 */
function drawHeatingBars(host, model) {
    drawHeatingSeries(host, model, false);
}

/**
 * @param {HTMLElement} host
 * @param {HeatingTimeModel} model
 */
function drawHeatingTotal(host, model) {
    drawHeatingSeries(host, model, true);
}

/**
 * @param {HTMLElement} host
 * @param {HeatingTimeModel} model
 */
function appendHeatingLegend(host, model) {
    const legend = document.createElement("div");
    legend.className = "heating-time-legend";
    const items = [
        { tone: "current", label: model.range.legend(model.bounds, "current") },
    ];
    if (model.showPrevious) {
        items.push({ tone: "previous", label: model.range.legend(model.bounds, "previous") });
    }
    for (const item of items) {
        const row = document.createElement("span");
        const swatch = document.createElement("i");
        swatch.className = `heating-time-swatch ${item.tone}`;
        swatch.setAttribute("aria-hidden", "true");
        row.append(swatch, document.createTextNode(item.label));
        legend.append(row);
    }
    host.append(legend);
}

/**
 * @param {HTMLElement} host
 * @param {HeatingTimeModel} model
 */
function drawHeatingHeatmap(host, model) {
    host.replaceChildren();
    const root = document.createElement("div");
    root.className = "heating-heat";
    const weekdays = document.createElement("div");
    weekdays.className = "heating-heat-weekdays";
    for (const label of HEATING_WEEKDAY_LABELS) {
        const cell = document.createElement("span");
        cell.textContent = label;
        weekdays.append(cell);
    }

    const grid = document.createElement("div");
    grid.className = "heating-heat-grid";
    const firstDay = model.bounds.start.getDay();
    const lead = firstDay === 0 ? 6 : firstDay - 1;
    const rowCount = Math.ceil((lead + model.slots.length) / HEATING_WEEKDAY_LABELS.length);
    grid.style.setProperty("--heat-rows", String(rowCount));
    for (let index = 0; index < lead; index += 1) {
        const pad = document.createElement("span");
        pad.className = "heating-heat-pad";
        pad.setAttribute("aria-hidden", "true");
        grid.append(pad);
    }

    const maxMs = HEATING_HEATMAP_MAX_HOURS * 3600000;
    const pointer = document.createElement("p");
    pointer.className = "heating-time-pointer";

    for (const slot of model.slots) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "heating-heat-cell";
        cell.textContent = slot.label;
        if (slot.durationMs == null) {
            cell.classList.add("is-future");
            cell.disabled = true;
            cell.setAttribute("aria-label", formatHeatingDay(slot.start));
        } else {
            const heat = Math.min(1, slot.durationMs / maxMs);
            cell.classList.add("is-measured");
            if (heat >= 0.72) {
                cell.classList.add("is-hot");
            }
            cell.style.setProperty("--heat", heat.toFixed(3));
            const text = `${formatHeatingDay(slot.start)} · ${formatHeatingDuration(slot.durationMs)}`;
            cell.setAttribute("aria-label", text);
            const show = () => {
                pointer.textContent = text;
            };
            cell.addEventListener("pointerenter", show);
            cell.addEventListener("focus", show);
            cell.addEventListener("click", show);
        }
        grid.append(cell);
    }

    const legend = document.createElement("div");
    legend.className = "heating-time-legend";
    legend.append(heatingHeatLegendSwatch(0), heatingHeatLegendSwatch(HEATING_HEATMAP_MAX_HOURS));

    root.append(weekdays, grid, legend, pointer);
    host.append(root);
    layoutHeatingHeatmap(root);
}

/**
 * Square cells follow the dialog width. When that calendar would be taller
 * than the dialog, the cells shrink together and stay square.
 * @param {HTMLElement} root
 */
function layoutHeatingHeatmap(root) {
    const grid = root.querySelector(".heating-heat-grid");
    const weekdays = root.querySelector(".heating-heat-weekdays");
    const panel = root.closest(".heating-stats-panel");
    const dialog = root.closest(".heating-stats-dialog");
    if (!(grid instanceof HTMLElement) || !(panel instanceof HTMLElement) || !(dialog instanceof HTMLElement)) {
        return;
    }
    const rows = Number(grid.style.getPropertyValue("--heat-rows")) || 6;
    const savedPanelMax = panel.style.maxHeight;
    const savedDialogMax = dialog.style.maxHeight;
    grid.style.width = "";
    if (weekdays instanceof HTMLElement) {
        weekdays.style.width = "";
    }
    panel.style.maxHeight = "none";
    dialog.style.maxHeight = "none";
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
    const gridWidth = grid.getBoundingClientRect().width;
    const outside = panel.getBoundingClientRect().height - grid.getBoundingClientRect().height;
    panel.style.maxHeight = savedPanelMax;
    dialog.style.maxHeight = savedDialogMax;
    const panelLimit = parseFloat(getComputedStyle(panel).maxHeight);
    const dialogLimit = parseFloat(getComputedStyle(dialog).maxHeight);
    const limit = Math.min(
        Number.isFinite(panelLimit) ? panelLimit : Infinity,
        Number.isFinite(dialogLimit) ? dialogLimit : Infinity,
    );
    const cellFromWidth = (gridWidth - gap * 6) / 7;
    const cellFromHeight = (limit - outside - gap * (rows - 1)) / rows;
    if (!(cellFromHeight < cellFromWidth - 0.5)) {
        return;
    }
    const width = Math.max(0, cellFromHeight) * 7 + gap * 6;
    grid.style.width = `${width}px`;
    if (weekdays instanceof HTMLElement) {
        weekdays.style.width = `${width}px`;
    }
}

/**
 * @param {number} hours
 * @returns {HTMLSpanElement}
 */
function heatingHeatLegendSwatch(hours) {
    const row = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.className = "heating-time-swatch" + (hours > 0 ? " current" : "");
    if (hours <= 0) {
        swatch.style.background = "var(--surface-strong)";
        swatch.style.boxShadow = "inset 0 0 0 0.0625rem var(--line)";
    }
    swatch.setAttribute("aria-hidden", "true");
    row.append(swatch, document.createTextNode(`${hours} h`));
    return row;
}

function syncHeatingTimeChrome() {
    const range = heatingTimeRangeById(heatingTime.rangeId);
    const view = heatingTimeViewById(heatingTime.viewId);
    const bounds = range.window(heatingTime.cursor);
    const containsNow = heatingWindowContainsNow(bounds, new Date());

    document.querySelectorAll(".heating-time-range").forEach(button => {
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }
        const id = button.dataset.rangeId ?? "";
        const selected = id === range.id;
        const allowed = view.ranges.includes(id);
        button.disabled = !allowed;
        button.setAttribute("aria-checked", selected ? "true" : "false");
        button.tabIndex = selected ? 0 : -1;
    });

    const viewButton = document.getElementById("heating-time-view");
    if (viewButton != null) {
        viewButton.replaceChildren(
            document.createTextNode(view.label),
            heatingViewChevron(),
        );
    }
    document.querySelectorAll(".heating-time-menu-item").forEach(item => {
        if (!(item instanceof HTMLButtonElement)) {
            return;
        }
        item.setAttribute("aria-checked", item.dataset.viewId === view.id ? "true" : "false");
    });

    const label = document.getElementById("heating-time-label");
    if (label != null) {
        label.textContent = range.pagerLabel(bounds);
    }
    const pager = document.getElementById("heating-time-pager");
    if (pager != null) {
        pager.hidden = !view.pager;
    }
    const forward = document.getElementById("heating-time-forward");
    if (forward instanceof HTMLButtonElement) {
        forward.disabled = containsNow;
    }
}

/**
 * @returns {HTMLSpanElement}
 */
function heatingViewChevron() {
    const chevron = document.createElement("span");
    chevron.className = "heating-time-view-chevron";
    chevron.setAttribute("aria-hidden", "true");
    return chevron;
}

/**
 * @param {HeatingTimeModel} model
 * @returns {string}
 */
function heatingTimePaintKey(model) {
    const slotKey = model.slots.map(slot => slot.durationMs ?? "x").join(",");
    const previousKey = model.previousSlots == null
        ? ""
        : model.previousSlots.map(slot => (slot == null ? "-" : (slot.durationMs ?? "x"))).join(",");
    return [
        model.view.id,
        model.range.id,
        model.bounds.start.getTime(),
        slotKey,
        previousKey,
    ].join("|");
}

/**
 * @param {{force?: boolean}} [options]
 */
function paintHeatingTime(options) {
    const dialog = document.getElementById("heating-stats-dialog");
    const host = document.getElementById("heating-time-host");
    const empty = document.getElementById("heating-stats-empty");
    const title = document.getElementById("heating-stats-title");
    if (!(dialog instanceof HTMLDialogElement) || host == null || empty == null || !(title instanceof HTMLElement)) {
        return;
    }

    const sinceKey = String(heatingTimeQueryStart().getTime());
    if (sinceKey !== heatingTimeLoadedSince) {
        return;
    }

    const hasReadings = heatingTimeSeries != null && heatingTimeSeries.changes.length > 0;
    empty.hidden = hasReadings;
    if (hasReadings && heatingTimeSeries != null) {
        title.hidden = false;
        title.textContent = heatingTimeSeries.device_name;
        dialog.setAttribute("aria-labelledby", "heating-stats-title");
        dialog.removeAttribute("aria-label");
        const model = buildHeatingTimeModel();
        const paintKey = heatingTimePaintKey(model);
        if (!options?.force && paintKey === heatingTimePaintedKey && host.childElementCount > 0) {
            return;
        }
        heatingTimePaintedKey = paintKey;
        model.view.draw(host, model);
        return;
    }

    title.hidden = true;
    title.textContent = "";
    dialog.removeAttribute("aria-labelledby");
    dialog.setAttribute("aria-label", "Heating");
    if (host.childElementCount > 0) {
        heatingTimePaintedKey = "";
        host.replaceChildren();
    }
}

/**
 * @param {{refetch?: boolean}} [options]
 */
function refreshHeatingTime(options) {
    const dialog = document.getElementById("heating-stats-dialog");
    if (!(dialog instanceof HTMLDialogElement) || !dialog.open) {
        return;
    }
    syncHeatingTimeChrome();
    const since = heatingTimeQueryStart();
    const sinceKey = String(since.getTime());
    const reload = options?.refetch === true || sinceKey !== heatingTimeLoadedSince;
    if (!reload) {
        paintHeatingTime();
        return;
    }
    void fetchHeatingSpan(since, sinceKey);
}

/**
 * @param {Date} since
 * @param {string} sinceKey
 */
async function fetchHeatingSpan(since, sinceKey) {
    const id = ++heatingTimeFetchId;
    try {
        const response = await fetch(`/heating/?since=${encodeURIComponent(since.toISOString())}`, {
            cache: "no-store",
        });
        if (!response.ok) {
            throw new Error(`Heating span ${response.status}`);
        }
        const body = await response.json();
        if (id !== heatingTimeFetchId) {
            return;
        }
        heatingTimeSeries = body != null && Array.isArray(body.changes) ? body : null;
        heatingTimeLoadedSince = sinceKey;
        paintHeatingTime();
    } catch (error) {
        if (id !== heatingTimeFetchId) {
            return;
        }
        console.error("Error fetching heating span:", error);
    }
}

/**
 * @param {boolean} [focusButton]
 */
function closeHeatingViewMenu(focusButton) {
    const menu = document.getElementById("heating-time-view-menu");
    const button = document.getElementById("heating-time-view");
    if (menu != null) {
        menu.hidden = true;
    }
    if (button != null) {
        button.setAttribute("aria-expanded", "false");
        if (focusButton) {
            button.focus();
        }
    }
}

/**
 * @param {'first' | 'last' | 'active'} [which]
 */
function openHeatingViewMenu(which) {
    const menu = document.getElementById("heating-time-view-menu");
    const button = document.getElementById("heating-time-view");
    if (menu == null || button == null) {
        return;
    }
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const items = [...menu.querySelectorAll(".heating-time-menu-item")];
    const active = items.find(item => item.getAttribute("aria-checked") === "true");
    const target = which === "last"
        ? items[items.length - 1]
        : which === "first"
            ? items[0]
            : (active ?? items[0]);
    if (target instanceof HTMLElement) {
        target.focus();
    }
}

function heatingViewMenuIsOpen() {
    const menu = document.getElementById("heating-time-view-menu");
    return menu != null && !menu.hidden;
}

function resetHeatingTime() {
    heatingTime.rangeId = heatingTimeRanges[0].id;
    heatingTime.viewId = heatingTimeViews[0].id;
    heatingTime.cursor = new Date();
    heatingTime.rangeBeforeLock = null;
    heatingTimeSeries = null;
    heatingTimeLoadedSince = "";
    heatingTimePaintedKey = "";
    heatingTimeFetchId += 1;
}

function initializeHeatingStats() {
    const button = document.getElementById("heating-stats-button");
    const dialog = document.getElementById("heating-stats-dialog");
    const closeButton = document.getElementById("heating-stats-close");
    const rangeGroup = document.getElementById("heating-time-ranges");
    const viewButton = document.getElementById("heating-time-view");
    const menu = document.getElementById("heating-time-view-menu");
    const back = document.getElementById("heating-time-back");
    const forward = document.getElementById("heating-time-forward");
    if (
        !(button instanceof HTMLButtonElement)
        || !(dialog instanceof HTMLDialogElement)
        || closeButton == null
        || rangeGroup == null
        || !(viewButton instanceof HTMLButtonElement)
        || menu == null
        || !(back instanceof HTMLButtonElement)
        || !(forward instanceof HTMLButtonElement)
    ) {
        return;
    }

    for (const range of heatingTimeRanges) {
        const rangeButton = document.createElement("button");
        rangeButton.type = "button";
        rangeButton.className = "heating-time-range";
        rangeButton.dataset.rangeId = range.id;
        rangeButton.setAttribute("role", "radio");
        rangeButton.textContent = range.label;
        rangeButton.addEventListener("click", () => {
            if (rangeButton.disabled) {
                return;
            }
            heatingTime.rangeId = range.id;
            heatingTime.rangeBeforeLock = null;
            refreshHeatingTime();
        });
        rangeGroup.append(rangeButton);
    }

    rangeGroup.addEventListener("keydown", event => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
            return;
        }
        const buttons = [...rangeGroup.querySelectorAll(".heating-time-range")].filter(
            item => item instanceof HTMLButtonElement && !item.disabled,
        );
        const index = buttons.indexOf(document.activeElement);
        if (index < 0) {
            return;
        }
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const next = buttons[(index + delta + buttons.length) % buttons.length];
        if (next instanceof HTMLButtonElement) {
            next.click();
            next.focus();
        }
    });

    for (const view of heatingTimeViews) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "heating-time-menu-item";
        item.dataset.viewId = view.id;
        item.setAttribute("role", "menuitemradio");
        item.textContent = view.label;
        item.addEventListener("click", () => {
            selectHeatingTimeView(view.id);
            closeHeatingViewMenu(true);
            refreshHeatingTime();
        });
        menu.append(item);
    }

    viewButton.addEventListener("click", () => {
        if (heatingViewMenuIsOpen()) {
            closeHeatingViewMenu();
        } else {
            openHeatingViewMenu("active");
        }
    });
    viewButton.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openHeatingViewMenu(event.key === "ArrowUp" ? "last" : "first");
        }
    });
    menu.addEventListener("keydown", event => {
        const items = [...menu.querySelectorAll(".heating-time-menu-item")];
        const index = items.indexOf(document.activeElement);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const delta = event.key === "ArrowDown" ? 1 : -1;
            const next = items[(index + delta + items.length) % items.length];
            if (next instanceof HTMLElement) {
                next.focus();
            }
        } else if (event.key === "Home" && items[0] instanceof HTMLElement) {
            event.preventDefault();
            items[0].focus();
        } else if (event.key === "End" && items[items.length - 1] instanceof HTMLElement) {
            event.preventDefault();
            items[items.length - 1].focus();
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeHeatingViewMenu(true);
        }
    });

    back.addEventListener("click", () => {
        const range = heatingTimeRangeById(heatingTime.rangeId);
        heatingTime.cursor = range.step(heatingTime.cursor, -1);
        refreshHeatingTime();
    });
    forward.addEventListener("click", () => {
        if (forward.disabled) {
            return;
        }
        const range = heatingTimeRangeById(heatingTime.rangeId);
        heatingTime.cursor = range.step(heatingTime.cursor, 1);
        refreshHeatingTime();
    });

    button.addEventListener("click", () => {
        resetHeatingTime();
        closeHeatingViewMenu();
        if (!dialog.open) {
            button.setAttribute("aria-expanded", "true");
            dialog.showModal();
        }
        refreshHeatingTime({ refetch: true });
    });
    closeButton.addEventListener("click", () => {
        dialog.close();
    });
    dialog.addEventListener("click", event => {
        if (event.target === dialog) {
            dialog.close();
            return;
        }
        const wrap = document.getElementById("heating-time-view-wrap");
        if (
            heatingViewMenuIsOpen()
            && wrap != null
            && event.target instanceof Node
            && !wrap.contains(event.target)
        ) {
            closeHeatingViewMenu();
        }
    });
    dialog.addEventListener("cancel", event => {
        if (heatingViewMenuIsOpen()) {
            event.preventDefault();
            closeHeatingViewMenu(true);
        }
    });
    dialog.addEventListener("close", () => {
        closeHeatingViewMenu();
        button.setAttribute("aria-expanded", "false");
        button.focus();
    });
    window.addEventListener("resize", () => {
        if (dialog.open) {
            paintHeatingTime({ force: true });
        }
    });

    syncHeatingTimeChrome();
}

/**
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @param {'daily' | 'weekly'} period
 * @param {number} periodOffset
 * @returns {Array<{timestamp: string, temp: number, humidity: number}>}
 */
function filterDataForPeriod(data, period, periodOffset) {
    const { start, end } = getPeriodBounds(period, periodOffset);
    return data.filter(point => {
        const timestamp = new Date(point.timestamp);
        return timestamp >= start && timestamp < end;
    });
}

/**
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @param {'daily' | 'weekly'} period
 * @returns {Array<{timestamp: string, temp: number, humidity: number}>}
 */
function alignPreviousPeriodData(data, period) {
    const offsetMs = period === 'daily' ? dayMs : weekMs;
    return data.map(point => ({
        ...point,
        timestamp: new Date(new Date(point.timestamp).getTime() + offsetMs).toISOString(),
    }));
}

/**
 * @returns {number}
 */
function getSmoothWindowMs() {
    // Centered average: ~45 minutes for daily, ~3 hours for weekly.
    return chartPeriod === 'weekly' ? 3 * 60 * 60 * 1000 : 45 * 60 * 1000;
}

/**
 * Centered moving average over a time window. Assumes data is sorted by timestamp.
 *
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @param {number} windowMs
 * @returns {Array<{timestamp: string, temp: number, humidity: number}>}
 */
function smoothTemperatureSeries(data, windowMs) {
    if (data.length < 2 || windowMs <= 0) {
        return data;
    }

    const times = data.map(point => new Date(point.timestamp).getTime());
    const halfWindow = windowMs / 2;
    let left = 0;
    let right = 0;
    let sum = 0;

    return data.map((point, index) => {
        const center = times[index];
        const windowStart = center - halfWindow;
        const windowEnd = center + halfWindow;

        while (right < data.length && times[right] <= windowEnd) {
            sum += data[right].temp;
            right += 1;
        }

        while (left < right && times[left] < windowStart) {
            sum -= data[left].temp;
            left += 1;
        }

        const count = right - left;
        return {
            ...point,
            temp: count > 0 ? sum / count : point.temp,
        };
    });
}

/**
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @returns {{current: Array<{timestamp: string, temp: number, humidity: number}>, overlay: Array<{timestamp: string, temp: number, humidity: number}> | null, bounds: {minTimestamp: number, maxTimestamp: number}}}
 */
function getChartSeries(data) {
    let current = filterDataForPeriod(data, chartPeriod, 0);
    const bounds = getPeriodBounds(chartPeriod, 0);
    let overlay = null;

    if (showPreviousPeriod) {
        const previous = filterDataForPeriod(data, chartPeriod, 1);
        overlay = alignPreviousPeriodData(previous, chartPeriod);
    }

    if (smoothCharts) {
        const windowMs = getSmoothWindowMs();
        current = smoothTemperatureSeries(current, windowMs);
        if (overlay != null) {
            overlay = smoothTemperatureSeries(overlay, windowMs);
        }
    }

    return {
        current,
        overlay,
        bounds: {
            minTimestamp: bounds.start.getTime() / timeScale,
            maxTimestamp: bounds.end.getTime() / timeScale,
        },
    };
}

function loadChartSettings() {
    try {
        const storedSettings = localStorage.getItem(chartSettingsStorageKey);
        if (storedSettings == null) {
            return;
        }

        const settings = JSON.parse(storedSettings);
        if (settings.period === 'daily' || settings.period === 'weekly') {
            chartPeriod = settings.period;
        }
        if (typeof settings.showPreviousPeriod === 'boolean') {
            showPreviousPeriod = settings.showPreviousPeriod;
        }
        if (typeof settings.smoothCharts === 'boolean') {
            smoothCharts = settings.smoothCharts;
        }
        if (Array.isArray(settings.chartOrder)) {
            chartOrder = settings.chartOrder.filter(deviceId => typeof deviceId === 'string');
        }
    } catch (error) {
        // Ignore storage read errors.
    }
}

/**
 * @returns {string[]}
 */
function getCurrentChartOrder() {
    return [...document.querySelectorAll('.charts .data-container')]
        .map(container => container.id.replace(/^data-container-/, ''));
}

function persistChartSettings() {
    try {
        localStorage.setItem(chartSettingsStorageKey, JSON.stringify({
            period: chartPeriod,
            showPreviousPeriod,
            smoothCharts,
            chartOrder: getCurrentChartOrder(),
        }));
    } catch (error) {
        // Ignore storage write errors.
    }
}

function applyStoredChartOrder() {
    const charts = document.querySelector('.charts');
    if (charts == null || chartOrder.length === 0) {
        return;
    }

    /** @type {Map<string, HTMLElement>} */
    const containersById = new Map(
        [...charts.querySelectorAll('.data-container')]
            .map(container => [container.id.replace(/^data-container-/, ''), container])
    );

    for (const deviceId of chartOrder) {
        const container = containersById.get(deviceId);
        if (container != null) {
            charts.appendChild(container);
            containersById.delete(deviceId);
        }
    }
}

/**
 * @param {HTMLElement} dragging
 * @param {HTMLElement} target
 */
function reorderChartContainers(dragging, target) {
    if (dragging === target || dragging.parentElement !== target.parentElement) {
        return;
    }

    const charts = dragging.parentElement;
    if (charts == null) {
        return;
    }

    const siblings = [...charts.children];
    const dragIndex = siblings.indexOf(dragging);
    const targetIndex = siblings.indexOf(target);
    if (dragIndex < 0 || targetIndex < 0) {
        return;
    }

    if (dragIndex < targetIndex) {
        target.after(dragging);
    } else {
        target.before(dragging);
    }
}

/**
 * @param {PointerEvent} event
 */
function onChartDragHandlePointerDown(event) {
    if (event.button !== 0 || activeChartDrag != null) {
        return;
    }

    const handle = event.currentTarget;
    if (!(handle instanceof HTMLElement)) {
        return;
    }

    const container = handle.closest('.data-container');
    const charts = document.querySelector('.charts');
    if (!(container instanceof HTMLElement) || !(charts instanceof HTMLElement)) {
        return;
    }

    event.preventDefault();

    activeChartDrag = {
        container,
        pointerId: event.pointerId,
        charts,
        lastTarget: null,
    };

    container.classList.add('dragging');
    charts.classList.add('is-reordering');

    document.addEventListener('pointermove', onChartDragHandlePointerMove);
    document.addEventListener('pointerup', endChartDrag);
    document.addEventListener('pointercancel', endChartDrag);
}

/**
 * @param {PointerEvent} event
 */
function onChartDragHandlePointerMove(event) {
    if (activeChartDrag == null || event.pointerId !== activeChartDrag.pointerId) {
        return;
    }

    const elementUnderPointer = document.elementFromPoint(event.clientX, event.clientY);
    const target = elementUnderPointer?.closest('.data-container');
    if (!(target instanceof HTMLElement) || target === activeChartDrag.container) {
        if (activeChartDrag.lastTarget != null) {
            activeChartDrag.lastTarget.classList.remove('drag-over');
            activeChartDrag.lastTarget = null;
        }
        return;
    }

    if (activeChartDrag.lastTarget != null && activeChartDrag.lastTarget !== target) {
        activeChartDrag.lastTarget.classList.remove('drag-over');
    }

    target.classList.add('drag-over');
    activeChartDrag.lastTarget = target;
    reorderChartContainers(activeChartDrag.container, target);
}

/**
 * @param {PointerEvent} event
 */
function endChartDrag(event) {
    if (activeChartDrag == null || event.pointerId !== activeChartDrag.pointerId) {
        return;
    }

    const { container, charts, lastTarget } = activeChartDrag;
    activeChartDrag = null;

    document.removeEventListener('pointermove', onChartDragHandlePointerMove);
    document.removeEventListener('pointerup', endChartDrag);
    document.removeEventListener('pointercancel', endChartDrag);

    container.classList.remove('dragging');
    charts.classList.remove('is-reordering');
    if (lastTarget != null) {
        lastTarget.classList.remove('drag-over');
    }
    charts.querySelectorAll('.data-container.drag-over').forEach(element => {
        element.classList.remove('drag-over');
    });

    chartOrder = getCurrentChartOrder();
    persistChartSettings();

    if (deviceData != null) {
        updateCharts();
    }
}

function initializeChartReorder() {
    applyStoredChartOrder();

    document.querySelectorAll('.chart-drag-handle').forEach(handle => {
        handle.addEventListener('pointerdown', onChartDragHandlePointerDown);
    });
}

function syncChartControls() {
    document.querySelectorAll('.period-btn').forEach(button => {
        const isActive = button.getAttribute('data-period') === chartPeriod;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });

    const overlayToggle = document.getElementById('overlay-toggle');
    if (overlayToggle != null) {
        overlayToggle.checked = showPreviousPeriod;
    }

    const smoothToggle = document.getElementById('smooth-toggle');
    if (smoothToggle != null) {
        smoothToggle.checked = smoothCharts;
    }
}

function initializeChartControls() {
    loadChartSettings();
    syncChartControls();

    document.querySelectorAll('.period-btn').forEach(button => {
        button.addEventListener('click', () => {
            const nextPeriod = button.getAttribute('data-period');
            if (nextPeriod !== 'daily' && nextPeriod !== 'weekly') {
                return;
            }

            chartPeriod = nextPeriod;
            syncChartControls();
            persistChartSettings();

            if (deviceData != null) {
                drawCharts();
                refreshAllTemperatureReadouts();
            }
        });
    });

    const overlayToggle = document.getElementById('overlay-toggle');
    if (overlayToggle != null) {
        overlayToggle.addEventListener('change', () => {
            showPreviousPeriod = overlayToggle.checked;
            persistChartSettings();

            if (deviceData != null) {
                drawCharts();
                refreshAllTemperatureReadouts();
            }
        });
    }

    const smoothToggle = document.getElementById('smooth-toggle');
    if (smoothToggle != null) {
        smoothToggle.addEventListener('change', () => {
            smoothCharts = smoothToggle.checked;
            persistChartSettings();

            if (deviceData != null) {
                drawCharts();
                refreshAllTemperatureReadouts();
            }
        });
    }
}

function refreshAllTemperatureReadouts() {
    latestSensorReadings.forEach((_reading, device_id) => {
        if (activeScrubState?.device_id === device_id) {
            restoreActiveScrubMarkers(device_id);
        } else {
            restoreLiveReadouts(device_id);
        }
    });
}

function promptForWaitingWorker(registration) {
    if (!registration || !registration.waiting) {
        return;
    }

    if (window.__pwaUpdatePromptOpen === true) {
        return;
    }

    window.__pwaUpdatePromptOpen = true;
    const shouldUpdateNow = window.confirm('A new version is available. Update now?');
    if (shouldUpdateNow) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
        window.__pwaUpdatePromptOpen = false;
    }
}

function attachUpdateFlow(registration) {
    if (!registration) {
        return;
    }

    promptForWaitingWorker(registration);

    registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (installingWorker == null) {
            return;
        }

        installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                promptForWaitingWorker(registration);
            }
        });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (isReloadingForUpdate) {
            return;
        }

        isReloadingForUpdate = true;
        window.location.reload();
    });
}

// Function to update the registration of the service worker or register it if it does not exist
async function updateServiceWorkerRegistration() {
    // Get the active service worker
    registration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);

    if (registration != null) {
        await registration.update();
        attachUpdateFlow(registration);
        return registration;
    } else {
        const newRegistration = await navigator.serviceWorker.register(serviceWorkerPath, { scope: serviceWorkerScope });
        attachUpdateFlow(newRegistration);
        return newRegistration;
    }
}

// Add event listener for the page to be ready to use
document.addEventListener('DOMContentLoaded', () => {
    initializeChartControls();
    initializeChartReorder();
    initializeHeatingStats();

    // Check if the browser supports service workers
    if ('serviceWorker' in navigator) {
        // Create the service worker and register it
        updateServiceWorkerRegistration()
            .then(() => navigator.serviceWorker.ready)
            .catch((error) => {
                console.error('Service Worker registration failed:', error);
            });
    } else {
        console.warn('Service Worker is not supported');
    }

    // Fetch the latest sensor data
    fetchSensorData();

    // Update the sensor data every 5 seconds
    setInterval(fetchSensorData, 5000);

    // Fetch the time series temperature data
    fetchTemperatureData();

    // Update the temperature data every 5 seconds
    setInterval(fetchTemperatureData, 5000);

    // Add event listener for the page to be resized
    window.addEventListener('resize', () => {
        // Draw the device data if it exists
        if (deviceData != null) {
            updateCharts();
        }
    });

    // Redraw when the charts panel actually receives a non-zero size
    // (common after the full-viewport flex shell finishes laying out).
    const chartsRoot = document.querySelector('.charts');
    if (chartsRoot != null && typeof ResizeObserver !== 'undefined') {
        let lastWidth = chartsRoot.clientWidth;
        const chartsResizeObserver = new ResizeObserver(() => {
            const nextWidth = chartsRoot.clientWidth;
            if (deviceData != null && Math.abs(nextWidth - lastWidth) >= 1) {
                lastWidth = nextWidth;
                updateCharts();
            }
        });
        chartsResizeObserver.observe(chartsRoot);
    }

    // Add event listenter for each mouse / touch move on each svg element
    document.querySelectorAll('svg').forEach(svg => {
        // Add event listener for mouse move on each svg element
        svg.addEventListener('mousemove', (event) => {
            // Get the clientX and clientY of the mouse event
            const clientX = event.clientX;
            const clientY = event.clientY;

            // Handle the move event
            handleMoveEvent(svg, clientX, clientY);
        });

        // Add event listener for touch move on each svg element
        svg.addEventListener('touchmove', (event) => {
            // Get the clientX and clientY of the touch event
            const clientX = event.touches[0].clientX;
            const clientY = event.touches[0].clientY;

            // Handle the move event
            handleMoveEvent(svg, clientX, clientY);
        }, { passive: true });

        // Add event listener for mouse leave on each svg element
        svg.addEventListener('mouseleave', () => {
            const device_id = svg.id.split("-").slice(1).join("-");
            clearChartScrub(device_id);
        });

        // Add event listener for touch end on each svg element
        svg.addEventListener('touchend', () => {
            const device_id = svg.id.split("-").slice(1).join("-");
            clearChartScrub(device_id);
        });
    });
});

function handleMoveEvent(svg, clientX, clientY) {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const mousePosition = point.matrixTransform(svg.getScreenCTM().inverse());
    const device_id = svg.id.split("-").slice(1).join("-");

    applyScrubAtChartX(device_id, mousePosition.x);
}

// Fetch the latest temperature data from the server every 5 seconds and update the page
async function fetchSensorData() {
    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    // Fetch the sensor data
    fetch('/latest_data/', { headers, cache: 'no-store' })
        .then(response => response.json())
        .then(response_data => {
            // Update the sensor data on the page
            response_data.data.forEach(element => {
                const containerElement = document.getElementById("data-container-" + element.device_id);

                latestSensorReadings.set(element.device_id, {
                    temperature: element.temperature,
                    timestamp: element.timestamp,
                });

                // Update the device name
                document.getElementById("device-" + element.device_id).innerText = element.device_name;

                // Update the time data in Tue, 01 Jan, 21:54 format
                if (activeScrubState?.device_id !== element.device_id) {
                    timeString = new Date(element.timestamp)
                        .toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                    document.getElementById("time-" + element.device_id).innerText = timeString;
                }

                // Update the status data
                statusString = element.online ? "Online" : "Offline";
                statusElement = document.getElementById("status-" + element.device_id);
                statusElement.innerText = statusString;
                statusElement.classList.toggle("status-online", element.online);
                statusElement.classList.toggle("status-offline", !element.online);

                if (containerElement != null) {
                    containerElement.classList.toggle("device-online", element.online);
                    containerElement.classList.toggle("device-offline", !element.online);
                }

                // Update the temperature data to 1 decimal place
                if (activeScrubState?.device_id !== element.device_id) {
                    const historicTemp = getHistoricTemperatureAtNow(getDeviceTimeseries(element.device_id));
                    updateTemperatureReadout(element.device_id, element.temperature, historicTemp);
                }

                // Update the humidity data to 1 decimal place
                document.getElementById("humidity-" + element.device_id).innerText = element.humidity.toFixed(1) + "%";
            });
        })
        .catch(error => {
            console.error('Error fetching temperature data:', error);
        });
}

// Fetch the time series temperature data from the server
async function fetchTemperatureData() {
    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    // Fetch the temperature data
    fetch('/timeseries/', { headers, cache: 'no-store' })
        .then(response => response.json())
        .then(response_data => {
            // Update the temperature data
            deviceData = response_data.data;
            heatingSeries = response_data.heating ?? null;
            drawCharts();
            refreshAllTemperatureReadouts();
            refreshHeatingTime({ refetch: true });
        })
        .catch(error => {
            console.error('Error fetching temperature data:', error);
        });
}

// Function to draw the charts of the temperature data
function drawCharts() {
    deviceData.forEach(element => {
        const device_id = element.device_id;
        const data = element.data;
        const svg = document.getElementById("chart-" + device_id);

        if (svg != null && svg.querySelector(".grid") != null) {
            updateChart(device_id, data);
        } else {
            drawChart(device_id, data);
        }
    });
}

// Function to update the charts of the temperature data
function updateCharts() {
    // Loop through the device data and update the charts
    deviceData.forEach(element => {
        // Get the device data
        const device_id = element.device_id;
        const data = element.data;

        // Update the chart
        updateChart(device_id, data);
    });
}

/**
 * @param {{current: Array<{timestamp: string, temp: number, humidity: number}>, overlay: Array<{timestamp: string, temp: number, humidity: number}> | null, bounds: {minTimestamp: number, maxTimestamp: number}}} series
 * @returns {{minTemp: number, maxTemp: number, minTimestamp: number, maxTimestamp: number}}
 */
function chartValueRange(series) {
    const { current, overlay, bounds } = series;
    const temperatures = current.map(d => d.temp);
    if (overlay != null) {
        temperatures.push(...overlay.map(d => d.temp));
    }

    const defaultTemp = 20;
    const minTemp = temperatures.length > 0 ? Math.floor(Math.min(...temperatures)) : defaultTemp - 1;
    const maxTemp = temperatures.length > 0 ? Math.ceil(Math.max(...temperatures)) : defaultTemp + 1;

    return {
        minTemp,
        maxTemp,
        minTimestamp: bounds.minTimestamp,
        maxTimestamp: bounds.maxTimestamp,
    };
}

/**
 * @param {string} device_id
 * @param {{current: Array<{timestamp: string, temp: number, humidity: number}>, overlay: Array<{timestamp: string, temp: number, humidity: number}> | null, bounds: {minTimestamp: number, maxTimestamp: number}}} series
 * @returns {boolean}
 */
function setTransformationMatrix(device_id, series) {
    // Get the chart svg element
    const svgContainer = document.getElementById("svg-container-" + device_id);
    if (svgContainer == null) {
        return false;
    }

    // Get the width of the SVG container
    const width = svgContainer.clientWidth;
    if (width < 8) {
        // Layout not ready yet (flex/grid settled at zero); retry after paint.
        return false;
    }

    // Prefer measured height from CSS aspect-ratio; fall back to 16:9 from width.
    let height = svgContainer.clientHeight;
    if (height < 8) {
        height = (width * 9 / 16);
        svgContainer.style.height = height + "px";
    } else {
        svgContainer.style.height = "";
    }

    const { minTemp, maxTemp, minTimestamp, maxTimestamp } = chartValueRange(series);

    // Get the x and y translation needed to move the top left corner to the origin
    const xTranslation = -minTimestamp;
    const yTranslation = -maxTemp;

    // Get the x and y scale needed to fit the data in the SVG container
    const xRange = Math.max(maxTimestamp - minTimestamp, 1);
    const yRange = Math.max(maxTemp - minTemp, 1);
    const xScale = (width - 2 * xPadding) / xRange;
    const yScale = (height - 2 * yPadding) / yRange;

    // Create the transformation matrix
    const matrix = new DOMMatrix()
        .translateSelf(xPadding, yPadding)
        .scaleSelf(xScale, -yScale)
        .translateSelf(xTranslation, yTranslation);

    // Set the transformation matrix
    transformationMatrices.set(device_id, matrix);

    const svg = document.getElementById("chart-" + device_id);
    if (svg != null) {
        // Pixel size is more reliable than percentage height inside flex/grid shells.
        svg.setAttribute("width", String(width));
        svg.setAttribute("height", String(height));
    }

    return true;
}

/** @type {number | null} */
let chartsRedrawFrame = null;

function scheduleChartsRedraw() {
    if (chartsRedrawFrame != null) {
        return;
    }
    chartsRedrawFrame = window.requestAnimationFrame(() => {
        chartsRedrawFrame = null;
        if (deviceData != null) {
            drawCharts();
        }
    });
}

// Function to draw the chart of the temperature data
function drawChart(device_id, data) {
    const series = getChartSeries(data);

    // Set the transformation matrix of the chart
    if (!setTransformationMatrix(device_id, series)) {
        scheduleChartsRedraw();
        return;
    }

    // Get the chart svg element
    const svg = document.getElementById("chart-" + device_id);
    if (svg == null) {
        return;
    }

    // Remove all existing children of the SVG element
    while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
    }

    // Draw the grid, then the heating wash, then the temperature lines.
    drawGrid(svg, device_id, series);
    drawHeatingBands(svg, device_id, series);

    // Draw the temperature data
    drawTemperature(svg, device_id, series);
    restoreActiveScrubMarkers(device_id);
}

/**
 * Function to draw the grid for the chart
 * @param {SVGElement} svg
 * @param {string} device_id
 * @param {{current: Array<{timestamp: string, temp: number, humidity: number}>, overlay: Array<{timestamp: string, temp: number, humidity: number}> | null, bounds: {minTimestamp: number, maxTimestamp: number}}} series
 * @returns {void}
 */
function drawGrid(svg, device_id, series) {
    // Get the transformation matrix of the chart
    const matrix = transformationMatrices.get(device_id);

    const { minTemp, maxTemp, minTimestamp, maxTimestamp } = chartValueRange(series);

    // Create the top left, bottom left and bottom right corners of the grid
    const topLeft = matrix.transformPoint(new DOMPoint(minTimestamp, maxTemp));
    const bottomLeft = matrix.transformPoint(new DOMPoint(minTimestamp, minTemp));
    const bottomRight = matrix.transformPoint(new DOMPoint(maxTimestamp, minTemp));

    // Remove the existing grid if it exists
    const existingGrid = document.getElementById("grid-" + device_id);
    if (existingGrid != null) {
        svg.removeChild(existingGrid);
    }

    // Create the grid group
    const grid = document.createElementNS("http://www.w3.org/2000/svg", "g");
    grid.setAttribute("class", "grid");
    grid.setAttribute("id", "grid-" + device_id);
    svg.appendChild(grid);

    // Create a polyline for the axes
    const axes = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    axes.setAttribute("class", "axes");
    axes.setAttribute("id", "axes-" + device_id);
    axes.setAttribute("fill", "none");
    axes.setAttribute("stroke", "black");
    axes.setAttribute("stroke-width", "1");
    axes.setAttribute("points", `${topLeft.x},${topLeft.y} ${bottomLeft.x},${bottomLeft.y} ${bottomRight.x},${bottomRight.y}`);
    grid.appendChild(axes);

    // Create the x axis labels
    const xLabels = document.createElementNS("http://www.w3.org/2000/svg", "g");
    xLabels.setAttribute("class", "x-labels");
    xLabels.setAttribute("id", "x-labels-" + device_id);
    grid.appendChild(xLabels);

    // Create the y axis labels
    const yLabels = document.createElementNS("http://www.w3.org/2000/svg", "g");
    yLabels.setAttribute("class", "y-labels");
    yLabels.setAttribute("id", "y-labels-" + device_id);
    grid.appendChild(yLabels);

    // Create the x axis grid lines
    const xGrid = document.createElementNS("http://www.w3.org/2000/svg", "g");
    xGrid.setAttribute("class", "x-grid");
    xGrid.setAttribute("id", "x-grid-" + device_id);
    grid.appendChild(xGrid);

    // Create the y axis grid lines
    const yGrid = document.createElementNS("http://www.w3.org/2000/svg", "g");
    yGrid.setAttribute("class", "y-grid");
    yGrid.setAttribute("id", "y-grid-" + device_id);
    grid.appendChild(yGrid);

    // Create the x axis ticks and labels
    const xTickInterval = chartPeriod === 'daily'
        ? 2 * 60 * 60 * 1000 / timeScale
        : 24 * 60 * 60 * 1000 / timeScale;
    const xTickStart = Math.ceil(minTimestamp / xTickInterval) * xTickInterval;
    const xTickEnd = Math.floor(maxTimestamp / xTickInterval) * xTickInterval;
    for (let xTick = xTickStart; xTick <= xTickEnd; xTick += xTickInterval) {
        // Get the transformed x position of the tick
        const x = matrix.transformPoint(new DOMPoint(xTick, minTemp)).x;

        // Create the x axis tick
        const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
        tick.setAttribute("class", "x-tick");
        tick.setAttribute("x1", x);
        tick.setAttribute("y1", bottomLeft.y);
        tick.setAttribute("x2", x);
        tick.setAttribute("y2", bottomLeft.y + 5);
        tick.setAttribute("stroke", "black");
        tick.setAttribute("stroke-width", "1");
        xGrid.appendChild(tick);

        // Create the x axis label
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("class", "x-label");
        label.setAttribute("x", x);
        label.setAttribute("y", bottomLeft.y + 20);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("font-size", "12");
        label.textContent = chartPeriod === 'daily'
            ? new Date(xTick * timeScale).toLocaleTimeString([], { hour: '2-digit' })
            : new Date(xTick * timeScale).toLocaleDateString([], { weekday: 'short' });
        xLabels.appendChild(label);
    }

    // Add the x axis label
    const xLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    xLabel.setAttribute("class", "x-label");
    xLabel.setAttribute("x", bottomRight.x);
    xLabel.setAttribute("y", bottomRight.y + 40);
    xLabel.setAttribute("text-anchor", "end");
    xLabel.setAttribute("font-size", "12");
    xLabel.textContent = "Time";
    xLabels.appendChild(xLabel);

    // Create the y axis ticks and labels, one tick per degree
    const yTickInterval = 1;
    const yTickStart = Math.ceil(minTemp / yTickInterval) * yTickInterval;
    const yTickEnd = Math.floor(maxTemp / yTickInterval) * yTickInterval;

    for (let yTick = yTickStart; yTick <= yTickEnd; yTick += yTickInterval) {
        // Get the transformed y position of the tick
        const y = matrix.transformPoint(new DOMPoint(minTimestamp, yTick)).y;

        // Create the y axis tick
        const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
        tick.setAttribute("class", "y-tick");
        tick.setAttribute("x1", topLeft.x);
        tick.setAttribute("y1", y);
        tick.setAttribute("x2", topLeft.x - 5);
        tick.setAttribute("y2", y);
        tick.setAttribute("stroke", "black");
        tick.setAttribute("stroke-width", "1");
        yGrid.appendChild(tick);

        // Create the y axis label
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("class", "y-label");
        label.setAttribute("x", topLeft.x - 10);
        label.setAttribute("y", y + 5);
        label.setAttribute("text-anchor", "end");
        label.setAttribute("font-size", "12");
        label.textContent = yTick;
        yLabels.appendChild(label);
    }

    // Add the y axis label
    const yLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    yLabel.setAttribute("class", "y-label");
    yLabel.setAttribute("x", topLeft.x - 30);
    yLabel.setAttribute("y", topLeft.y - 20);
    yLabel.setAttribute("text-anchor", "start");
    yLabel.setAttribute("font-size", "12");
    yLabel.textContent = "Temperature (°C)";
    yLabels.appendChild(yLabel);
}

function updateChart(device_id, data) {
    const series = getChartSeries(data);

    // Set the transformation matrix of the chart
    if (!setTransformationMatrix(device_id, series)) {
        scheduleChartsRedraw();
        return;
    }

    // Get the chart svg element
    const svg = document.getElementById("chart-" + device_id);
    if (svg == null || transformationMatrices.get(device_id) == null) {
        return;
    }

    // Draw the grid, then the heating wash, then the temperature lines.
    // The grid is appended, so the wash has to be rebuilt after it or the
    // grid covers the bands. Rebuilding also drops a stale group.
    drawGrid(svg, device_id, series);
    drawHeatingBands(svg, device_id, series);

    // Update the temperature data
    drawTemperature(svg, device_id, series);
    restoreActiveScrubMarkers(device_id);
}

/**
 * @param {SVGElement} svg
 * @param {string} device_id
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @param {string} className
 * @param {string} elementId
 */
function drawTemperatureLine(svg, device_id, data, className, elementId) {
    const matrix = transformationMatrices.get(device_id);
    const existingLine = document.getElementById(elementId);
    if (existingLine != null) {
        svg.removeChild(existingLine);
    }

    if (data.length === 0) {
        return;
    }

    const points = data.map(d => matrix.transformPoint(
        new DOMPoint(new Date(d.timestamp).getTime() / timeScale, d.temp)
    ));

    const temperature = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    temperature.setAttribute("class", className);
    temperature.setAttribute("id", elementId);
    temperature.setAttribute("fill", "none");
    temperature.setAttribute("stroke-width", "1");
    temperature.setAttribute("points", points.map(p => `${p.x},${p.y}`).join(" "));
    svg.appendChild(temperature);
}

/**
 * Paint this period's HEATING runs behind the temperature lines.
 * Previous-period heating is left in the payload and is not drawn.
 * Mode and requested temperature are not read here.
 *
 * @param {SVGElement} svg
 * @param {string} device_id
 * @param {{current: Array<{timestamp: string, temp: number, humidity: number}>, overlay: Array<{timestamp: string, temp: number, humidity: number}> | null, bounds: {minTimestamp: number, maxTimestamp: number}}} series
 */
function drawHeatingBands(svg, device_id, series) {
    const existing = document.getElementById("heating-bands-" + device_id);
    if (existing != null) {
        existing.remove();
    }
    const existingDefs = document.getElementById("heating-bands-defs-" + device_id);
    if (existingDefs != null) {
        existingDefs.remove();
    }

    const heating = heatingSeries;
    if (heating == null || !Array.isArray(heating.changes) || heating.changes.length === 0) {
        return;
    }

    const matrix = transformationMatrices.get(device_id);
    if (matrix == null) {
        return;
    }

    const range = chartValueRange(series);
    const runs = heatingRuns(heating.changes, getPeriodBounds(chartPeriod, 0));
    if (runs.length === 0) {
        return;
    }

    const topLeft = matrix.transformPoint(new DOMPoint(range.minTimestamp, range.maxTemp));
    const bottomLeft = matrix.transformPoint(new DOMPoint(range.minTimestamp, range.minTemp));
    const bottomRight = matrix.transformPoint(new DOMPoint(range.maxTimestamp, range.minTemp));
    const clipX = Math.min(topLeft.x, bottomRight.x);
    const clipY = Math.min(topLeft.y, bottomLeft.y);
    const clipWidth = Math.abs(bottomRight.x - topLeft.x);
    const clipHeight = Math.abs(bottomLeft.y - topLeft.y);
    const bandHeight = Math.abs(bottomLeft.y - topLeft.y);
    if (!(clipWidth > 0) || !(bandHeight > 0)) {
        return;
    }

    const clipId = "heating-bands-clip-" + device_id;
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.setAttribute("id", "heating-bands-defs-" + device_id);
    const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
    clipPath.setAttribute("id", clipId);
    const clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    clipRect.setAttribute("x", String(clipX));
    clipRect.setAttribute("y", String(clipY));
    clipRect.setAttribute("width", String(clipWidth));
    clipRect.setAttribute("height", String(clipHeight));
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "heating-bands");
    group.setAttribute("id", "heating-bands-" + device_id);
    group.setAttribute("pointer-events", "none");
    group.setAttribute("clip-path", "url(#" + clipId + ")");

    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = "Heating running";
    group.appendChild(title);

    for (const run of runs) {
        const startX = matrix.transformPoint(
            new DOMPoint(run.start.getTime() / timeScale, range.minTemp)
        ).x;
        const endX = matrix.transformPoint(
            new DOMPoint(run.end.getTime() / timeScale, range.minTemp)
        ).x;
        const width = endX - startX;
        if (!(width > 0)) {
            continue;
        }

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("class", "heating-band");
        rect.setAttribute("x", String(startX));
        rect.setAttribute("y", String(clipY));
        rect.setAttribute("width", String(width));
        rect.setAttribute("height", String(bandHeight));
        group.appendChild(rect);
    }

    if (group.querySelector(".heating-band") == null) {
        return;
    }

    svg.appendChild(defs);
    svg.appendChild(group);
}

// Function to draw the temperature data on the chart
function drawTemperature(svg, device_id, series) {
    const { current, overlay } = series;

    if (overlay != null && overlay.length > 0) {
        drawTemperatureLine(
            svg,
            device_id,
            overlay,
            "temperature-overlay",
            "temperature-overlay-line-" + device_id
        );
    } else {
        const existingOverlay = document.getElementById("temperature-overlay-line-" + device_id);
        if (existingOverlay != null) {
            svg.removeChild(existingOverlay);
        }
    }

    drawTemperatureLine(
        svg,
        device_id,
        current,
        "temperature temperature-current",
        "temperature-line-" + device_id
    );
}
