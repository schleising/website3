document.addEventListener("readystatechange", event => {
    if (event.target.readyState === "complete") {
        initialiseInputCardToggle();
        resetResultsScrollPosition();
        bindCrestPreview("team-a-select", "team-a-crest");
        bindCrestPreview("team-b-select", "team-b-crest");
        initialiseOutcomeBarColours();
    }
});

function resetResultsScrollPosition() {
    const resultsScroller = document.querySelector(".h2h-results-scroll");

    if (!resultsScroller) {
        return;
    }

    resultsScroller.scrollTop = 0;
}

function initialiseInputCardToggle() {
    const inputCard = document.getElementById("h2h-input-card");
    const toggleButton = document.getElementById("h2h-input-toggle");
    const toggleIcon = document.getElementById("h2h-input-toggle-icon");
    const contentElement = document.getElementById("h2h-input-content");

    if (!inputCard || !toggleButton || !contentElement) {
        return;
    }

    const applyToggleState = isCollapsed => {
        inputCard.classList.toggle("collapsed", isCollapsed);
        toggleButton.setAttribute("aria-expanded", String(!isCollapsed));
        if (toggleIcon) {
            toggleIcon.textContent = isCollapsed ? "▼" : "▲";
        }

        if (isCollapsed) {
            contentElement.style.maxHeight = "0px";
        } else {
            contentElement.style.maxHeight = contentElement.scrollHeight + "px";
        }
    };

    toggleButton.addEventListener("click", () => {
        applyToggleState(!inputCard.classList.contains("collapsed"));
    });

    toggleButton.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            applyToggleState(!inputCard.classList.contains("collapsed"));
        }
    });

    applyToggleState(inputCard.classList.contains("collapsed"));

    if (inputCard.dataset.autoCollapse === "true") {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                applyToggleState(true);

                window.setTimeout(() => {
                    resetResultsScrollPosition();
                }, 190);
            });
        });
    }

    window.addEventListener("resize", () => {
        if (!inputCard.classList.contains("collapsed")) {
            contentElement.style.maxHeight = contentElement.scrollHeight + "px";
        }
    });
}

function bindCrestPreview(selectId, crestId) {
    const selectElement = document.getElementById(selectId);
    const crestElement = document.getElementById(crestId);

    if (!selectElement || !crestElement) {
        return;
    }

    const applyPreview = () => {
        const selectedOption = selectElement.options[selectElement.selectedIndex];
        const crestPath = selectedOption ? selectedOption.dataset.crest : "";

        if (crestPath) {
            crestElement.src = crestPath;
            crestElement.classList.remove("hidden");
        } else {
            crestElement.removeAttribute("src");
            crestElement.classList.add("hidden");
        }
    };

    selectElement.addEventListener("change", applyPreview);
    applyPreview();
}

async function initialiseOutcomeBarColours() {
    const summaryBars = document.querySelectorAll(".h2h-outcome-sticky");

    if (summaryBars.length === 0) {
        return;
    }

    for (const summaryBar of summaryBars) {
        const presetTeamAColour = normaliseHexColour(summaryBar.dataset.teamAColour);
        const presetTeamBColour = normaliseHexColour(summaryBar.dataset.teamBColour);

        const [teamAColour, teamBColour] = await Promise.all([
            presetTeamAColour
                ? Promise.resolve(presetTeamAColour)
                : derivePrimaryColourFromCrest(summaryBar.dataset.teamACrest, "#1f4570"),
            presetTeamBColour
                ? Promise.resolve(presetTeamBColour)
                : derivePrimaryColourFromCrest(summaryBar.dataset.teamBCrest, "#2a5b90"),
        ]);

        summaryBar.style.setProperty("--team-a-color", teamAColour);
        summaryBar.style.setProperty("--team-b-color", teamBColour);
        summaryBar.style.setProperty("--team-a-text", readableTextColour(teamAColour));
        summaryBar.style.setProperty("--team-b-text", readableTextColour(teamBColour));
    }
}

function normaliseHexColour(colourValue) {
    if (!colourValue) {
        return null;
    }

    const trimmed = colourValue.trim();
    const sixDigitMatch = trimmed.match(/^#([0-9a-fA-F]{6})$/);
    if (sixDigitMatch) {
        return `#${sixDigitMatch[1].toUpperCase()}`;
    }

    const threeDigitMatch = trimmed.match(/^#([0-9a-fA-F]{3})$/);
    if (threeDigitMatch) {
        const expanded = threeDigitMatch[1]
            .split("")
            .map(character => character + character)
            .join("")
            .toUpperCase();
        return `#${expanded}`;
    }

    return null;
}

function derivePrimaryColourFromCrest(sourcePath, fallbackColour) {
    return new Promise(resolve => {
        if (!sourcePath) {
            resolve(fallbackColour);
            return;
        }

        const image = new Image();

        image.addEventListener("load", () => {
            try {
                const sampleSize = 36;
                const canvas = document.createElement("canvas");
                const context = canvas.getContext("2d", { willReadFrequently: true });

                if (!context) {
                    resolve(fallbackColour);
                    return;
                }

                canvas.width = sampleSize;
                canvas.height = sampleSize;
                context.drawImage(image, 0, 0, sampleSize, sampleSize);

                const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
                let weightedRed = 0;
                let weightedGreen = 0;
                let weightedBlue = 0;
                let totalWeight = 0;

                for (let index = 0; index < pixels.length; index += 4) {
                    const red = pixels[index];
                    const green = pixels[index + 1];
                    const blue = pixels[index + 2];
                    const alpha = pixels[index + 3] / 255;

                    if (alpha < 0.22) {
                        continue;
                    }

                    const maxChannel = Math.max(red, green, blue);
                    const minChannel = Math.min(red, green, blue);
                    const saturation = maxChannel === 0 ? 0 : (maxChannel - minChannel) / maxChannel;
                    const brightness = maxChannel / 255;

                    if (brightness > 0.95 && saturation < 0.12) {
                        continue;
                    }

                    const weight = alpha * (0.62 + saturation * 1.1);
                    weightedRed += red * weight;
                    weightedGreen += green * weight;
                    weightedBlue += blue * weight;
                    totalWeight += weight;
                }

                if (totalWeight <= 0) {
                    resolve(fallbackColour);
                    return;
                }

                const baseColour = {
                    r: weightedRed / totalWeight,
                    g: weightedGreen / totalWeight,
                    b: weightedBlue / totalWeight,
                };

                const boostedColour = boostTeamColour(baseColour);
                resolve(`rgb(${boostedColour.r}, ${boostedColour.g}, ${boostedColour.b})`);
            } catch {
                resolve(fallbackColour);
            }
        });

        image.addEventListener("error", () => {
            resolve(fallbackColour);
        });

        image.src = sourcePath;
    });
}

function boostTeamColour(colour) {
    const average = (colour.r + colour.g + colour.b) / 3;
    const clamp = value => Math.max(0, Math.min(255, Math.round(value)));

    const red = clamp(colour.r * 1.04 + (colour.r - average) * 0.18);
    const green = clamp(colour.g * 1.04 + (colour.g - average) * 0.18);
    const blue = clamp(colour.b * 1.04 + (colour.b - average) * 0.18);

    return { r: red, g: green, b: blue };
}

function readableTextColour(colourValue) {
    const parsedColour = parseCssColour(colourValue);

    if (!parsedColour) {
        return "#ffffff";
    }

    const luminance =
        (0.2126 * parsedColour.r + 0.7152 * parsedColour.g + 0.0722 * parsedColour.b) /
        255;

    return luminance > 0.62 ? "#14213a" : "#ffffff";
}

function parseCssColour(colourValue) {
    if (!colourValue) {
        return null;
    }

    const rgbMatch = colourValue.match(/rgb\(\s*([0-9]+),\s*([0-9]+),\s*([0-9]+)\s*\)/i);
    if (rgbMatch) {
        return {
            r: Number.parseInt(rgbMatch[1], 10),
            g: Number.parseInt(rgbMatch[2], 10),
            b: Number.parseInt(rgbMatch[3], 10),
        };
    }

    const hexMatch = colourValue.match(/^#([0-9a-f]{6})$/i);
    if (hexMatch) {
        const value = hexMatch[1];
        return {
            r: Number.parseInt(value.slice(0, 2), 16),
            g: Number.parseInt(value.slice(2, 4), 16),
            b: Number.parseInt(value.slice(4, 6), 16),
        };
    }

    return null;
}
