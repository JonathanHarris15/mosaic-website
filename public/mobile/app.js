/* ============================================================
   app.js — router + screens + app root for the Mosaic mobile shell.

   Screens implemented in-shell render as Preact views; any route not
   yet ported falls back to the existing desktop page (page-load), so
   the mobile shell can take over the app screen by screen.
   ============================================================ */
(function () {
  "use strict";
  var html = M.html, Ic = M.Ic;
  var useState = M.hooks.useState, useEffect = M.hooks.useEffect;
  var ui = M.ui, data = M.data;
  var Screen = ui.Screen, TopBar = ui.TopBar, BarAction = ui.BarAction, Body = ui.Body,
      Overline = ui.Overline, SerifHead = ui.SerifHead, Row = ui.Row, CardList = ui.CardList,
      Medallion = ui.Medallion, Button = ui.Button, Badge = ui.Badge, Avatar = ui.Avatar, Input = ui.Input;

  // Routes not yet ported render the in-shell ComingSoon screen, offering the
  // desktop page as "open full page" — no jarring bounce out of the shell.
  var ROUTE_META = {
    serviceGuide: { title: "Service Guide", page: "service-guide.html" },
  };

  function currentRoute() {
    var m = (location.hash || "").replace(/^#\/?/, "");
    var q = m.indexOf("?");
    if (q !== -1) m = m.slice(0, q);
    return m || "home";
  }
  // Params carried in the hash query (e.g. mobile.html#/careList?id=X) — the
  // deep-link path used when a shell page (the Documents library) opens a native
  // screen by full page load, where in-memory M.navParams isn't available.
  function currentHashParams() {
    var h = location.hash || "";
    var q = h.indexOf("?");
    if (q === -1) return {};
    var out = {};
    h.slice(q + 1).split("&").forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf("=");
      var k = i === -1 ? kv : kv.slice(0, i);
      var v = i === -1 ? "" : kv.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { out[k] = v; }
    });
    return out;
  }
  // Serialize simple params into a hash query so history.back() (incl. Android's
  // hardware/gesture back) can restore them — M.navParams is transient and doesn't
  // survive a history pop. Objects/functions are skipped; they stay available via
  // M.navParams for the immediate forward render.
  function encodeParams(params) {
    if (!params) return "";
    var parts = [];
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null) return;
      var t = typeof v;
      if (t === "string" || t === "number" || t === "boolean") {
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
      }
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  // ── Signed in, or a guest on purpose ─────────────────────
  //
  // The app used to open on the home screen whoever you were. Signed out, that
  // meant every tile, and behind them every shell page loading as
  // a stranger — a Calendar with the Sunday Service on it and nothing else,
  // because a Sunday is fetched by id regardless of who is asking while every
  // other Event is filtered by what your rank may see. Nothing said so. You
  // simply saw a smaller church than the one you belong to, and no control that
  // would let you fix it.
  //
  // So a signed-out launch goes to the login screen. "Continue as guest" is
  // still there, and now it means something: it is remembered, so it is a choice
  // rather than a bounce.
  var GUEST_KEY = "mosaicGuest";
  function isGuest() {
    try { return sessionStorage.getItem(GUEST_KEY) === "1"; } catch (e) { return false; }
  }
  function setGuest(on) {
    try { on ? sessionStorage.setItem(GUEST_KEY, "1") : sessionStorage.removeItem(GUEST_KEY); } catch (e) {}
  }
  M.isGuest = isGuest;
  M.setGuest = setGuest;


  // ── Login ────────────────────────────────────────────────
  // Firebase deliberately doesn't say which half was wrong (telling you an email
  // exists is an account-enumeration leak), so neither do we — one sentence for
  // the whole "that pair isn't right" family, and both fields go red. `fields`
  // is what turns them red, so a network failure says its piece without blaming
  // what you typed.
  function signInMessage(err) {
    switch (err && err.code) {
      case "auth/invalid-email": return { text: "That doesn't look like an email address.", fields: true };
      case "auth/user-disabled": return { text: "That account has been disabled. Ask an admin for help.", fields: false };
      case "auth/too-many-requests": return { text: "Too many attempts. Wait a moment and try again.", fields: false };
      case "auth/network-request-failed": return { text: "Can't reach Mosaic. Check your connection and try again.", fields: false };
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return { text: "That email and password don't match an account.", fields: true };
      default: return { text: "Sign in failed. Please try again.", fields: false };
    }
  }

  function LoginScreen(props) {
    var emailS = useState(""), pwS = useState(""), errS = useState(null), busyS = useState(false);
    function submit() {
      if (busyS[0]) return;
      if (!emailS[0].trim() || !pwS[0]) { errS[1]({ text: "Enter your email and password.", fields: true }); return; }
      busyS[1](true); errS[1](null);
      data.signIn(emailS[0].trim(), pwS[0])
        .then(function () { busyS[1](false); props.nav("home"); })
        .catch(function (err) { busyS[1](false); errS[1](signInMessage(err)); });
    }
    // Typing is the person answering the complaint — clear it so the red doesn't
    // outlive the mistake.
    function onEdit(setter) {
      return function (ev) { if (errS[0]) errS[1](null); setter(ev.target.value); };
    }
    function onEnter(ev) { if (ev.key === "Enter") submit(); }
    var err = errS[0], bad = !!(err && err.fields);
    return html`
      <div style=${{ height: "100%", background: "var(--background)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style=${{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "80px 28px 40px", position: "relative" }}>
          <div style=${{ position: "absolute", right: -50, top: 60, width: 180, height: 180, border: "1px solid var(--outline-variant)", borderRadius: "50%", opacity: 0.5 }}></div>
          <div style=${{ position: "absolute", left: -60, bottom: 90, width: 150, height: 150, border: "1px solid var(--outline-variant)", borderRadius: "50%", opacity: 0.4 }}></div>
          <div style=${{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32, position: "relative" }}>
            <img src="mobile/assets/logo-seal.png" alt="Mosaic Church seal" style=${{ width: 92, height: 92, objectFit: "contain" }} />
            <div style=${{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 600, letterSpacing: "0.1em", color: "var(--primary)", marginTop: 16, textTransform: "uppercase" }}>Mosaic</div>
            <div style=${{ fontFamily: "var(--font-serif)", fontSize: 15, fontStyle: "italic", color: "var(--on-surface-variant)", marginTop: 2 }}>Services · College Station</div>
          </div>
          <div style=${{ display: "flex", flexDirection: "column", gap: 16, position: "relative" }}>
            <${Input} label="Email Address" type="email" placeholder="you@example.com" value=${emailS[0]} invalid=${bad} onKeyDown=${onEnter} onInput=${onEdit(emailS[1])} />
            <${Input} label="Password" type="password" placeholder="••••••••" value=${pwS[0]} invalid=${bad} onKeyDown=${onEnter} onInput=${onEdit(pwS[1])} />
            ${err ? html`<div role="alert" style=${{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: "var(--radius)", background: "var(--error-container)", color: "var(--on-error-container)", fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.35 }}>
              <span style=${{ display: "flex", flexShrink: 0, color: "var(--error)" }}>${Ic("circle-alert", 16)}</span>${err.text}
            </div>` : null}
            <div style=${{ marginTop: 4 }}>
              <${Button} variant="primary" size="lg" style=${{ width: "100%" }} icon=${Ic("log-in", 18)} onClick=${submit}>${busyS[0] ? "Signing in…" : "Sign In"}<//>
            </div>
            <button onClick=${function () { setGuest(true); props.nav("home"); }} style=${{ background: "none", border: "none", color: "var(--secondary)", fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: 600, letterSpacing: "0.04em", cursor: "pointer", marginTop: 2 }}>Continue as guest</button>
          </div>
        </div>
      </div>`;
  }

  // ── Home ─────────────────────────────────────────────────
  // A phone browser now opens the mobile app rather than the desktop site
  // (index.html's head script), so the desktop site needs a door out — the app
  // doesn't cover every screen, and the one it doesn't cover is always the one
  // you needed. Inside the native app there is no door: index.html would send
  // us straight back here, so the link is a button that does nothing.
  function inNativeApp() { return !!window.Capacitor; }

  function HomeScreen(props) {
    var user = props.user;
    var svcState = M.useAsync(data.getNextService, []);
    var svc = svcState.data;
    // The Home card grid mirrors the drawer's top-level destinations (permission-gated).
    var tiles = [
      { icon: "book-open", label: "Hymn Directory", route: "hymnDirectory" },
      { icon: "church", label: "Services", route: "calendar" },
      // Route "events", not "calendar" — see data.js. "calendar" is Services.
      { icon: "calendar-days", label: "Calendar", route: "events" },
      { icon: "users", label: "Member Directory", route: "people" },
      { icon: "shield", label: "Shepherd", route: "shepherd", permissionLevels: ["elder", "super_admin"] },
      { icon: "settings-2", label: "Admin", route: "admin", permissionLevels: ["admin", "super_admin"] },
      // A drawer destination now as well as a tile here (destinations.js) —
      // on a phone the drawer IS the navigation, and reachable only from Home
      // meant going home to reach it. Same gate as the web's card, MS-120.
      { icon: "hand-heart", label: "Roles Manager", route: "rolesManager", permissionLevels: ["editor", "elder", "admin", "super_admin"] },
    ].filter(function (t) { return data.canSee(t, user); });
    return html`
      <${Screen}>
        <${TopBar} title="Mosaic Services" onMenu=${props.openMenu} right=${html`<${BarAction} icon="user-round" label="Profile" onClick=${function () { props.nav("profile"); }} />`} />
        <${Body} style=${{ padding: "12px 16px calc(32px + env(safe-area-inset-bottom, 0px))" }}>
          <div style=${{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            ${tiles.map(function (t) {
              return html`
                <button key=${t.route} onClick=${function () { props.nav(t.route); }} style=${{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "16px 10px", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", cursor: "pointer" }}>
                  <${Medallion} icon=${t.icon} size=${46} />
                  <span style=${{ fontFamily: "var(--font-serif)", fontSize: 15, fontWeight: 600, color: "var(--on-surface)", textAlign: "center", lineHeight: 1.2 }}>${t.label}</span>
                </button>`;
            })}
          </div>

          <${Overline} style=${{ marginBottom: 8, paddingLeft: 2 }}>Sunday at a Glance<//>
          <div style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", padding: 18 }}>
            ${svcState.loading ? html`<div style=${{ color: "var(--on-surface-variant)", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14 }}>Loading service…</div>`
              : svc ? html`
                <div style=${{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 600, color: "var(--primary)", lineHeight: 1.2 }}>${svc.theme}</div>
                <div style=${{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                  ${[["Preacher", svc.preacher], ["Service Leader", svc.serviceLeader], ["Music Leader", svc.musicLeader]].filter(function (kv) { return kv[1]; }).map(function (kv) {
                    return html`<div key=${kv[0]} style=${{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                      <span style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)" }}>${kv[0]}</span>
                      <span style=${{ fontFamily: "var(--font-sans)", fontSize: 14.5, fontWeight: 500, color: "var(--on-surface)", textAlign: "right" }}>${kv[1]}</span>
                    </div>`;
                  })}
                </div>
                ${svc.hasBaptism ? html`<div style=${{ display: "flex", gap: 6, marginTop: 14 }}><${Badge} tone="tertiary" icon=${Ic("droplet", 13)}>Baptism<//></div>` : null}
                <div onClick=${function () { props.nav("serviceBuilder", { date: svc.date }); }} style=${{ marginTop: 14 }}>
                  <${Button} variant="primary" size="md" style=${{ width: "100%" }} icon=${Ic("square-pen", 17)}>Open in Service Editor<//>
                </div>`
              : html`
                <div style=${{ color: "var(--on-surface-variant)", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14 }}>No upcoming service found.</div>
                <div onClick=${function () { props.nav("calendar"); }} style=${{ marginTop: 14 }}>
                  <${Button} variant="secondary" size="md" style=${{ width: "100%" }} icon=${Ic("church", 17)}>Open Services<//>
                </div>`}
          </div>

          ${inNativeApp() ? null : html`
            <a href="index.html?shell=web" style=${{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 20, padding: "8px 0", color: "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500, textDecoration: "none" }}>
              ${Ic("monitor", 15)}View desktop site
            </a>`}
        </${Body}>
      </${Screen}>`;
  }

  // Profile is shell-adapted (see SHELL_PAGES below): the real profile.html
  // (password change, account management) runs inside the WebView with
  // ?shell=mobile so the mobile app inherits every feature. The Admin Dashboard
  // is now a native screen (screens-admin.js, route "admin").

  // Merge app-level screens with the content screens from screens-content.js.
  M.SCREENS = Object.assign(M.SCREENS || {}, { login: LoginScreen, home: HomeScreen });
  var SCREENS = M.SCREENS;

  // Routes that open a full desktop page in-place within the same WebView.
  // shell=mobile makes those pages adapt their chrome for the phone and keep
  // navigation inside the shell (see mobile-shell.js). Reused wholesale so the
  // mobile app gets every feature + the proven save logic — no reimplementation.
  // Shared with the shell's own drawer — see mobile/destinations.js.
  //
  // Native screens cover the drawer pages (home, hymnDirectory, calendar,
  // people, shepherd, admin) plus the shepherding cluster (including Manage Tags,
  // route "shepherdTags" → screens-shepherd-tags.js) + both editors. The
  // remaining shell pages are subpages opened in-place with ?shell=mobile and a
  // standardized back-arrow header (mobile-shell-header.js): the hymn manager /
  // service builder / service guide / profile (routed elsewhere in nav()).
  var SHELL_PAGES = window.MosaicDestinations.SHELL_PAGES;

  function nav(route, params) {
    // Opening an editor is the last moment we know the thing being edited is
    // about to change. What data.js remembered about it has to go now — the
    // editor is a whole new document, so nothing here runs again to do it
    // afterwards, and coming back to Home would show the version you just
    // finished editing away.
    if (route === "serviceBuilder") {
      if (data.forget) data.forget("services");
      var d = (params && params.date) || "";
      if (!d) { M.navParams = {}; location.hash = "#/calendar"; return; }
      window.location.href = "service-builder.html?date=" + encodeURIComponent(d) + "&shell=mobile";
      return;
    }
    if (route === "hymnManager") {
      if (data.forget) data.forget("hymns");
      // The hymn manager is the real desktop page (manager.html) opened in-shell:
      // ?edit=<id> from a hymn's "Manage Hymn" button, ?new=1 from the directory's
      // add-a-hymn FAB. No separate mobile "manager" list — the directory is the list.
      window.location.href = (params && params.edit)
        ? "manager.html?edit=" + encodeURIComponent(params.edit) + "&shell=mobile"
        : "manager.html?new=1&shell=mobile";
      return;
    }
    if (SHELL_PAGES[route]) { window.location.href = SHELL_PAGES[route] + "?shell=mobile"; return; }
    if (SCREENS[route]) { M.navParams = params || {}; location.hash = "#/" + route + encodeParams(params); return; }
    if (ROUTE_META[route]) { M.navParams = ROUTE_META[route]; location.hash = "#/" + route + encodeParams(ROUTE_META[route]); return; }
    M.navParams = {}; location.hash = "#/home";
  }

  // ── Drawer ───────────────────────────────────────────────
  function Drawer(props) {
    // Own mount/visibility lifecycle so the panel slides in (and out) rather
    // than popping. `render` keeps us in the DOM through the close animation;
    // `vis` flips one frame after mount to trigger the CSS transition.
    var renderS = useState(false), visS = useState(false);
    var render = renderS[0], setRender = renderS[1], vis = visS[0], setVis = visS[1];
    useEffect(function () {
      var raf1, raf2, timer;
      if (props.open) {
        setRender(true);
        // Two frames so the closed state paints before we transition open.
        raf1 = requestAnimationFrame(function () {
          raf2 = requestAnimationFrame(function () { setVis(true); });
        });
      } else {
        setVis(false);
        timer = setTimeout(function () { setRender(false); }, 300);
      }
      return function () {
        if (raf1) cancelAnimationFrame(raf1);
        if (raf2) cancelAnimationFrame(raf2);
        if (timer) clearTimeout(timer);
      };
    }, [props.open]);

    if (!render) return null;
    var user = props.user || {};
    // The head is your row: tapping it opens your profile. Only when there is a
    // you — signed out it stays a plain label, not a button to nowhere.
    var signedIn = !!props.user;
    return html`
      <${M.Fragment}>
        <div onClick=${props.onClose} style=${{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(14,28,54,0.42)", backdropFilter: "blur(1.5px)", opacity: vis ? 1 : 0, transition: "opacity 0.28s ease" }}></div>
        <nav style=${{ position: "absolute", top: 0, bottom: 0, left: 0, width: 296, zIndex: 41, background: "var(--surface)", borderRight: "1px solid var(--outline-variant)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", transform: vis ? "translateX(0)" : "translateX(-100%)", transition: "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)", willChange: "transform" }}>
          <div style=${{ background: "var(--primary)", padding: "calc(env(safe-area-inset-top, 20px) + 10px) 20px 20px", position: "relative", overflow: "hidden" }}>
            <div style=${{ position: "absolute", right: -30, top: -34, width: 120, height: 120, border: "1px solid rgba(255,255,255,0.14)", borderRadius: "50%" }}></div>
            <div style=${{ height: 52, display: "flex", alignItems: "center", position: "relative" }}>
              <button onClick=${props.onClose} aria-label="Collapse menu"
                style=${{ width: 44, height: 44, marginLeft: -14, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--on-primary)", cursor: "pointer", borderRadius: 10 }}>
                ${Ic("menu", 24)}
              </button>
            </div>
            <${signedIn ? "button" : "div"} onClick=${signedIn ? function () { props.onNavigate("profile"); } : null}
              aria-label=${signedIn ? "Open your profile" : null}
              style=${{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, position: "relative", width: "100%", padding: 0, border: "none", background: "transparent", textAlign: "left", cursor: signedIn ? "pointer" : "default" }}>
              <${Avatar} name=${user.name || "Guest"} size=${36} />
              <div style=${{ minWidth: 0, flex: 1 }}>
                <div style=${{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, color: "var(--on-primary)" }}>${user.name || "Guest"}</div>
                <div style=${{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--primary-fixed-dim)" }}>${user.roleLabel || "Not signed in"}</div>
              </div>
              ${signedIn ? html`<span style=${{ display: "flex", color: "var(--primary-fixed-dim)" }}>${Ic("chevron-right", 18)}</span>` : null}
            <//>
          </div>
          <div style=${{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
            ${data.DESTINATIONS.filter(function (d) { return data.canSee(d, user); }).map(function (d) {
              var active = props.current === d.route;
              return html`
                <button key=${d.key} onClick=${function () { props.onNavigate(d.route); }} style=${{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", marginBottom: 2, border: "none", borderRadius: "var(--radius)", cursor: "pointer", textAlign: "left", background: active ? "var(--primary-fixed)" : "transparent", color: active ? "var(--primary)" : "var(--on-surface)", fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: active ? 600 : 500 }}>
                  ${Ic(d.icon, 20)}${d.label}
                </button>`;
            })}
          </div>
          <div style=${{ padding: "12px 12px calc(12px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid var(--outline-variant)" }}>
            <button onClick=${function () { setGuest(false); data.signOut().then(function () { props.onNavigate("login"); }); }} style=${{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", border: "none", borderRadius: "var(--radius)", cursor: "pointer", textAlign: "left", background: "transparent", color: "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 500 }}>
              ${Ic("log-out", 20)}Sign Out
            </button>
          </div>
        </nav>
      </${M.Fragment}>`;
  }

  // ── App root ─────────────────────────────────────────────
  function App() {
    var routeState = useState(currentRoute());
    var menuState = useState(false);
    var userState = useState(undefined); // undefined = loading, null = signed out

    // Signing in is the moment to fill the on-device cache: you are already
    // watching the app start, and every screen after this reads from it rather
    // than the network. Deliberately not awaited — it warms behind the home
    // screen instead of holding it back.
    useEffect(function () {
      return data.onUser(function (u) {
        userState[1](u);
        if (u) setGuest(false);
        if (u && data.warmCache) data.warmCache(u);
      });
    }, []);

    // `undefined` is still loading; only `null` is a decision. Redirecting on
    // the loading value would bounce a signed-in person off their own home
    // screen for the half-second before Firebase restores the session.
    useEffect(function () {
      if (userState[0] !== null) return;
      if (isGuest() || routeState[0] === "login") return;
      nav("login");
    });
    useEffect(function () {
      function onHash() { routeState[1](currentRoute()); menuState[1](false); }
      window.addEventListener("hashchange", onHash);
      return function () { window.removeEventListener("hashchange", onHash); };
    }, []);

    function closeMenu() { menuState[1](false); }

    // Android hardware back: close drawer → navigate back → exit at home.
    // Refreshed each render so it always sees current state.
    useEffect(function () {
      M._back = function () {
        if (menuState[0]) { closeMenu(); return; }
        if (routeState[0] !== "home" && routeState[0] !== "login") { history.back(); return; }
        var CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
        if (CapApp && CapApp.exitApp) CapApp.exitApp();
      };
    });
    // Register the native back-button listener once.
    useEffect(function () {
      var CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (!CapApp || !CapApp.addListener) return;
      var pending = CapApp.addListener("backButton", function () { if (M._back) M._back(); });
      return function () { Promise.resolve(pending).then(function (h) { if (h && h.remove) h.remove(); }); };
    }, []);

    var ScreenComp = SCREENS[routeState[0]] || SCREENS.comingSoon || HomeScreen;
    return html`
      <div style=${{ height: "100%", position: "relative", overflow: "hidden" }}>
        <${ScreenComp} nav=${nav} openMenu=${function () { menuState[1](true); }} back=${function () { history.length > 1 ? history.back() : nav("home"); }} user=${userState[0]} params=${Object.assign({}, M.navParams || {}, currentHashParams())} />
        <${Drawer} open=${menuState[0]} current=${routeState[0]} user=${userState[0]} onClose=${closeMenu} onNavigate=${function (r) { menuState[1](false); nav(r); }} />
      </div>`;
  }

  // Expose for headless testing / potential reuse.
  M.App = App;
  M.screens = SCREENS;
  M.Drawer = Drawer;

  function mount() {
    var root = typeof document !== "undefined" && document.getElementById("app");
    if (!root) return;
    if (!location.hash) location.hash = "#/home";
    M.render(M.h(App), root);
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
    else mount();
  }
})();
