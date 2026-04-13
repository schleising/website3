const sunriseApi = "/sun-times/";
const synodicMonthDays = 29.53058867;
const knownNewMoonUtcMs = Date.UTC(2000, 0, 6, 18, 14, 0);
const astronomicalUnitLightTimeDays = 0.0057755183;

const latitudeInput = document.getElementById("latitude");
const longitudeInput = document.getElementById("longitude");
const cityPicker = document.getElementById("city-picker");
const cityPickerButton = document.getElementById("city-picker-button");
const cityPickerButtonLabel = document.getElementById("city-picker-button-label");
const cityPickerPopover = document.getElementById("city-picker-popover");
const cityPickerListbox = document.getElementById("city-picker-listbox");
const cityPickerOptions = Array.from(document.querySelectorAll(".city-picker-option[data-city-value]"));
const refreshButton = document.getElementById("refresh-button");
const locationButton = document.getElementById("location-button");
const locationReadout = document.getElementById("location-readout");
const sunStatus = document.getElementById("sun-status");

const cityPresets = {
    auckland: { label: "Auckland, New Zealand", lat: -36.8509, lon: 174.7645 },
    beijing: { label: "Beijing, China", lat: 39.9042, lon: 116.4074 },
    "buenos-aires": { label: "Buenos Aires, Argentina", lat: -34.6037, lon: -58.3816 },
    cairo: { label: "Cairo, Egypt", lat: 30.0444, lon: 31.2357 },
    "cape-town": { label: "Cape Town, South Africa", lat: -33.9249, lon: 18.4241 },
    delhi: { label: "Delhi, India", lat: 28.6139, lon: 77.209 },
    dubai: { label: "Dubai, UAE", lat: 25.2048, lon: 55.2708 },
    honolulu: { label: "Honolulu, USA", lat: 21.3069, lon: -157.8583 },
    istanbul: { label: "Istanbul, Turkiye", lat: 41.0082, lon: 28.9784 },
    jakarta: { label: "Jakarta, Indonesia", lat: -6.2088, lon: 106.8456 },
    lagos: { label: "Lagos, Nigeria", lat: 6.5244, lon: 3.3792 },
    london: { label: "London, UK", lat: 51.5074, lon: -0.1278 },
    "los-angeles": { label: "Los Angeles, USA", lat: 34.0522, lon: -118.2437 },
    melbourne: { label: "Melbourne, Australia", lat: -37.8136, lon: 144.9631 },
    "mexico-city": { label: "Mexico City, Mexico", lat: 19.4326, lon: -99.1332 },
    moscow: { label: "Moscow, Russia", lat: 55.7558, lon: 37.6173 },
    mumbai: { label: "Mumbai, India", lat: 19.076, lon: 72.8777 },
    nairobi: { label: "Nairobi, Kenya", lat: -1.2921, lon: 36.8219 },
    "new-york": { label: "New York, USA", lat: 40.7128, lon: -74.006 },
    paris: { label: "Paris, France", lat: 48.8566, lon: 2.3522 },
    reykjavik: { label: "Reykjavik, Iceland", lat: 64.1466, lon: -21.9426 },
    "sao-paulo": { label: "Sao Paulo, Brazil", lat: -23.5505, lon: -46.6333 },
    santiago: { label: "Santiago, Chile", lat: -33.4489, lon: -70.6693 },
    seoul: { label: "Seoul, South Korea", lat: 37.5665, lon: 126.978 },
    singapore: { label: "Singapore, Singapore", lat: 1.3521, lon: 103.8198 },
    tokyo: { label: "Tokyo, Japan", lat: 35.6762, lon: 139.6503 },
    toronto: { label: "Toronto, Canada", lat: 43.6532, lon: -79.3832 },
    wellington: { label: "Wellington, New Zealand", lat: -41.2865, lon: 174.7762 }
};

const serviceWorkerPath = "/sw.js";
const serviceWorkerScope = "/";

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
const skyFullscreenElement = document.getElementById("sky-fullscreen");
const skyFullscreenStageElement = document.getElementById("sky-fullscreen-stage");
const skyCloseButton = document.getElementById("sky-close-button");
const skyFullscreenCanvas = document.getElementById("sky-canvas-fullscreen");

let latestVisiblePlanets = [];
let latestSkyContext = null;
let isLocationRequestInProgress = false;
let requestCurrentLocation = async () => false;

const fullscreenSkyViewState = {
    scale: 1,
    translateX: 0,
    translateY: 0,
    minScale: 1,
    maxScale: 5,
    isDragging: false,
    lastX: 0,
    lastY: 0,
    pointers: new Map(),
    pinchStartDistance: 0,
    pinchStartScale: 1
};

const planetColors = {
    Mercury: "#f7d7a6",
    Venus: "#fff4c4",
    Mars: "#ff9c88",
    Jupiter: "#e9d0b2",
    Saturn: "#ead9a2",
    Uranus: "#9fe7e9",
    Neptune: "#95bcff"
};

const constellations = [
    {
        name: "Orion",
        stars: {
            Betelgeuse: { ra: 88.79, dec: 7.4 },
            Bellatrix: { ra: 81.28, dec: 6.35 },
            Alnitak: { ra: 85.19, dec: -1.94 },
            Alnilam: { ra: 84.05, dec: -1.2 },
            Mintaka: { ra: 83.0, dec: -0.3 },
            Rigel: { ra: 78.63, dec: -8.2 },
            Saiph: { ra: 86.94, dec: -9.67 }
        },
        lines: [
            ["Betelgeuse", "Bellatrix"],
            ["Bellatrix", "Mintaka"],
            ["Mintaka", "Alnilam"],
            ["Alnilam", "Alnitak"],
            ["Alnitak", "Saiph"],
            ["Saiph", "Rigel"],
            ["Rigel", "Mintaka"],
            ["Betelgeuse", "Alnitak"]
        ]
    },
    {
        name: "Cassiopeia",
        stars: {
            Caph: { ra: 2.29, dec: 59.15 },
            Schedar: { ra: 10.13, dec: 56.54 },
            Gamma: { ra: 14.17, dec: 60.72 },
            Ruchbah: { ra: 21.45, dec: 60.24 },
            Segin: { ra: 28.6, dec: 63.67 }
        },
        lines: [
            ["Caph", "Schedar"],
            ["Schedar", "Gamma"],
            ["Gamma", "Ruchbah"],
            ["Ruchbah", "Segin"]
        ]
    },
    {
        name: "Ursa Major",
        stars: {
            Dubhe: { ra: 165.93, dec: 61.75 },
            Merak: { ra: 165.46, dec: 56.38 },
            Phecda: { ra: 178.46, dec: 53.69 },
            Megrez: { ra: 183.86, dec: 57.03 },
            Alioth: { ra: 193.51, dec: 55.96 },
            Mizar: { ra: 200.98, dec: 54.93 },
            Alkaid: { ra: 206.89, dec: 49.31 }
        },
        lines: [
            ["Dubhe", "Merak"],
            ["Merak", "Phecda"],
            ["Phecda", "Megrez"],
            ["Megrez", "Dubhe"],
            ["Megrez", "Alioth"],
            ["Alioth", "Mizar"],
            ["Mizar", "Alkaid"]
        ]
    },
    {
        name: "Cygnus",
        stars: {
            Deneb: { ra: 310.36, dec: 45.28 },
            Sadr: { ra: 305.56, dec: 40.26 },
            Albireo: { ra: 292.68, dec: 27.96 },
            Gienah: { ra: 292.68, dec: 33.97 },
            Delta: { ra: 296.24, dec: 45.13 }
        },
        lines: [
            ["Deneb", "Sadr"],
            ["Sadr", "Albireo"],
            ["Sadr", "Gienah"],
            ["Sadr", "Delta"]
        ]
    },
    {
        name: "Scorpius",
        stars: {
            Antares: { ra: 247.35, dec: -26.43 },
            Acrab: { ra: 241.36, dec: -19.81 },
            Dschubba: { ra: 240.08, dec: -22.62 },
            Sargas: { ra: 263.4, dec: -42.99 },
            Shaula: { ra: 263.4, dec: -37.1 },
            Lesath: { ra: 262.69, dec: -37.3 }
        },
        lines: [
            ["Acrab", "Dschubba"],
            ["Dschubba", "Antares"],
            ["Antares", "Sargas"],
            ["Sargas", "Shaula"],
            ["Shaula", "Lesath"]
        ]
    },
    {
        name: "Crux",
        stars: {
            Acrux: { ra: 186.65, dec: -63.1 },
            Mimosa: { ra: 191.93, dec: -59.69 },
            Gacrux: { ra: 187.79, dec: -57.11 },
            Delta: { ra: 183.79, dec: -58.75 }
        },
        lines: [
            ["Gacrux", "Acrux"],
            ["Mimosa", "Delta"]
        ]
    },
    {
        name: "Centaurus",
        stars: {
            RigilKent: { ra: 219.9, dec: -60.83 },
            Hadar: { ra: 210.96, dec: -60.37 },
            Menkent: { ra: 211.67, dec: -36.37 },
            Alnair: { ra: 208.89, dec: -47.29 }
        },
        lines: [
            ["RigilKent", "Hadar"],
            ["Hadar", "Alnair"],
            ["Alnair", "Menkent"]
        ]
    },
    {
        name: "Carina",
        stars: {
            Canopus: { ra: 95.99, dec: -52.7 },
            Miaplacidus: { ra: 138.3, dec: -69.72 },
            Avior: { ra: 125.63, dec: -59.51 },
            Aspidiske: { ra: 139.27, dec: -59.28 }
        },
        lines: [
            ["Canopus", "Avior"],
            ["Avior", "Aspidiske"],
            ["Aspidiske", "Miaplacidus"]
        ]
    }
];

const northPoleStar = {
    name: "Polaris",
    ra: 37.95,
    dec: 89.26
};

const southPoleStar = {
    name: "Sigma Octantis",
    ra: 21.08,
    dec: -88.96
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
    return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short"
    });
}

function formatClockTime(date) {
    return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short"
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

function normalizeDegrees180(degrees) {
    let angle = normalizeDegrees(degrees);
    if (angle > 180) {
        angle -= 360;
    }

    return angle;
}

function toJulianDate(date) {
    return date.getTime() / 86400000 + 2440587.5;
}

function toJulianCenturies(jd) {
    return (jd - 2451545) / 36525;
}

function getMeanObliquityRadians(jd) {
    const T = toJulianCenturies(jd);
    const arcSeconds = 84381.448 - 46.815 * T - 0.00059 * T * T + 0.001813 * T * T * T;
    return toRadians(arcSeconds / 3600);
}

function getGreenwichMeanSiderealTimeDegrees(jd) {
    const T = toJulianCenturies(jd);
    return normalizeDegrees(
        280.46061837
            + 360.98564736629 * (jd - 2451545)
            + 0.000387933 * T * T
            - (T * T * T) / 38710000
    );
}

function getAtmosphericRefractionDegrees(altitudeDegrees) {
    if (altitudeDegrees <= -1 || altitudeDegrees >= 90) {
        return 0;
    }

    const refractionArcMinutes = 1.02 / Math.tan(toRadians(altitudeDegrees + 10.3 / (altitudeDegrees + 5.11)));
    return refractionArcMinutes / 60;
}

function precessJ2000ToDate(raDegrees, decDegrees, jd) {
    const T = toJulianCenturies(jd);
    const zetaArcSeconds = 2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T;
    const zArcSeconds = 2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T;
    const thetaArcSeconds = 2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T;

    const zeta = toRadians(zetaArcSeconds / 3600);
    const z = toRadians(zArcSeconds / 3600);
    const theta = toRadians(thetaArcSeconds / 3600);

    const rightAscension = toRadians(raDegrees);
    const declination = toRadians(decDegrees);

    const A = Math.cos(declination) * Math.sin(rightAscension + zeta);
    const B = Math.cos(theta) * Math.cos(declination) * Math.cos(rightAscension + zeta)
        - Math.sin(theta) * Math.sin(declination);
    const C = Math.sin(theta) * Math.cos(declination) * Math.cos(rightAscension + zeta)
        + Math.cos(theta) * Math.sin(declination);

    return {
        rightAscensionDegrees: normalizeDegrees(toDegrees(Math.atan2(A, B) + z)),
        declinationDegrees: toDegrees(Math.asin(C))
    };
}

function solveEccentricAnomaly(meanAnomalyRadians, eccentricity) {
    let eccentricAnomaly = meanAnomalyRadians + eccentricity * Math.sin(meanAnomalyRadians) * (1 + eccentricity * Math.cos(meanAnomalyRadians));

    for (let i = 0; i < 5; i++) {
        const delta = (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomalyRadians) / (1 - eccentricity * Math.cos(eccentricAnomaly));
        eccentricAnomaly -= delta;
    }

    return eccentricAnomaly;
}

function getMeanAnomalyDegrees(elements, d) {
    return normalizeDegrees(elements.M0 + elements.M1 * d);
}

function applyOuterPlanetPerturbations(planetName, d, longitudeRadians, latitudeRadians) {
    let deltaLongitudeDegrees = 0;
    let deltaLatitudeDegrees = 0;

    const Mj = getMeanAnomalyDegrees(planetaryElements.Jupiter, d);
    const Ms = getMeanAnomalyDegrees(planetaryElements.Saturn, d);
    const Mu = getMeanAnomalyDegrees(planetaryElements.Uranus, d);

    if (planetName === "Jupiter") {
        deltaLongitudeDegrees += -0.332 * Math.sin(toRadians(2 * Mj - 5 * Ms - 67.6));
        deltaLongitudeDegrees += -0.056 * Math.sin(toRadians(2 * Mj - 2 * Ms + 21));
        deltaLongitudeDegrees += 0.042 * Math.sin(toRadians(3 * Mj - 5 * Ms + 21));
        deltaLongitudeDegrees += -0.036 * Math.sin(toRadians(Mj - 2 * Ms));
        deltaLongitudeDegrees += 0.022 * Math.cos(toRadians(Mj - Ms));
        deltaLongitudeDegrees += 0.023 * Math.sin(toRadians(2 * Mj - 3 * Ms + 52));
        deltaLongitudeDegrees += -0.016 * Math.sin(toRadians(Mj - 5 * Ms - 69));
    }

    if (planetName === "Saturn") {
        deltaLongitudeDegrees += 0.812 * Math.sin(toRadians(2 * Mj - 5 * Ms - 67.6));
        deltaLongitudeDegrees += -0.229 * Math.cos(toRadians(2 * Mj - 4 * Ms - 2));
        deltaLongitudeDegrees += 0.119 * Math.sin(toRadians(Mj - 2 * Ms - 3));
        deltaLongitudeDegrees += 0.046 * Math.sin(toRadians(2 * Mj - 6 * Ms - 69));
        deltaLongitudeDegrees += 0.014 * Math.sin(toRadians(Mj - 3 * Ms + 32));

        deltaLatitudeDegrees += -0.020 * Math.cos(toRadians(2 * Mj - 4 * Ms - 2));
        deltaLatitudeDegrees += 0.018 * Math.sin(toRadians(2 * Mj - 6 * Ms - 49));
    }

    if (planetName === "Uranus") {
        deltaLongitudeDegrees += 0.040 * Math.sin(toRadians(Ms - 2 * Mu + 6));
        deltaLongitudeDegrees += 0.035 * Math.sin(toRadians(Ms - 3 * Mu + 33));
        deltaLongitudeDegrees += -0.015 * Math.sin(toRadians(Mj - Mu + 20));
    }

    return {
        longitudeRadians: longitudeRadians + toRadians(deltaLongitudeDegrees),
        latitudeRadians: latitudeRadians + toRadians(deltaLatitudeDegrees)
    };
}

function getHeliocentricCoordinates(elements, d, planetName = null) {
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

    let xh = r * (Math.cos(N) * Math.cos(v + w) - Math.sin(N) * Math.sin(v + w) * Math.cos(i));
    let yh = r * (Math.sin(N) * Math.cos(v + w) + Math.cos(N) * Math.sin(v + w) * Math.cos(i));
    let zh = r * (Math.sin(v + w) * Math.sin(i));

    if (planetName != null) {
        const longitudeRadians = Math.atan2(yh, xh);
        const latitudeRadians = Math.atan2(zh, Math.sqrt(xh * xh + yh * yh));
        const perturbation = applyOuterPlanetPerturbations(planetName, d, longitudeRadians, latitudeRadians);

        xh = r * Math.cos(perturbation.longitudeRadians) * Math.cos(perturbation.latitudeRadians);
        yh = r * Math.sin(perturbation.longitudeRadians) * Math.cos(perturbation.latitudeRadians);
        zh = r * Math.sin(perturbation.latitudeRadians);
    }

    return { x: xh, y: yh, z: zh };
}

function getPlanetHorizontalCoordinates(planetName, date, latitude, longitude) {
    const jd = toJulianDate(date);
    const d = jd - 2451543.5;

    const earth = getHeliocentricCoordinates(earthElements, d, null);
    let lightTimeDays = 0;
    let xg = 0;
    let yg = 0;
    let zg = 0;

    // One refinement pass is enough for apparent planetary position accuracy in this UI.
    for (let i = 0; i < 2; i++) {
        const planet = getHeliocentricCoordinates(planetaryElements[planetName], d - lightTimeDays, planetName);
        xg = planet.x - earth.x;
        yg = planet.y - earth.y;
        zg = planet.z - earth.z;

        const geocentricDistanceAu = Math.sqrt(xg * xg + yg * yg + zg * zg);
        lightTimeDays = geocentricDistanceAu * astronomicalUnitLightTimeDays;
    }

    const obliquity = getMeanObliquityRadians(jd);

    const xeq = xg;
    const yeq = yg * Math.cos(obliquity) - zg * Math.sin(obliquity);
    const zeq = yg * Math.sin(obliquity) + zg * Math.cos(obliquity);

    const rightAscensionDegrees = normalizeDegrees(toDegrees(Math.atan2(yeq, xeq)));
    const declinationDegrees = toDegrees(Math.atan2(zeq, Math.sqrt(xeq * xeq + yeq * yeq)));

    return getHorizontalCoordinatesFromEquatorial(
        rightAscensionDegrees,
        declinationDegrees,
        date,
        latitude,
        longitude,
        { applyRefraction: true }
    );
}

function getMoonPhaseData(date) {
    const moonAgeDays = ((date.getTime() - knownNewMoonUtcMs) / 86400000) % synodicMonthDays;
    const normalizedAgeDays = moonAgeDays < 0 ? moonAgeDays + synodicMonthDays : moonAgeDays;
    const phase = normalizedAgeDays / synodicMonthDays;
    const illumination = 0.5 * (1 - Math.cos(2 * Math.PI * phase));

    let name = "New Moon";
    if (phase >= 0.03 && phase < 0.22) {
        name = "Waxing Crescent";
    } else if (phase >= 0.22 && phase < 0.28) {
        name = "First Quarter";
    } else if (phase >= 0.28 && phase < 0.47) {
        name = "Waxing Gibbous";
    } else if (phase >= 0.47 && phase < 0.53) {
        name = "Full Moon";
    } else if (phase >= 0.53 && phase < 0.72) {
        name = "Waning Gibbous";
    } else if (phase >= 0.72 && phase < 0.78) {
        name = "Last Quarter";
    } else if (phase >= 0.78 && phase < 0.97) {
        name = "Waning Crescent";
    }

    return {
        phase,
        illumination,
        age: normalizedAgeDays,
        name
    };
}

function drawMoonPhaseImage(targetCanvas, phase) {
    if (targetCanvas == null) {
        return;
    }

    const ctx = targetCanvas.getContext("2d");
    if (ctx == null) {
        return;
    }

    const width = targetCanvas.width;
    const height = targetCanvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.4;
    const radiusSquared = radius * radius;

    ctx.clearRect(0, 0, width, height);

    const background = ctx.createRadialGradient(cx, cy * 0.75, radius * 0.25, cx, cy, radius * 1.35);
    background.addColorStop(0, "hsl(218, 42%, 18%)");
    background.addColorStop(1, "hsl(228, 48%, 8%)");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    // Render the visible lunar disk using a phase-angle lighting model.
    const diskLeft = Math.max(0, Math.floor(cx - radius));
    const diskTop = Math.max(0, Math.floor(cy - radius));
    const diskWidth = Math.min(width - diskLeft, Math.ceil(radius * 2));
    const diskHeight = Math.min(height - diskTop, Math.ceil(radius * 2));
    const moonPixels = ctx.createImageData(diskWidth, diskHeight);

    const phaseAngle = 2 * Math.PI * phase;
    const sunX = Math.sin(phaseAngle);
    const sunZ = -Math.cos(phaseAngle);

    const litColor = { r: 252, g: 244, b: 210 };
    const darkColor = { r: 20, g: 26, b: 50 };

    for (let py = 0; py < diskHeight; py++) {
        for (let px = 0; px < diskWidth; px++) {
            const canvasX = diskLeft + px + 0.5;
            const canvasY = diskTop + py + 0.5;
            const dx = canvasX - cx;
            const dy = canvasY - cy;
            const distanceSquared = dx * dx + dy * dy;

            if (distanceSquared > radiusSquared) {
                continue;
            }

            const nx = dx / radius;
            const ny = dy / radius;
            const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
            const lightDot = nx * sunX + nz * sunZ;

            const litMix = Math.pow(Math.max(0, lightDot), 0.82);
            const shading = 0.86 + 0.20 * nz;
            const limbHighlight = Math.pow(Math.max(0, lightDot), 3) * (1 - nz) * 0.22;

            const r = (darkColor.r + (litColor.r - darkColor.r) * litMix) * (shading + limbHighlight);
            const g = (darkColor.g + (litColor.g - darkColor.g) * litMix) * (shading + limbHighlight);
            const b = (darkColor.b + (litColor.b - darkColor.b) * litMix) * (shading + limbHighlight);

            const alphaEdge = Math.max(0, Math.min(1, (radius - Math.sqrt(distanceSquared)) / 1.15));
            const alpha = Math.round((0.2 + 0.8 * alphaEdge) * 255);

            const pixelIndex = (py * diskWidth + px) * 4;
            moonPixels.data[pixelIndex] = Math.max(0, Math.min(255, Math.round(r)));
            moonPixels.data[pixelIndex + 1] = Math.max(0, Math.min(255, Math.round(g)));
            moonPixels.data[pixelIndex + 2] = Math.max(0, Math.min(255, Math.round(b)));
            moonPixels.data[pixelIndex + 3] = alpha;
        }
    }

    ctx.putImageData(moonPixels, diskLeft, diskTop);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "hsla(44, 84%, 91%, 0.72)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

function getHorizontalCoordinatesFromEquatorial(raDegrees, decDegrees, date, latitude, longitude, options = {}) {
    const { applyRefraction = true, precessFromJ2000 = false } = options;
    const jd = toJulianDate(date);

    let workingRaDegrees = raDegrees;
    let workingDecDegrees = decDegrees;

    if (precessFromJ2000) {
        const precessed = precessJ2000ToDate(raDegrees, decDegrees, jd);
        workingRaDegrees = precessed.rightAscensionDegrees;
        workingDecDegrees = precessed.declinationDegrees;
    }

    const gmst = getGreenwichMeanSiderealTimeDegrees(jd);
    const lst = normalizeDegrees(gmst + longitude);
    const hourAngle = toRadians(normalizeDegrees180(lst - workingRaDegrees));

    const latitudeRadians = toRadians(latitude);
    const declination = toRadians(workingDecDegrees);

    const altitude = Math.asin(
        Math.sin(declination) * Math.sin(latitudeRadians)
            + Math.cos(declination) * Math.cos(latitudeRadians) * Math.cos(hourAngle)
    );

    const azimuth = Math.atan2(
        Math.sin(hourAngle),
        Math.cos(hourAngle) * Math.sin(latitudeRadians) - Math.tan(declination) * Math.cos(latitudeRadians)
    );

    let altitudeDegrees = toDegrees(altitude);
    if (applyRefraction) {
        altitudeDegrees += getAtmosphericRefractionDegrees(altitudeDegrees);
    }

    return {
        altitudeDegrees,
        azimuthDegrees: normalizeDegrees(toDegrees(azimuth) + 180)
    };
}

function projectToSky(azimuthDegrees, altitudeDegrees, cx, cy, radius) {
    const radialDistance = (90 - altitudeDegrees) / 90 * radius;
    const azimuthRadians = toRadians(azimuthDegrees);

    return {
        x: cx + radialDistance * Math.sin(azimuthRadians),
        y: cy - radialDistance * Math.cos(azimuthRadians)
    };
}

function getSkyLabelScale(targetCanvas) {
    if (targetCanvas == null) {
        return 1;
    }

    return targetCanvas.width >= 1000 ? 2.15 : 1;
}

function intersectsLabelBox(labelBox, occupiedLabelBoxes) {
    return occupiedLabelBoxes.some(box => {
        return !(
            labelBox.x + labelBox.width < box.x
            || labelBox.x > box.x + box.width
            || labelBox.y + labelBox.height < box.y
            || labelBox.y > box.y + box.height
        );
    });
}

function getLabelBoxOverlapArea(labelBox, occupiedLabelBoxes) {
    let totalOverlapArea = 0;

    for (const box of occupiedLabelBoxes) {
        const overlapWidth = Math.max(0, Math.min(labelBox.x + labelBox.width, box.x + box.width) - Math.max(labelBox.x, box.x));
        const overlapHeight = Math.max(0, Math.min(labelBox.y + labelBox.height, box.y + box.height) - Math.max(labelBox.y, box.y));
        totalOverlapArea += overlapWidth * overlapHeight;
    }

    return totalOverlapArea;
}

function reserveSkyMarkerSpace(occupiedLabelBoxes, anchorX, anchorY, radius = 18) {
    occupiedLabelBoxes.push({
        x: anchorX - radius,
        y: anchorY - radius,
        width: radius * 2,
        height: radius * 2
    });
}

function drawSkyLabel(ctx, text, anchorX, anchorY, occupiedLabelBoxes, options = {}) {
    const {
        fontSize = 12,
        fillStyle = "hsla(0, 0%, 100%, 0.92)",
        textAlign = "left",
        shadowColor = "hsla(218, 44%, 8%, 0.88)",
        shadowBlur = 8,
        preferBelow = false
    } = options;

    ctx.save();
    ctx.font = `${fontSize}px Outfit, sans-serif`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = "middle";

    const textMetrics = ctx.measureText(text);
    const textWidth = textMetrics.width;
    const boxHeight = Math.round(fontSize * 1.2);
    const padding = 4;
    const candidateOffsets = preferBelow
        ? [[10, 14], [10, -14], [14, 0], [-textWidth - 14, 0], [12, 28], [12, -28], [24, 14], [-textWidth - 24, 14], [24, -14], [-textWidth - 24, -14], [0, 30], [0, -30]]
        : [[10, -12], [10, 14], [14, 0], [-textWidth - 14, 0], [12, -28], [12, 28], [24, -14], [-textWidth - 24, -14], [24, 14], [-textWidth - 24, 14], [0, -30], [0, 30]];

    let chosenPosition = null;
    let bestFallbackPosition = null;
    let lowestOverlapArea = Number.POSITIVE_INFINITY;

    for (const [offsetX, offsetY] of candidateOffsets) {
        let drawX = anchorX + offsetX;
        if (textAlign === "center") {
            drawX = anchorX + offsetX;
        }

        const drawY = anchorY + offsetY;
        const boxX = textAlign === "center" ? drawX - textWidth / 2 - padding : drawX - padding;
        const boxY = drawY - boxHeight / 2 - padding;
        const labelBox = {
            x: boxX,
            y: boxY,
            width: textWidth + padding * 2,
            height: boxHeight + padding * 2
        };

        if (!intersectsLabelBox(labelBox, occupiedLabelBoxes)) {
            chosenPosition = { drawX, drawY, labelBox };
            break;
        }

        const overlapArea = getLabelBoxOverlapArea(labelBox, occupiedLabelBoxes);
        if (overlapArea < lowestOverlapArea) {
            lowestOverlapArea = overlapArea;
            bestFallbackPosition = { drawX, drawY, labelBox };
        }
    }

    if (chosenPosition == null) {
        chosenPosition = bestFallbackPosition || {
            drawX: textAlign === "center" ? anchorX : anchorX + 10,
            drawY: anchorY + (preferBelow ? 14 : -12),
            labelBox: {
                x: (textAlign === "center" ? anchorX - textWidth / 2 : anchorX + 10) - padding,
                y: anchorY + (preferBelow ? 14 : -12) - boxHeight / 2 - padding,
                width: textWidth + padding * 2,
                height: boxHeight + padding * 2
            }
        };
    }

    occupiedLabelBoxes.push(chosenPosition.labelBox);
    ctx.fillStyle = fillStyle;
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = shadowBlur;
    ctx.fillText(text, chosenPosition.drawX, chosenPosition.drawY);
    ctx.restore();
}

function getMoonEquatorialCoordinates(date) {
    const jd = toJulianDate(date);
    const d = jd - 2451543.5;

    const N = normalizeDegrees(125.1228 - 0.0529538083 * d);
    const i = 5.1454;
    const w = normalizeDegrees(318.0634 + 0.1643573223 * d);
    const a = 60.2666;
    const e = 0.0549;
    const M = normalizeDegrees(115.3654 + 13.0649929509 * d);

    const Ms = getMeanAnomalyDegrees(earthElements, d);
    const ws = normalizeDegrees(earthElements.w0 + earthElements.w1 * d);
    const Ls = normalizeDegrees(Ms + ws);
    const Lm = normalizeDegrees(M + w + N);
    const D = normalizeDegrees(Lm - Ls);
    const F = normalizeDegrees(Lm - N);

    const E = solveEccentricAnomaly(toRadians(M), e);
    const xv = a * (Math.cos(E) - e);
    const yv = a * (Math.sqrt(1 - e * e) * Math.sin(E));

    const v = Math.atan2(yv, xv);
    const r = Math.sqrt(xv * xv + yv * yv);

    const Nrad = toRadians(N);
    const irad = toRadians(i);
    const wrad = toRadians(w);

    const xh = r * (Math.cos(Nrad) * Math.cos(v + wrad) - Math.sin(Nrad) * Math.sin(v + wrad) * Math.cos(irad));
    const yh = r * (Math.sin(Nrad) * Math.cos(v + wrad) + Math.cos(Nrad) * Math.sin(v + wrad) * Math.cos(irad));
    const zh = r * Math.sin(v + wrad) * Math.sin(irad);

    let eclipticLongitudeDegrees = normalizeDegrees(toDegrees(Math.atan2(yh, xh)));
    let eclipticLatitudeDegrees = toDegrees(Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)));

    eclipticLongitudeDegrees += -1.274 * Math.sin(toRadians(M - 2 * D));
    eclipticLongitudeDegrees += 0.658 * Math.sin(toRadians(2 * D));
    eclipticLongitudeDegrees += -0.186 * Math.sin(toRadians(Ms));
    eclipticLongitudeDegrees += -0.059 * Math.sin(toRadians(2 * M - 2 * D));
    eclipticLongitudeDegrees += -0.057 * Math.sin(toRadians(M - 2 * D + Ms));
    eclipticLongitudeDegrees += 0.053 * Math.sin(toRadians(M + 2 * D));
    eclipticLongitudeDegrees += 0.046 * Math.sin(toRadians(2 * D - Ms));
    eclipticLongitudeDegrees += 0.041 * Math.sin(toRadians(M - Ms));
    eclipticLongitudeDegrees += -0.035 * Math.sin(toRadians(D));
    eclipticLongitudeDegrees += -0.031 * Math.sin(toRadians(M + Ms));
    eclipticLongitudeDegrees += -0.015 * Math.sin(toRadians(2 * F - 2 * D));
    eclipticLongitudeDegrees += 0.011 * Math.sin(toRadians(M - 4 * D));

    eclipticLatitudeDegrees += -0.173 * Math.sin(toRadians(F - 2 * D));
    eclipticLatitudeDegrees += -0.055 * Math.sin(toRadians(M - F - 2 * D));
    eclipticLatitudeDegrees += -0.046 * Math.sin(toRadians(M + F - 2 * D));
    eclipticLatitudeDegrees += 0.033 * Math.sin(toRadians(F + 2 * D));
    eclipticLatitudeDegrees += 0.017 * Math.sin(toRadians(2 * M + F));

    const distanceEarthRadii = r
        - 0.58 * Math.cos(toRadians(M - 2 * D))
        - 0.46 * Math.cos(toRadians(2 * D));

    const eclipticLongitude = toRadians(normalizeDegrees(eclipticLongitudeDegrees));
    const eclipticLatitude = toRadians(eclipticLatitudeDegrees);

    const correctedXh = distanceEarthRadii * Math.cos(eclipticLongitude) * Math.cos(eclipticLatitude);
    const correctedYh = distanceEarthRadii * Math.sin(eclipticLongitude) * Math.cos(eclipticLatitude);
    const correctedZh = distanceEarthRadii * Math.sin(eclipticLatitude);

    const obliquity = getMeanObliquityRadians(jd);
    const xeq = correctedXh;
    const yeq = correctedYh * Math.cos(obliquity) - correctedZh * Math.sin(obliquity);
    const zeq = correctedYh * Math.sin(obliquity) + correctedZh * Math.cos(obliquity);

    const rightAscension = normalizeDegrees(toDegrees(Math.atan2(yeq, xeq)));
    const declination = toDegrees(Math.atan2(zeq, Math.sqrt(xeq * xeq + yeq * yeq)));

    return {
        rightAscension,
        declination,
        distanceEarthRadii
    };
}

function getMoonHorizontalCoordinates(date, latitude, longitude) {
    const equatorial = getMoonEquatorialCoordinates(date);
    const geocentricHorizontal = getHorizontalCoordinatesFromEquatorial(
        equatorial.rightAscension,
        equatorial.declination,
        date,
        latitude,
        longitude,
        { applyRefraction: false }
    );

    const parallaxRadians = Math.asin(Math.min(1, 1 / equatorial.distanceEarthRadii));
    const geocentricAltitudeRadians = toRadians(geocentricHorizontal.altitudeDegrees);
    const parallaxAdjustment = Math.asin(
        Math.max(-1, Math.min(1, Math.cos(geocentricAltitudeRadians) * Math.sin(parallaxRadians)))
    );

    let topocentricAltitudeDegrees = geocentricHorizontal.altitudeDegrees - toDegrees(parallaxAdjustment);
    topocentricAltitudeDegrees += getAtmosphericRefractionDegrees(topocentricAltitudeDegrees);

    return {
        altitudeDegrees: topocentricAltitudeDegrees,
        azimuthDegrees: geocentricHorizontal.azimuthDegrees
    };
}

function drawMoonPath(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes = []) {
    if (skyContext == null) {
        return;
    }

    const { date, latitude, longitude, windowStart, windowEnd } = skyContext;
    const start = windowStart == null ? new Date(date.getTime() - 45 * 60 * 1000) : windowStart;
    const end = windowEnd == null ? new Date(date.getTime() + 45 * 60 * 1000) : windowEnd;
    const sampleStepMs = 20 * 60 * 1000;
    const samples = [];
    const labelScale = getSkyLabelScale(ctx.canvas);

    for (let t = start.getTime(); t <= end.getTime(); t += sampleStepMs) {
        const sampleDate = new Date(t);
        const horizontal = getMoonHorizontalCoordinates(sampleDate, latitude, longitude);
        if (horizontal.altitudeDegrees >= 0) {
            samples.push(horizontal);
        }
    }

    if (samples.length > 1) {
        ctx.beginPath();
        samples.forEach((sample, index) => {
            const point = projectToSky(sample.azimuthDegrees, sample.altitudeDegrees, cx, cy, radius);
            if (index === 0) {
                ctx.moveTo(point.x, point.y);
            } else {
                ctx.lineTo(point.x, point.y);
            }
        });
        ctx.strokeStyle = "#f1f6ff";
        ctx.lineWidth = 1.8;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();

        const labelSample = samples[Math.floor(samples.length / 2)];
        const labelPoint = projectToSky(labelSample.azimuthDegrees, labelSample.altitudeDegrees, cx, cy, radius);
        drawSkyLabel(ctx, "Moon path", labelPoint.x, labelPoint.y, occupiedLabelBoxes, {
            fontSize: Math.round(11 * labelScale),
            fillStyle: "#f1f6ff"
        });
    }

    const moonNow = getMoonHorizontalCoordinates(date, latitude, longitude);
    if (moonNow.altitudeDegrees < 0) {
        return;
    }

    const moonNowPoint = projectToSky(moonNow.azimuthDegrees, moonNow.altitudeDegrees, cx, cy, radius);
    reserveSkyMarkerSpace(occupiedLabelBoxes, moonNowPoint.x, moonNowPoint.y);
    ctx.beginPath();
    ctx.arc(moonNowPoint.x, moonNowPoint.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#f7fbff";
    ctx.fill();
    ctx.strokeStyle = "hsla(218, 36%, 14%, 0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();

    drawSkyLabel(ctx, "Moon", moonNowPoint.x, moonNowPoint.y, occupiedLabelBoxes, {
        fontSize: Math.round(12 * labelScale),
        fillStyle: "#f7fbff",
        preferBelow: true
    });
}

function drawConstellationOverlay(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes = []) {
    if (skyContext == null) {
        return;
    }

    const { date, latitude, longitude } = skyContext;
    const labelScale = getSkyLabelScale(ctx.canvas);
    ctx.strokeStyle = "hsla(201, 78%, 84%, 0.52)";
    ctx.fillStyle = "hsla(204, 88%, 90%, 0.94)";
    ctx.lineWidth = labelScale > 1 ? 1.6 : 1.25;
    ctx.shadowColor = "hsla(210, 88%, 78%, 0.16)";
    ctx.shadowBlur = labelScale > 1 ? 8 : 4;

    for (const constellation of constellations) {
        const projectedStars = {};

        for (const [starName, coordinates] of Object.entries(constellation.stars)) {
            const horizontal = getHorizontalCoordinatesFromEquatorial(
                coordinates.ra,
                coordinates.dec,
                date,
                latitude,
                longitude,
                { precessFromJ2000: true }
            );

            if (horizontal.altitudeDegrees < 0) {
                continue;
            }

            projectedStars[starName] = projectToSky(
                horizontal.azimuthDegrees,
                horizontal.altitudeDegrees,
                cx,
                cy,
                radius
            );
        }

        for (const [fromStar, toStar] of constellation.lines) {
            const from = projectedStars[fromStar];
            const to = projectedStars[toStar];
            if (from == null || to == null) {
                continue;
            }

            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
        }

        const labelAnchor = projectedStars[Object.keys(projectedStars)[0]];
        if (labelAnchor != null) {
            drawSkyLabel(ctx, constellation.name, labelAnchor.x, labelAnchor.y, occupiedLabelBoxes, {
                fontSize: Math.round(11 * labelScale),
                fillStyle: "hsla(204, 88%, 90%, 0.94)",
                preferBelow: true
            });
        }
    }

    ctx.shadowBlur = 0;
}

function drawPolarisOverlay(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes = []) {
    if (skyContext == null) {
        return;
    }

    const { date, latitude, longitude } = skyContext;
    const labelScale = getSkyLabelScale(ctx.canvas);
    const poleStarCandidates = [];

    if (latitude >= -5) {
        poleStarCandidates.push(northPoleStar);
    }

    if (latitude <= 5) {
        poleStarCandidates.push(southPoleStar);
    }

    for (const poleStar of poleStarCandidates) {
        const horizontal = getHorizontalCoordinatesFromEquatorial(
            poleStar.ra,
            poleStar.dec,
            date,
            latitude,
            longitude,
            { precessFromJ2000: true }
        );

        if (horizontal.altitudeDegrees < 0) {
            continue;
        }

        const point = projectToSky(horizontal.azimuthDegrees, horizontal.altitudeDegrees, cx, cy, radius);
        reserveSkyMarkerSpace(occupiedLabelBoxes, point.x, point.y);
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "hsl(50, 100%, 82%)";
        ctx.fill();
        ctx.strokeStyle = "hsla(220, 45%, 12%, 0.9)";
        ctx.lineWidth = 1;
        ctx.stroke();

        drawSkyLabel(ctx, poleStar.name, point.x, point.y, occupiedLabelBoxes, {
            fontSize: Math.round(12 * labelScale),
            fillStyle: "hsla(53, 100%, 88%, 0.96)"
        });
    }
}

function drawSkyDiagram(targetCanvas, visiblePlanets, skyContext = null) {
    if (targetCanvas == null) {
        return;
    }

    const ctx = targetCanvas.getContext("2d");
    if (ctx == null) {
        return;
    }

    const width = targetCanvas.width;
    const height = targetCanvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.39;
    const labelScale = getSkyLabelScale(targetCanvas);
    const occupiedLabelBoxes = [];

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
    ctx.font = `${Math.round(12 * labelScale)}px Outfit, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("N", cx, cy - radius - 7);
    ctx.fillText("S", cx, cy + radius + 16);
    ctx.fillText("E", cx + radius + 10, cy + 4);
    ctx.fillText("W", cx - radius - 10, cy + 4);

    drawConstellationOverlay(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes);
    drawPolarisOverlay(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes);
    drawMoonPath(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes);
    if (visiblePlanets.length === 0) {
        ctx.fillStyle = "hsla(210, 26%, 88%, 0.86)";
        ctx.font = `${Math.round(13 * labelScale)}px Outfit, sans-serif`;
        ctx.fillText("No visible planets", cx, cy + 4);
        return;
    }

    ctx.textAlign = "left";
    for (const planet of visiblePlanets) {
        if (planet.displayAltitude < 0) {
            continue;
        }

        const planetPoint = projectToSky(planet.displayAzimuth, planet.displayAltitude, cx, cy, radius);
        const x = planetPoint.x;
        const y = planetPoint.y;
        reserveSkyMarkerSpace(occupiedLabelBoxes, x, y);

        ctx.beginPath();
        ctx.arc(x, y, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = planetColors[planet.planetName] || "#ffffff";
        ctx.fill();
        ctx.strokeStyle = "hsla(216, 38%, 16%, 0.8)";
        ctx.lineWidth = 1;
        ctx.stroke();

        drawSkyLabel(ctx, planet.planetName, x, y, occupiedLabelBoxes, {
            fontSize: Math.round(12 * labelScale),
            fillStyle: "hsla(0, 0%, 100%, 0.92)"
        });
    }
}

function renderVisiblePlanets(latitude, longitude) {
    const skySampleDate = new Date();
    const pathWindowStart = new Date(skySampleDate.getTime() - 90 * 60 * 1000);
    const pathWindowEnd = new Date(skySampleDate.getTime() + 90 * 60 * 1000);
    planetWindowElement.innerText = `Snapshot: ${formatLocalTime(skySampleDate.toISOString())}`;

    const visiblePlanets = [];

    for (const planetName of Object.keys(planetaryElements)) {
        const displayCoordinates = getPlanetHorizontalCoordinates(planetName, skySampleDate, latitude, longitude);

        if (displayCoordinates.altitudeDegrees >= 0) {
            visiblePlanets.push({
                planetName,
                displayAltitude: displayCoordinates.altitudeDegrees,
                displayAzimuth: displayCoordinates.azimuthDegrees
            });
        }
    }

    planetListElement.innerHTML = "";

    latestVisiblePlanets = visiblePlanets;
    latestSkyContext = {
        date: skySampleDate,
        latitude,
        longitude,
        windowStart: pathWindowStart,
        windowEnd: pathWindowEnd
    };

    if (visiblePlanets.length === 0) {
        const item = document.createElement("li");
        item.innerText = "No major planets are currently above the horizon.";
        planetListElement.appendChild(item);
        drawSkyDiagram(skyCanvas, [], latestSkyContext);

        if (skyFullscreenElement != null && !skyFullscreenElement.hidden) {
            drawSkyDiagram(skyFullscreenCanvas, [], latestSkyContext);
        }

        return;
    }

    visiblePlanets.sort((a, b) => b.displayAltitude - a.displayAltitude);

    for (const planet of visiblePlanets) {
        const item = document.createElement("li");
        item.innerText = `${planet.planetName}: ${planet.displayAltitude.toFixed(0)} degrees above horizon now`;
        planetListElement.appendChild(item);
    }

    drawSkyDiagram(skyCanvas, visiblePlanets, latestSkyContext);

    if (skyFullscreenElement != null && !skyFullscreenElement.hidden) {
        drawSkyDiagram(skyFullscreenCanvas, visiblePlanets, latestSkyContext);
    }
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
        renderVisiblePlanets(lat, lon);
        sunStatus.innerText = `Updated ${formatLocalTime(new Date().toISOString())}`;
    } catch (error) {
        planetWindowElement.innerText = "Window: --";
        planetListElement.innerHTML = "<li>Planet visibility unavailable.</li>";
        latestVisiblePlanets = [];
        latestSkyContext = null;
        drawSkyDiagram(skyCanvas, []);

        if (skyFullscreenElement != null && !skyFullscreenElement.hidden) {
            drawSkyDiagram(skyFullscreenCanvas, []);
        }

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

function applyFullscreenSkyTransform() {
    if (skyFullscreenCanvas == null) {
        return;
    }

    skyFullscreenCanvas.style.transform = `translate(${fullscreenSkyViewState.translateX}px, ${fullscreenSkyViewState.translateY}px) scale(${fullscreenSkyViewState.scale})`;
}

function resetFullscreenSkyTransform() {
    fullscreenSkyViewState.scale = 1;
    fullscreenSkyViewState.translateX = 0;
    fullscreenSkyViewState.translateY = 0;
    fullscreenSkyViewState.pointers.clear();
    fullscreenSkyViewState.isDragging = false;
    fullscreenSkyViewState.pinchStartDistance = 0;
    applyFullscreenSkyTransform();

    if (skyFullscreenStageElement != null) {
        skyFullscreenStageElement.classList.remove("dragging");
    }
}

function requestSkyFullscreen() {
    if (skyFullscreenElement == null || typeof skyFullscreenElement.requestFullscreen !== "function") {
        return;
    }

    skyFullscreenElement.requestFullscreen().catch(() => {
        // Overlay still works if Fullscreen API is unavailable.
    });
}

function openSkyFullscreen() {
    if (skyFullscreenElement == null || skyFullscreenCanvas == null) {
        return;
    }

    skyFullscreenElement.hidden = false;
    drawSkyDiagram(skyFullscreenCanvas, latestVisiblePlanets, latestSkyContext);
    resetFullscreenSkyTransform();
    requestSkyFullscreen();
}

function closeSkyFullscreen() {
    if (skyFullscreenElement == null) {
        return;
    }

    skyFullscreenElement.hidden = true;
    resetFullscreenSkyTransform();

    if (document.fullscreenElement != null) {
        document.exitFullscreen().catch(() => {
            // Ignore fullscreen exit failures.
        });
    }
}

function getPointerDistance(pointerA, pointerB) {
    const dx = pointerA.x - pointerB.x;
    const dy = pointerA.y - pointerB.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function clampScale(scale) {
    return Math.min(fullscreenSkyViewState.maxScale, Math.max(fullscreenSkyViewState.minScale, scale));
}

function initializeFullscreenSkyInteractions() {
    if (skyCanvas != null) {
        skyCanvas.addEventListener("click", openSkyFullscreen);
    }

    if (skyCloseButton != null) {
        skyCloseButton.addEventListener("click", closeSkyFullscreen);
    }

    if (skyFullscreenElement != null) {
        skyFullscreenElement.addEventListener("click", event => {
            if (event.target === skyFullscreenElement) {
                closeSkyFullscreen();
            }
        });
    }

    if (skyFullscreenStageElement == null) {
        return;
    }

    skyFullscreenStageElement.addEventListener("wheel", event => {
        event.preventDefault();
        const zoomFactor = event.deltaY < 0 ? 1.12 : 0.9;
        fullscreenSkyViewState.scale = clampScale(fullscreenSkyViewState.scale * zoomFactor);
        applyFullscreenSkyTransform();
    }, { passive: false });

    skyFullscreenStageElement.addEventListener("pointerdown", event => {
        skyFullscreenStageElement.setPointerCapture(event.pointerId);
        fullscreenSkyViewState.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (fullscreenSkyViewState.pointers.size === 1) {
            fullscreenSkyViewState.isDragging = true;
            fullscreenSkyViewState.lastX = event.clientX;
            fullscreenSkyViewState.lastY = event.clientY;
            skyFullscreenStageElement.classList.add("dragging");
        } else if (fullscreenSkyViewState.pointers.size === 2) {
            const pointerValues = Array.from(fullscreenSkyViewState.pointers.values());
            fullscreenSkyViewState.pinchStartDistance = getPointerDistance(pointerValues[0], pointerValues[1]);
            fullscreenSkyViewState.pinchStartScale = fullscreenSkyViewState.scale;
            fullscreenSkyViewState.isDragging = false;
            skyFullscreenStageElement.classList.remove("dragging");
        }
    });

    skyFullscreenStageElement.addEventListener("pointermove", event => {
        if (!fullscreenSkyViewState.pointers.has(event.pointerId)) {
            return;
        }

        fullscreenSkyViewState.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (fullscreenSkyViewState.pointers.size === 2) {
            const pointerValues = Array.from(fullscreenSkyViewState.pointers.values());
            const distance = getPointerDistance(pointerValues[0], pointerValues[1]);

            if (fullscreenSkyViewState.pinchStartDistance > 0) {
                const nextScale = fullscreenSkyViewState.pinchStartScale * (distance / fullscreenSkyViewState.pinchStartDistance);
                fullscreenSkyViewState.scale = clampScale(nextScale);
                applyFullscreenSkyTransform();
            }
            return;
        }

        if (!fullscreenSkyViewState.isDragging) {
            return;
        }

        const dx = event.clientX - fullscreenSkyViewState.lastX;
        const dy = event.clientY - fullscreenSkyViewState.lastY;
        fullscreenSkyViewState.lastX = event.clientX;
        fullscreenSkyViewState.lastY = event.clientY;

        fullscreenSkyViewState.translateX += dx;
        fullscreenSkyViewState.translateY += dy;
        applyFullscreenSkyTransform();
    });

    const releasePointer = event => {
        fullscreenSkyViewState.pointers.delete(event.pointerId);

        if (fullscreenSkyViewState.pointers.size <= 1) {
            fullscreenSkyViewState.pinchStartDistance = 0;
            fullscreenSkyViewState.pinchStartScale = fullscreenSkyViewState.scale;
        }

        if (fullscreenSkyViewState.pointers.size === 0) {
            fullscreenSkyViewState.isDragging = false;
            skyFullscreenStageElement.classList.remove("dragging");
        }
    };

    skyFullscreenStageElement.addEventListener("pointerup", releasePointer);
    skyFullscreenStageElement.addEventListener("pointercancel", releasePointer);
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
        setCityPickerValue("custom");
        locationReadout.innerText = `Manual coordinates: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        await updateSunTimes(lat, lon);
    } catch (error) {
        sunStatus.innerText = "Enter valid latitude and longitude values.";
    }
}

function findCityPickerOption(value) {
    return cityPickerOptions.find(option => option.dataset.cityValue === value) || null;
}

function getCurrentCityPickerValue() {
    return cityPickerButton?.dataset.value || "custom";
}

function setCityPickerValue(value) {
    if (cityPickerButton == null || cityPickerButtonLabel == null) {
        return;
    }

    const targetOption = findCityPickerOption(value) || findCityPickerOption("custom");
    if (targetOption == null) {
        return;
    }

    cityPickerButton.dataset.value = targetOption.dataset.cityValue || "custom";
    cityPickerButtonLabel.innerText = targetOption.innerText;

    for (const option of cityPickerOptions) {
        option.setAttribute("aria-selected", option === targetOption ? "true" : "false");
        option.tabIndex = option === targetOption ? 0 : -1;
    }
}

function closeCityPicker({ restoreFocus = false } = {}) {
    if (cityPickerPopover == null || cityPickerButton == null) {
        return;
    }

    cityPickerPopover.hidden = true;
    cityPickerButton.setAttribute("aria-expanded", "false");

    if (restoreFocus) {
        cityPickerButton.focus();
    }
}

function openCityPicker({ focusSelected = false } = {}) {
    if (cityPickerPopover == null || cityPickerButton == null) {
        return;
    }

    cityPickerPopover.hidden = false;
    cityPickerButton.setAttribute("aria-expanded", "true");

    if (focusSelected) {
        const selectedOption = findCityPickerOption(getCurrentCityPickerValue()) || cityPickerOptions[0];
        selectedOption?.focus();
    }
}

function moveCityPickerFocus(direction) {
    if (cityPickerOptions.length === 0) {
        return;
    }

    const activeElement = document.activeElement;
    const currentIndex = cityPickerOptions.indexOf(activeElement);
    const selectedIndex = cityPickerOptions.findIndex(option => option.dataset.cityValue === getCurrentCityPickerValue());
    const baseIndex = currentIndex >= 0 ? currentIndex : Math.max(selectedIndex, 0);
    const nextIndex = (baseIndex + direction + cityPickerOptions.length) % cityPickerOptions.length;

    cityPickerOptions[nextIndex].focus();
}

async function handleCityPickerSelection(value) {
    setCityPickerValue(value);
    closeCityPicker();

    if (value === "custom") {
        locationReadout.innerText = "Using manual coordinates";
        cityPickerButton?.focus();
        return;
    }

    if (value === "current-location") {
        await requestCurrentLocation({
            showFailureMessage: true,
            showRequestMessage: true
        });
        cityPickerButton?.focus();
        return;
    }

    await applyCityPreset(value);
    cityPickerButton?.focus();
}

async function applyCityPreset(presetKey) {
    const preset = cityPresets[presetKey];
    if (preset == null) {
        return;
    }

    setCityPickerValue(presetKey);
    latitudeInput.value = preset.lat.toFixed(4);
    longitudeInput.value = preset.lon.toFixed(4);
    locationReadout.innerText = `Preset location: ${preset.label} (${preset.lat.toFixed(4)}, ${preset.lon.toFixed(4)})`;
    await updateSunTimes(preset.lat, preset.lon);
}

function initializeCityPicker() {
    if (cityPicker == null || cityPickerButton == null || cityPickerPopover == null || cityPickerListbox == null) {
        return;
    }

    setCityPickerValue(getCurrentCityPickerValue());

    cityPickerButton.addEventListener("click", () => {
        const isOpen = cityPickerButton.getAttribute("aria-expanded") === "true";
        if (isOpen) {
            closeCityPicker();
        } else {
            openCityPicker();
        }
    });

    cityPickerButton.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openCityPicker({ focusSelected: true });
            if (event.key === "ArrowUp") {
                moveCityPickerFocus(-1);
            }
        }
    });

    cityPickerListbox.addEventListener("keydown", async event => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            moveCityPickerFocus(1);
            return;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            moveCityPickerFocus(-1);
            return;
        }

        if (event.key === "Home") {
            event.preventDefault();
            cityPickerOptions[0]?.focus();
            return;
        }

        if (event.key === "End") {
            event.preventDefault();
            cityPickerOptions[cityPickerOptions.length - 1]?.focus();
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            closeCityPicker({ restoreFocus: true });
            return;
        }

        if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLElement) {
            event.preventDefault();
            const selectedValue = event.target.dataset.cityValue;
            if (selectedValue != null) {
                await handleCityPickerSelection(selectedValue);
            }
        }
    });

    for (const option of cityPickerOptions) {
        option.addEventListener("click", async () => {
            const value = option.dataset.cityValue;
            if (value != null) {
                await handleCityPickerSelection(value);
            }
        });
    }

    document.addEventListener("click", event => {
        if (!(event.target instanceof Node)) {
            return;
        }

        if (!cityPicker.contains(event.target)) {
            closeCityPicker();
        }
    });

    const setCustomPickerState = () => {
        if (getCurrentCityPickerValue() !== "custom") {
            setCityPickerValue("custom");
        }
    };

    latitudeInput.addEventListener("input", setCustomPickerState);
    longitudeInput.addEventListener("input", setCustomPickerState);
}

function initializeLocationButton() {
    const setLocationButtonBusyState = isBusy => {
        locationButton.disabled = isBusy;
        locationButton.innerText = isBusy ? "Locating..." : "Use My Location";
    };

    const tryCurrentLocation = async ({ showFailureMessage = true, showRequestMessage = false } = {}) => {
        if (!("geolocation" in navigator)) {
            if (showFailureMessage) {
                sunStatus.innerText = "Geolocation is not available in this browser.";
            }
            return false;
        }

        if (isLocationRequestInProgress) {
            return false;
        }

        isLocationRequestInProgress = true;
        if (showRequestMessage) {
            sunStatus.innerText = "Requesting current location...";
        }

        return new Promise(resolve => {
            navigator.geolocation.getCurrentPosition(
                async position => {
                    const lat = position.coords.latitude;
                    const lon = position.coords.longitude;

                    latitudeInput.value = lat.toFixed(4);
                    longitudeInput.value = lon.toFixed(4);
                    setCityPickerValue("current-location");
                    locationReadout.innerText = `Current location: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;

                    await updateSunTimes(lat, lon);
                    isLocationRequestInProgress = false;
                    resolve(true);
                },
                error => {
                    console.error(error);
                    if (showFailureMessage) {
                        sunStatus.innerText = "Could not read your location. Please allow location access.";
                    }
                    isLocationRequestInProgress = false;
                    resolve(false);
                },
                {
                    enableHighAccuracy: false,
                    timeout: 12000,
                    maximumAge: 300000
                }
            );
        });
    };

    requestCurrentLocation = async ({ showFailureMessage = true, showRequestMessage = false } = {}) => {
        setLocationButtonBusyState(true);
        const wasResolved = await tryCurrentLocation({ showFailureMessage, showRequestMessage });
        setLocationButtonBusyState(false);
        return wasResolved;
    };

    locationButton.addEventListener("click", async () => {
        await requestCurrentLocation({ showFailureMessage: true, showRequestMessage: false });
    });

    return {
        requestCurrentLocation
    };
}

async function updateServiceWorkerRegistration() {
    const existingRegistration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);

    if (existingRegistration != null) {
        return existingRegistration.update();
    }

    return navigator.serviceWorker.register(serviceWorkerPath, { scope: serviceWorkerScope });
}

function initializeProgressiveWebApp() {
    if (!("serviceWorker" in navigator)) {
        return;
    }

    updateServiceWorkerRegistration().catch(error => {
        console.error("Service worker registration failed", error);
    });
}

async function initializePage() {
    if (skyFullscreenElement != null) {
        skyFullscreenElement.hidden = true;
    }

    refreshButton.addEventListener("click", refreshFromInputs);
    initializeProgressiveWebApp();
    initializeCityPicker();
    const locationController = initializeLocationButton();
    initializeFullscreenSkyInteractions();

    let usedCurrentLocation = false;
    if (locationController != null) {
        usedCurrentLocation = await locationController.requestCurrentLocation({
            showFailureMessage: false,
            showRequestMessage: true
        });
    }

    if (!usedCurrentLocation) {
        const initialPickerValue = getCurrentCityPickerValue();
        if (cityPickerButton != null && cityPresets[initialPickerValue] != null) {
            await applyCityPreset(initialPickerValue);
        } else {
            await refreshFromInputs();
        }
    }

    updateMoonPhase();
}

document.addEventListener("DOMContentLoaded", initializePage);
