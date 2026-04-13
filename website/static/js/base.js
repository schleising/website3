// Add a callback for state changes
document.addEventListener('readystatechange', event => {
    if (event.target.readyState === "complete") {
        // Set updateSize as the window resize handler
        window.onresize = function() {
            updateSize();
            closeMobileSidebarsOnDesktop();
        };
        
        // Call updateSize when the document is loaded
        updateSize();
        updateSidebarVisibility();
        setupMobileSidebarToggles();
    }
});

function updateSize() {
    document.getElementById("outer").style.height = window.innerHeight + "px";
};

function updateSidebarVisibility() {
    const main = document.getElementById("main");
    const rightToggle = document.getElementById("right-nav-toggle");
    if (!main) {
        return;
    }

    const rightSidebar = main.querySelector(".right-sidebar");
    const rightSidebarContent = main.querySelector(".right-sidebar .sub-level-nav-container");
    if (!rightSidebar || !rightSidebarContent) {
        return;
    }

    const hasVisibleElements = rightSidebarContent.querySelector("a, button, input, select, textarea, img, svg, ul, ol, li, div, p, span, table, section, article") !== null;
    const hasTextContent = rightSidebarContent.textContent.trim().length > 0;
    const hasSidebarContent = hasVisibleElements || hasTextContent;

    rightSidebar.classList.toggle("hidden-sidebar", !hasSidebarContent);
    if (rightToggle) {
        rightToggle.classList.toggle("hidden-button", !hasSidebarContent);
    }
}

function setupMobileSidebarToggles() {
    const leftToggle = document.getElementById("left-nav-toggle");
    const rightToggle = document.getElementById("right-nav-toggle");
    const leftSidebar = document.getElementById("left-sidebar-menu");
    const rightSidebar = document.getElementById("right-sidebar-menu");

    if (!leftToggle || !rightToggle || !leftSidebar || !rightSidebar) {
        return;
    }

    leftToggle.addEventListener("click", function() {
        toggleMobileSidebar(leftSidebar, leftToggle, rightSidebar, rightToggle);
    });

    rightToggle.addEventListener("click", function() {
        toggleMobileSidebar(rightSidebar, rightToggle, leftSidebar, leftToggle);
    });

    document.addEventListener("click", function(event) {
        if (window.innerWidth > 672) {
            return;
        }

        const clickInsideControls = leftToggle.contains(event.target) || rightToggle.contains(event.target);
        const clickInsideLeft = leftSidebar.contains(event.target);
        const clickInsideRight = rightSidebar.contains(event.target);
        if (!clickInsideControls && !clickInsideLeft && !clickInsideRight) {
            closeMobileSidebars();
        }
    });
}

function toggleMobileSidebar(sidebarToToggle, toggleToToggle, sidebarToClose, toggleToClose) {
    if (window.innerWidth > 672) {
        return;
    }

    const isOpening = !sidebarToToggle.classList.contains("mobile-open");
    if (isOpening) {
        positionMobileSidebar(sidebarToToggle, toggleToToggle);
    }
    sidebarToToggle.classList.toggle("mobile-open", isOpening);
    toggleToToggle.setAttribute("aria-expanded", isOpening ? "true" : "false");

    if (sidebarToClose.classList.contains("mobile-open")) {
        sidebarToClose.classList.remove("mobile-open");
        toggleToClose.setAttribute("aria-expanded", "false");
    }

    document.body.classList.toggle("nav-drawer-open", isOpening);
}

function closeMobileSidebars() {
    const leftToggle = document.getElementById("left-nav-toggle");
    const rightToggle = document.getElementById("right-nav-toggle");
    const leftSidebar = document.getElementById("left-sidebar-menu");
    const rightSidebar = document.getElementById("right-sidebar-menu");

    if (!leftToggle || !rightToggle || !leftSidebar || !rightSidebar) {
        return;
    }

    leftSidebar.classList.remove("mobile-open");
    rightSidebar.classList.remove("mobile-open");
    leftSidebar.style.top = "";
    leftSidebar.style.left = "";
    leftSidebar.style.right = "";
    rightSidebar.style.top = "";
    rightSidebar.style.left = "";
    rightSidebar.style.right = "";
    leftToggle.setAttribute("aria-expanded", "false");
    rightToggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-drawer-open");
}

function positionMobileSidebar(sidebar, toggleButton) {
    const buttonRect = toggleButton.getBoundingClientRect();
    const isRightMenu = sidebar.classList.contains("right-sidebar");
    const viewportPadding = 8;

    sidebar.style.top = Math.round(buttonRect.bottom + 6) + "px";
    if (isRightMenu) {
        sidebar.style.right = Math.max(viewportPadding, Math.round(window.innerWidth - buttonRect.right)) + "px";
        sidebar.style.left = "auto";
    } else {
        sidebar.style.left = Math.max(viewportPadding, Math.round(buttonRect.left)) + "px";
        sidebar.style.right = "auto";
    }
}

function closeMobileSidebarsOnDesktop() {
    if (window.innerWidth > 672) {
        closeMobileSidebars();
    }
}

function checkForEnter(event, baseUrl, element, callback) {
    if (event.key == "Enter") {
        searchClicked(baseUrl, element, callback);
        return true;
    }
    return false;
};

function searchClicked(baseUrl, id, callback) {
    value = document.getElementById(id).value;

    if (value != '') {
        var xmlhttp = new XMLHttpRequest();
        var url = baseUrl + value;
        xmlhttp.onreadystatechange = function() {
            if (this.readyState == 4 && this.status == 200) {
                var jsn = this.responseText;
                callback(jsn);
            }
        };
        xmlhttp.open("GET", url, true);
        xmlhttp.send();
    }
};

function blogLinkClicked(baseUrl, id, callback) {
    if (id != '') {
        var xmlhttp = new XMLHttpRequest();
        var url = baseUrl + id;
        xmlhttp.onreadystatechange = function() {
            if (this.readyState == 4 && this.status == 200) {
                var jsn = this.responseText;
                callback(jsn);
            }
        };
        xmlhttp.open("GET", url, true);
        xmlhttp.send();
    }
};

function textareaAcceptTab(id) {
    document.getElementById(id).addEventListener('keydown', function(event) {
        if (event.key == 'Tab') {
          event.preventDefault();
          var start = this.selectionStart;
          var end = this.selectionEnd;

          // set textarea value to: text before caret + tab + text after caret
          this.value = this.value.substring(0, start) +
            "\t" + this.value.substring(end);

          // put caret at right position again
          this.selectionStart =
            this.selectionEnd = start + 1;
        }
    });
};

function textareaOverridePaste(id, callback) {
    document.getElementById(id).addEventListener('paste', function(event){
        event.preventDefault();
        var start = this.selectionStart;
        var end = this.selectionEnd;

        // set textarea value to: text before caret + tab + text after caret
        this.value = this.value.substring(0, start) +
        event.clipboardData.getData("text") + this.value.substring(end);

        // put caret at right position again
        this.selectionStart =
        this.selectionEnd = start + event.clipboardData.getData("text").length

        callback(event)
    });
};

function storageAvailable(type) {
    let storage;
    try {
        storage = window[type];
        const x = '__storage_test__';
        storage.setItem(x, x);
        storage.removeItem(x);
        return true;
    }
    catch (e) {
        return e instanceof DOMException && (
            // everything except Firefox
            e.name === 'QuotaExceededError' ||
            // Firefox
            e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
            // acknowledge QuotaExceededError only if there's something already stored
            (storage && storage.length !== 0);
    }
}
