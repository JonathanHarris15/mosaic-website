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

  // ── The shell's drawer ──────────────────────────────────────────────────────
  //
  // The app's drawer is a Preact panel inside mobile.html, and a shell page is a
  // separate document — so this is a second rendering of the same chrome. What
  // it is NOT is a second list: which destinations exist, who may see them and
  // where each goes all come from mobile/destinations.js, which is the only
  // thing here that could drift into a lie.
  //
  // A page opts in by loading that file; without it the hamburger has nothing to
  // open, so the header draws a back arrow instead of a control that does
  // nothing.

  var drawer = null;

  // Who is looking, so the gated destinations are gated. Reads `firebase`
  // directly because auth.js keeps `auth` and `db` as consts — deliberately not
  // window properties — and this script has no bootstrap of its own.
  //
  // FAILS CLOSED: until the answer arrives the user is null, and canSee hides
  // every gated entry. Offering the Shepherd Dashboard to somebody who will be
  // refused on arrival is worse than not offering it.
  function whoIsLooking(then) {
    try {
      if (!window.firebase || !firebase.apps || !firebase.apps.length) return then(null);
      firebase.auth().onAuthStateChanged(function (user) {
        if (!user) return then(null);
        firebase.firestore().collection("users").doc(user.uid).get()
          .then(function (doc) {
            var d = (doc.exists && doc.data()) || {};
            then({
              // Same fallback chain as the app's own profile loader, so the two
              // drawers cannot end up calling one person two different things.
              name: d.name || d.displayName || user.displayName || (user.email || "").split("@")[0] || "Friend",
              permissionLevel: d.permissionLevel || d.role || "viewer",
            });
          })
          .catch(function () { then({ name: "Friend", permissionLevel: "viewer" }); });
      });
    } catch (e) { then(null); }
  }

  function symbol(name, size) {
    var el = document.createElement("span");
    el.className = "material-symbols-outlined";
    el.style.cssText = "font-size:" + size + "px;flex-shrink:0;";
    el.textContent = name;
    return el;
  }

  function buildDrawer() {
    var D = window.MosaicDestinations;
    if (!D || drawer) return drawer;

    var root = document.createElement("div");
    root.id = "mobile-shell-drawer";
    root.style.cssText = "position:fixed;inset:0;z-index:1200;visibility:hidden;";

    var scrim = document.createElement("div");
    scrim.style.cssText = "position:absolute;inset:0;background:rgba(14,28,54,0.42);" +
      "opacity:0;transition:opacity 280ms ease;";
    scrim.addEventListener("click", closeDrawer);

    var panel = document.createElement("nav");
    panel.setAttribute("aria-label", "Menu");
    panel.style.cssText = "position:absolute;top:0;bottom:0;left:0;width:296px;max-width:86vw;" +
      "background:var(--surface, #FBF7F0);border-right:1px solid var(--outline-variant, #DAD0C0);" +
      "box-shadow:0 18px 48px rgba(14,28,54,.14);display:flex;flex-direction:column;" +
      "transform:translateX(-100%);transition:transform 300ms cubic-bezier(0.22, 1, 0.36, 1);";

    // The same navy head the app's drawer wears, including its safe-area pad.
    var head = document.createElement("div");
    head.style.cssText = "background:#182F57;color:#F2EAE2;" +
      "padding:calc(env(safe-area-inset-top, 20px) + 10px) 20px 20px;";

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Collapse menu");
    closeBtn.style.cssText = "width:44px;height:44px;margin-left:-14px;display:flex;align-items:center;" +
      "justify-content:center;border:none;background:transparent;color:#F2EAE2;cursor:pointer;border-radius:10px;";
    closeBtn.innerHTML = MENU;
    closeBtn.addEventListener("click", closeDrawer);
    head.appendChild(closeBtn);

    // Avatar, name, role — the drawer's head, and the same three parts the app's
    // drawer shows. The avatar went missing from this one, which is what a
    // second rendering costs if nothing holds the two to the same list.
    var whoRow = document.createElement("div");
    whoRow.style.cssText = "display:flex;align-items:center;gap:10px;margin-top:6px;";

    var avatar = document.createElement("span");
    avatar.setAttribute("data-drawer-part", "avatar");
    avatar.style.cssText = "width:36px;height:36px;border-radius:9999px;background:#D8E2FF;color:#182F57;" +
      "display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;" +
      "font-family:var(--font-sans, sans-serif);font-weight:700;font-size:14px;";

    var names = document.createElement("div");
    names.style.cssText = "min-width:0;";
    var who = document.createElement("div");
    who.setAttribute("data-drawer-part", "name");
    who.style.cssText = "font-family:var(--font-sans, sans-serif);font-size:14px;font-weight:600;" +
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    var role = document.createElement("div");
    role.setAttribute("data-drawer-part", "roleLabel");
    role.style.cssText = "font-family:var(--font-sans, sans-serif);font-size:11px;color:#B2C6F8;";

    names.appendChild(who);
    names.appendChild(role);
    whoRow.appendChild(avatar);
    whoRow.appendChild(names);
    head.appendChild(whoRow);

    var list = document.createElement("div");
    list.style.cssText = "flex:1;overflow-y:auto;padding:10px 12px;";

    function draw(user) {
      var name = (user && user.name) || "Guest";
      who.textContent = name;
      avatar.textContent = D.initials(name);
      role.textContent = user ? D.roleLabel(user.permissionLevel) : "Not signed in";
      list.textContent = "";
      D.DESTINATIONS.filter(function (d) { return D.canSee(d, user); }).forEach(function (d) {
        var here = d.route === (window.MOBILE_HEADER || {}).route;
        var a = document.createElement("a");
        a.href = D.routeHref(d.route);
        a.style.cssText = "display:flex;align-items:center;gap:14px;padding:12px 14px;margin-bottom:2px;" +
          "border-radius:10px;text-decoration:none;font-family:var(--font-sans, sans-serif);font-size:15px;" +
          "font-weight:" + (here ? "600" : "500") + ";" +
          "background:" + (here ? "var(--primary-fixed, #D8E2FF)" : "transparent") + ";" +
          "color:" + (here ? "#182F57" : "var(--on-surface, #0E1C36)") + ";";
        a.appendChild(symbol(d.symbol, 20));
        a.appendChild(document.createTextNode(d.label));
        list.appendChild(a);
      });
    }

    draw(null);
    whoIsLooking(draw);

    panel.appendChild(head);
    panel.appendChild(list);
    root.appendChild(scrim);
    root.appendChild(panel);
    document.body.appendChild(root);

    drawer = { root: root, scrim: scrim, panel: panel };
    return drawer;
  }

  function openDrawer() {
    var d = buildDrawer();
    // No list means nothing to open. Should be unreachable — the header only
    // draws a hamburger where a drawer exists — but a menu that opens an empty
    // panel is worse than one that does nothing.
    if (!d) return;
    d.root.style.visibility = "visible";
    // One frame, so the closed state paints before the transition starts.
    requestAnimationFrame(function () {
      d.scrim.style.opacity = "1";
      d.panel.style.transform = "translateX(0)";
    });
    document.addEventListener("keydown", onEscape);
  }

  function closeDrawer() {
    if (!drawer) return;
    drawer.scrim.style.opacity = "0";
    drawer.panel.style.transform = "translateX(-100%)";
    // Hidden only after the slide-out, or it pops rather than closes.
    setTimeout(function () { if (drawer) drawer.root.style.visibility = "hidden"; }, 300);
    document.removeEventListener("keydown", onEscape);
  }

  function onEscape(e) { if (e.key === "Escape") closeDrawer(); }

  function build() {
    if (document.getElementById("mobile-shell-header")) return;
    var cfg = window.MOBILE_HEADER || {};

    // Hide the page's own header(s).
    try {
      document.querySelectorAll(cfg.hideSelector || "body > header").forEach(function (el) { el.style.display = "none"; });
    } catch (e) {}

    // A hamburger is only honest where a drawer can actually open, so a page
    // that asks for one without loading the destination list gets a back arrow.
    var isMenu = !!cfg.menu && !cfg.back && !cfg.onBack && !!window.MosaicDestinations;

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
      // A hamburger opens a drawer OVER THE PAGE YOU ARE ON. Navigating to the
      // app's home screen to borrow its drawer moved the ground under you —
      // the page behind the panel became somewhere else, and closing it was the
      // only way back. So the shell draws its own, from the same list.
      if (isMenu) { openDrawer(); return; }
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
