document.addEventListener("readystatechange", event => {
    if (event.target.readyState === "complete") {
        initializeSiteSelectMenus();
    }
});

function initializeSiteSelectMenus() {
    const selectElements = Array.from(document.querySelectorAll("select.site-select"));

    if (!selectElements.length) {
        return;
    }

    const menuModels = [];

    for (const selectElement of selectElements) {
        if (selectElement.dataset.siteSelectEnhanced === "true") {
            continue;
        }

        const menuModel = createSiteSelectMenu(selectElement);
        if (menuModel) {
            menuModels.push(menuModel);
        }
    }

    if (!menuModels.length) {
        return;
    }

    const closeAllMenus = exceptModel => {
        for (const menuModel of menuModels) {
            if (menuModel === exceptModel) {
                continue;
            }
            closeSiteSelectMenu(menuModel);
        }
    };

    document.addEventListener("click", clickEvent => {
        const clickTarget = clickEvent.target;
        if (!(clickTarget instanceof Node)) {
            return;
        }

        for (const menuModel of menuModels) {
            if (menuModel.root.contains(clickTarget) || menuModel.menu.contains(clickTarget)) {
                return;
            }
        }

        closeAllMenus();
    });

    document.addEventListener("keydown", keyEvent => {
        if (keyEvent.key !== "Escape") {
            return;
        }

        const openMenu = menuModels.find(menuModel => menuModel.root.classList.contains("is-open"));
        if (!openMenu) {
            return;
        }

        closeAllMenus();
        openMenu.trigger.focus();
    });

    window.addEventListener("resize", () => {
        closeAllMenus();
    });

    for (const menuModel of menuModels) {
        menuModel.trigger.addEventListener("click", clickEvent => {
            clickEvent.preventDefault();

            if (menuModel.root.classList.contains("is-open")) {
                closeSiteSelectMenu(menuModel);
                return;
            }

            closeAllMenus(menuModel);
            openSiteSelectMenu(menuModel);
        });

        menuModel.trigger.addEventListener("keydown", keyEvent => {
            if (keyEvent.key === "ArrowDown" || keyEvent.key === "ArrowUp") {
                keyEvent.preventDefault();
                closeAllMenus(menuModel);
                openSiteSelectMenu(menuModel);
                focusSelectedOrEdgeOption(menuModel, keyEvent.key === "ArrowUp");
            }
        });

        menuModel.menu.addEventListener("keydown", keyEvent => {
            handleMenuKeydown(keyEvent, menuModel);
        });

        menuModel.select.addEventListener("change", () => {
            syncSiteSelectMenu(menuModel);
        });

        const parentForm = menuModel.select.form;
        if (parentForm) {
            parentForm.addEventListener("reset", () => {
                requestAnimationFrame(() => {
                    syncSiteSelectMenu(menuModel);
                });
            });
        }
    }
}

function createSiteSelectMenu(selectElement) {
    if (selectElement.multiple || selectElement.size > 1) {
        return null;
    }

    const parentElement = selectElement.parentElement;
    if (!parentElement) {
        return null;
    }

    selectElement.dataset.siteSelectEnhanced = "true";
    selectElement.classList.add("site-select-native");
    const usesBodyPortal = selectElement.dataset.siteSelectPortal === "body";

    const rootElement = document.createElement("div");
    rootElement.className = "site-select-menu";

    parentElement.insertBefore(rootElement, selectElement);
    rootElement.appendChild(selectElement);

    const triggerButton = document.createElement("button");
    triggerButton.type = "button";
    triggerButton.className = "site-dropdown-trigger site-select-trigger";
    triggerButton.setAttribute("aria-haspopup", "listbox");
    triggerButton.setAttribute("aria-expanded", "false");

    const triggerContent = document.createElement("span");
    triggerContent.className = "site-select-trigger-content";

    let triggerIcon = null;
    const optionIconAttribute = selectElement.dataset.siteSelectOptionIcon || "";
    const placeholderIconPath = selectElement.dataset.siteSelectPlaceholderIcon || "";
    if (optionIconAttribute || placeholderIconPath) {
        triggerIcon = document.createElement("img");
        triggerIcon.className = "site-select-trigger-icon";
        triggerIcon.alt = "";
        triggerIcon.setAttribute("aria-hidden", "true");
        triggerIcon.hidden = true;
        triggerContent.appendChild(triggerIcon);
    }

    const triggerLabel = document.createElement("span");
    triggerLabel.className = "site-select-trigger-label";
    triggerContent.appendChild(triggerLabel);
    triggerButton.appendChild(triggerContent);

    const optionMenu = document.createElement("div");
    optionMenu.className = "site-select-options site-dropdown-panel";
    if (usesBodyPortal) {
        optionMenu.classList.add("site-select-options--portal");
    }
    optionMenu.setAttribute("role", "listbox");
    optionMenu.hidden = true;

    rootElement.appendChild(triggerButton);
    if (usesBodyPortal) {
        document.body.appendChild(optionMenu);
    } else {
        rootElement.appendChild(optionMenu);
    }

    const menuModel = {
        root: rootElement,
        select: selectElement,
        trigger: triggerButton,
        triggerLabel,
        menu: optionMenu,
        usesBodyPortal,
        expansionContainer: selectElement.closest(".football-season-popup"),
        optionIconAttribute,
        placeholderIconPath,
        triggerIcon,
        optionButtons: [],
    };

    rebuildSiteSelectOptions(menuModel);
    syncSiteSelectMenu(menuModel);

    return menuModel;
}

function rebuildSiteSelectOptions(menuModel) {
    menuModel.menu.textContent = "";
    menuModel.optionButtons = [];

    for (const optionElement of menuModel.select.options) {
        if (optionElement.hidden) {
            continue;
        }

        const optionButton = document.createElement("button");
        optionButton.type = "button";
        optionButton.className = "sub-level-nav site-dropdown-item site-select-option";
        const optionContent = document.createElement("span");
        optionContent.className = "site-select-option-content";

        if (menuModel.optionIconAttribute) {
            const iconSource = optionElement.getAttribute(menuModel.optionIconAttribute);
            if (iconSource) {
                const optionIcon = document.createElement("img");
                optionIcon.className = "site-select-option-icon";
                optionIcon.src = iconSource;
                optionIcon.alt = "";
                optionIcon.setAttribute("aria-hidden", "true");
                optionContent.appendChild(optionIcon);
            }
        }

        const optionLabel = document.createElement("span");
        optionLabel.className = "site-select-option-label";
        optionLabel.textContent = optionElement.textContent || "";
        optionContent.appendChild(optionLabel);

        optionButton.appendChild(optionContent);
        optionButton.dataset.value = optionElement.value;
        optionButton.setAttribute("role", "option");
        optionButton.tabIndex = -1;

        if (optionElement.disabled) {
            optionButton.disabled = true;
            optionButton.classList.add("is-disabled");
        }

        optionButton.addEventListener("click", () => {
            if (optionButton.disabled) {
                return;
            }

            menuModel.select.value = optionElement.value;
            menuModel.select.dispatchEvent(new Event("input", { bubbles: true }));
            menuModel.select.dispatchEvent(new Event("change", { bubbles: true }));
            closeSiteSelectMenu(menuModel);
            menuModel.trigger.focus();
        });

        menuModel.menu.appendChild(optionButton);
        menuModel.optionButtons.push(optionButton);
    }
}

function syncSiteSelectMenu(menuModel) {
    const selectedOption = menuModel.select.options[menuModel.select.selectedIndex] || null;
    const selectedText = selectedOption ? (selectedOption.textContent || "") : "Select";

    menuModel.triggerLabel.textContent = selectedText;

    if (menuModel.triggerIcon) {
        const selectedIconSource = menuModel.optionIconAttribute && selectedOption
            ? selectedOption.getAttribute(menuModel.optionIconAttribute) || ""
            : "";
        const triggerIconSource = selectedIconSource || menuModel.placeholderIconPath;

        if (triggerIconSource) {
            menuModel.triggerIcon.src = triggerIconSource;
            menuModel.triggerIcon.hidden = false;
        } else {
            menuModel.triggerIcon.removeAttribute("src");
            menuModel.triggerIcon.hidden = true;
        }
    }

    menuModel.trigger.disabled = menuModel.select.disabled;

    for (const optionButton of menuModel.optionButtons) {
        const isSelected = optionButton.dataset.value === menuModel.select.value;
        optionButton.classList.toggle("is-selected", isSelected);
        optionButton.setAttribute("aria-selected", isSelected ? "true" : "false");
    }
}

function openSiteSelectMenu(menuModel) {
    if (menuModel.select.disabled) {
        return;
    }

    if (menuModel.expansionContainer) {
        menuModel.expansionContainer.classList.add("has-open-select-menu");
    }

    if (menuModel.usesBodyPortal) {
        positionPortalMenu(menuModel);
    }

    menuModel.root.classList.add("is-open");
    menuModel.trigger.setAttribute("aria-expanded", "true");
    menuModel.menu.hidden = false;
    focusSelectedOrEdgeOption(menuModel, false);
}

function closeSiteSelectMenu(menuModel) {
    menuModel.root.classList.remove("is-open");
    menuModel.trigger.setAttribute("aria-expanded", "false");
    menuModel.menu.hidden = true;

    if (menuModel.expansionContainer) {
        menuModel.expansionContainer.classList.remove("has-open-select-menu");
    }
}

function getEnabledOptionButtons(menuModel) {
    return menuModel.optionButtons.filter(optionButton => !optionButton.disabled);
}

function focusSelectedOrEdgeOption(menuModel, focusLast) {
    const enabledButtons = getEnabledOptionButtons(menuModel);

    if (!enabledButtons.length) {
        return;
    }

    const selectedButton = enabledButtons.find(optionButton => optionButton.dataset.value === menuModel.select.value);

    if (selectedButton) {
        selectedButton.focus();
        return;
    }

    if (focusLast) {
        enabledButtons[enabledButtons.length - 1].focus();
        return;
    }

    enabledButtons[0].focus();
}

function handleMenuKeydown(keyEvent, menuModel) {
    const enabledButtons = getEnabledOptionButtons(menuModel);

    if (!enabledButtons.length) {
        return;
    }

    const activeElement = document.activeElement;
    const activeIndex = enabledButtons.findIndex(optionButton => optionButton === activeElement);

    if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        closeSiteSelectMenu(menuModel);
        menuModel.trigger.focus();
        return;
    }

    if (keyEvent.key === "Tab") {
        closeSiteSelectMenu(menuModel);
        return;
    }

    if (keyEvent.key === "ArrowDown") {
        keyEvent.preventDefault();
        const nextIndex = activeIndex < 0 ? 0 : Math.min(activeIndex + 1, enabledButtons.length - 1);
        enabledButtons[nextIndex].focus();
        return;
    }

    if (keyEvent.key === "ArrowUp") {
        keyEvent.preventDefault();
        const previousIndex = activeIndex < 0 ? enabledButtons.length - 1 : Math.max(activeIndex - 1, 0);
        enabledButtons[previousIndex].focus();
        return;
    }

    if (keyEvent.key === "Home") {
        keyEvent.preventDefault();
        enabledButtons[0].focus();
        return;
    }

    if (keyEvent.key === "End") {
        keyEvent.preventDefault();
        enabledButtons[enabledButtons.length - 1].focus();
    }
}

function positionPortalMenu(menuModel) {
    const triggerRect = menuModel.trigger.getBoundingClientRect();
    const viewportMarginPx = 8;
    const topGapPx = 6;
    const preferredMaxHeightPx = 320;

    const availableBelowPx = window.innerHeight - triggerRect.bottom - viewportMarginPx - topGapPx;
    const availableAbovePx = triggerRect.top - viewportMarginPx - topGapPx;

    let placeAbove = false;
    if (availableBelowPx < 140 && availableAbovePx > availableBelowPx) {
        placeAbove = true;
    }

    const maxHeightPx = Math.max(
        120,
        Math.min(preferredMaxHeightPx, placeAbove ? availableAbovePx : availableBelowPx),
    );

    let topPx = triggerRect.bottom + topGapPx;
    if (placeAbove) {
        topPx = triggerRect.top - topGapPx - maxHeightPx;
    }

    menuModel.menu.style.left = `${Math.round(triggerRect.left)}px`;
    menuModel.menu.style.top = `${Math.max(Math.round(topPx), viewportMarginPx)}px`;
    menuModel.menu.style.width = `${Math.round(triggerRect.width)}px`;
    menuModel.menu.style.maxHeight = `${Math.round(maxHeightPx)}px`;
}
