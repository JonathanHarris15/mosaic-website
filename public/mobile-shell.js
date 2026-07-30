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

  // ⚠ WITHOUT `viewport-fit=cover`, EVERY env(safe-area-inset-*) READS 0.
  //
  // The shell's WebView is full-screen, so the page lays out under the status
  // bar and the home indicator either way. What viewport-fit=cover changes is
  // whether iOS will TELL the page how far under — and with it absent, every
  // safe-area rule silently computes to zero padding. mobile-shell.css has had
  // two of those since it was written (its top and bottom insets), and the
  // standard header pads itself the same way; none of it could ever fire.
  //
  // The symptom is a header sitting under the dynamic island, which reads as
  // "the header is too thin" rather than as a missing inset.
  //
  // Set here rather than in each page's <meta>, because seven pages had already
  // forgotten it and a page cannot be expected to remember something it only
  // needs in a mode it does not know it is in.
  try {
    var vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement("meta");
      vp.setAttribute("name", "viewport");
      vp.setAttribute("content", "width=device-width, initial-scale=1.0");
      document.head.appendChild(vp);
    }
    var content = vp.getAttribute("content") || "";
    if (content.indexOf("viewport-fit") === -1) {
      vp.setAttribute("content", content.replace(/\s*$/, "") + ", viewport-fit=cover");
    }
  } catch (e) {}

  function markBody() { if (document.body) document.body.classList.add("shell-mobile"); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", markBody);
  else markBody();
})();
