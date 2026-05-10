(function () {
  "use strict";

  function setDeleteTarget(usernameTarget, usernameInput, username) {
    if (usernameTarget) {
      usernameTarget.textContent = username;
    }

    if (usernameInput instanceof HTMLInputElement) {
      usernameInput.value = username;
    }
  }

  function bindDeletePopup() {
    const dialog = document.getElementById("user-delete-dialog");
    const usernameTarget = document.getElementById("user-delete-dialog-username");
    const usernameInput = document.getElementById("user-delete-username-input");
    const deleteForm = document.getElementById("user-delete-confirm-form");
    const cancelButton = document.getElementById("user-delete-cancel-button");
    const triggerButtons = document.querySelectorAll("[data-user-delete-trigger]");
    const canUseDialog =
      dialog instanceof HTMLDialogElement && typeof dialog.showModal === "function";

    triggerButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const username = button.getAttribute("data-username") || "this user";
        setDeleteTarget(usernameTarget, usernameInput, username);

        if (!canUseDialog) {
          if (window.confirm("Delete " + username + "? This cannot be undone.")) {
            deleteForm?.submit();
          }
          return;
        }

        dialog.showModal();
      });
    });

    if (!canUseDialog) {
      return;
    }

    if (cancelButton instanceof HTMLButtonElement) {
      cancelButton.addEventListener("click", () => {
        dialog.close();
      });
    }

    dialog.addEventListener("click", (event) => {
      if (!(event instanceof MouseEvent)) {
        return;
      }

      const bounds = dialog.getBoundingClientRect();
      const isBackdropClick =
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom;

      if (isBackdropClick) {
        dialog.close();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindDeletePopup);
  } else {
    bindDeletePopup();
  }
})();