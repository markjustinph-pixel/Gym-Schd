(() => {
  "use strict";

  const splash = document.getElementById("loading-splash");
  if (!splash) return;

  const minimumWait = new Promise(resolve => window.setTimeout(resolve, 5000));

  function dismissSplash() {
    splash.setAttribute("aria-busy", "false");
    splash.hidden = true;
    document.querySelectorAll("[data-splash-inert]").forEach(element => {
      element.removeAttribute("inert");
    });
  }

  minimumWait.then(dismissSplash);
})();
