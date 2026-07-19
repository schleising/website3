(() => {
  const button = document.getElementById("units-copy-link");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const targetId = button.getAttribute("data-copy-target");
  const input = targetId ? document.getElementById(targetId) : null;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const absoluteUrl = () => input.value || window.location.href;

  button.addEventListener("click", async () => {
    const text = absoluteUrl();
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      input.focus();
      input.select();
      button.textContent = "Select & copy";
    }
    window.setTimeout(() => {
      button.textContent = original;
    }, 1600);
  });
})();
