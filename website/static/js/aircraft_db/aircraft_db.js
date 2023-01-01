function parseAircraftData(jsn) {
    const dataset = JSON.parse(jsn);
    for (var key in dataset) {
        var element = document.getElementById(key)

        if (element) {
            element.innerHTML = dataset[key]
        }
    }
};
