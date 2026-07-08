/* ============================================================
   mobile-shell.js — lets desktop pages (service builder, the
   shepherding cluster) run inside the Capacitor/mobile WebView shell.

   The mobile shell opens a desktop page with `?shell=mobile`. This
   script remembers that in sessionStorage so every subsequent
   navigation between those pages stays in the mobile experience
   without each internal link having to carry the flag. It marks the
   document with `.shell-mobile` (for mobile-shell.css) and exposes
   `window.MOSAIC_SHELL` for pages that need to branch a link (e.g. a
   "Home" back-link that should return to the shell, not index.html).

   Load this EARLY in <head> so the class is set before first paint.
   ============================================================ */
(function () {
  "use strict";
  var param = null;
  try {
    var p = new URLSearchParams(window.location.search);
    param = p.get("shell");
    if (param === "mobile") sessionStorage.setItem("mosaicShell", "mobile");
    else if (param === "web") sessionStorage.removeItem("mosaicShell");
  } catch (e) {}

  var isMobile = false;
  try { isMobile = sessionStorage.getItem("mosaicShell") === "mobile"; } catch (e) {}

  // Guard against a sticky session flag leaking the mobile shell into a desktop
  // browser. sessionStorage remembers "mobile" for the whole tab so navigation
  // between shell pages needn't re-pass ?shell=mobile — but that same stickiness
  // would make a desktop page (opened later in the tab) render mobile-cramped
  // and send its back-links to the mobile home. So unless THIS navigation
  // explicitly asked for the shell (?shell=mobile), only honor it inside the
  // native app (window.Capacitor) or on a phone-sized viewport.
  if (isMobile && param !== "mobile") {
    var inApp = !!window.Capacitor;
    var narrow = !window.matchMedia || window.matchMedia("(max-width: 820px)").matches;
    if (!inApp && !narrow) isMobile = false;
  }

  window.MOSAIC_SHELL = isMobile ? "mobile" : "web";
  if (!isMobile) return;

  document.documentElement.classList.add("shell-mobile");
  function markBody() { if (document.body) document.body.classList.add("shell-mobile"); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", markBody);
  else markBody();
})();
