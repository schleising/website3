(function () {
  "use strict";

  function toBase64Url(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (const value of bytes) {
      binary += String.fromCharCode(value);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function fromBase64Url(base64Url) {
    const padded = base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4);
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function credentialToJson(credential) {
    const response = {};

    if (credential.response.clientDataJSON) {
      response.clientDataJSON = toBase64Url(credential.response.clientDataJSON);
    }
    if (credential.response.attestationObject) {
      response.attestationObject = toBase64Url(credential.response.attestationObject);
    }
    if (credential.response.authenticatorData) {
      response.authenticatorData = toBase64Url(credential.response.authenticatorData);
    }
    if (credential.response.signature) {
      response.signature = toBase64Url(credential.response.signature);
    }
    if (credential.response.userHandle) {
      response.userHandle = toBase64Url(credential.response.userHandle);
    }
    if (typeof credential.response.getTransports === "function") {
      response.transports = credential.response.getTransports();
    }

    return {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      type: credential.type,
      response,
      clientExtensionResults: credential.getClientExtensionResults(),
    };
  }

  function normaliseRegistrationOptions(publicKey) {
    const options = structuredClone(publicKey);
    options.challenge = fromBase64Url(options.challenge);
    options.user.id = fromBase64Url(options.user.id);

    if (Array.isArray(options.excludeCredentials)) {
      options.excludeCredentials = options.excludeCredentials.map((descriptor) => {
        const value = structuredClone(descriptor);
        value.id = fromBase64Url(value.id);
        return value;
      });
    }

    return options;
  }

  function normaliseAuthenticationOptions(publicKey) {
    const options = structuredClone(publicKey);
    options.challenge = fromBase64Url(options.challenge);

    if (Array.isArray(options.allowCredentials)) {
      options.allowCredentials = options.allowCredentials.map((descriptor) => {
        const value = structuredClone(descriptor);
        value.id = fromBase64Url(value.id);
        return value;
      });
    }

    return options;
  }

  async function postJson(url, payload, csrfToken) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify(payload),
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    return {
      ok: response.ok,
      statusCode: response.status,
      data,
    };
  }

  function statusTextForReason(reason) {
    switch (reason) {
      case "rate_limited":
        return "Too many attempts. Please wait and try again.";
      case "username_taken":
        return "That email is already in use.";
      case "invalid_input":
        return "Please complete all required fields.";
      case "verification_failed":
        return "Passkey verification failed.";
      case "email_sent":
        return "If the email exists and is eligible, a link has been sent.";
      case "email_send_failed":
        return "Unable to send email right now. Please try again.";
      case "email_link_invalid":
        return "Verification link is invalid or expired. Request a new one.";
      case "recovery_link_invalid":
        return "Recovery link is invalid or expired. Request a new one.";
      case "email_verification_required":
        return "Verify your email first, then continue with passkey setup.";
      case "challenge_invalid":
        return "This passkey request expired. Please try again.";
      case "login_failed":
        return "Unable to sign in with passkey.";
      case "migration_required":
        return "This account must be migrated to passkeys first.";
      case "credentials_required":
        return "Email and password are required for migration.";
      case "migration_failed":
        return "Migration failed. Check your credentials and try again.";
      case "already_enrolled":
        return "This account already has a passkey.";
      default:
        return "Request failed. Please try again.";
    }
  }

  function setBusy(button, isBusy, busyLabel) {
    if (!button) {
      return;
    }
    if (isBusy) {
      button.dataset.originalText = button.textContent || "";
      button.textContent = busyLabel;
      button.disabled = true;
      return;
    }

    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
    }
    button.disabled = false;
  }

  function setStatus(statusElement, message, isError) {
    if (!statusElement) {
      return;
    }
    statusElement.textContent = message;
    statusElement.classList.toggle("is-error", Boolean(isError));
  }

  function requirePasskeySupport(statusElement) {
    if (window.PublicKeyCredential) {
      return true;
    }

    setStatus(statusElement, "This browser does not support passkeys.", true);
    return false;
  }

  async function runLogin(form, options) {
    const runOptions = options || {};
    const statusElement = form.querySelector("#passkey-status");
    const submitButton = form.querySelector("#passkey-login-submit");
    const migrationLink = form.querySelector("#passkey-migrate-link");
    const csrfToken = form.querySelector("input[name='csrf_token']")?.value || "";
    const username = form.querySelector("input[name='username']")?.value?.trim() || "";
    const nextPath = form.querySelector("input[name='next']")?.value || "";

    if (!requirePasskeySupport(statusElement)) {
      return;
    }

    const busyMessage = runOptions.autoStart ? "Opening passkey prompt..." : "Starting passkey...";
    setBusy(submitButton, true, busyMessage);
    setStatus(statusElement, "", false);

    try {
      const begin = await postJson(
        "/account/webauthn/authenticate/begin/",
        { username: username === "" ? null : username, next_path: nextPath || null },
        csrfToken,
      );

      if (!begin.ok || !begin.data || begin.data.status !== "ok") {
        const reason = begin.data?.reason || "login_failed";
        setStatus(statusElement, statusTextForReason(reason), true);

        if (reason === "migration_required" && begin.data?.migration_url && migrationLink) {
          migrationLink.classList.remove("d-none");
          migrationLink.href = begin.data.migration_url;
        }
        return;
      }

      const credential = await navigator.credentials.get({
        publicKey: normaliseAuthenticationOptions(begin.data.public_key),
      });

      if (!credential) {
        setStatus(statusElement, "Passkey prompt was cancelled.", true);
        return;
      }

      const complete = await postJson(
        "/account/webauthn/authenticate/complete/",
        {
          challenge_id: begin.data.challenge_id,
          credential: credentialToJson(credential),
          next_path: nextPath || null,
        },
        csrfToken,
      );

      if (!complete.ok || !complete.data || complete.data.status !== "ok") {
        const reason = complete.data?.reason || "verification_failed";
        setStatus(statusElement, statusTextForReason(reason), true);
        return;
      }

      if (typeof complete.data.redirect_url === "string" && complete.data.redirect_url !== "") {
        window.location.assign(complete.data.redirect_url);
        return;
      }

      window.location.assign("/account/login_success/");
    } catch (error) {
      setStatus(statusElement, "Passkey login failed. Please try again.", true);
    } finally {
      setBusy(submitButton, false, "");
    }
  }

  async function runRegistration(form) {
    const statusElement = form.querySelector("#passkey-status");
    const submitButton = form.querySelector("#passkey-register-submit");
    const csrfToken = form.querySelector("input[name='csrf_token']")?.value || "";
    const firstname = form.querySelector("input[name='firstname']")?.value?.trim() || "";
    const lastname = form.querySelector("input[name='lastname']")?.value?.trim() || "";
    const username = form.querySelector("input[name='username']")?.value?.trim() || "";
    const website = form.querySelector("input[name='website']")?.value || "";
    const formLoadedAt = form.querySelector("input[name='form_loaded_at']")?.value || "";

    if (!requirePasskeySupport(statusElement)) {
      return;
    }

    if (firstname === "" || lastname === "" || username === "") {
      setStatus(statusElement, "Please complete all required fields.", true);
      return;
    }

    setBusy(submitButton, true, "Starting registration...");
    setStatus(statusElement, "", false);

    try {
      const begin = await postJson(
        "/account/webauthn/register/begin/",
        {
          firstname,
          lastname,
          username,
          website,
          form_loaded_at: formLoadedAt,
        },
        csrfToken,
      );

      if (!begin.ok || !begin.data || begin.data.status !== "ok") {
        const reason = begin.data?.reason || "create_failed";
        setStatus(statusElement, statusTextForReason(reason), true);
        return;
      }

      const credential = await navigator.credentials.create({
        publicKey: normaliseRegistrationOptions(begin.data.public_key),
      });

      if (!credential) {
        setStatus(statusElement, "Passkey prompt was cancelled.", true);
        return;
      }

      const complete = await postJson(
        "/account/webauthn/register/complete/",
        {
          challenge_id: begin.data.challenge_id,
          credential: credentialToJson(credential),
        },
        csrfToken,
      );

      if (!complete.ok || !complete.data || complete.data.status !== "ok") {
        const reason = complete.data?.reason || "verification_failed";
        setStatus(statusElement, statusTextForReason(reason), true);
        return;
      }

      if (typeof complete.data.redirect_url === "string" && complete.data.redirect_url !== "") {
        window.location.assign(complete.data.redirect_url);
        return;
      }

      window.location.assign("/account/create_success/");
    } catch (error) {
      setStatus(statusElement, "Passkey registration failed. Please try again.", true);
    } finally {
      setBusy(submitButton, false, "");
    }
  }

  async function runSignupEmailRequest(form) {
    const statusElement = form.querySelector("#passkey-status");
    const submitButton = form.querySelector("#signup-email-submit");
    const csrfToken = form.querySelector("input[name='csrf_token']")?.value || "";
    const firstname = form.querySelector("input[name='firstname']")?.value?.trim() || "";
    const lastname = form.querySelector("input[name='lastname']")?.value?.trim() || "";
    const username = form.querySelector("input[name='username']")?.value?.trim() || "";
    const website = form.querySelector("input[name='website']")?.value || "";
    const formLoadedAt = form.querySelector("input[name='form_loaded_at']")?.value || "";

    if (firstname === "" || lastname === "" || username === "") {
      setStatus(statusElement, "Please complete all required fields.", true);
      return;
    }

    setBusy(submitButton, true, "Sending verification email...");
    setStatus(statusElement, "", false);

    try {
      const result = await postJson(
        "/account/email/signup/request/",
        {
          firstname,
          lastname,
          username,
          website,
          form_loaded_at: formLoadedAt,
        },
        csrfToken,
      );

      if (!result.ok || !result.data) {
        const reason = result.data?.reason || "email_send_failed";
        setStatus(statusElement, statusTextForReason(reason), true);
        return;
      }

      setStatus(
        statusElement,
        "Verification email sent. Open the link in your inbox to continue passkey setup.",
        false,
      );
    } catch (error) {
      setStatus(statusElement, "Unable to send verification email right now.", true);
    } finally {
      setBusy(submitButton, false, "");
    }
  }

  async function runVerifiedSignupRegistration(form) {
    const statusElement = form.querySelector("#passkey-status");
    const submitButton = form.querySelector("#verified-signup-submit");
    const csrfToken = form.querySelector("input[name='csrf_token']")?.value || "";
    const signupSessionToken = form.querySelector("input[name='signup_session_token']")?.value || "";

    if (!requirePasskeySupport(statusElement)) {
      return;
    }

    if (signupSessionToken === "") {
      setStatus(statusElement, "Signup verification session is missing.", true);
      return;
    }

    setBusy(submitButton, true, "Starting passkey setup...");
    setStatus(statusElement, "", false);

    try {
      const begin = await postJson(
        "/account/webauthn/register-from-email/begin/",
        { signup_session_token: signupSessionToken },
        csrfToken,
      );

      if (!begin.ok || !begin.data || begin.data.status !== "ok") {
        const reason = begin.data?.reason || "email_link_invalid";
        setStatus(statusElement, statusTextForReason(reason), true);
        return;
      }

      const credential = await navigator.credentials.create({
        publicKey: normaliseRegistrationOptions(begin.data.public_key),
      });

      if (!credential) {
        setStatus(statusElement, "Passkey prompt was cancelled.", true);
        return;
      }

      const complete = await postJson(
        "/account/webauthn/register/complete/",
        {
          challenge_id: begin.data.challenge_id,
          credential: credentialToJson(credential),
        },
        csrfToken,
      );

      if (!complete.ok || !complete.data || complete.data.status !== "ok") {
        const reason = complete.data?.reason || "verification_failed";
        setStatus(statusElement, statusTextForReason(reason), true);
        return;
      }

      if (typeof complete.data.redirect_url === "string" && complete.data.redirect_url !== "") {
        window.location.assign(complete.data.redirect_url);
        return;
      }

      window.location.assign("/account/create_success/");
    } catch (error) {
      setStatus(statusElement, "Passkey registration failed. Please try again.", true);
    } finally {
      setBusy(submitButton, false, "");
    }
  }

  async function runRecoveryEmailRequest(form) {
    const statusElement = form.querySelector("#passkey-status");
    const submitButton = form.querySelector("#recovery-email-submit");
    const csrfToken = form.querySelector("input[name='csrf_token']")?.value || "";
    const username = form.querySelector("input[name='username']")?.value?.trim() || "";

    if (username === "") {
      setStatus(statusElement, "Please enter your email.", true);
      return;
    }

    setBusy(submitButton, true, "Sending recovery email...");
    setStatus(statusElement, "", false);

    try {
      const result = await postJson(
        "/account/email/recovery/request/",
        { username },
        csrfToken,
      );

      if (!result.ok || !result.data) {
        const reason = result.data?.reason || "email_send_failed";
        setStatus(statusElement, statusTextForReason(reason), true);
        return;
      }

      setStatus(
        statusElement,
        "If the account exists, a recovery link has been sent. Check your inbox.",
        false,
      );
    } catch (error) {
      setStatus(statusElement, "Unable to send recovery email right now.", true);
    } finally {
      setBusy(submitButton, false, "");
    }
  }

  async function runRecoveryRegistration(form) {
    const statusElement = form.querySelector("#passkey-status");
    const submitButton = form.querySelector("#recovery-register-submit");
    const csrfToken = form.querySelector("input[name='csrf_token']")?.value || "";
    const recoverySessionToken = form.querySelector("input[name='recovery_session_token']")?.value || "";

    if (!requirePasskeySupport(statusElement)) {
      return;
    }

    if (recoverySessionToken === "") {
      setStatus(statusElement, "Recovery session is missing.", true);
      return;
    }

    setBusy(submitButton, true, "Starting passkey recovery...");
    setStatus(statusElement, "", false);

    try {
      const begin = await postJson(
        "/account/webauthn/recovery/begin/",
        { recovery_session_token: recoverySessionToken },
        csrfToken,
      );

      if (!begin.ok || !begin.data || begin.data.status !== "ok") {
        const reason = begin.data?.reason || "recovery_link_invalid";
        setStatus(statusElement, statusTextForReason(reason), true);
        return;
      }

      const credential = await navigator.credentials.create({
        publicKey: normaliseRegistrationOptions(begin.data.public_key),
      });

      if (!credential) {
        setStatus(statusElement, "Passkey prompt was cancelled.", true);
        return;
      }

      const complete = await postJson(
        "/account/webauthn/recovery/complete/",
        {
          challenge_id: begin.data.challenge_id,
          credential: credentialToJson(credential),
        },
        csrfToken,
      );

      if (!complete.ok || !complete.data || complete.data.status !== "ok") {
        const reason = complete.data?.reason || "verification_failed";
        setStatus(statusElement, statusTextForReason(reason), true);
        return;
      }

      if (typeof complete.data.redirect_url === "string" && complete.data.redirect_url !== "") {
        window.location.assign(complete.data.redirect_url);
        return;
      }

      window.location.assign("/account/login_success/");
    } catch (error) {
      setStatus(statusElement, "Recovery passkey setup failed. Please try again.", true);
    } finally {
      setBusy(submitButton, false, "");
    }
  }

  async function runMigration(form) {
    const statusElement = form.querySelector("#passkey-status");
    const submitButton = form.querySelector("#passkey-migrate-submit");
    const csrfToken = form.querySelector("input[name='csrf_token']")?.value || "";
    const username = form.querySelector("input[name='username']")?.value?.trim() || "";
    const password = form.querySelector("input[name='password']")?.value || "";
    const nextPath = form.querySelector("input[name='next']")?.value || "";
    const sessionMigration = form.querySelector("input[name='session_migration']")?.value === "true";

    if (!requirePasskeySupport(statusElement)) {
      return;
    }

    if (username === "") {
      setStatus(statusElement, "Please enter your email.", true);
      return;
    }

    if (!sessionMigration && password === "") {
      setStatus(statusElement, "Please enter your password.", true);
      return;
    }

    setBusy(submitButton, true, "Starting migration...");
    setStatus(statusElement, "", false);

    try {
      const begin = await postJson(
        "/account/webauthn/migrate/begin/",
        {
          username,
          password: sessionMigration ? null : password,
          next_path: nextPath || null,
        },
        csrfToken,
      );

      if (!begin.ok || !begin.data || begin.data.status !== "ok") {
        const reason = begin.data?.reason || "migration_failed";
        setStatus(statusElement, statusTextForReason(reason), true);
        return;
      }

      const credential = await navigator.credentials.create({
        publicKey: normaliseRegistrationOptions(begin.data.public_key),
      });

      if (!credential) {
        setStatus(statusElement, "Passkey prompt was cancelled.", true);
        return;
      }

      const complete = await postJson(
        "/account/webauthn/migrate/complete/",
        {
          challenge_id: begin.data.challenge_id,
          credential: credentialToJson(credential),
          next_path: nextPath || null,
        },
        csrfToken,
      );

      if (!complete.ok || !complete.data || complete.data.status !== "ok") {
        const reason = complete.data?.reason || "verification_failed";
        setStatus(statusElement, statusTextForReason(reason), true);
        return;
      }

      if (typeof complete.data.redirect_url === "string" && complete.data.redirect_url !== "") {
        window.location.assign(complete.data.redirect_url);
        return;
      }

      window.location.assign("/");
    } catch (error) {
      setStatus(statusElement, "Migration failed. Please try again.", true);
    } finally {
      setBusy(submitButton, false, "");
    }
  }

  function initPasskeyFlow() {
    const form = document.querySelector("form[data-passkey-flow]");
    if (!form) {
      return;
    }

    if (form.dataset.passkeyFlow === "login") {
      void runLogin(form, { autoStart: true });
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const flow = form.dataset.passkeyFlow;
      if (flow === "login") {
        await runLogin(form, { autoStart: false });
      } else if (flow === "signup-email") {
        await runSignupEmailRequest(form);
      } else if (flow === "register-verified") {
        await runVerifiedSignupRegistration(form);
      } else if (flow === "register") {
        await runRegistration(form);
      } else if (flow === "recovery-email") {
        await runRecoveryEmailRequest(form);
      } else if (flow === "recovery-register") {
        await runRecoveryRegistration(form);
      } else if (flow === "migrate") {
        await runMigration(form);
      }
    });
  }

  initPasskeyFlow();
})();
