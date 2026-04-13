// Add a callback for state changes
let sharedSidebarWidthPx = 0;

document.addEventListener('readystatechange', event => {
    if (event.target.readyState === "complete") {
        window.onresize = function() {
            closeMobileSidebarsOnDesktop();
            syncSidebarWidths();
        };

        updateSidebarVisibility();
        setupMobileSidebarToggles();
        syncSidebarWidths();
    }
});

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

    syncSidebarWidths();
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
        if (!isOverlaySidebarMode()) {
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
    if (!isOverlaySidebarMode()) {
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
    if (!isOverlaySidebarMode()) {
        closeMobileSidebars();
    }
}

function syncSidebarWidths() {
    const leftSidebar = document.getElementById("left-sidebar-menu");
    const rightSidebar = document.getElementById("right-sidebar-menu");
    if (!leftSidebar || !rightSidebar) {
        return;
    }

    const leftWidth = measureSidebarContentWidth(leftSidebar);
    const rightAvailable = !rightSidebar.classList.contains("hidden-sidebar");
    const rightWidth = rightAvailable ? measureSidebarContentWidth(rightSidebar) : 0;
    const contentWidth = Math.max(leftWidth, rightWidth);
    if (contentWidth > 0) {
        sharedSidebarWidthPx = Math.max(sharedSidebarWidthPx, contentWidth);
    }

    const finalWidth = sharedSidebarWidthPx;

    if (finalWidth > 0) {
        leftSidebar.style.width = finalWidth + "px";
        rightSidebar.style.width = finalWidth + "px";
    }

    updateSidebarCollapseMode(finalWidth, rightAvailable);
}

function measureSidebarContentWidth(sidebar) {
    const content = sidebar.querySelector(".sub-level-nav-container");
    if (!content) {
        return 0;
    }

    const styleSnapshot = {
        display: sidebar.style.display,
        visibility: sidebar.style.visibility,
        position: sidebar.style.position,
        left: sidebar.style.left,
        right: sidebar.style.right
    };

    const sidebarIsHidden = getComputedStyle(sidebar).display === "none";
    if (sidebarIsHidden) {
        sidebar.style.display = "flex";
        sidebar.style.visibility = "hidden";
        sidebar.style.position = "fixed";
        sidebar.style.left = "-9999px";
        sidebar.style.right = "auto";
    }

    const links = content.querySelectorAll(".sub-level-nav");
    let maxLinkWidth = 0;
    for (const link of links) {
        maxLinkWidth = Math.max(maxLinkWidth, measureIntrinsicLinkWidth(link));
    }

    const contentStyle = getComputedStyle(content);
    const sidebarStyle = getComputedStyle(sidebar);
    const contentPad = parseFloat(contentStyle.paddingLeft) + parseFloat(contentStyle.paddingRight);
    const sidebarPad = parseFloat(sidebarStyle.paddingLeft) + parseFloat(sidebarStyle.paddingRight);
    const sidebarBorder = parseFloat(sidebarStyle.borderLeftWidth) + parseFloat(sidebarStyle.borderRightWidth);
    const fallbackWidth = Math.ceil(content.scrollWidth);
    const measuredWidth = Math.max(fallbackWidth, maxLinkWidth + contentPad + sidebarPad + sidebarBorder);

    if (sidebarIsHidden) {
        sidebar.style.display = styleSnapshot.display;
        sidebar.style.visibility = styleSnapshot.visibility;
        sidebar.style.position = styleSnapshot.position;
        sidebar.style.left = styleSnapshot.left;
        sidebar.style.right = styleSnapshot.right;
    }

    return measuredWidth;
}

function measureIntrinsicLinkWidth(link) {
    const linkStyle = getComputedStyle(link);
    const measureNode = document.createElement("span");
    measureNode.textContent = link.textContent;
    measureNode.style.position = "fixed";
    measureNode.style.left = "-9999px";
    measureNode.style.top = "-9999px";
    measureNode.style.visibility = "hidden";
    measureNode.style.whiteSpace = "nowrap";
    measureNode.style.fontFamily = linkStyle.fontFamily;
    measureNode.style.fontSize = linkStyle.fontSize;
    measureNode.style.fontWeight = linkStyle.fontWeight;
    measureNode.style.fontStyle = linkStyle.fontStyle;
    measureNode.style.letterSpacing = linkStyle.letterSpacing;
    measureNode.style.textTransform = linkStyle.textTransform;
    document.body.appendChild(measureNode);

    const textWidth = Math.ceil(measureNode.getBoundingClientRect().width);
    measureNode.remove();

    const horizontalPadding = parseFloat(linkStyle.paddingLeft) + parseFloat(linkStyle.paddingRight);
    const horizontalMargin = parseFloat(linkStyle.marginLeft) + parseFloat(linkStyle.marginRight);
    const horizontalBorder = parseFloat(linkStyle.borderLeftWidth) + parseFloat(linkStyle.borderRightWidth);

    return textWidth + horizontalPadding + horizontalMargin + horizontalBorder;
}

function updateSidebarCollapseMode(sidebarWidth, rightAvailable) {
    const body = document.body;
    if (!body || sidebarWidth <= 0) {
        return;
    }

    if (window.innerWidth <= 672) {
        body.classList.remove("collapsed-sidebars");
        return;
    }

    const outerPadding = 24;
    const mainGap = 16;
    const visibleSidebarCount = rightAvailable ? 2 : 1;
    const reservedForContent = 420;
    const requiredWidth = (sidebarWidth * visibleSidebarCount) + (mainGap * visibleSidebarCount) + reservedForContent + outerPadding;
    const shouldCollapse = window.innerWidth < requiredWidth;

    body.classList.toggle("collapsed-sidebars", shouldCollapse);
}

function isOverlaySidebarMode() {
    return window.innerWidth <= 672 || document.body.classList.contains("collapsed-sidebars");
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
