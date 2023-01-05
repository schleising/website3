document.getElementById("search-button").addEventListener("click", function(event) {
    searchClicked('/aircraft/tail_no/', 'input_tail_number', parseAircraftData)
});

document.getElementById("input_tail_number").addEventListener("keyup", function(event) {
    checkForEnter(event, '/aircraft/tail_no/', 'input_tail_number', parseAircraftData)
});

function parseAircraftData(jsn) {
    const dataset = JSON.parse(jsn);
    for (var key in dataset) {
        var element = document.getElementById(key)

        if (element) {
            element.innerHTML = dataset[key]
        }
    }
};
