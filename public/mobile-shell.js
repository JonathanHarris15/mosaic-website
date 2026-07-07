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
  try {
    var p = new URLSearchParams(window.location.search);
    if (p.get("shell") === "mobile") sessionStorage.setItem("mosaicShell", "mobile");
    else if (p.get("shell") === "web") sessionStorage.removeItem("mosaicShell");
  } catch (e) {}

  var isMobile = false;
  try { isMobile = sessionStorage.getItem("mosaicShell") === "mobile"; } catch (e) {}
  window.MOSAIC_SHELL = isMobile ? "mobile" : "web";
  if (!isMobile) return;

  document.documentElement.classList.add("shell-mobile");
  function markBody() { if (document.body) document.body.classList.add("shell-mobile"); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", markBody);
  else markBody();
})();
