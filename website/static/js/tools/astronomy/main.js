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

function formatLocalTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
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
        sunStatus.innerText = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (error) {
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
}

document.addEventListener("DOMContentLoaded", initializePage);
