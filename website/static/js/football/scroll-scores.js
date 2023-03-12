// Add a callback for state changes
document.addEventListener('readystatechange', event => {
    if (event.target.readyState === "complete") {
        // Get the score widgets in the page
        scoreWidgets = document.getElementsByClassName("score-widget");

        // Loop through the score widgets
        for (var index = 0; index < scoreWidgets.length; index++) {
            // Get the score widget at this index
            scoreWidget = scoreWidgets[index];

            // Get the match status div (there should only be one)
            matchStatusDivs = scoreWidget.getElementsByClassName("match-status");

            // Check there is one and only one match status div
            if (matchStatusDivs.length === 1) {
                // Get the match status text
                matchStatus = matchStatusDivs[0].innerHTML;

                // If it is the first Not Started of In Play break out of the loop
                if (matchStatus === "Not Started" || matchStatus === "In Play") {
                    break;
                }
            }
        }

        // Only scroll if the index is greater than 0 and less than the number of score widgets
        if (index > 0 && index < scoreWidgets.length) {
            // Move the index back one
            index = index - 1;

            // Get the widget to scroll to
            widgetToScrollTo = scoreWidgets[index];
    
            // Scroll the widget to the vertical centre of the view (this is the containing div, not the centre of the screen)
            widgetToScrollTo.scrollIntoView({behaviour: "smooth", block: "center", inline: "nearest"});
        }
    }
});
