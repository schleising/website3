function appendKeyValueElement(element, key, value, additionalKeyClass = [], additionalValueClass = []) {
    // Create wrapper element
    var wrapperElement = document.createElement("div");
    wrapperElement.classList.add("key-value-wrapper");

    // Create key element
    var keyElement = document.createElement("div");
    keyElement.classList.add("data-key");

    if (additionalKeyClass.length > 0) {
        keyElement.classList.add(...additionalKeyClass);
    }

    // Create value element
    var valueElement = document.createElement("div");
    valueElement.classList.add("data-value");

    if (additionalValueClass.length > 0) {
        valueElement.classList.add(...additionalValueClass);
    }

    // Set key and value text
    keyElement.innerText = key;
    valueElement.innerText = value;

    // Append key and value elements as children of the wrapper
    wrapperElement.appendChild(keyElement);
    wrapperElement.appendChild(valueElement);

    // Append wrapper element as a child of the input element
    element.appendChild(wrapperElement);

    return wrapperElement;
}

function addPopover(element, data) {
    // Create popover element
    var popoverElement = document.createElement("div");
    popoverElement.popover = "auto";
    popoverElement.setAttribute("id", data.file_data_id);

    // Create popover content element
    var fileStatsPopupContainer = document.createElement("div");
    fileStatsPopupContainer.classList.add("file-stats-popup-container");

    popoverElement.appendChild(fileStatsPopupContainer);

    var fileStatsPopupHeader = document.createElement("div");
    fileStatsPopupHeader.classList.add("file-stats-popup-header");

    fileStatsPopupContainer.appendChild(fileStatsPopupHeader);

    // Create the popup header
    var fileStatsPopupTitle = document.createElement("h4");
    fileStatsPopupTitle.innerHTML = data.filename;

    fileStatsPopupHeader.appendChild(fileStatsPopupTitle);

    // Create the popover body
    var fileStatsPopupBody = document.createElement("div");
    fileStatsPopupBody.classList.add("file-stats-popup-body");

    fileStatsPopupContainer.appendChild(fileStatsPopupBody);

    // Create the popover row
    var fileStatsPopupRow = document.createElement("div");
    fileStatsPopupRow.classList.add("file-stats-popup-row");

    fileStatsPopupBody.appendChild(fileStatsPopupRow);

    // Create the popover column
    var fileStatsPopupFileColumn = document.createElement("div");
    fileStatsPopupFileColumn.classList.add("file-stats-popup-col");

    fileStatsPopupRow.appendChild(fileStatsPopupFileColumn);

    // Create the Original Size key-value pair
    originalSizeElement = document.createElement("div");
    originalSizeElement.classList.add("file-stats-popup-data");

    fileStatsPopupFileColumn.appendChild(originalSizeElement);

    newElement = document.createElement("p");
    newElement.classList.add("file-stats-popup-key");
    newElement.innerText = "Original Size";

    originalSizeElement.appendChild(newElement);

    newElement = document.createElement("p");
    newElement.classList.add("file-stats-popup-value");
    newElement.innerText = data.pre_conversion_size;

    originalSizeElement.appendChild(newElement);

    // Create the New Size key-value pair
    newSizeElement = document.createElement("div");
    newSizeElement.classList.add("file-stats-popup-data");

    fileStatsPopupFileColumn.appendChild(newSizeElement);

    newElement = document.createElement("p");
    newElement.classList.add("file-stats-popup-key");
    newElement.innerText = "New Size";

    newSizeElement.appendChild(newElement);

    newElement = document.createElement("p");
    newElement.classList.add("file-stats-popup-value");
    newElement.innerText = data.current_size;

    newSizeElement.appendChild(newElement);

    // Create the Compression Ratio key-value pair
    percentageSavedElement = document.createElement("div");
    percentageSavedElement.classList.add("file-stats-popup-data");

    fileStatsPopupFileColumn.appendChild(percentageSavedElement);

    newElement = document.createElement("p");
    newElement.classList.add("file-stats-popup-key");
    newElement.innerText = "Compression Ratio";

    percentageSavedElement.appendChild(newElement);

    newElement = document.createElement("p");
    newElement.classList.add("file-stats-popup-value");
    newElement.innerText = data.percentage_saved + "%";

    percentageSavedElement.appendChild(newElement);

    // Time values
    // Create the popover column
    var fileStatsPopupFileColumn = document.createElement("div");
    fileStatsPopupFileColumn.classList.add("file-stats-popup-col");

    fileStatsPopupRow.appendChild(fileStatsPopupFileColumn);

    // Create the Start Time key-value pair
    startTimeElement = document.createElement("div");
    startTimeElement.classList.add("file-stats-popup-data");

    fileStatsPopupFileColumn.appendChild(startTimeElement);

    newElement = document.createElement("p");
    newElement.classList.add("file-stats-popup-key");
    newElement.innerText = "Start Time";

    startTimeElement.appendChild(newElement);

    newElement = document.createElement("p");
    newElement.classList.add("file-stats-popup-value");
    newElement.innerText = data.start_conversion_time;

    startTimeElement.appendChild(newElement);

    // Create the End Time key-value pair
    newSizeElement = document.createElement("div");
    newSizeElement.classList.add("file-stats-popup-data");

    fileStatsPopupFileColumn.appendChild(newSizeElement);

    newElement = document.createElement("p");
    newElement.classList.add("file-stats-popup-key");
    newElement.innerText = "End Time";

    newSizeElement.appendChild(newElement);

    newElement = document.createElement("p");
    newElement.classList.add("file-stats-popup-value");
    newElement.innerText = data.end_conversion_time;

    newSizeElement.appendChild(newElement);

    // Create the Total Time key-value pair
    percentageSavedElement = document.createElement("div");
    percentageSavedElement.classList.add("file-stats-popup-data");

    fileStatsPopupFileColumn.appendChild(percentageSavedElement);

    newElement = document.createElement("p");
    newElement.classList.add("file-stats-popup-key");
    newElement.innerText = "Total Time";

    percentageSavedElement.appendChild(newElement);

    newElement = document.createElement("p");
    newElement.classList.add("file-stats-popup-value");
    newElement.innerText = data.total_conversion_time;

    percentageSavedElement.appendChild(newElement);

    // Append popover element as a child of the wrapper
    element.appendChild(popoverElement);

    element.addEventListener("click", function() {
        // If the popover is already visible, hide it, otherwise show it
        if (popoverElement.matches(".open")) {
            popoverElement.classList.remove("open");
            popoverElement.hidePopover();
        }
        else {
            // Hide any other open popovers
            var openPopovers = document.querySelectorAll(".open");
            openPopovers.forEach(function(popover) {
                popover.classList.remove("open");
                popover.hidePopover();
            });
            popoverElement.classList.add("open");
            popoverElement.showPopover();
        }
    });
}
