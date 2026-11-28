(() => {
  "use strict";

  const splash = document.getElementById("loading-splash");
  if (!splash) return;

  const MINIMUM_DISPLAY_MS = 250;
  const MAXIMUM_WAIT_MS = 10000;
  const minimumDisplay = new Promise(resolve =>
    window.setTimeout(resolve, MINIMUM_DISPLAY_MS)
  );
  const authReady = window.MJM_AUTH_READY &&
    typeof window.MJM_AUTH_READY.then === "function"
    ? Promise.resolve(window.MJM_AUTH_READY).catch(error => {
        console.error("Authentication initialization failed:", error);
      })
    : Promise.resolve();
  const failSafe = new Promise(resolve =>
    window.setTimeout(resolve, MAXIMUM_WAIT_MS)
  );

  function dismissSplash() {
    splash.setAttribute("aria-busy", "false");
    splash.hidden = true;
    document.body.classList.remove("auth-initializing");
    document.querySelectorAll("[data-splash-inert]").forEach(element => {
      element.removeAttribute("inert");
    });
  }

  if (document.documentElement.classList.contains("mjm-skip-splash")) {
    splash.hidden = true;
  }

  Promise.all([
    minimumDisplay,
    Promise.race([authReady, failSafe])
  ]).then(dismissSplash);
})();
