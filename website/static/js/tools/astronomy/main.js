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
const skyFullscreenElement = document.getElementById("sky-fullscreen");
const skyFullscreenStageElement = document.getElementById("sky-fullscreen-stage");
const skyCloseButton = document.getElementById("sky-close-button");
const skyFullscreenCanvas = document.getElementById("sky-canvas-fullscreen");

let latestVisiblePlanets = [];
let latestSkyContext = null;

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

const satelliteTracks = [
    {
        name: "ISS",
        color: "#ffb866",
        inclination: 51.64,
        raan: 257.4,
        meanAnomaly0: 24,
        periodMinutes: 92.68,
        epochMs: Date.UTC(2026, 0, 1, 0, 0, 0)
    },
    {
        name: "Tiangong",
        color: "#7fe3ff",
        inclination: 41.5,
        raan: 104.8,
        meanAnomaly0: 278,
        periodMinutes: 91.7,
        epochMs: Date.UTC(2026, 0, 1, 0, 0, 0)
    },
    {
        name: "Hubble",
        color: "#bfa9ff",
        inclination: 28.47,
        raan: 34.2,
        meanAnomaly0: 132,
        periodMinutes: 95.42,
        epochMs: Date.UTC(2026, 0, 1, 0, 0, 0)
    }
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

function getHorizontalCoordinatesFromEquatorial(raDegrees, decDegrees, date, latitude, longitude) {
    const jd = toJulianDate(date);
    const gmst = normalizeDegrees(280.46061837 + 360.98564736629 * (jd - 2451545));
    const lst = normalizeDegrees(gmst + longitude);
    const hourAngle = toRadians(normalizeDegrees(lst - raDegrees));

    const latitudeRadians = toRadians(latitude);
    const declination = toRadians(decDegrees);

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

function projectToSky(azimuthDegrees, altitudeDegrees, cx, cy, radius) {
    const radialDistance = (90 - altitudeDegrees) / 90 * radius;
    const azimuthRadians = toRadians(azimuthDegrees);

    return {
        x: cx + radialDistance * Math.sin(azimuthRadians),
        y: cy - radialDistance * Math.cos(azimuthRadians)
    };
}

function getSatelliteHorizontalCoordinates(track, date, latitude, longitude) {
    const elapsedMinutes = (date.getTime() - track.epochMs) / (60 * 1000);
    const orbitalRate = 360 / track.periodMinutes;
    const argumentLatitude = toRadians(normalizeDegrees(track.meanAnomaly0 + orbitalRate * elapsedMinutes));
    const inclination = toRadians(track.inclination);
    const raan = toRadians(normalizeDegrees(track.raan));

    const x = Math.cos(raan) * Math.cos(argumentLatitude)
        - Math.sin(raan) * Math.sin(argumentLatitude) * Math.cos(inclination);
    const y = Math.sin(raan) * Math.cos(argumentLatitude)
        + Math.cos(raan) * Math.sin(argumentLatitude) * Math.cos(inclination);
    const z = Math.sin(argumentLatitude) * Math.sin(inclination);

    const rightAscension = normalizeDegrees(toDegrees(Math.atan2(y, x)));
    const declination = toDegrees(Math.atan2(z, Math.sqrt(x * x + y * y)));

    return getHorizontalCoordinatesFromEquatorial(rightAscension, declination, date, latitude, longitude);
}

function buildSatellitePathSegments(skyContext) {
    if (skyContext == null) {
        return [];
    }

    const { date, latitude, longitude, windowStart, windowEnd } = skyContext;
    const start = windowStart == null ? new Date(date.getTime() - 45 * 60 * 1000) : windowStart;
    const end = windowEnd == null ? new Date(date.getTime() + 45 * 60 * 1000) : windowEnd;
    const sampleStepMs = 6 * 60 * 1000;

    return satelliteTracks.map(track => {
        const segments = [];
        let activeSegment = [];

        for (let t = start.getTime(); t <= end.getTime(); t += sampleStepMs) {
            const sampleDate = new Date(t);
            const horizontal = getSatelliteHorizontalCoordinates(track, sampleDate, latitude, longitude);

            if (horizontal.altitudeDegrees < 0) {
                if (activeSegment.length > 1) {
                    segments.push(activeSegment);
                }
                activeSegment = [];
                continue;
            }

            activeSegment.push(horizontal);
        }

        if (activeSegment.length > 1) {
            segments.push(activeSegment);
        }

        const currentHorizontal = getSatelliteHorizontalCoordinates(track, date, latitude, longitude);
        const isCurrentlyVisible = currentHorizontal.altitudeDegrees >= 0;

        return {
            name: track.name,
            color: track.color,
            segments,
            currentHorizontal: isCurrentlyVisible ? currentHorizontal : null
        };
    });
}

function drawSatellitePaths(ctx, cx, cy, radius, skyContext) {
    const paths = buildSatellitePathSegments(skyContext);

    for (const path of paths) {
        ctx.strokeStyle = path.color;
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        for (const segment of path.segments) {
            if (segment.length < 2) {
                continue;
            }

            ctx.beginPath();
            segment.forEach((sample, index) => {
                const point = projectToSky(sample.azimuthDegrees, sample.altitudeDegrees, cx, cy, radius);
                if (index === 0) {
                    ctx.moveTo(point.x, point.y);
                } else {
                    ctx.lineTo(point.x, point.y);
                }
            });
            ctx.stroke();

            const labelIndex = Math.floor(segment.length / 2);
            const labelSample = segment[labelIndex];
            const labelPoint = projectToSky(labelSample.azimuthDegrees, labelSample.altitudeDegrees, cx, cy, radius);
            ctx.fillStyle = path.color;
            ctx.font = "11px Outfit, sans-serif";
            ctx.textAlign = "left";
            ctx.fillText(`${path.name} path`, labelPoint.x + 6, labelPoint.y - 4);
            break;
        }

        if (path.currentHorizontal == null) {
            continue;
        }

        const nowPoint = projectToSky(path.currentHorizontal.azimuthDegrees, path.currentHorizontal.altitudeDegrees, cx, cy, radius);
        ctx.beginPath();
        ctx.arc(nowPoint.x, nowPoint.y, 3.8, 0, Math.PI * 2);
        ctx.fillStyle = path.color;
        ctx.fill();
        ctx.strokeStyle = "hsla(218, 34%, 14%, 0.9)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = path.color;
        ctx.font = "11px Outfit, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`${path.name} now`, nowPoint.x + 6, nowPoint.y + 2);
    }
}

function drawConstellationOverlay(ctx, cx, cy, radius, skyContext) {
    if (skyContext == null) {
        return;
    }

    const { date, latitude, longitude } = skyContext;
    ctx.strokeStyle = "hsla(204, 65%, 80%, 0.34)";
    ctx.fillStyle = "hsla(204, 65%, 82%, 0.82)";
    ctx.lineWidth = 1;

    for (const constellation of constellations) {
        const projectedStars = {};

        for (const [starName, coordinates] of Object.entries(constellation.stars)) {
            const horizontal = getHorizontalCoordinatesFromEquatorial(
                coordinates.ra,
                coordinates.dec,
                date,
                latitude,
                longitude
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
            ctx.font = "11px Outfit, sans-serif";
            ctx.fillText(constellation.name, labelAnchor.x + 5, labelAnchor.y + 12);
        }
    }
}

function drawPolarisOverlay(ctx, cx, cy, radius, skyContext) {
    if (skyContext == null) {
        return;
    }

    const { date, latitude, longitude } = skyContext;
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
            longitude
        );

        if (horizontal.altitudeDegrees < 0) {
            continue;
        }

        const point = projectToSky(horizontal.azimuthDegrees, horizontal.altitudeDegrees, cx, cy, radius);
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "hsl(50, 100%, 82%)";
        ctx.fill();
        ctx.strokeStyle = "hsla(220, 45%, 12%, 0.9)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = "hsla(53, 100%, 88%, 0.96)";
        ctx.font = "12px Outfit, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(poleStar.name, point.x + 7, point.y - 8);
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

    drawConstellationOverlay(ctx, cx, cy, radius, skyContext);
    drawPolarisOverlay(ctx, cx, cy, radius, skyContext);
    drawSatellitePaths(ctx, cx, cy, radius, skyContext);

    if (visiblePlanets.length === 0) {
        ctx.fillStyle = "hsla(210, 26%, 88%, 0.86)";
        ctx.font = "13px Outfit, sans-serif";
        ctx.fillText("No visible planets", cx, cy + 4);
        return;
    }

    ctx.textAlign = "left";
    for (const planet of visiblePlanets) {
        const planetPoint = projectToSky(planet.bestAzimuth, planet.maxAltitude, cx, cy, radius);
        const x = planetPoint.x;
        const y = planetPoint.y;

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
    const skySampleDate = new Date((start.getTime() + end.getTime()) / 2);
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

    latestVisiblePlanets = visiblePlanets;
    latestSkyContext = {
        date: skySampleDate,
        latitude,
        longitude,
        windowStart: start,
        windowEnd: end
    };

    if (visiblePlanets.length === 0) {
        const item = document.createElement("li");
        item.innerText = "No major planets rise above 10 degrees in this window.";
        planetListElement.appendChild(item);
        drawSkyDiagram(skyCanvas, [], latestSkyContext);

        if (skyFullscreenElement != null && !skyFullscreenElement.hidden) {
            drawSkyDiagram(skyFullscreenCanvas, [], latestSkyContext);
        }

        return;
    }

    visiblePlanets.sort((a, b) => b.maxAltitude - a.maxAltitude);

    for (const planet of visiblePlanets) {
        const item = document.createElement("li");
        item.innerText = `${planet.planetName}: up to ${planet.maxAltitude.toFixed(0)} degrees at ${formatClockTime(planet.bestTime)}`;
        planetListElement.appendChild(item);
    }

    drawSkyDiagram(skyCanvas, visiblePlanets, latestSkyContext);

    if (skyFullscreenElement != null && !skyFullscreenElement.hidden) {
        drawSkyDiagram(skyFullscreenCanvas, visiblePlanets, latestSkyContext);
    }
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
    if (skyFullscreenElement != null) {
        skyFullscreenElement.hidden = true;
    }

    refreshButton.addEventListener("click", refreshFromInputs);
    initializeLocationButton();
    initializeFullscreenSkyInteractions();

    refreshFromInputs();
    updateMoonPhase();
    drawSkyDiagram(skyCanvas, []);
}

document.addEventListener("DOMContentLoaded", initializePage);
