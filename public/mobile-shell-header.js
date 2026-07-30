/* ============================================================
   mobile-shell-header.js — one standardized mobile header for desktop
   pages rendered inside the mobile shell (?shell=mobile). Matches the
   native shell's M.ui.TopBar exactly (52px row + safe-area, serif title,
   44px lucide chevron-left / menu button) so every mobile page — native
   or shell — reads the same.

   A page opts in by setting, before DOMContentLoaded:
     window.MOBILE_HEADER = {
       title:  "Edit Hymn",                 // required
       back:   "mobile.html#/hymnDirectory",// URL, or "#back" for history.back()
       menu:   true,                        // (alt) show a hamburger → app home
       onBack: true,                        // (alt) fire a "mobile-header:back" event
       hideSelector: "body > header",       // page header(s) to hide (default)
     };
   Load this in <head> right after mobile-shell.js. It no-ops off the shell.

   The header sits sticky at the top of normal flow (no body padding, so it
   coexists with flex-column and 100vh layouts and stays visible on scroll).
   Its measured height is written to the `--msh-height` CSS var so fixed-overlay
   pages (e.g. the hymn manager's full-screen modal) can offset themselves with
   `top: var(--msh-height)`.
   ============================================================ */
(function () {
  "use strict";
  if (!document.documentElement.classList.contains("shell-mobile")) return;

  var CHEVRON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  var MENU = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>';

  function build() {
    if (document.getElementById("mobile-shell-header")) return;
    var cfg = window.MOBILE_HEADER || {};

    // Hide the page's own header(s).
    try {
      document.querySelectorAll(cfg.hideSelector || "body > header").forEach(function (el) { el.style.display = "none"; });
    } catch (e) {}

    var isMenu = !!cfg.menu && !cfg.back && !cfg.onBack;

    var header = document.createElement("header");
    header.id = "mobile-shell-header";
    header.style.cssText = "position:sticky;top:0;left:0;right:0;z-index:1000;flex-shrink:0;" +
      "padding-top:calc(env(safe-area-inset-top, 20px) + 10px);" +
      "background:var(--surface-container-lowest, #ffffff);border-bottom:1px solid var(--outline-variant, rgba(0,0,0,0.12));";

    var row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:6px;height:52px;padding:0 8px 0 6px;";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", isMenu ? "Menu" : "Back");
    btn.style.cssText = "width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--on-surface);cursor:pointer;border-radius:10px;padding:0;";
    btn.innerHTML = isMenu ? MENU : CHEVRON;
    btn.addEventListener("click", function () {
      if (cfg.onBack) { document.dispatchEvent(new CustomEvent("mobile-header:back")); return; }
      // A hamburger has to open the drawer, not go home — going home is what a
      // back arrow does, and drawing one glyph while doing the other's job is
      // the control lying about itself.
      //
      // The drawer is the app's, and this is a separate page load, so it cannot
      // be opened in place without a second copy of it here — a copy that would
      // drift from the destination list it is meant to mirror. So the app is
      // asked to open its own: `menu=1` opens the drawer on arrival, and closing
      // it comes straight back to this page.
      if (isMenu) { window.location.href = "mobile.html#/home?menu=1"; return; }
      if (!cfg.back || cfg.back === "#back") { if (history.length > 1) history.back(); else window.location.href = "mobile.html#/home"; return; }
      window.location.href = cfg.back;
    });

    var title = document.createElement("h1");
    title.id = "mobile-shell-header-title";
    title.style.cssText = "flex:1;margin:0;min-width:0;font-family:var(--font-serif);font-size:20px;font-weight:600;letter-spacing:0.01em;color:var(--on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    title.textContent = cfg.title || "";

    row.appendChild(btn);
    row.appendChild(title);
    header.appendChild(row);
    document.body.insertBefore(header, document.body.firstChild);

    // Expose the header height so fixed-overlay pages can offset below it.
    document.documentElement.style.setProperty("--msh-height", header.offsetHeight + "px");
  }

  // Allow pages to update the title later (e.g. after async load).
  window.setMobileHeaderTitle = function (t) {
    var el = document.getElementById("mobile-shell-header-title");
    if (el) el.textContent = t || "";
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
