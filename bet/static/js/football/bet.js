/**
 * @typedef {Object} FootballBetData
 * @property {string} team_name - Name of the team
 * @property {string} name - Name of the participant
 * @property {number} played - Matches played
 * @property {number} points - Points associated with the bet
 * @property {string} owea - Owed amount A
 * @property {number} amounta - Amount A
 * @property {string} oweb - Owed amount B
 * @property {number} amountb - Amount B
 * @property {string} balance - Balance description or value
 * @property {number} balance_amount - Balance amount
 * @property {boolean} live - Whether the match is live
 * @property {string|null} home_team - Home team name (if live)
 * @property {string|null} away_team - Away team name (if live)
 * @property {number|null} home_team_score - Home team score (if live)
 * @property {number|null} away_team_score - Away team score (if live)
 */

/**
 * @typedef {Object} FootballBetList
 * @property {FootballBetData[]} bets - Ordered list of bet data
 */

var gotDataFromNetwork = false;

document.addEventListener("DOMContentLoaded", async function () {
    // Register the service worker
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("sw.js").then(
            (registration) => {
                navigator.serviceWorker.ready.then(() => {
                    registration.active.postMessage({ messageType: "getCachedBetData" });
                });
            },
            (error) => {
                console.error(`Service worker registration failed: ${error}`);
            },
        );
    } else {
        console.error("Service workers are not supported.");
    }

    // Get the initial bet data when the page loads
    await getBetData();

    // Set up an interval to refresh the bet data every 10 seconds
    setInterval(getBetData, 10000);
});


/**
 * Updates the UI with the latest bet data.
 *
 * Iterates through the provided bet data and updates corresponding DOM elements
 * for each bet widget, including team styling, live status, scores, and various
 * financial/statistical fields. Applies appropriate CSS classes for positive/negative
 * money values and handles live/non-live state transitions.
 *
 * @param {FootballBetList} data - The data object containing bet information.
 * @param {boolean} cached - Indicates if the data is from cache.
 */
function handleBetDataUpdate(data, cached) {
    // If we got data from the network, ignore cached data
    if (!cached) {
        gotDataFromNetwork = true;
    }

    if (gotDataFromNetwork && cached) {
        return;
    }

    // Process the bet data
    data.bets.forEach((bet, index) => {
        const widget = document.getElementById(`bet-widget-${index}`);
        if (widget) {
            widget.classList.remove("bet-widget-liverpool", "bet-widget-chelsea", "bet-widget-tottenham");
            widget.classList.add(`bet-widget-${bet.team_name}`);
            widget.querySelector(`#name-${index}`).textContent = bet.name;
            const stats = widget.querySelector(`#stats-${index}`);
            const liveText = widget.querySelector(`#live-text-${index}`);
            const liveScoreText = widget.querySelector(`#live-score-text-${index}`);
            if (bet.live) {
                stats.classList.remove("stats-2-columns");
                stats.classList.add("stats-3-columns");
                liveText.classList.remove("hidden");
                liveText.textContent = "LIVE";
                liveScoreText.classList.remove("hidden");
                if (bet.home_team !== null && bet.away_team !== null && bet.home_team_score !== null && bet.away_team_score !== null) {
                    liveScoreText.textContent = `${bet.home_team} ${bet.home_team_score} - ${bet.away_team_score} ${bet.away_team}`;
                } else {
                    liveScoreText.textContent = "";
                }
            } else {
                stats.classList.remove("stats-3-columns");
                stats.classList.add("stats-2-columns");
                liveText.classList.add("hidden");
                liveText.textContent = "";
                liveScoreText.classList.add("hidden");
                liveScoreText.textContent = "";
            }
            widget.querySelector(`#played-${index}`).textContent = bet.played;
            widget.querySelector(`#points-${index}`).textContent = bet.points;
            widget.querySelector(`#owea-${index}`).textContent = bet.owea;
            widget.querySelector(`#amounta-${index}`).textContent = "£" + bet.amounta;
            widget.querySelector(`#amounta-${index}`).classList.remove("money-positive", "money-negative");
            if (bet.amounta > 0) {
                widget.querySelector(`#amounta-${index}`).classList.add("money-positive");
            } else if (bet.amounta < 0) {
                widget.querySelector(`#amounta-${index}`).classList.add("money-negative");
            }
            widget.querySelector(`#oweb-${index}`).textContent = bet.oweb;
            widget.querySelector(`#amountb-${index}`).textContent = "£" + bet.amountb;
            widget.querySelector(`#amountb-${index}`).classList.remove("money-positive", "money-negative");
            if (bet.amountb > 0) {
                widget.querySelector(`#amountb-${index}`).classList.add("money-positive");
            } else if (bet.amountb < 0) {
                widget.querySelector(`#amountb-${index}`).classList.add("money-negative");
            }
            widget.querySelector(`#best_case-${index}`).textContent = "£" + bet.best_case;
            widget.querySelector(`#best_case-${index}`).classList.remove("money-positive", "money-negative");
            if (bet.best_case > 0) {
                widget.querySelector(`#best_case-${index}`).classList.add("money-positive");
            } else if (bet.best_case < 0) {
                widget.querySelector(`#best_case-${index}`).classList.add("money-negative");
            }
            widget.querySelector(`#worst_case-${index}`).textContent = "£" + bet.worst_case;
            widget.querySelector(`#worst_case-${index}`).classList.remove("money-positive", "money-negative");
            if (bet.worst_case > 0) {
                widget.querySelector(`#worst_case-${index}`).classList.add("money-positive");
            } else if (bet.worst_case < 0) {
                widget.querySelector(`#worst_case-${index}`).classList.add("money-negative");
            }
            widget.querySelector(`#balance-${index}`).textContent = bet.balance;
            widget.querySelector(`#balance-amount-${index}`).textContent = "£" + bet.balance_amount;
            widget.querySelector(`#balance-amount-${index}`).classList.remove("money-positive", "money-negative");
            if (bet.balance_amount > 0) {
                widget.querySelector(`#balance-amount-${index}`).classList.add("money-positive");
            } else if (bet.balance_amount < 0) {
                widget.querySelector(`#balance-amount-${index}`).classList.add("money-negative");
            }
        }
    });
}

navigator.serviceWorker.addEventListener("message", (event) => {
    switch (event.data.messageType) {
        case "cachedBetData":
            // Process the cached bet data
            /** @type {FootballBetList} */
            const cachedData = event.data.data;
            handleBetDataUpdate(cachedData, true);
            break;
        default:
            console.error(`Unknown message type: ${event.data.messageType}`);
            break;
    }
});

async function getBetData() {
    /** @type {Promise<FootballBetList>} */
    fetch("/football/bet/data/")
        .then(response => response.json())
        .then(/** @param {FootballBetList} data */ data => handleBetDataUpdate(data, false))
        .catch(error => {
            console.error("Error fetching bet data:", error);
        });
}
