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
const planetListFullscreenElement = document.getElementById("planet-list-fullscreen");
const skyCanvas = document.getElementById("sky-canvas");
const skyFullscreenElement = document.getElementById("sky-fullscreen");
const skyFullscreenStageElement = document.getElementById("sky-fullscreen-stage");
const skyFullscreenHudElement = document.getElementById("sky-fullscreen-hud");
const skyArToggleButton = document.getElementById("sky-ar-toggle-button");
const skyArStatusElement = document.getElementById("sky-ar-status");
const skyCloseButton = document.getElementById("sky-close-button");
const skyFullscreenCanvas = document.getElementById("sky-canvas-fullscreen");
const skyTimeSlider = document.getElementById("sky-time-slider");
const skyTimeSliderFullscreen = document.getElementById("sky-time-slider-fullscreen");
const skyTimeLabel = document.getElementById("sky-time-label");
const skyTimeLabelFullscreen = document.getElementById("sky-time-label-fullscreen");
const skyTimeNowButton = document.getElementById("sky-time-now-button");
const skyTimeNowButtonFullscreen = document.getElementById("sky-time-now-button-fullscreen");
const skyTimePlayButton = document.getElementById("sky-time-play-button");
const skyTimePlayButtonFullscreen = document.getElementById("sky-time-play-button-fullscreen");
const shareSkyButton = document.getElementById("share-sky-button");
const shareSkyButtonFullscreen = document.getElementById("share-sky-button-fullscreen");

let latestVisiblePlanets = [];
let latestSkyContext = null;
let isLocationRequestInProgress = false;
let requestCurrentLocation = async () => false;
let skyTimeOffsetMinutes = 0;
let skyTimePlayIntervalId = null;
let pendingSkyRerenderFrameId = null;

const skyArViewState = {
    isSupported: typeof window !== "undefined" && typeof window.DeviceOrientationEvent !== "undefined",
    isEnabled: false,
    headingDegrees: null,
    altitudeDegrees: 18,
    orientationListener: null,
    liveRerenderIntervalId: null,
    hasReceivedOrientation: false,
    hasAbsoluteHeading: false
};

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

const arCatalogConfig = {
    maxStarMagnitude: 4.8,
    milkyWayHalfWidthDegrees: 11,
    milkyWaySampleStepDegrees: 2
};

const arCatalogAssetPaths = {
    stars: "/js/tools/astronomy/data/stars.6.json",
    starNames: "/js/tools/astronomy/data/starnames.json",
    constellationLines: "/js/tools/astronomy/data/constellations.lines.json",
    constellationNames: "/js/tools/astronomy/data/constellations.json",
    messier: "/js/tools/astronomy/data/messier.json",
    brightDeepSky: "/js/tools/astronomy/data/dsos.bright.json"
};

const arCatalogState = {
    isLoaded: false,
    hasLoadError: false,
    loadPromise: null,
    stars: [],
    constellations: [],
    deepSkyObjects: [],
    milkyWayBandSamples: []
};

const arCompassDirections = [
    { label: "N", azimuthDegrees: 0 },
    { label: "NNE", azimuthDegrees: 22.5 },
    { label: "NE", azimuthDegrees: 45 },
    { label: "ENE", azimuthDegrees: 67.5 },
    { label: "E", azimuthDegrees: 90 },
    { label: "ESE", azimuthDegrees: 112.5 },
    { label: "SE", azimuthDegrees: 135 },
    { label: "SSE", azimuthDegrees: 157.5 },
    { label: "S", azimuthDegrees: 180 },
    { label: "SSW", azimuthDegrees: 202.5 },
    { label: "SW", azimuthDegrees: 225 },
    { label: "WSW", azimuthDegrees: 247.5 },
    { label: "W", azimuthDegrees: 270 },
    { label: "WNW", azimuthDegrees: 292.5 },
    { label: "NW", azimuthDegrees: 315 },
    { label: "NNW", azimuthDegrees: 337.5 }
];

const skyHistoryStateKey = "astronomySkyView";
const skyHistoryViewMain = "main";
const skyHistoryViewFullscreen = "fullscreen";
const skyHistoryViewAr = "ar";
let isApplyingSkyHistoryNavigation = false;

const planetColors = {
    Mercury: "#f7d7a6",
    Venus: "#fff4c4",
    Mars: "#ff9c88",
    Jupiter: "#e9d0b2",
    Saturn: "#ead9a2",
    Uranus: "#9fe7e9",
    Neptune: "#95bcff"
};

const brightStars = [
    { name: "Sirius", ra: 101.287, dec: -16.716, mag: -1.46 },
    { name: "Canopus", ra: 95.9879, dec: -52.6957, mag: -0.74 },
    { name: "Arcturus", ra: 213.915, dec: 19.182, mag: -0.05 },
    { name: "Vega", ra: 279.234, dec: 38.783, mag: 0.03 },
    { name: "Capella", ra: 79.172, dec: 45.998, mag: 0.08 },
    { name: "Rigel", ra: 78.634, dec: -8.201, mag: 0.13 },
    { name: "Procyon", ra: 114.825, dec: 5.225, mag: 0.34 },
    { name: "Betelgeuse", ra: 88.7929, dec: 7.4071, mag: 0.42 },
    { name: "Achernar", ra: 24.4286, dec: -57.2368, mag: 0.46 },
    { name: "Hadar", ra: 210.9558, dec: -60.373, mag: 0.61 },
    { name: "Altair", ra: 297.6958, dec: 8.8683, mag: 0.77 },
    { name: "Aldebaran", ra: 68.98, dec: 16.509, mag: 0.85 },
    { name: "Spica", ra: 201.2983, dec: -11.1614, mag: 0.98 },
    { name: "Antares", ra: 247.3519, dec: -26.432, mag: 1.06 },
    { name: "Pollux", ra: 113.649, dec: 28.026, mag: 1.14 },
    { name: "Fomalhaut", ra: 344.4128, dec: -29.6222, mag: 1.16 },
    { name: "Deneb", ra: 310.3579, dec: 45.2803, mag: 1.25 },
    { name: "Regulus", ra: 152.0929, dec: 11.9672, mag: 1.35 },
    { name: "Adhara", ra: 104.6564, dec: -28.9721, mag: 1.5 },
    { name: "Castor", ra: 113.6494, dec: 31.8883, mag: 1.58 }
];

const extendedNakedEyeStars = [
    { name: "Rigil Kent", ra: 219.9, dec: -60.83, mag: -0.27 },
    { name: "Acrux", ra: 186.65, dec: -63.1, mag: 0.77 },
    { name: "Mimosa", ra: 191.93, dec: -59.69, mag: 1.25 },
    { name: "Gacrux", ra: 187.79, dec: -57.11, mag: 1.63 },
    { name: "Bellatrix", ra: 81.28, dec: 6.35, mag: 1.64 },
    { name: "Elnath", ra: 81.57, dec: 28.61, mag: 1.65 },
    { name: "Miaplacidus", ra: 138.3, dec: -69.72, mag: 1.68 },
    { name: "Alnilam", ra: 84.05, dec: -1.2, mag: 1.69 },
    { name: "Alnair", ra: 332.06, dec: -46.96, mag: 1.74 },
    { name: "Alioth", ra: 193.51, dec: 55.96, mag: 1.76 },
    { name: "Alnitak", ra: 85.19, dec: -1.94, mag: 1.77 },
    { name: "Dubhe", ra: 165.93, dec: 61.75, mag: 1.79 },
    { name: "Kaus Australis", ra: 283.82, dec: -34.38, mag: 1.79 },
    { name: "Mirfak", ra: 51.08, dec: 49.86, mag: 1.79 },
    { name: "Wezen", ra: 104.66, dec: -26.39, mag: 1.83 },
    { name: "Alkaid", ra: 206.89, dec: 49.31, mag: 1.86 },
    { name: "Sargas", ra: 263.4, dec: -42.99, mag: 1.86 },
    { name: "Atria", ra: 252.17, dec: -69.03, mag: 1.91 },
    { name: "Alhena", ra: 99.43, dec: 16.4, mag: 1.93 },
    { name: "Peacock", ra: 306.41, dec: -56.74, mag: 1.94 },
    { name: "Mirzam", ra: 95.67, dec: -17.96, mag: 1.98 },
    { name: "Alphard", ra: 141.9, dec: -8.66, mag: 1.98 },
    { name: "Hamal", ra: 31.79, dec: 23.46, mag: 2.0 },
    { name: "Diphda", ra: 10.9, dec: -17.99, mag: 2.04 },
    { name: "Nunki", ra: 283.82, dec: -26.3, mag: 2.05 },
    { name: "Menkent", ra: 211.67, dec: -36.37, mag: 2.06 },
    { name: "Saiph", ra: 86.94, dec: -9.67, mag: 2.07 },
    { name: "Rasalhague", ra: 263.73, dec: 12.56, mag: 2.07 },
    { name: "Alpheratz", ra: 2.1, dec: 29.09, mag: 2.07 },
    { name: "Kochab", ra: 222.68, dec: 74.16, mag: 2.08 },
    { name: "Mirach", ra: 17.43, dec: 35.62, mag: 2.06 },
    { name: "Algol", ra: 47.04, dec: 40.96, mag: 2.12 },
    { name: "Denebola", ra: 177.26, dec: 14.57, mag: 2.14 },
    { name: "Sadr", ra: 305.56, dec: 40.26, mag: 2.23 },
    { name: "Mintaka", ra: 83.0, dec: -0.3, mag: 2.23 },
    { name: "Mizar", ra: 200.98, dec: 54.93, mag: 2.23 },
    { name: "Schedar", ra: 10.13, dec: 56.54, mag: 2.24 },
    { name: "Caph", ra: 2.29, dec: 59.15, mag: 2.28 },
    { name: "Dschubba", ra: 240.08, dec: -22.62, mag: 2.29 },
    { name: "Merak", ra: 165.46, dec: 56.38, mag: 2.37 },
    { name: "Enif", ra: 333.37, dec: 9.96, mag: 2.39 },
    { name: "Phecda", ra: 178.46, dec: 53.69, mag: 2.43 },
    { name: "Scheat", ra: 345.94, dec: 28.08, mag: 2.44 },
    { name: "Gienah", ra: 292.68, dec: 33.97, mag: 2.48 },
    { name: "Markab", ra: 346.19, dec: 15.2, mag: 2.49 },
    { name: "Menkar", ra: 45.57, dec: 4.09, mag: 2.54 },
    { name: "Acrab", ra: 241.36, dec: -19.81, mag: 2.62 },
    { name: "Ruchbah", ra: 21.45, dec: 60.24, mag: 2.68 },
    { name: "Lesath", ra: 262.69, dec: -37.3, mag: 2.7 },
    { name: "Algenib", ra: 3.31, dec: 15.18, mag: 2.83 },
    { name: "Delta Cygni", ra: 296.24, dec: 45.13, mag: 2.87 },
    { name: "Albireo", ra: 292.68, dec: 27.96, mag: 3.05 },
    { name: "Megrez", ra: 183.86, dec: 57.03, mag: 3.32 },
    { name: "Segin", ra: 28.6, dec: 63.67, mag: 3.35 }
];

const nakedEyeStars = [...brightStars, ...extendedNakedEyeStars];

const deepSkyObjects = [
    { name: "M31 Andromeda Galaxy", ra: 10.6847, dec: 41.269, type: "galaxy" },
    { name: "M42 Orion Nebula", ra: 83.8221, dec: -5.3911, type: "nebula" },
    { name: "M45 Pleiades", ra: 56.75, dec: 24.1167, type: "cluster" },
    { name: "Omega Centauri", ra: 201.697, dec: -47.479, type: "cluster" }
];

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

const allPlanetNames = Object.keys(planetaryElements);

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

function getSkyRenderDate() {
    return new Date(Date.now() + skyTimeOffsetMinutes * 60 * 1000);
}

function formatSkyOffsetLabel(offsetMinutes) {
    if (offsetMinutes === 0) {
        return `Live now (${formatClockTime(getSkyRenderDate())})`;
    }

    const sign = offsetMinutes > 0 ? "+" : "-";
    const absoluteMinutes = Math.abs(offsetMinutes);
    const hours = Math.floor(absoluteMinutes / 60);
    const minutes = absoluteMinutes % 60;
    const minutePart = minutes > 0 ? ` ${minutes}m` : "";
    return `${sign}${hours}h${minutePart} (${formatClockTime(getSkyRenderDate())})`;
}

function updateSkyTimeLabel() {
    const labelText = formatSkyOffsetLabel(skyTimeOffsetMinutes);
    if (skyTimeLabel != null) {
        skyTimeLabel.innerText = labelText;
    }
    if (skyTimeLabelFullscreen != null) {
        skyTimeLabelFullscreen.innerText = labelText;
    }
}

function setTimePlayButtonsState(isPlaying) {
    const buttons = [skyTimePlayButton, skyTimePlayButtonFullscreen];
    for (const button of buttons) {
        if (button == null) {
            continue;
        }

        button.setAttribute("aria-pressed", isPlaying ? "true" : "false");
        button.innerText = isPlaying ? "Stop Animation" : "Animate Night";
    }
}

function renderPlanetStatusList(targetListElement, planetStatuses, options = {}) {
    const { compactNamesOnly = false } = options;

    if (targetListElement == null) {
        return;
    }

    targetListElement.innerHTML = "";
    for (const status of planetStatuses) {
        const item = document.createElement("li");
        item.className = `planet-status-item ${status.isVisible ? "visible" : "not-visible"}`;
        item.style.setProperty("--planet-color", planetColors[status.planetName] || "#dce9ff");

        const nameSpan = document.createElement("span");
        nameSpan.className = "planet-name";
        nameSpan.innerText = status.planetName;

        if (!compactNamesOnly) {
            const stateSpan = document.createElement("span");
            stateSpan.className = "planet-status";
            if (status.isVisible) {
                stateSpan.innerText = `Visible ${status.displayAltitude.toFixed(0)} deg`;
            } else {
                stateSpan.innerText = `Below horizon ${Math.abs(status.displayAltitude).toFixed(0)} deg`;
            }

            item.appendChild(stateSpan);
        }

        item.appendChild(nameSpan);
        targetListElement.appendChild(item);
    }
}

function getCoordinatesFromInputsOrNull() {
    try {
        return readCoordinatesFromInputs();
    } catch {
        return null;
    }
}

function rerenderSkyForCurrentInputs() {
    const coordinates = getCoordinatesFromInputsOrNull();
    if (coordinates == null) {
        return;
    }

    renderVisiblePlanets(coordinates.lat, coordinates.lon);
}

function scheduleRerenderSkyForCurrentInputs() {
    if (pendingSkyRerenderFrameId != null) {
        return;
    }

    pendingSkyRerenderFrameId = window.requestAnimationFrame(() => {
        pendingSkyRerenderFrameId = null;
        rerenderSkyForCurrentInputs();
    });
}

function getSkyHistoryView(state = history.state) {
    if (state == null || typeof state !== "object") {
        return skyHistoryViewMain;
    }

    const view = state[skyHistoryStateKey];
    if (view === skyHistoryViewFullscreen || view === skyHistoryViewAr) {
        return view;
    }

    return skyHistoryViewMain;
}

function setSkyHistoryView(view, { replace = false } = {}) {
    if (typeof history === "undefined") {
        return;
    }

    const currentState = history.state != null && typeof history.state === "object" ? history.state : {};
    const nextState = {
        ...currentState,
        [skyHistoryStateKey]: view
    };

    if (replace) {
        history.replaceState(nextState, "");
        return;
    }

    history.pushState(nextState, "");
}

async function syncSkyUiToHistoryView(view) {
    isApplyingSkyHistoryNavigation = true;

    try {
        if (view === skyHistoryViewAr) {
            openSkyFullscreen({ suppressHistory: true });
            await setSkyArModeEnabled(true);

            if (!skyArViewState.isEnabled) {
                setSkyHistoryView(skyHistoryViewFullscreen, { replace: true });
            }

            drawActiveFullscreenSky();
            return;
        }

        if (view === skyHistoryViewFullscreen) {
            openSkyFullscreen({ suppressHistory: true });
            await setSkyArModeEnabled(false);
            drawActiveFullscreenSky();
            return;
        }

        await setSkyArModeEnabled(false);
        closeSkyFullscreen({ suppressHistory: true });
    } finally {
        isApplyingSkyHistoryNavigation = false;
    }
}

function initializeSkyHistoryNavigation() {
    if (typeof history === "undefined" || typeof history.pushState !== "function") {
        return;
    }

    setSkyHistoryView(skyHistoryViewMain, { replace: true });
    window.addEventListener("popstate", event => {
        void syncSkyUiToHistoryView(getSkyHistoryView(event.state));
    });
}

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

async function fetchArCatalogJson(path) {
    const response = await fetch(path, { cache: "force-cache" });
    if (!response.ok) {
        throw new Error(`Failed to load ${path} (${response.status})`);
    }

    return response.json();
}

function getArStarLabel(starId, starNameEntry) {
    if (starNameEntry != null && typeof starNameEntry === "object") {
        const properName = typeof starNameEntry.name === "string" ? starNameEntry.name.trim() : "";
        if (properName.length > 0) {
            return properName;
        }

        const designation = typeof starNameEntry.desig === "string" ? starNameEntry.desig.trim() : "";
        if (designation.length > 0) {
            return designation;
        }

        const constellationAbbreviation = typeof starNameEntry.c === "string" ? starNameEntry.c.trim() : "";
        const bayer = typeof starNameEntry.bayer === "string" ? starNameEntry.bayer.trim() : "";
        if (bayer.length > 0) {
            return constellationAbbreviation.length > 0 ? `${bayer} ${constellationAbbreviation}` : bayer;
        }

        const flamsteed = typeof starNameEntry.flam === "string" ? starNameEntry.flam.trim() : "";
        if (flamsteed.length > 0) {
            return constellationAbbreviation.length > 0 ? `${flamsteed} ${constellationAbbreviation}` : flamsteed;
        }
    }

    return starId.length > 0 ? `HIP ${starId}` : "Catalog Star";
}

function galacticToEquatorialCoordinates(longitudeDegrees, latitudeDegrees) {
    const longitudeRadians = toRadians(longitudeDegrees);
    const latitudeRadians = toRadians(latitudeDegrees);

    const galacticX = Math.cos(latitudeRadians) * Math.cos(longitudeRadians);
    const galacticY = Math.cos(latitudeRadians) * Math.sin(longitudeRadians);
    const galacticZ = Math.sin(latitudeRadians);

    // Transform from galactic to J2000 equatorial using the transpose of the ICRS->Galactic matrix.
    const equatorialX = -0.0548755604 * galacticX + 0.4941094279 * galacticY - 0.8676661490 * galacticZ;
    const equatorialY = -0.8734370902 * galacticX - 0.4448296300 * galacticY - 0.1980763734 * galacticZ;
    const equatorialZ = -0.4838350155 * galacticX + 0.7469822445 * galacticY + 0.4559837762 * galacticZ;

    return {
        ra: normalizeDegrees(toDegrees(Math.atan2(equatorialY, equatorialX))),
        dec: toDegrees(Math.asin(Math.max(-1, Math.min(1, equatorialZ))))
    };
}

function buildMilkyWayBandSamples(halfWidthDegrees = 11, sampleStepDegrees = 2) {
    const samples = [];

    for (let longitudeDegrees = 0; longitudeDegrees <= 360; longitudeDegrees += sampleStepDegrees) {
        const top = galacticToEquatorialCoordinates(longitudeDegrees, halfWidthDegrees);
        const bottom = galacticToEquatorialCoordinates(longitudeDegrees, -halfWidthDegrees);

        samples.push({
            top,
            bottom
        });
    }

    return samples;
}

async function ensureArCatalogLoaded() {
    if (arCatalogState.isLoaded || arCatalogState.hasLoadError) {
        return;
    }

    if (arCatalogState.loadPromise != null) {
        return arCatalogState.loadPromise;
    }

    arCatalogState.loadPromise = (async () => {
        const [
            starsPayload,
            starNamesPayload,
            constellationLinesPayload,
            constellationNamesPayload,
            messierPayload,
            brightDeepSkyPayload
        ] = await Promise.all([
            fetchArCatalogJson(arCatalogAssetPaths.stars),
            fetchArCatalogJson(arCatalogAssetPaths.starNames),
            fetchArCatalogJson(arCatalogAssetPaths.constellationLines),
            fetchArCatalogJson(arCatalogAssetPaths.constellationNames),
            fetchArCatalogJson(arCatalogAssetPaths.messier),
            fetchArCatalogJson(arCatalogAssetPaths.brightDeepSky)
        ]);

        const starNameLookup = starNamesPayload != null && typeof starNamesPayload === "object"
            ? starNamesPayload
            : {};

        arCatalogState.stars = (starsPayload.features || [])
            .map(feature => {
                const coordinates = feature?.geometry?.coordinates;
                if (!Array.isArray(coordinates) || coordinates.length < 2) {
                    return null;
                }

                const ra = toFiniteNumber(coordinates[0]);
                const dec = toFiniteNumber(coordinates[1]);
                const mag = toFiniteNumber(feature?.properties?.mag);
                if (ra == null || dec == null || mag == null || mag > arCatalogConfig.maxStarMagnitude) {
                    return null;
                }

                const starId = String(feature?.id ?? "");
                const starNameEntry = starId.length > 0 ? starNameLookup[starId] : null;
                return {
                    id: starId,
                    name: getArStarLabel(starId, starNameEntry),
                    ra: normalizeDegrees(ra),
                    dec,
                    mag
                };
            })
            .filter(star => star != null)
            .sort((a, b) => a.mag - b.mag);

        const constellationNameLookup = new Map(
            (constellationNamesPayload.features || [])
                .map(feature => {
                    const identifier = typeof feature?.id === "string" ? feature.id : "";
                    if (identifier.length === 0) {
                        return null;
                    }

                    const displayName = typeof feature?.properties?.name === "string" && feature.properties.name.trim().length > 0
                        ? feature.properties.name.trim()
                        : identifier;
                    return [identifier, displayName];
                })
                .filter(entry => entry != null)
        );

        arCatalogState.constellations = (constellationLinesPayload.features || [])
            .map(feature => {
                const lineGroups = feature?.geometry?.coordinates;
                if (!Array.isArray(lineGroups)) {
                    return null;
                }

                const segments = lineGroups
                    .map(segment => {
                        if (!Array.isArray(segment)) {
                            return null;
                        }

                        const normalizedSegment = segment
                            .map(point => {
                                if (!Array.isArray(point) || point.length < 2) {
                                    return null;
                                }

                                const ra = toFiniteNumber(point[0]);
                                const dec = toFiniteNumber(point[1]);
                                if (ra == null || dec == null) {
                                    return null;
                                }

                                return {
                                    ra: normalizeDegrees(ra),
                                    dec
                                };
                            })
                            .filter(point => point != null);

                        return normalizedSegment.length >= 2 ? normalizedSegment : null;
                    })
                    .filter(segment => segment != null);

                if (segments.length === 0) {
                    return null;
                }

                const identifier = typeof feature?.id === "string" ? feature.id : "Constellation";
                return {
                    id: identifier,
                    name: constellationNameLookup.get(identifier) || identifier,
                    segments
                };
            })
            .filter(constellation => constellation != null);

        const deepSkyLookup = new Map();
        const addDeepSkyObject = ({ key, name, ra, dec, type = "dso", mag = null }) => {
            if (typeof name !== "string" || name.trim().length === 0) {
                return;
            }

            if (!Number.isFinite(ra) || !Number.isFinite(dec)) {
                return;
            }

            const normalizedKey = key || `${name}-${Math.round(ra * 1000)}-${Math.round(dec * 1000)}`;
            const nextItem = {
                name: name.trim(),
                ra: normalizeDegrees(ra),
                dec,
                type,
                mag: Number.isFinite(mag) ? mag : null
            };

            const existingItem = deepSkyLookup.get(normalizedKey);
            if (existingItem == null) {
                deepSkyLookup.set(normalizedKey, nextItem);
                return;
            }

            const existingMag = existingItem.mag == null ? Number.POSITIVE_INFINITY : existingItem.mag;
            const nextMag = nextItem.mag == null ? Number.POSITIVE_INFINITY : nextItem.mag;
            if (nextMag < existingMag) {
                deepSkyLookup.set(normalizedKey, nextItem);
            }
        };

        for (const feature of messierPayload.features || []) {
            const coordinates = feature?.geometry?.coordinates;
            if (!Array.isArray(coordinates) || coordinates.length < 2) {
                continue;
            }

            const ra = toFiniteNumber(coordinates[0]);
            const dec = toFiniteNumber(coordinates[1]);
            if (ra == null || dec == null) {
                continue;
            }

            const props = feature?.properties || {};
            const labelOptions = [props.alt, props.name, props.desig, feature?.id]
                .filter(value => typeof value === "string" && value.trim().length > 0)
                .map(value => value.trim());
            const name = labelOptions[0] || "Messier Object";
            const mag = toFiniteNumber(props.mag);

            addDeepSkyObject({
                key: `messier-${String(feature?.id ?? name)}`,
                name,
                ra,
                dec,
                type: typeof props.type === "string" ? props.type.toLowerCase() : "messier",
                mag
            });
        }

        for (const feature of brightDeepSkyPayload.features || []) {
            const coordinates = feature?.geometry?.coordinates;
            if (!Array.isArray(coordinates) || coordinates.length < 2) {
                continue;
            }

            const ra = toFiniteNumber(coordinates[0]);
            const dec = toFiniteNumber(coordinates[1]);
            if (ra == null || dec == null) {
                continue;
            }

            const props = feature?.properties || {};
            const labelOptions = [props.desig, props.name, feature?.id]
                .filter(value => typeof value === "string" && value.trim().length > 0)
                .map(value => value.trim());
            const name = labelOptions[0] || "Deep Sky Object";
            const mag = toFiniteNumber(props.mag);

            addDeepSkyObject({
                key: `bright-${String(feature?.id ?? name)}`,
                name,
                ra,
                dec,
                type: typeof props.type === "string" ? props.type.toLowerCase() : "dso",
                mag
            });
        }

        arCatalogState.deepSkyObjects = Array.from(deepSkyLookup.values())
            .sort((a, b) => {
                const aMag = a.mag == null ? Number.POSITIVE_INFINITY : a.mag;
                const bMag = b.mag == null ? Number.POSITIVE_INFINITY : b.mag;
                return aMag - bMag;
            });

        arCatalogState.milkyWayBandSamples = buildMilkyWayBandSamples(
            arCatalogConfig.milkyWayHalfWidthDegrees,
            arCatalogConfig.milkyWaySampleStepDegrees
        );

        arCatalogState.isLoaded = true;
    })()
        .catch(error => {
            arCatalogState.hasLoadError = true;
            console.error("Expanded AR catalog load failed", error);
        })
        .finally(() => {
            arCatalogState.loadPromise = null;
            scheduleRerenderSkyForCurrentInputs();
        });

    return arCatalogState.loadPromise;
}

function isMobileArEligible() {
    return window.matchMedia("(max-width: 56rem) and (pointer: coarse)").matches;
}

function setFullscreenTimeTravelControlsDisabled(isDisabled) {
    [
        skyTimeSliderFullscreen,
        skyTimeNowButtonFullscreen,
        skyTimePlayButtonFullscreen
    ].forEach(element => {
        if (element != null) {
            element.disabled = isDisabled;
        }
    });
}

function updateSkyArUiState() {
    if (skyFullscreenElement != null) {
        skyFullscreenElement.classList.toggle("sky-fullscreen-ar-active", skyArViewState.isEnabled);
    }

    if (skyArToggleButton != null) {
        const canUseAr = skyArViewState.isSupported && isMobileArEligible();
        skyArToggleButton.hidden = !canUseAr;
        skyArToggleButton.disabled = !canUseAr;
        skyArToggleButton.setAttribute("aria-pressed", skyArViewState.isEnabled ? "true" : "false");
        skyArToggleButton.innerText = skyArViewState.isEnabled ? "Stop AR" : "AR View";
    }

    if (skyArStatusElement != null) {
        if (!skyArViewState.isEnabled) {
            skyArStatusElement.hidden = true;
            return;
        }

        const headingText = Number.isFinite(skyArViewState.headingDegrees)
            ? `${Math.round(skyArViewState.headingDegrees)} deg`
            : "calibrating";
        const altitudeText = `${Math.round(skyArViewState.altitudeDegrees)} deg alt`;
        skyArStatusElement.innerText = `AR live | Heading ${headingText} | ${altitudeText}`;
        skyArStatusElement.hidden = false;
    }
}

function stopSkyArLiveRerender() {
    if (skyArViewState.liveRerenderIntervalId != null) {
        clearInterval(skyArViewState.liveRerenderIntervalId);
        skyArViewState.liveRerenderIntervalId = null;
    }
}

function startSkyArLiveRerender() {
    stopSkyArLiveRerender();
    skyArViewState.liveRerenderIntervalId = window.setInterval(() => {
        scheduleRerenderSkyForCurrentInputs();
    }, 1000);
}

function getSkyArHeadingDegrees(event) {
    if (Number.isFinite(event.webkitCompassHeading)) {
        return normalizeDegrees(event.webkitCompassHeading);
    }

    if (Number.isFinite(event.alpha) && Number.isFinite(event.beta) && Number.isFinite(event.gamma)) {
        // Tilt-compensated compass heading from DeviceOrientation alpha/beta/gamma.
        const x = toRadians(event.beta);
        const y = toRadians(event.gamma);
        const z = toRadians(event.alpha);

        const cX = Math.cos(x);
        const cY = Math.cos(y);
        const cZ = Math.cos(z);
        const sX = Math.sin(x);
        const sY = Math.sin(y);
        const sZ = Math.sin(z);

        const vx = -cZ * sY - sZ * sX * cY;
        const vy = -sZ * sY + cZ * sX * cY;
        if (Math.hypot(vx, vy) < 0.0001) {
            return null;
        }

        return normalizeDegrees(toDegrees(Math.atan2(vx, vy)));
    }

    if (Number.isFinite(event.alpha)) {
        return normalizeDegrees(360 - event.alpha);
    }

    return null;
}

function smoothHeadingDegrees(previousHeadingDegrees, nextHeadingDegrees, smoothingFactor = 0.28) {
    if (!Number.isFinite(previousHeadingDegrees)) {
        return normalizeDegrees(nextHeadingDegrees);
    }

    const delta = normalizeDegrees180(nextHeadingDegrees - previousHeadingDegrees);
    return normalizeDegrees(previousHeadingDegrees + delta * smoothingFactor);
}

function getSkyArAltitudeDegrees(event) {
    const beta = Number.isFinite(event.beta) ? event.beta : 0;
    const gamma = Number.isFinite(event.gamma) ? event.gamma : 0;
    const screenOrientationAngle = Number.isFinite(window.screen?.orientation?.angle)
        ? normalizeDegrees(window.screen.orientation.angle)
        : normalizeDegrees(Number(window.orientation) || 0);

    let altitudeDegrees;
    if (screenOrientationAngle >= 45 && screenOrientationAngle < 135) {
        // Landscape-right: use gamma for vertical pitch.
        altitudeDegrees = gamma - 90;
    } else if (screenOrientationAngle >= 225 && screenOrientationAngle < 315) {
        // Landscape-left: gamma sign is mirrored.
        altitudeDegrees = -90 - gamma;
    } else if (screenOrientationAngle >= 135 && screenOrientationAngle < 225) {
        // Upside-down portrait.
        altitudeDegrees = 90 - beta;
    } else {
        // Upright portrait: beta near 90deg corresponds to horizon.
        altitudeDegrees = beta - 90;
    }

    return Math.max(-85, Math.min(90, altitudeDegrees));
}

function handleSkyArOrientation(event) {
    const hasCompassHeading = Number.isFinite(event.webkitCompassHeading);
    const hasFullOrientation = Number.isFinite(event.alpha) && Number.isFinite(event.beta) && Number.isFinite(event.gamma);
    const eventHasAbsoluteHeading = hasCompassHeading || (event.absolute === true && hasFullOrientation);
    if (eventHasAbsoluteHeading) {
        skyArViewState.hasAbsoluteHeading = true;
    }

    // Prefer absolute heading events when available to avoid gyro drift.
    if (skyArViewState.hasAbsoluteHeading && !eventHasAbsoluteHeading) {
        return;
    }

    const altitude = getSkyArAltitudeDegrees(event);
    let heading = getSkyArHeadingDegrees(event);

    // Heading becomes numerically unstable near zenith/nadir; hold last stable value there.
    if (Math.abs(altitude) > 78 && Number.isFinite(skyArViewState.headingDegrees)) {
        heading = skyArViewState.headingDegrees;
    } else if (heading != null) {
        heading = smoothHeadingDegrees(skyArViewState.headingDegrees, heading);
    }

    if (heading != null) {
        skyArViewState.headingDegrees = heading;
    }

    skyArViewState.altitudeDegrees = altitude;
    skyArViewState.hasReceivedOrientation = true;
    updateSkyArUiState();
    scheduleRerenderSkyForCurrentInputs();
}

async function requestSkyArPermissionIfNeeded() {
    if (typeof DeviceOrientationEvent === "undefined") {
        return false;
    }

    const requestPermission = DeviceOrientationEvent.requestPermission;
    if (typeof requestPermission !== "function") {
        return true;
    }

    try {
        const permission = await requestPermission.call(DeviceOrientationEvent);
        return permission === "granted";
    } catch {
        return false;
    }
}

async function setSkyArModeEnabled(nextEnabled) {
    if (!skyArViewState.isSupported || !isMobileArEligible()) {
        skyArViewState.isEnabled = false;
        updateSkyArUiState();
        return;
    }

    if (nextEnabled) {
        const permissionGranted = await requestSkyArPermissionIfNeeded();
        if (!permissionGranted) {
            sunStatus.innerText = "AR access requires motion permission on this device.";
            skyArViewState.isEnabled = false;
            updateSkyArUiState();
            return;
        }

        stopSkyTimePlayback();
        setSkyTimeOffset(0);
        setFullscreenTimeTravelControlsDisabled(true);
        resetFullscreenSkyTransform();

        skyArViewState.isEnabled = true;
        skyArViewState.hasReceivedOrientation = false;
        skyArViewState.hasAbsoluteHeading = false;
        skyArViewState.headingDegrees = null;
        void ensureArCatalogLoaded();

        if (skyArViewState.orientationListener == null) {
            skyArViewState.orientationListener = handleSkyArOrientation;
        }

        window.addEventListener("deviceorientationabsolute", skyArViewState.orientationListener, true);
        window.addEventListener("deviceorientation", skyArViewState.orientationListener, true);
        startSkyArLiveRerender();
        updateSkyArUiState();
        scheduleRerenderSkyForCurrentInputs();
        return;
    }

    skyArViewState.isEnabled = false;
    setFullscreenTimeTravelControlsDisabled(false);
    stopSkyArLiveRerender();

    if (skyArViewState.orientationListener != null) {
        window.removeEventListener("deviceorientationabsolute", skyArViewState.orientationListener, true);
        window.removeEventListener("deviceorientation", skyArViewState.orientationListener, true);
    }

    updateSkyArUiState();
    scheduleRerenderSkyForCurrentInputs();
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

function getSunHorizontalCoordinates(date, latitude, longitude) {
    const jd = toJulianDate(date);
    const n = jd - 2451545.0;

    const meanLongitude = normalizeDegrees(280.460 + 0.9856474 * n);
    const meanAnomaly = normalizeDegrees(357.528 + 0.9856003 * n);
    const eclipticLongitude = normalizeDegrees(
        meanLongitude
            + 1.915 * Math.sin(toRadians(meanAnomaly))
            + 0.020 * Math.sin(toRadians(2 * meanAnomaly))
    );

    const obliquity = toRadians(23.439 - 0.0000004 * n);
    const lambda = toRadians(eclipticLongitude);

    const rightAscensionDegrees = normalizeDegrees(toDegrees(Math.atan2(Math.cos(obliquity) * Math.sin(lambda), Math.cos(lambda))));
    const declinationDegrees = toDegrees(Math.asin(Math.sin(obliquity) * Math.sin(lambda)));

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

function resizeCanvasToDisplaySize(targetCanvas, maxPixelSize = 2800) {
    if (targetCanvas == null) {
        return;
    }

    const logicalWidth = targetCanvas.clientWidth || parseFloat(getComputedStyle(targetCanvas).width);
    const logicalHeight = targetCanvas.clientHeight || parseFloat(getComputedStyle(targetCanvas).height);
    if (!Number.isFinite(logicalWidth) || !Number.isFinite(logicalHeight) || logicalWidth <= 0 || logicalHeight <= 0) {
        return;
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    const desiredWidth = Math.min(maxPixelSize, Math.round(logicalWidth * devicePixelRatio));
    const desiredHeight = Math.min(maxPixelSize, Math.round(logicalHeight * devicePixelRatio));

    if (targetCanvas.width !== desiredWidth || targetCanvas.height !== desiredHeight) {
        targetCanvas.width = Math.max(1, desiredWidth);
        targetCanvas.height = Math.max(1, desiredHeight);
    }
}

function getSkyLabelScale(targetCanvas) {
    if (targetCanvas == null) {
        return 1;
    }

    const logicalWidth = targetCanvas.clientWidth || parseFloat(getComputedStyle(targetCanvas).width) || targetCanvas.width;
    if (logicalWidth >= 980) {
        return 1.9;
    }

    if (logicalWidth >= 720) {
        return 1.55;
    }

    if (logicalWidth >= 500) {
        return 1.3;
    }

    return 1.18;
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

function drawSunMarker(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes = []) {
    if (skyContext == null) {
        return;
    }

    const { date, latitude, longitude } = skyContext;
    const sunHorizontal = getSunHorizontalCoordinates(date, latitude, longitude);
    if (sunHorizontal.altitudeDegrees < 0) {
        return;
    }

    const labelScale = getSkyLabelScale(ctx.canvas);
    const point = projectToSky(sunHorizontal.azimuthDegrees, sunHorizontal.altitudeDegrees, cx, cy, radius);
    reserveSkyMarkerSpace(occupiedLabelBoxes, point.x, point.y, 20);

    ctx.beginPath();
    ctx.arc(point.x, point.y, 5.8, 0, Math.PI * 2);
    ctx.fillStyle = "hsl(45, 100%, 62%)";
    ctx.shadowColor = "hsla(45, 100%, 62%, 0.68)";
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "hsla(222, 44%, 12%, 0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();

    drawSkyLabel(ctx, "Sun", point.x, point.y, occupiedLabelBoxes, {
        fontSize: Math.round(12 * labelScale),
        fillStyle: "hsla(48, 100%, 82%, 0.96)",
        preferBelow: true
    });
}

function drawMoonMarker(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes = []) {
    if (skyContext == null) {
        return;
    }

    const { date, latitude, longitude } = skyContext;
    const moonHorizontal = getMoonHorizontalCoordinates(date, latitude, longitude);
    if (moonHorizontal.altitudeDegrees < 0) {
        return;
    }

    const labelScale = getSkyLabelScale(ctx.canvas);
    const point = projectToSky(moonHorizontal.azimuthDegrees, moonHorizontal.altitudeDegrees, cx, cy, radius);
    reserveSkyMarkerSpace(occupiedLabelBoxes, point.x, point.y, 18);

    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#f7fbff";
    ctx.fill();
    ctx.strokeStyle = "hsla(218, 36%, 14%, 0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();

    drawSkyLabel(ctx, "Moon", point.x, point.y, occupiedLabelBoxes, {
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

function drawStarfieldOverlay(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes = []) {
    if (skyContext == null) {
        return;
    }

    const { date, latitude, longitude } = skyContext;
    const labelScale = getSkyLabelScale(ctx.canvas);
    const logicalWidth = ctx.canvas.clientWidth || parseFloat(getComputedStyle(ctx.canvas).width) || ctx.canvas.width;
    const magnitudeLimit = logicalWidth >= 980 ? 5.1 : logicalWidth >= 720 ? 4.7 : 4.3;

    for (const star of nakedEyeStars) {
        if (star.mag > magnitudeLimit) {
            continue;
        }

        const horizontal = getHorizontalCoordinatesFromEquatorial(
            star.ra,
            star.dec,
            date,
            latitude,
            longitude,
            { precessFromJ2000: true }
        );

        if (horizontal.altitudeDegrees < 0) {
            continue;
        }

        const point = projectToSky(horizontal.azimuthDegrees, horizontal.altitudeDegrees, cx, cy, radius);
        const brightness = Math.max(0.08, Math.min(1, (magnitudeLimit - star.mag) / (magnitudeLimit + 1.2)));
        const dotRadius = 0.85 + brightness * 2.4;

        ctx.beginPath();
        ctx.arc(point.x, point.y, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(44, 100%, 94%, ${0.52 + brightness * 0.45})`;
        ctx.shadowColor = "hsla(210, 100%, 88%, 0.38)";
        ctx.shadowBlur = 2 + dotRadius * 2;
        ctx.fill();
        ctx.shadowBlur = 0;

        if (star.mag <= 1.2) {
            reserveSkyMarkerSpace(occupiedLabelBoxes, point.x, point.y, 14);
            drawSkyLabel(ctx, star.name, point.x, point.y, occupiedLabelBoxes, {
                fontSize: Math.round(10 * labelScale),
                fillStyle: "hsla(44, 84%, 92%, 0.86)",
                preferBelow: true
            });
        }
    }
}

function drawDeepSkyHighlights(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes = []) {
    if (skyContext == null) {
        return;
    }

    const { date, latitude, longitude } = skyContext;
    const labelScale = getSkyLabelScale(ctx.canvas);

    for (const target of deepSkyObjects) {
        const horizontal = getHorizontalCoordinatesFromEquatorial(
            target.ra,
            target.dec,
            date,
            latitude,
            longitude,
            { precessFromJ2000: true }
        );

        if (horizontal.altitudeDegrees < 8) {
            continue;
        }

        const point = projectToSky(horizontal.azimuthDegrees, horizontal.altitudeDegrees, cx, cy, radius);
        reserveSkyMarkerSpace(occupiedLabelBoxes, point.x, point.y, 18);

        ctx.save();
        ctx.translate(point.x, point.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = "hsla(186, 88%, 72%, 0.92)";
        ctx.strokeStyle = "hsla(220, 45%, 10%, 0.88)";
        ctx.lineWidth = 1;
        ctx.fillRect(-3.5, -3.5, 7, 7);
        ctx.strokeRect(-3.5, -3.5, 7, 7);
        ctx.restore();

        drawSkyLabel(ctx, target.name, point.x, point.y, occupiedLabelBoxes, {
            fontSize: Math.round(10 * labelScale),
            fillStyle: "hsla(186, 88%, 84%, 0.92)",
            preferBelow: true
        });
    }
}

function getSkyPalette() {
    const isStargazingMode = document.body != null && document.body.classList.contains("stargazing-mode");
    if (isStargazingMode) {
        return {
            gradientInner: "hsl(8, 58%, 14%)",
            gradientOuter: "hsl(0, 60%, 7%)",
            ringStroke: "hsla(20, 66%, 78%, 0.24)",
            horizonStroke: "hsla(20, 70%, 84%, 0.48)",
            axisStroke: "hsla(22, 54%, 76%, 0.18)",
            cardinalFill: "hsla(24, 92%, 90%, 0.9)",
            noVisibleFill: "hsla(22, 72%, 84%, 0.88)",
            markerStroke: "hsla(10, 48%, 12%, 0.82)",
            labelFill: "hsla(24, 92%, 90%, 0.92)"
        };
    }

    return {
        gradientInner: "hsl(216, 58%, 20%)",
        gradientOuter: "hsl(232, 58%, 8%)",
        ringStroke: "hsla(210, 38%, 84%, 0.28)",
        horizonStroke: "hsla(210, 52%, 90%, 0.55)",
        axisStroke: "hsla(212, 32%, 88%, 0.2)",
        cardinalFill: "hsla(0, 0%, 100%, 0.84)",
        noVisibleFill: "hsla(210, 26%, 88%, 0.86)",
        markerStroke: "hsla(216, 38%, 16%, 0.8)",
        labelFill: "hsla(0, 0%, 100%, 0.92)"
    };
}

function drawSkyArView(targetCanvas, skyContext = null) {
    if (targetCanvas == null || skyContext == null) {
        return;
    }

    resizeCanvasToDisplaySize(targetCanvas);

    const ctx = targetCanvas.getContext("2d");
    if (ctx == null) {
        return;
    }

    const width = targetCanvas.clientWidth || parseFloat(getComputedStyle(targetCanvas).width) || targetCanvas.width;
    const height = targetCanvas.clientHeight || parseFloat(getComputedStyle(targetCanvas).height) || targetCanvas.height;
    const dpr = width > 0 ? targetCanvas.width / width : 1;
    const cx = width / 2;
    const cy = height / 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const skyPalette = getSkyPalette();
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, skyPalette.gradientInner);
    gradient.addColorStop(1, skyPalette.gradientOuter);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const viewAzimuth = Number.isFinite(skyArViewState.headingDegrees) ? skyArViewState.headingDegrees : 0;
    const viewAltitude = skyArViewState.altitudeDegrees;
    const fovHorizontal = 78;
    const fovVertical = 64;

    ctx.strokeStyle = skyPalette.axisStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.moveTo(0, cy);
    ctx.lineTo(width, cy);
    ctx.stroke();

    const projectArPoint = (azimuthDegrees, altitudeDegrees) => {
        const deltaAz = normalizeDegrees180(azimuthDegrees - viewAzimuth);
        const deltaAlt = altitudeDegrees - viewAltitude;
        const inFrame = Math.abs(deltaAz) <= fovHorizontal / 2 && Math.abs(deltaAlt) <= fovVertical / 2;
        if (!inFrame) {
            return null;
        }

        return {
            x: cx + deltaAz / (fovHorizontal / 2) * cx,
            y: cy - deltaAlt / (fovVertical / 2) * cy
        };
    };

    const drawArMarker = (name, azimuthDegrees, altitudeDegrees, color, radius = 3.4) => {
        const point = projectArPoint(azimuthDegrees, altitudeDegrees);
        if (point == null) {
            return;
        }

        const isBelowHorizon = altitudeDegrees < 0;
        ctx.save();
        ctx.globalAlpha = isBelowHorizon ? 0.48 : 1;

        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = skyPalette.markerStroke;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = skyPalette.labelFill;
        ctx.font = "11px Outfit, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(name, point.x + 7, point.y - 1);
        ctx.restore();
    };

    const { date, latitude, longitude } = skyContext;
    if (!arCatalogState.isLoaded && !arCatalogState.hasLoadError) {
        void ensureArCatalogLoaded();
    }

    const activeStars = arCatalogState.isLoaded && arCatalogState.stars.length > 0
        ? arCatalogState.stars
        : nakedEyeStars;
    const activeDeepSkyObjects = arCatalogState.isLoaded && arCatalogState.deepSkyObjects.length > 0
        ? arCatalogState.deepSkyObjects
        : deepSkyObjects;
    const activeConstellations = arCatalogState.isLoaded && arCatalogState.constellations.length > 0
        ? arCatalogState.constellations
        : constellations.map(constellation => {
            const segments = constellation.lines
                .map(([fromStar, toStar]) => {
                    const fromCoordinates = constellation.stars[fromStar];
                    const toCoordinates = constellation.stars[toStar];
                    if (fromCoordinates == null || toCoordinates == null) {
                        return null;
                    }

                    return [
                        { ra: fromCoordinates.ra, dec: fromCoordinates.dec },
                        { ra: toCoordinates.ra, dec: toCoordinates.dec }
                    ];
                })
                .filter(segment => segment != null);

            return {
                name: constellation.name,
                segments
            };
        });

    const horizonPoints = [];
    for (let deltaAzimuth = -fovHorizontal / 2 - 3; deltaAzimuth <= fovHorizontal / 2 + 3; deltaAzimuth += 1.4) {
        const horizonPoint = projectArPoint(normalizeDegrees(viewAzimuth + deltaAzimuth), 0);
        if (horizonPoint != null) {
            horizonPoints.push(horizonPoint);
        }
    }

    if (horizonPoints.length >= 2) {
        const horizonTop = Math.min(...horizonPoints.map(point => point.y));
        const horizonGradient = ctx.createLinearGradient(0, horizonTop, 0, height);
        horizonGradient.addColorStop(0, "hsla(205, 26%, 20%, 0.02)");
        horizonGradient.addColorStop(1, "hsla(205, 30%, 4%, 0.36)");

        ctx.save();
        ctx.fillStyle = horizonGradient;
        ctx.beginPath();
        ctx.moveTo(horizonPoints[0].x, height);
        for (const point of horizonPoints) {
            ctx.lineTo(point.x, point.y);
        }
        ctx.lineTo(horizonPoints[horizonPoints.length - 1].x, height);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = "hsla(190, 84%, 86%, 0.62)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(horizonPoints[0].x, horizonPoints[0].y);
        for (const point of horizonPoints.slice(1)) {
            ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
        ctx.restore();
    }

    ctx.save();
    ctx.font = "700 10px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.strokeStyle = "hsla(216, 52%, 8%, 0.92)";
    ctx.fillStyle = "hsla(190, 100%, 90%, 0.95)";
    ctx.lineWidth = 2.4;
    ctx.shadowColor = "hsla(214, 58%, 6%, 0.9)";
    ctx.shadowBlur = 5;

    for (const compassDirection of arCompassDirections) {
        const point = projectArPoint(compassDirection.azimuthDegrees, 0);
        if (point == null) {
            continue;
        }

        ctx.beginPath();
        ctx.moveTo(point.x, point.y - 4);
        ctx.lineTo(point.x, point.y + 4);
        ctx.stroke();
        ctx.strokeText(compassDirection.label, point.x, point.y - 8);
        ctx.fillText(compassDirection.label, point.x, point.y - 8);
    }

    ctx.restore();

    if (arCatalogState.milkyWayBandSamples.length > 1) {
        const projectedBandSamples = arCatalogState.milkyWayBandSamples.map(sample => {
            const topHorizontal = getHorizontalCoordinatesFromEquatorial(
                sample.top.ra,
                sample.top.dec,
                date,
                latitude,
                longitude,
                { precessFromJ2000: true }
            );
            const bottomHorizontal = getHorizontalCoordinatesFromEquatorial(
                sample.bottom.ra,
                sample.bottom.dec,
                date,
                latitude,
                longitude,
                { precessFromJ2000: true }
            );

            return {
                top: projectArPoint(topHorizontal.azimuthDegrees, topHorizontal.altitudeDegrees),
                bottom: projectArPoint(bottomHorizontal.azimuthDegrees, bottomHorizontal.altitudeDegrees),
                averageAltitude: (topHorizontal.altitudeDegrees + bottomHorizontal.altitudeDegrees) / 2
            };
        });

        ctx.save();
        for (let sampleIndex = 0; sampleIndex < projectedBandSamples.length - 1; sampleIndex += 1) {
            const current = projectedBandSamples[sampleIndex];
            const next = projectedBandSamples[sampleIndex + 1];
            if (current.top == null || current.bottom == null || next.top == null || next.bottom == null) {
                continue;
            }

            const segmentAverageAltitude = (current.averageAltitude + next.averageAltitude) / 2;
            ctx.globalAlpha = segmentAverageAltitude < 0 ? 0.08 : 0.18;
            ctx.fillStyle = "hsla(197, 64%, 84%, 0.92)";
            ctx.beginPath();
            ctx.moveTo(current.top.x, current.top.y);
            ctx.lineTo(next.top.x, next.top.y);
            ctx.lineTo(next.bottom.x, next.bottom.y);
            ctx.lineTo(current.bottom.x, current.bottom.y);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }

    ctx.save();
    ctx.lineWidth = 1.15;
    for (const constellation of activeConstellations) {
        let labelXSum = 0;
        let labelYSum = 0;
        let labelPointCount = 0;
        let belowHorizonPointCount = 0;
        let visibleSegmentCount = 0;

        for (const segment of constellation.segments) {
            const projectedSegment = [];
            let segmentAltitudeSum = 0;

            for (const pointCoordinates of segment) {
                const horizontal = getHorizontalCoordinatesFromEquatorial(
                    pointCoordinates.ra,
                    pointCoordinates.dec,
                    date,
                    latitude,
                    longitude,
                    { precessFromJ2000: true }
                );

                const point = projectArPoint(horizontal.azimuthDegrees, horizontal.altitudeDegrees);
                if (point == null) {
                    continue;
                }

                projectedSegment.push(point);
                segmentAltitudeSum += horizontal.altitudeDegrees;
                labelXSum += point.x;
                labelYSum += point.y;
                labelPointCount += 1;
                if (horizontal.altitudeDegrees < 0) {
                    belowHorizonPointCount += 1;
                }
            }

            if (projectedSegment.length < 2) {
                continue;
            }

            const segmentAverageAltitude = segmentAltitudeSum / projectedSegment.length;
            ctx.globalAlpha = segmentAverageAltitude < 0 ? 0.24 : 0.58;
            ctx.strokeStyle = "hsla(201, 78%, 84%, 0.9)";
            ctx.beginPath();
            ctx.moveTo(projectedSegment[0].x, projectedSegment[0].y);
            for (const point of projectedSegment.slice(1)) {
                ctx.lineTo(point.x, point.y);
            }
            ctx.stroke();
            visibleSegmentCount += 1;
        }

        if (visibleSegmentCount > 0 && labelPointCount > 0) {
            const labelX = labelXSum / labelPointCount;
            const labelY = labelYSum / labelPointCount;
            const isBelowHorizonLabel = belowHorizonPointCount === labelPointCount;

            ctx.save();
            ctx.globalAlpha = isBelowHorizonLabel ? 0.52 : 0.94;
            ctx.fillStyle = isBelowHorizonLabel
                ? "hsla(166, 74%, 62%, 0.9)"
                : "hsla(166, 100%, 72%, 0.98)";
            ctx.font = "700 13px Outfit, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.shadowColor = "hsla(210, 88%, 8%, 0.88)";
            ctx.shadowBlur = 8;
            ctx.strokeStyle = "hsla(214, 48%, 8%, 0.92)";
            ctx.lineWidth = 3;
            ctx.strokeText(constellation.name, labelX, labelY - 8);
            ctx.fillText(constellation.name, labelX, labelY - 8);
            ctx.restore();
        }
    }

    ctx.restore();

    const getDeepSkyMarkerStyle = target => {
        const objectType = typeof target.type === "string" ? target.type.toLowerCase() : "";
        if (objectType.includes("neb")) {
            return { color: "hsla(191, 92%, 74%, 0.96)", radius: 3.2 };
        }

        if (objectType.includes("gal")) {
            return { color: "hsla(212, 96%, 78%, 0.96)", radius: 3.2 };
        }

        if (objectType.includes("cluster") || objectType.includes("oc") || objectType.includes("gc")) {
            return { color: "hsla(171, 88%, 74%, 0.96)", radius: 3.0 };
        }

        return { color: "hsla(186, 88%, 72%, 0.95)", radius: 2.8 };
    };

    for (const planetName of allPlanetNames) {
        const horizontal = getPlanetHorizontalCoordinates(planetName, date, latitude, longitude);
        drawArMarker(
            planetName,
            horizontal.azimuthDegrees,
            horizontal.altitudeDegrees,
            planetColors[planetName] || "#ffffff"
        );
    }

    const sunHorizontal = getSunHorizontalCoordinates(date, latitude, longitude);
    drawArMarker("Sun", sunHorizontal.azimuthDegrees, sunHorizontal.altitudeDegrees, "hsl(45, 100%, 62%)", 4.1);

    const moonHorizontal = getMoonHorizontalCoordinates(date, latitude, longitude);
    drawArMarker("Moon", moonHorizontal.azimuthDegrees, moonHorizontal.altitudeDegrees, "#f7fbff", 4.1);

    for (const star of activeStars) {
        const horizontal = getHorizontalCoordinatesFromEquatorial(
            star.ra,
            star.dec,
            date,
            latitude,
            longitude,
            { precessFromJ2000: true }
        );

        const starMagnitude = Number.isFinite(star.mag) ? star.mag : arCatalogConfig.maxStarMagnitude;
        const starRadius = Math.max(1.08, Math.min(3.2, 3.45 - Math.max(-1, Math.min(6, starMagnitude)) * 0.34));
        drawArMarker(
            typeof star.name === "string" && star.name.trim().length > 0 ? star.name : "Catalog Star",
            horizontal.azimuthDegrees,
            horizontal.altitudeDegrees,
            "hsla(44, 100%, 92%, 0.95)",
            starRadius
        );
    }

    for (const target of activeDeepSkyObjects) {
        const horizontal = getHorizontalCoordinatesFromEquatorial(
            target.ra,
            target.dec,
            date,
            latitude,
            longitude,
            { precessFromJ2000: true }
        );

        const markerStyle = getDeepSkyMarkerStyle(target);
        drawArMarker(
            typeof target.name === "string" && target.name.trim().length > 0 ? target.name : "Deep Sky Object",
            horizontal.azimuthDegrees,
            horizontal.altitudeDegrees,
            markerStyle.color,
            markerStyle.radius
        );
    }

    ctx.fillStyle = skyPalette.labelFill;
    ctx.font = "600 12px Outfit, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`AR heading ${Math.round(viewAzimuth)} deg`, 14, 18);
    ctx.fillText(`Looking ${Math.round(viewAltitude)} deg alt`, 14, 36);

    if (!skyArViewState.hasReceivedOrientation) {
        ctx.textAlign = "center";
        ctx.font = "600 13px Outfit, sans-serif";
        ctx.fillText("Move phone to calibrate AR view", cx, cy + 22);
    }
}

function drawSkyDiagram(targetCanvas, visiblePlanets, skyContext = null) {
    if (targetCanvas == null) {
        return;
    }

    resizeCanvasToDisplaySize(targetCanvas);

    const ctx = targetCanvas.getContext("2d");
    if (ctx == null) {
        return;
    }

    const width = targetCanvas.clientWidth || parseFloat(getComputedStyle(targetCanvas).width) || targetCanvas.width;
    const height = targetCanvas.clientHeight || parseFloat(getComputedStyle(targetCanvas).height) || targetCanvas.height;
    const dpr = width > 0 ? targetCanvas.width / width : 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.39;
    const labelScale = getSkyLabelScale(targetCanvas);
    const occupiedLabelBoxes = [];
    const skyPalette = getSkyPalette();

    const gradient = ctx.createRadialGradient(cx, cy * 0.75, radius * 0.15, cx, cy, radius * 1.15);
    gradient.addColorStop(0, skyPalette.gradientInner);
    gradient.addColorStop(1, skyPalette.gradientOuter);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    for (const alt of [30, 60]) {
        const ringRadius = (90 - alt) / 90 * radius;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = skyPalette.ringStroke;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = skyPalette.horizonStroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.strokeStyle = skyPalette.axisStroke;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = skyPalette.cardinalFill;
    ctx.font = `${Math.round(12 * labelScale)}px Outfit, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("N", cx, cy - radius - 7);
    ctx.fillText("S", cx, cy + radius + 16);
    ctx.fillText("E", cx + radius + 10, cy + 4);
    ctx.fillText("W", cx - radius - 10, cy + 4);

    drawStarfieldOverlay(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes);
    drawConstellationOverlay(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes);
    drawDeepSkyHighlights(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes);
    drawPolarisOverlay(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes);
    drawSunMarker(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes);
    drawMoonMarker(ctx, cx, cy, radius, skyContext, occupiedLabelBoxes);
    if (visiblePlanets.length === 0) {
        ctx.fillStyle = skyPalette.noVisibleFill;
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
        ctx.strokeStyle = skyPalette.markerStroke;
        ctx.lineWidth = 1;
        ctx.stroke();

        drawSkyLabel(ctx, planet.planetName, x, y, occupiedLabelBoxes, {
            fontSize: Math.round(12 * labelScale),
            fillStyle: "hsla(0, 0%, 100%, 0.92)"
        });
    }
}

function drawActiveFullscreenSky() {
    if (skyFullscreenCanvas == null) {
        return;
    }

    if (skyArViewState.isEnabled && isMobileArEligible()) {
        drawSkyArView(skyFullscreenCanvas, latestSkyContext);
        return;
    }

    drawSkyDiagram(skyFullscreenCanvas, latestVisiblePlanets, latestSkyContext);
}

function renderVisiblePlanets(latitude, longitude) {
    const skySampleDate = getSkyRenderDate();
    planetWindowElement.innerText = `Snapshot: ${formatLocalTime(skySampleDate.toISOString())}`;

    const visiblePlanets = [];
    const planetStatuses = [];

    for (const planetName of allPlanetNames) {
        const displayCoordinates = getPlanetHorizontalCoordinates(planetName, skySampleDate, latitude, longitude);
        const isVisible = displayCoordinates.altitudeDegrees >= 0;

        planetStatuses.push({
            planetName,
            displayAltitude: displayCoordinates.altitudeDegrees,
            isVisible
        });

        if (isVisible) {
            visiblePlanets.push({
                planetName,
                displayAltitude: displayCoordinates.altitudeDegrees,
                displayAzimuth: displayCoordinates.azimuthDegrees
            });
        }
    }

    renderPlanetStatusList(planetListElement, planetStatuses);
    renderPlanetStatusList(planetListFullscreenElement, planetStatuses, { compactNamesOnly: true });

    latestVisiblePlanets = visiblePlanets;
    latestSkyContext = {
        date: skySampleDate,
        latitude,
        longitude
    };

    if (visiblePlanets.length === 0) {
        drawSkyDiagram(skyCanvas, [], latestSkyContext);

        if (skyFullscreenElement != null && !skyFullscreenElement.hidden) {
            drawActiveFullscreenSky();
        }

        return;
    }

    visiblePlanets.sort((a, b) => b.displayAltitude - a.displayAltitude);

    drawSkyDiagram(skyCanvas, visiblePlanets, latestSkyContext);

    if (skyFullscreenElement != null && !skyFullscreenElement.hidden) {
        drawActiveFullscreenSky();
    }

    updateMoonPhase(skySampleDate);
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
        if (planetListFullscreenElement != null) {
            planetListFullscreenElement.innerHTML = "<li class=\"planet-status-item\"><span class=\"planet-name\">Planet visibility unavailable.</span></li>";
        }
        latestVisiblePlanets = [];
        latestSkyContext = null;
        drawSkyDiagram(skyCanvas, []);

        if (skyFullscreenElement != null && !skyFullscreenElement.hidden) {
            drawActiveFullscreenSky();
        }

        sunStatus.innerText = "Could not fetch sun times. Please try again.";
        console.error(error);
    }
}

function updateMoonPhase(date = new Date()) {
    const phaseData = getMoonPhaseData(date);
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

function openSkyFullscreen(options = {}) {
    const { suppressHistory = false } = options;

    if (skyFullscreenElement == null || skyFullscreenCanvas == null) {
        return;
    }

    const wasHidden = skyFullscreenElement.hidden;
    skyFullscreenElement.hidden = false;
    updateSkyArUiState();
    drawActiveFullscreenSky();
    resetFullscreenSkyTransform();
    requestSkyFullscreen();

    if (!suppressHistory && wasHidden && !isApplyingSkyHistoryNavigation) {
        const currentView = getSkyHistoryView();
        if (currentView === skyHistoryViewMain) {
            setSkyHistoryView(skyHistoryViewFullscreen);
        } else if (currentView === skyHistoryViewAr) {
            setSkyHistoryView(skyHistoryViewFullscreen, { replace: true });
        }
    }
}

function closeSkyFullscreen(options = {}) {
    const { suppressHistory = false } = options;

    if (skyFullscreenElement == null) {
        return;
    }

    if (!suppressHistory && !isApplyingSkyHistoryNavigation) {
        const currentView = getSkyHistoryView();
        if (currentView === skyHistoryViewAr) {
            history.go(-2);
            return;
        }

        if (currentView === skyHistoryViewFullscreen) {
            history.back();
            return;
        }
    }

    if (skyFullscreenElement.hidden) {
        return;
    }

    void setSkyArModeEnabled(false);
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

    if (skyArToggleButton != null) {
        skyArToggleButton.addEventListener("click", async () => {
            if (skyArViewState.isEnabled) {
                if (!isApplyingSkyHistoryNavigation && getSkyHistoryView() === skyHistoryViewAr) {
                    history.back();
                    return;
                }

                await setSkyArModeEnabled(false);
                drawActiveFullscreenSky();
                return;
            }

            await setSkyArModeEnabled(true);

            if (skyArViewState.isEnabled && !isApplyingSkyHistoryNavigation && getSkyHistoryView() !== skyHistoryViewAr) {
                setSkyHistoryView(skyHistoryViewAr);
            }

            drawActiveFullscreenSky();
        });
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

    if (skyFullscreenHudElement != null) {
        const swallowHudEvent = event => {
            event.stopPropagation();
        };

        ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel", "mousedown", "mouseup", "touchstart", "touchmove", "touchend", "click"].forEach(
            eventName => {
                skyFullscreenHudElement.addEventListener(eventName, swallowHudEvent);
            }
        );
    }

    skyFullscreenStageElement.addEventListener("wheel", event => {
        if (skyArViewState.isEnabled) {
            return;
        }

        if (event.target !== skyFullscreenCanvas) {
            return;
        }

        event.preventDefault();
        const zoomFactor = event.deltaY < 0 ? 1.12 : 0.9;
        fullscreenSkyViewState.scale = clampScale(fullscreenSkyViewState.scale * zoomFactor);
        applyFullscreenSkyTransform();
    }, { passive: false });

    skyFullscreenStageElement.addEventListener("pointerdown", event => {
        if (skyArViewState.isEnabled) {
            return;
        }

        if (event.target !== skyFullscreenCanvas) {
            return;
        }

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
        if (skyArViewState.isEnabled) {
            return;
        }

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

function stopSkyTimePlayback() {
    if (skyTimePlayIntervalId != null) {
        clearInterval(skyTimePlayIntervalId);
        skyTimePlayIntervalId = null;
    }

    setTimePlayButtonsState(false);
}

function setSkyTimeOffset(nextOffsetMinutes, { syncSlider = true } = {}) {
    const clamped = Math.max(-720, Math.min(720, Math.round(nextOffsetMinutes / 5) * 5));
    skyTimeOffsetMinutes = clamped;

    if (syncSlider) {
        if (skyTimeSlider != null) {
            skyTimeSlider.value = String(clamped);
        }
        if (skyTimeSliderFullscreen != null) {
            skyTimeSliderFullscreen.value = String(clamped);
        }
    }

    updateSkyTimeLabel();
}

function initializeTimeTravelControls() {
    setSkyTimeOffset(0);

    const attachSliderHandler = sliderElement => {
        if (sliderElement == null) {
            return;
        }

        sliderElement.addEventListener("input", event => {
            const target = Number.parseInt(event.target.value, 10);
            if (!Number.isFinite(target)) {
                return;
            }

            stopSkyTimePlayback();
            setSkyTimeOffset(target);
            scheduleRerenderSkyForCurrentInputs();
        });
    };

    attachSliderHandler(skyTimeSlider);
    attachSliderHandler(skyTimeSliderFullscreen);

    const attachNowHandler = buttonElement => {
        if (buttonElement == null) {
            return;
        }

        buttonElement.addEventListener("click", () => {
            stopSkyTimePlayback();
            setSkyTimeOffset(0);
            scheduleRerenderSkyForCurrentInputs();
        });
    };

    attachNowHandler(skyTimeNowButton);
    attachNowHandler(skyTimeNowButtonFullscreen);

    const attachPlayHandler = buttonElement => {
        if (buttonElement == null) {
            return;
        }

        buttonElement.addEventListener("click", () => {
            if (skyTimePlayIntervalId != null) {
                stopSkyTimePlayback();
                return;
            }

            setTimePlayButtonsState(true);

            skyTimePlayIntervalId = window.setInterval(() => {
                const nextOffset = skyTimeOffsetMinutes >= 720 ? -720 : skyTimeOffsetMinutes + 10;
                setSkyTimeOffset(nextOffset);
                scheduleRerenderSkyForCurrentInputs();
            }, 350);
        });
    };

    attachPlayHandler(skyTimePlayButton);
    attachPlayHandler(skyTimePlayButtonFullscreen);
}

function buildSkyShareCardBlob() {
    return new Promise(resolve => {
        const cardCanvas = document.createElement("canvas");
        cardCanvas.width = 1200;
        cardCanvas.height = 630;
        const context = cardCanvas.getContext("2d");
        if (context == null) {
            resolve(null);
            return;
        }

        const gradient = context.createLinearGradient(0, 0, cardCanvas.width, cardCanvas.height);
        gradient.addColorStop(0, "#0a1730");
        gradient.addColorStop(1, "#12284a");
        context.fillStyle = gradient;
        context.fillRect(0, 0, cardCanvas.width, cardCanvas.height);

        context.fillStyle = "rgba(255, 255, 255, 0.12)";
        context.fillRect(32, 32, cardCanvas.width - 64, cardCanvas.height - 64);

        context.fillStyle = "#eaf4ff";
        context.font = "700 52px Outfit, sans-serif";
        context.fillText("Tonight's Sky", 70, 110);

        context.font = "500 26px Outfit, sans-serif";
        context.fillStyle = "#8fd9ff";
        context.fillText(locationReadout.innerText, 70, 152);

        context.font = "500 24px Outfit, sans-serif";
        context.fillStyle = "#d7ecff";
        context.fillText(`Sky time: ${formatClockTime(getSkyRenderDate())}`, 70, 188);

        if (skyCanvas != null) {
            context.drawImage(skyCanvas, 70, 220, 360, 360);
        }

        if (moonCanvas != null) {
            context.drawImage(moonCanvas, 460, 250, 170, 170);
        }

        context.font = "600 26px Outfit, sans-serif";
        context.fillStyle = "#f2f8ff";
        context.fillText("Visible Planets", 670, 260);

        context.font = "500 23px Outfit, sans-serif";
        const listStartY = 296;
        if (latestVisiblePlanets.length === 0) {
            context.fillStyle = "#b7d6ec";
            context.fillText("No major planets currently above horizon", 670, listStartY);
        } else {
            latestVisiblePlanets.slice(0, 7).forEach((planet, index) => {
                context.fillStyle = "#d4e8fb";
                context.fillText(
                    `${planet.planetName} (${planet.displayAltitude.toFixed(0)} deg alt)`,
                    670,
                    listStartY + index * 34
                );
            });
        }

        context.font = "500 20px Outfit, sans-serif";
        context.fillStyle = "#9ec9e6";
        context.fillText("Shared from Astronomy Tool", 670, 552);

        cardCanvas.toBlob(blob => resolve(blob), "image/png");
    });
}

function initializeShareSkyCard() {
    const shareButtons = [shareSkyButton, shareSkyButtonFullscreen].filter(button => button != null);
    if (shareButtons.length === 0) {
        return;
    }

    const setShareButtonsBusyState = isBusy => {
        for (const button of shareButtons) {
            button.disabled = isBusy;
            button.innerText = isBusy ? "Preparing..." : "Share Sky Card";
        }
    };

    const handleShare = async () => {
        setShareButtonsBusyState(true);

        try {
            const blob = await buildSkyShareCardBlob();
            if (blob == null) {
                throw new Error("Could not create sky card image");
            }

            const file = new File([blob], "tonights-sky.png", { type: "image/png" });
            const canUseWebShare = navigator.share != null && navigator.canShare != null && navigator.canShare({ files: [file] });

            if (canUseWebShare) {
                await navigator.share({
                    title: "Tonight's Sky",
                    text: "Sky snapshot from Astronomy Tool",
                    files: [file]
                });
            } else {
                const downloadUrl = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = downloadUrl;
                link.download = "tonights-sky.png";
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(downloadUrl);
            }
        } catch (error) {
            console.error(error);
            sunStatus.innerText = "Could not create sky card right now.";
        } finally {
            setShareButtonsBusyState(false);
        }
    };

    for (const button of shareButtons) {
        button.addEventListener("click", handleShare);
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

    initializeSkyHistoryNavigation();

    refreshButton.addEventListener("click", refreshFromInputs);
    initializeProgressiveWebApp();
    initializeCityPicker();
    initializeTimeTravelControls();
    initializeShareSkyCard();
    const locationController = initializeLocationButton();
    initializeFullscreenSkyInteractions();
    updateSkyArUiState();

    window.addEventListener("resize", () => {
        updateSkyArUiState();
        if (skyArViewState.isEnabled && !isMobileArEligible()) {
            void setSkyArModeEnabled(false);
            if (getSkyHistoryView() === skyHistoryViewAr) {
                setSkyHistoryView(skyHistoryViewFullscreen, { replace: true });
            }
        }
        scheduleRerenderSkyForCurrentInputs();
    });

    window.addEventListener("astronomy-theme-change", () => {
        scheduleRerenderSkyForCurrentInputs();
    });

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

    updateMoonPhase(getSkyRenderDate());
}

document.addEventListener("DOMContentLoaded", initializePage);
