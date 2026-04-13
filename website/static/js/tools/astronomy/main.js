const sunriseApi = "/sun-times/";
const synodicMonthDays = 29.53058867;
const knownNewMoonUtcMs = Date.UTC(2000, 0, 6, 18, 14, 0);

const latitudeInput = document.getElementById("latitude");
const longitudeInput = document.getElementById("longitude");
const refreshButton = document.getElementById("refresh-button");
const locationButton = document.getElementById("location-button");
const locationReadout = document.getElementById("location-readout");
const sunStatus = document.getElementById("sun-status");

const sunriseElement = document.getElementById("sunrise");
const sunsetElement = document.getElementById("sunset");
const civilBeginElement = document.getElementById("civil-begin");
const civilEndElement = document.getElementById("civil-end");

const moonCanvas = document.getElementById("moon-canvas");
const moonNameElement = document.getElementById("moon-name");
const moonDetailsElement = document.getElementById("moon-details");
const planetWindowElement = document.getElementById("planet-window");
const planetListElement = document.getElementById("planet-list");
const skyCanvas = document.getElementById("sky-canvas");

const planetColors = {
    Mercury: "#f7d7a6",
    Venus: "#fff4c4",
    Mars: "#ff9c88",
    Jupiter: "#e9d0b2",
    Saturn: "#ead9a2",
    Uranus: "#9fe7e9",
    Neptune: "#95bcff"
};

const planetaryElements = {
    Mercury: { N0: 48.3313, N1: 3.24587e-5, i0: 7.0047, i1: 5e-8, w0: 29.1241, w1: 1.01444e-5, a0: 0.387098, a1: 0, e0: 0.205635, e1: 5.59e-10, M0: 168.6562, M1: 4.0923344368 },
    Venus: { N0: 76.6799, N1: 2.4659e-5, i0: 3.3946, i1: 2.75e-8, w0: 54.891, w1: 1.38374e-5, a0: 0.72333, a1: 0, e0: 0.006773, e1: -1.302e-9, M0: 48.0052, M1: 1.6021302244 },
    Mars: { N0: 49.5574, N1: 2.11081e-5, i0: 1.8497, i1: -1.78e-8, w0: 286.5016, w1: 2.92961e-5, a0: 1.523688, a1: 0, e0: 0.093405, e1: 2.516e-9, M0: 18.6021, M1: 0.5240207766 },
    Jupiter: { N0: 100.4542, N1: 2.76854e-5, i0: 1.303, i1: -1.557e-7, w0: 273.8777, w1: 1.64505e-5, a0: 5.20256, a1: 0, e0: 0.048498, e1: 4.469e-9, M0: 19.895, M1: 0.0830853001 },
    Saturn: { N0: 113.6634, N1: 2.3898e-5, i0: 2.4886, i1: -1.081e-7, w0: 339.3939, w1: 2.97661e-5, a0: 9.55475, a1: 0, e0: 0.055546, e1: -9.499e-9, M0: 316.967, M1: 0.0334442282 },
    Uranus: { N0: 74.0005, N1: 1.3978e-5, i0: 0.7733, i1: 1.9e-8, w0: 96.6612, w1: 3.0565e-5, a0: 19.18171, a1: -1.55e-8, e0: 0.047318, e1: 7.45e-9, M0: 142.5905, M1: 0.011725806 },
    Neptune: { N0: 131.7806, N1: 3.0173e-5, i0: 1.77, i1: -2.55e-7, w0: 272.8461, w1: -6.027e-6, a0: 30.05826, a1: 3.313e-8, e0: 0.008606, e1: 2.15e-9, M0: 260.2471, M1: 0.005995147 }
};

const earthElements = {
    N0: 0,
    N1: 0,
    i0: 0,
    i1: 0,
    w0: 282.9404,
    w1: 4.70935e-5,
    a0: 1,
    a1: 0,
    e0: 0.016709,
    e1: -1.151e-9,
    M0: 356.047,
    M1: 0.9856002585
};

function formatLocalTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

function formatClockTime(date) {
    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}

function toDegrees(radians) {
    return radians * (180 / Math.PI);
}

function normalizeDegrees(degrees) {
    let angle = degrees % 360;
    if (angle < 0) {
        angle += 360;
    }

    return angle;
}

function toJulianDate(date) {
    return date.getTime() / 86400000 + 2440587.5;
}

function solveEccentricAnomaly(meanAnomalyRadians, eccentricity) {
    let eccentricAnomaly = meanAnomalyRadians + eccentricity * Math.sin(meanAnomalyRadians) * (1 + eccentricity * Math.cos(meanAnomalyRadians));

    for (let i = 0; i < 5; i++) {
        const delta = (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomalyRadians) / (1 - eccentricity * Math.cos(eccentricAnomaly));
        eccentricAnomaly -= delta;
    }

    return eccentricAnomaly;
}

function getHeliocentricCoordinates(elements, d) {
    const N = toRadians(normalizeDegrees(elements.N0 + elements.N1 * d));
    const i = toRadians(elements.i0 + elements.i1 * d);
    const w = toRadians(normalizeDegrees(elements.w0 + elements.w1 * d));
    const a = elements.a0 + elements.a1 * d;
    const e = elements.e0 + elements.e1 * d;
    const M = toRadians(normalizeDegrees(elements.M0 + elements.M1 * d));

    const E = solveEccentricAnomaly(M, e);
    const xv = a * (Math.cos(E) - e);
    const yv = a * (Math.sqrt(1 - e * e) * Math.sin(E));

    const v = Math.atan2(yv, xv);
    const r = Math.sqrt(xv * xv + yv * yv);

    const xh = r * (Math.cos(N) * Math.cos(v + w) - Math.sin(N) * Math.sin(v + w) * Math.cos(i));
    const yh = r * (Math.sin(N) * Math.cos(v + w) + Math.cos(N) * Math.sin(v + w) * Math.cos(i));
    const zh = r * (Math.sin(v + w) * Math.sin(i));

    return { x: xh, y: yh, z: zh };
}

function getPlanetHorizontalCoordinates(planetName, date, latitude, longitude) {
    const jd = toJulianDate(date);
    const d = jd - 2451543.5;

    const earth = getHeliocentricCoordinates(earthElements, d);
    const planet = getHeliocentricCoordinates(planetaryElements[planetName], d);

    const xg = planet.x - earth.x;
    const yg = planet.y - earth.y;
    const zg = planet.z - earth.z;

    const obliquity = toRadians(23.4393 - 3.563e-7 * d);

    const xeq = xg;
    const yeq = yg * Math.cos(obliquity) - zg * Math.sin(obliquity);
    const zeq = yg * Math.sin(obliquity) + zg * Math.cos(obliquity);

    const rightAscension = Math.atan2(yeq, xeq);
    const declination = Math.atan2(zeq, Math.sqrt(xeq * xeq + yeq * yeq));

    const gmst = normalizeDegrees(280.46061837 + 360.98564736629 * (jd - 2451545));
    const lst = normalizeDegrees(gmst + longitude);
    const hourAngle = toRadians(normalizeDegrees(lst - normalizeDegrees(toDegrees(rightAscension))));

    const latitudeRadians = toRadians(latitude);
    const altitude = Math.asin(
        Math.sin(declination) * Math.sin(latitudeRadians)
            + Math.cos(declination) * Math.cos(latitudeRadians) * Math.cos(hourAngle)
    );

    const azimuth = Math.atan2(
        Math.sin(hourAngle),
        Math.cos(hourAngle) * Math.sin(latitudeRadians) - Math.tan(declination) * Math.cos(latitudeRadians)
    );

    return {
        altitudeDegrees: toDegrees(altitude),
        azimuthDegrees: normalizeDegrees(toDegrees(azimuth) + 180)
    };
}

function getEveningWindow(civilTwilightEndIso) {
    const start = new Date(civilTwilightEndIso);
    const end = new Date(start);
    end.setHours(24, 0, 0, 0);

    if (end <= start) {
        end.setDate(end.getDate() + 1);
    }

    return { start, end };
}

function drawSkyDiagram(visiblePlanets) {
    if (skyCanvas == null) {
        return;
    }

    const ctx = skyCanvas.getContext("2d");
    if (ctx == null) {
        return;
    }

    const width = skyCanvas.width;
    const height = skyCanvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.39;

    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createRadialGradient(cx, cy * 0.75, radius * 0.15, cx, cy, radius * 1.15);
    gradient.addColorStop(0, "hsl(216, 58%, 20%)");
    gradient.addColorStop(1, "hsl(232, 58%, 8%)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    for (const alt of [30, 60]) {
        const ringRadius = (90 - alt) / 90 * radius;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = "hsla(210, 38%, 84%, 0.28)";
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "hsla(210, 52%, 90%, 0.55)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.strokeStyle = "hsla(212, 32%, 88%, 0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "hsla(0, 0%, 100%, 0.84)";
    ctx.font = "12px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("N", cx, cy - radius - 7);
    ctx.fillText("S", cx, cy + radius + 16);
    ctx.fillText("E", cx + radius + 10, cy + 4);
    ctx.fillText("W", cx - radius - 10, cy + 4);

    if (visiblePlanets.length === 0) {
        ctx.fillStyle = "hsla(210, 26%, 88%, 0.86)";
        ctx.font = "13px Outfit, sans-serif";
        ctx.fillText("No visible planets", cx, cy + 4);
        return;
    }

    ctx.textAlign = "left";
    for (const planet of visiblePlanets) {
        const radialDistance = (90 - planet.maxAltitude) / 90 * radius;
        const azimuthRadians = toRadians(planet.bestAzimuth);
        const x = cx + radialDistance * Math.sin(azimuthRadians);
        const y = cy - radialDistance * Math.cos(azimuthRadians);

        ctx.beginPath();
        ctx.arc(x, y, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = planetColors[planet.planetName] || "#ffffff";
        ctx.fill();
        ctx.strokeStyle = "hsla(216, 38%, 16%, 0.8)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = "hsla(0, 0%, 100%, 0.92)";
        ctx.font = "12px Outfit, sans-serif";
        ctx.fillText(planet.planetName, x + 7, y - 7);
    }
}

function renderVisiblePlanets(civilTwilightEndIso, latitude, longitude) {
    const { start, end } = getEveningWindow(civilTwilightEndIso);
    planetWindowElement.innerText = `Window: ${formatClockTime(start)} to ${formatClockTime(end)}`;

    const sampleStepMs = 20 * 60 * 1000;
    const visibilityThreshold = 10;
    const visiblePlanets = [];

    for (const planetName of Object.keys(planetaryElements)) {
        let maxAltitude = -90;
        let bestTime = start;
        let bestAzimuth = 0;

        for (let t = start.getTime(); t <= end.getTime(); t += sampleStepMs) {
            const sampleDate = new Date(t);
            const horizontalCoordinates = getPlanetHorizontalCoordinates(planetName, sampleDate, latitude, longitude);
            const altitude = horizontalCoordinates.altitudeDegrees;

            if (altitude > maxAltitude) {
                maxAltitude = altitude;
                bestTime = sampleDate;
                bestAzimuth = horizontalCoordinates.azimuthDegrees;
            }
        }

        if (maxAltitude >= visibilityThreshold) {
            visiblePlanets.push({
                planetName,
                maxAltitude,
                bestTime,
                bestAzimuth
            });
        }
    }

    planetListElement.innerHTML = "";

    if (visiblePlanets.length === 0) {
        const item = document.createElement("li");
        item.innerText = "No major planets rise above 10 degrees in this window.";
        planetListElement.appendChild(item);
        drawSkyDiagram([]);
        return;
    }

    visiblePlanets.sort((a, b) => b.maxAltitude - a.maxAltitude);

    for (const planet of visiblePlanets) {
        const item = document.createElement("li");
        item.innerText = `${planet.planetName}: up to ${planet.maxAltitude.toFixed(0)} degrees at ${formatClockTime(planet.bestTime)}`;
        planetListElement.appendChild(item);
    }

    drawSkyDiagram(visiblePlanets);
}

function normalizePhase(phaseFraction) {
    let phase = phaseFraction % 1;
    if (phase < 0) {
        phase += 1;
    }

    return phase;
}

function getMoonPhaseData(now) {
    const dayMs = 24 * 60 * 60 * 1000;
    const phaseAgeDays = ((now.getTime() - knownNewMoonUtcMs) / dayMs) % synodicMonthDays;
    const age = phaseAgeDays < 0 ? phaseAgeDays + synodicMonthDays : phaseAgeDays;
    const phase = normalizePhase(age / synodicMonthDays);
    const illumination = 0.5 * (1 - Math.cos(2 * Math.PI * phase));

    let name = "New Moon";
    if (phase >= 0.0625 && phase < 0.1875) {
        name = "Waxing Crescent";
    } else if (phase >= 0.1875 && phase < 0.3125) {
        name = "First Quarter";
    } else if (phase >= 0.3125 && phase < 0.4375) {
        name = "Waxing Gibbous";
    } else if (phase >= 0.4375 && phase < 0.5625) {
        name = "Full Moon";
    } else if (phase >= 0.5625 && phase < 0.6875) {
        name = "Waning Gibbous";
    } else if (phase >= 0.6875 && phase < 0.8125) {
        name = "Last Quarter";
    } else if (phase >= 0.8125 && phase < 0.9375) {
        name = "Waning Crescent";
    }

    return {
        age,
        phase,
        illumination,
        name
    };
}

function drawMoonPhaseImage(canvas, phase) {
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.42;

    const lit = [240, 245, 255];
    const dark = [36, 43, 64];

    const theta = 2 * Math.PI * phase;
    const sunX = Math.sin(theta);
    const sunY = 0;
    const sunZ = -Math.cos(theta);

    ctx.clearRect(0, 0, width, height);

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = (x - cx) / radius;
            const dy = (y - cy) / radius;
            const d2 = dx * dx + dy * dy;

            if (d2 > 1) {
                continue;
            }

            const dz = Math.sqrt(1 - d2);
            const dot = dx * sunX + dy * sunY + dz * sunZ;
            const color = dot > 0 ? lit : dark;
            const i = (y * width + x) * 4;

            data[i] = color[0];
            data[i + 1] = color[1];
            data[i + 2] = color[2];
            data[i + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = "hsla(212, 38%, 90%, 0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();
}

async function updateSunTimes(lat, lon) {
    sunStatus.innerText = "Fetching sun times...";

    const requestUrl = `${sunriseApi}?lat=${lat}&lon=${lon}`;

    try {
        const response = await fetch(requestUrl);
        const payload = await response.json();

        if (payload.status !== "OK") {
            throw new Error("Sunrise API did not return OK status");
        }

        const result = payload.results;

        sunriseElement.innerText = formatLocalTime(result.sunrise);
        sunsetElement.innerText = formatLocalTime(result.sunset);
        civilBeginElement.innerText = formatLocalTime(result.civil_twilight_begin);
        civilEndElement.innerText = formatLocalTime(result.civil_twilight_end);
        renderVisiblePlanets(result.civil_twilight_end, lat, lon);
        sunStatus.innerText = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (error) {
        planetWindowElement.innerText = "Window: --";
        planetListElement.innerHTML = "<li>Planet visibility unavailable.</li>";
        drawSkyDiagram([]);
        sunStatus.innerText = "Could not fetch sun times. Please try again.";
        console.error(error);
    }
}

function updateMoonPhase() {
    const phaseData = getMoonPhaseData(new Date());
    drawMoonPhaseImage(moonCanvas, phaseData.phase);

    moonNameElement.innerText = phaseData.name;
    moonDetailsElement.innerText = `Illumination: ${(phaseData.illumination * 100).toFixed(1)}% | Age: ${phaseData.age.toFixed(1)} days`;
}

function readCoordinatesFromInputs() {
    const lat = Number.parseFloat(latitudeInput.value);
    const lon = Number.parseFloat(longitudeInput.value);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error("Invalid coordinates");
    }

    return { lat, lon };
}

async function refreshFromInputs() {
    try {
        const { lat, lon } = readCoordinatesFromInputs();
        locationReadout.innerText = `Manual coordinates: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        await updateSunTimes(lat, lon);
    } catch (error) {
        sunStatus.innerText = "Enter valid latitude and longitude values.";
    }
}

function initializeLocationButton() {
    locationButton.addEventListener("click", () => {
        if (!("geolocation" in navigator)) {
            sunStatus.innerText = "Geolocation is not available in this browser.";
            return;
        }

        locationButton.disabled = true;
        locationButton.innerText = "Locating...";

        navigator.geolocation.getCurrentPosition(
            async position => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;

                latitudeInput.value = lat.toFixed(4);
                longitudeInput.value = lon.toFixed(4);
                locationReadout.innerText = `Current location: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;

                await updateSunTimes(lat, lon);

                locationButton.disabled = false;
                locationButton.innerText = "Use My Location";
            },
            error => {
                console.error(error);
                sunStatus.innerText = "Could not read your location. Please allow location access.";
                locationButton.disabled = false;
                locationButton.innerText = "Use My Location";
            }
        );
    });
}

function initializePage() {
    refreshButton.addEventListener("click", refreshFromInputs);
    initializeLocationButton();

    refreshFromInputs();
    updateMoonPhase();
    drawSkyDiagram([]);
}

document.addEventListener("DOMContentLoaded", initializePage);
