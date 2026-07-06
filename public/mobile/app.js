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
    calendar: { title: "Service Calendar", page: "service-calendar.html" },
    analytics: { title: "Service Analytics", page: "analytics.html" },
    shepherd: { title: "Shepherd Dashboard", page: "shepherding-dashboard.html" },
    documents: { title: "Document Library", page: "shepherding-documents.html" },
    serviceBuilder: { title: "Service Editor", page: "service-builder.html" },
  };

  function currentRoute() {
    var m = (location.hash || "").replace(/^#\/?/, "");
    return m || "home";
  }
  function greeting() {
    var h = new Date().getHours();
    if (h >= 5 && h < 12) return "Good morning";
    if (h >= 12 && h < 17) return "Good afternoon";
    return "Good evening";
  }

  // ── Login ────────────────────────────────────────────────
  function LoginScreen(props) {
    var emailS = useState(""), pwS = useState(""), errS = useState(""), busyS = useState(false);
    function submit() {
      busyS[1](true); errS[1]("");
      data.signIn(emailS[0], pwS[0])
        .then(function () { busyS[1](false); props.nav("home"); })
        .catch(function (err) { busyS[1](false); errS[1](err && err.message ? err.message : "Sign in failed"); });
    }
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
            <${Input} label="Email Address" type="email" placeholder="you@example.com" value=${emailS[0]} onInput=${function (ev) { emailS[1](ev.target.value); }} />
            <${Input} label="Password" type="password" placeholder="••••••••" value=${pwS[0]} onInput=${function (ev) { pwS[1](ev.target.value); }} />
            ${errS[0] ? html`<div style=${{ color: "var(--error)", fontFamily: "var(--font-sans)", fontSize: 13 }}>${errS[0]}</div>` : null}
            <div style=${{ marginTop: 4 }}>
              <${Button} variant="primary" size="lg" style=${{ width: "100%" }} icon=${Ic("log-in", 18)} onClick=${submit}>${busyS[0] ? "Signing in…" : "Sign In"}<//>
            </div>
            <button onClick=${function () { props.nav("home"); }} style=${{ background: "none", border: "none", color: "var(--secondary)", fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: 600, letterSpacing: "0.04em", cursor: "pointer", marginTop: 2 }}>Continue as guest</button>
          </div>
        </div>
        <div style=${{ textAlign: "center", padding: "0 0 34px", fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--on-surface-variant)" }}>A very present help in trouble.</div>
      </div>`;
  }

  // ── Home ─────────────────────────────────────────────────
  function HomeScreen(props) {
    var user = props.user;
    var first = (user && user.first) || "friend";
    var tiles = [
      { icon: "book-open", label: "Hymn Directory", route: "hymnDirectory" },
      { icon: "calendar", label: "Service Calendar", route: "calendar" },
      { icon: "users", label: "People's Directory", route: "people" },
      { icon: "shield", label: "Shepherd", route: "shepherd" },
      { icon: "bar-chart-3", label: "Analytics", route: "analytics" },
      { icon: "library", label: "Hymn Manager", route: "hymnManager" },
    ];
    return html`
      <${Screen}>
        <${TopBar} title="Mosaic Services" onMenu=${props.openMenu} right=${html`<${BarAction} icon="user-round" label="Profile" onClick=${function () { props.nav("profile"); }} />`} />
        <${Body} style=${{ padding: "18px 16px calc(40px + env(safe-area-inset-bottom, 0px))" }}>
          <div style=${{ position: "relative", overflow: "hidden", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", padding: "20px 18px", marginBottom: 18 }}>
            <div style=${{ position: "absolute", right: -36, top: -48, width: 130, height: 130, border: "1px solid var(--outline-variant)", borderRadius: "50%", opacity: 0.4 }}></div>
            <${Overline}>${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}<//>
            <div style=${{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 600, color: "var(--primary)", letterSpacing: "0.02em", marginTop: 6 }}>${greeting()}, ${first}</div>
            <div style=${{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, color: "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 13 }}>${Ic("clock", 15)}<span>Welcome back to Mosaic Services</span></div>
          </div>

          <div style=${{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            ${tiles.map(function (t) {
              return html`
                <button key=${t.route} onClick=${function () { props.nav(t.route); }} style=${{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "22px 12px", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", cursor: "pointer" }}>
                  <${Medallion} icon=${t.icon} size=${52} />
                  <span style=${{ fontFamily: "var(--font-serif)", fontSize: 15.5, fontWeight: 600, color: "var(--on-surface)", textAlign: "center", lineHeight: 1.2 }}>${t.label}</span>
                </button>`;
            })}
          </div>

          <${Overline} style=${{ marginBottom: 10, paddingLeft: 2 }}>Sunday at a Glance<//>
          <div style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", padding: 18 }}>
            <div style=${{ display: "flex", alignItems: "center", gap: 10, color: "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 14 }}>${Ic("calendar-clock", 18)}<span>Upcoming service details load here.</span></div>
            <div onClick=${function () { props.nav("calendar"); }} style=${{ marginTop: 14 }}>
              <${Button} variant="secondary" size="md" style=${{ width: "100%" }} icon=${Ic("calendar", 17)}>Open Service Calendar<//>
            </div>
          </div>
        </${Body}>
      </${Screen}>`;
  }

  // ── Profile ──────────────────────────────────────────────
  function ProfileScreen(props) {
    var user = props.user || {};
    function out() { data.signOut().then(function () { props.nav("login"); }); }
    return html`
      <${Screen}>
        <${TopBar} title="Profile" onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "20px 16px calc(40px + env(safe-area-inset-bottom, 0px))" }}>
          <div style=${{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 22 }}>
            <${Avatar} name=${user.name || "Guest"} size=${80} />
            <div style=${{ fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 600, color: "var(--on-surface)", marginTop: 12 }}>${user.name || "Guest"}</div>
            <div style=${{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--on-surface-variant)", marginTop: 2 }}>${user.email || "Not signed in"}</div>
            ${user.roleLabel ? html`<div style=${{ marginTop: 10 }}><${Badge} tone="primary" icon=${Ic("shield", 13)}>${user.roleLabel}<//></div>` : null}
          </div>
          <${Overline} style=${{ margin: "0 0 8px 6px" }}>Account<//>
          <${CardList} style=${{ marginBottom: 18 }}>
            <${Row} leading=${Ic("bell", 20)} title="Notifications" meta="On" onClick=${function () {}} />
            <${Row} leading=${Ic("palette", 20)} title="Theme" meta="Parchment" onClick=${function () {}} isLast=${true} />
          </${CardList}>
          <div onClick=${out}>
            <${Button} variant="secondary" size="md" style=${{ width: "100%" }} icon=${Ic("log-out", 17)}>Sign Out<//>
          </div>
        </${Body}>
      </${Screen}>`;
  }

  // ── Admin ────────────────────────────────────────────────
  function AdminScreen(props) {
    var tools = [
      { icon: "message-square-text", title: "SMS & Messaging", desc: "Prayer request texts & the Elder Digest." },
      { icon: "refresh-cw", title: "Member Sync", desc: "Reconcile the directory with Planning Center." },
      { icon: "user-cog", title: "Roles & Permissions", desc: "Assign editor, elder, and admin roles." },
      { icon: "database", title: "Data & Exports", desc: "Backups, CSV exports, schedule import." },
    ];
    return html`
      <${Screen}>
        <${TopBar} title="Admin" onMenu=${props.openMenu} />
        <${Body} style=${{ padding: "18px 16px calc(40px + env(safe-area-inset-bottom, 0px))" }}>
          <${Overline} style=${{ margin: "0 0 10px 6px" }}>System Tools<//>
          <div style=${{ display: "flex", flexDirection: "column", gap: 12 }}>
            ${tools.map(function (t) {
              return html`
                <button key=${t.title} style=${{ display: "flex", alignItems: "center", gap: 14, padding: 16, background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", cursor: "pointer", textAlign: "left" }}>
                  <${Medallion} icon=${t.icon} size=${46} />
                  <div style=${{ flex: 1 }}>
                    <div style=${{ fontFamily: "var(--font-serif)", fontSize: 16.5, fontWeight: 600, color: "var(--on-surface)" }}>${t.title}</div>
                    <div style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)", marginTop: 2 }}>${t.desc}</div>
                  </div>
                  <span style=${{ color: "var(--outline)" }}>${Ic("chevron-right", 18)}</span>
                </button>`;
            })}
          </div>
        </${Body}>
      </${Screen}>`;
  }

  // Merge app-level screens with the content screens from screens-content.js.
  M.SCREENS = Object.assign(M.SCREENS || {}, { login: LoginScreen, home: HomeScreen, profile: ProfileScreen, admin: AdminScreen });
  var SCREENS = M.SCREENS;

  function nav(route, params) {
    if (SCREENS[route]) { M.navParams = params || {}; location.hash = "#/" + route; return; }
    if (ROUTE_META[route]) { M.navParams = ROUTE_META[route]; location.hash = "#/" + route; return; }
    M.navParams = {}; location.hash = "#/home";
  }

  // ── Drawer ───────────────────────────────────────────────
  function Drawer(props) {
    if (!props.open) return null;
    var user = props.user || {};
    return html`
      <${M.Fragment}>
        <div onClick=${props.onClose} style=${{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(14,28,54,0.42)", backdropFilter: "blur(1.5px)" }}></div>
        <nav style=${{ position: "absolute", top: 0, bottom: 0, left: 0, width: 296, zIndex: 41, background: "var(--surface)", borderRight: "1px solid var(--outline-variant)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column" }}>
          <div style=${{ background: "var(--primary)", padding: "calc(env(safe-area-inset-top, 20px) + 24px) 20px 20px", position: "relative", overflow: "hidden" }}>
            <div style=${{ position: "absolute", right: -30, top: -34, width: 120, height: 120, border: "1px solid rgba(255,255,255,0.14)", borderRadius: "50%" }}></div>
            <div style=${{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
              <img src="mobile/assets/logo-white.png" alt="Mosaic" style=${{ width: 42, height: 42, objectFit: "contain" }} />
              <div>
                <div style=${{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, letterSpacing: "0.08em", color: "var(--on-primary)", textTransform: "uppercase" }}>Mosaic</div>
                <div style=${{ fontFamily: "var(--font-sans)", fontSize: 11.5, letterSpacing: "0.06em", color: "var(--primary-fixed-dim)" }}>College Station</div>
              </div>
            </div>
            <div style=${{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, position: "relative" }}>
              <${Avatar} name=${user.name || "Guest"} size=${36} />
              <div style=${{ minWidth: 0 }}>
                <div style=${{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, color: "var(--on-primary)" }}>${user.name || "Guest"}</div>
                <div style=${{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--primary-fixed-dim)" }}>${user.roleLabel || "Not signed in"}</div>
              </div>
            </div>
          </div>
          <div style=${{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
            ${data.DESTINATIONS.map(function (d) {
              var active = props.current === d.route;
              return html`
                <button key=${d.key} onClick=${function () { props.onNavigate(d.route); }} style=${{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", marginBottom: 2, border: "none", borderRadius: "var(--radius)", cursor: "pointer", textAlign: "left", background: active ? "var(--primary-fixed)" : "transparent", color: active ? "var(--primary)" : "var(--on-surface)", fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: active ? 600 : 500 }}>
                  ${Ic(d.icon, 20)}${d.label}
                </button>`;
            })}
          </div>
          <div style=${{ padding: "12px 12px calc(12px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid var(--outline-variant)" }}>
            <button onClick=${function () { data.signOut().then(function () { props.onNavigate("login"); }); }} style=${{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", border: "none", borderRadius: "var(--radius)", cursor: "pointer", textAlign: "left", background: "transparent", color: "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 500 }}>
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

    useEffect(function () { return data.onUser(function (u) { userState[1](u); }); }, []);
    useEffect(function () {
      function onHash() { routeState[1](currentRoute()); menuState[1](false); }
      window.addEventListener("hashchange", onHash);
      return function () { window.removeEventListener("hashchange", onHash); };
    }, []);

    var ScreenComp = SCREENS[routeState[0]] || SCREENS.comingSoon || HomeScreen;
    return html`
      <div style=${{ height: "100%", position: "relative", overflow: "hidden" }}>
        <${ScreenComp} nav=${nav} openMenu=${function () { menuState[1](true); }} back=${function () { history.length > 1 ? history.back() : nav("home"); }} user=${userState[0]} params=${M.navParams || {}} />
        <${Drawer} open=${menuState[0]} current=${routeState[0]} user=${userState[0]} onClose=${function () { menuState[1](false); }} onNavigate=${function (r) { menuState[1](false); nav(r); }} />
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
