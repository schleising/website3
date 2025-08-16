/**
 * @typedef {Object} FootballBetData
 * @property {string} team_name - Name of the team
 * @property {string} name - Name of the participant
 * @property {number} points - Points associated with the bet
 * @property {string} owea - Owed amount A
 * @property {number} amounta - Amount A
 * @property {string} oweb - Owed amount B
 * @property {number} amountb - Amount B
 * @property {string} balance - Balance description or value
 * @property {number} balance_amount - Balance amount
 */

/**
 * @typedef {Object} FootballBetList
 * @property {FootballBetData[]} bets - Ordered list of bet data
 */


document.addEventListener("DOMContentLoaded", function () {
    // Get the initial bet data when the page loads
    getBetData();

    // Set up an interval to refresh the bet data every 10 seconds
    setInterval(getBetData, 10000);
});

function getBetData() {
    fetch("/football/bet/data")
        .then(response => response.json())
        .then(
            /** @param {FootballBetList} data */
            data => {
                // Process the bet data
                data.bets.forEach((bet, index) => {
                    const widget = document.getElementById(`bet-widget-${index}`);
                    if (widget) {
                        widget.classList.remove("bet-widget-liverpool", "bet-widget-chelsea", "bet-widget-tottenham");
                        widget.classList.add(`bet-widget-${bet.team_name}`);
                        widget.querySelector(`#name-${index}`).textContent = bet.name;
                        widget.querySelector(`#points-${index}`).textContent = bet.points + "Pts";
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
            })
        .catch(error => {
            console.error("Error fetching bet data:", error);
        });
}
