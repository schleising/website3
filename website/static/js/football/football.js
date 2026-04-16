// Variable which will contain the websocket
var ws;

// Variable which will contain the websocket url
var url;

// Variable for the periodic task
var intervalId = null;

// True when at least one current-day match is still due or live and polling should continue.
var shouldPollForUpdates = false;

// Latest Matches view needs an initial full-window payload to hydrate all visible day rows.
var isLiveMatchesView = false;

// Add a callback for state changes
document.addEventListener('readystatechange', event => {
    if (event.target.readyState === "complete") {
        console.log("Load Event")
        const pageUrl = new URL(window.location.href);
        const wsProtocol = pageUrl.protocol === "https:" ? "wss:" : "ws:";

        // Always use the football websocket endpoint, regardless of current sub-route.
        url = `${wsProtocol}//${pageUrl.host}/football/ws/${pageUrl.search}`;

        const footballContent = document.querySelector('.football-content-pad');
        isLiveMatchesView = footballContent?.dataset.liveMatchesView === 'true';

        // Check whether the websocket is open, if not open it
        openWebSocket();
    }
});

// Function to open a web socket
function openWebSocket() {
    console.log("Opening Websocket")
    // Create a new WebSocket
    ws = new WebSocket(url);

    // Setup callback for onmessage event
    ws.onmessage = event => {
        // Parse the message into a json object
        matches = JSON.parse(event.data);

        matches.matches.forEach(match => {
            var status;
            var home;
            var away;

            switch (match.status) {
                case 'SCHEDULED':
                case 'TIMED':
                case 'AWARDED':
                    status = 'Not Started';
                    break;
                case 'IN_PLAY':
                    if (match.minute != null) {
                        status = match.minute + '\'';

                        if (match.injury_time != null) {
                            status = status.slice(0, -1) + '+' + match.injury_time + '\'';
                        }
                    } else {
                        status = 'In Play';
                    }

                    break;
                case 'PAUSED':
                    status = 'Half Time';
                    break;
                case 'FINISHED':
                    status = 'Full Time';
                    break;
                case 'SUSPENDED':
                    status = 'Suspended';
                    break;
                case 'POSTPONED':
                    status = 'Postponed';
                    break;
                case 'CANCELLED':
                    status = 'Cancelled';
                    break;
            }

            if (match.score.full_time.home == null) {
                home = '-';
            } else {
                home = match.score.full_time.home;
            }

            if (match.score.full_time.away == null) {
                away = '-';
            } else {
                away = match.score.full_time.away;
            }

            scoreWidget = document.getElementById(match.id);
            if (!scoreWidget) {
                return;
            }

            scoreWidget.getElementsByClassName("match-status")[0].innerHTML = status;
            scoreWidget.getElementsByClassName("home-team-score")[0].innerHTML = home;
            scoreWidget.getElementsByClassName("away-team-score")[0].innerHTML = away;
        });

        shouldPollForUpdates = hasRefreshableMatchToday(matches.matches);
        syncPollingInterval();
    };

    // Add the event listener
    ws.addEventListener('open', (event) => {
        console.log("Initial Football Websocket Refresh")
        shouldPollForUpdates = false;
        syncPollingInterval();
        sendMessage(!isLiveMatchesView);
    });
};

function checkSocketAndSendMessage(event) {
    // Send the messsage, checking that the socket is open
    // If the socket is not open, open a new one and wait for it to be ready
    if (ws.readyState != WebSocket.OPEN) {
        // Open the new socket
        openWebSocket();
    } else {
        if (!shouldPollForUpdates) {
            return;
        }

        // If the socket is already open, just send the message
        sendMessage(true);
    }
};

function sendMessage(currentDayOnly) {
    const shouldRequestCurrentDayOnly = currentDayOnly !== false;

    // Create the message
    msg = {
        messageType: 'get_scores',
        currentDayOnly: shouldRequestCurrentDayOnly,
    };

    // Convert the JSON to a string and send it to the server
    ws.send(JSON.stringify(msg));
};

function hasRefreshableMatchToday(matchList) {
    if (!Array.isArray(matchList)) {
        return false;
    }

    const refreshStatuses = new Set([
        'SCHEDULED',
        'TIMED',
        'AWARDED',
        'IN_PLAY',
        'PAUSED',
        'SUSPENDED',
    ]);

    return matchList.some(match => refreshStatuses.has(match.status) && isTodayMatch(match));
}

function isTodayMatch(match) {
    if (!match || (typeof match !== 'object')) {
        return false;
    }

    const rawDate = match.local_date || match.utc_date;
    if (!rawDate) {
        return false;
    }

    const parsedDate = new Date(rawDate);
    if (Number.isNaN(parsedDate.getTime())) {
        return false;
    }

    const now = new Date();
    return parsedDate.getFullYear() === now.getFullYear()
        && parsedDate.getMonth() === now.getMonth()
        && parsedDate.getDate() === now.getDate();
}

function syncPollingInterval() {
    if (shouldPollForUpdates) {
        if (intervalId == null) {
            intervalId = setInterval(checkSocketAndSendMessage, 1000);
        }
        return;
    }

    if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
    }
}
