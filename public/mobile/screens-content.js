/* ============================================================
   screens-content.js — content screens for the mobile shell,
   ported from the Mosaic Mobile design and wired to real Firestore
   data via M.data loaders. Registered into M.SCREENS (merged by
   app.js, which owns the router).
   ============================================================ */
(function () {
  "use strict";
  var html = M.html, Ic = M.Ic, useAsync = M.useAsync, data = M.data;
  var useState = M.hooks.useState, useEffect = M.hooks.useEffect;
  var ui = M.ui;
  var Screen = ui.Screen, TopBar = ui.TopBar, BarAction = ui.BarAction, Body = ui.Body,
      Overline = ui.Overline, SearchBar = ui.SearchBar, FAB = ui.FAB, Button = ui.Button,
      Badge = ui.Badge, Avatar = ui.Avatar, statusTone = ui.statusTone;

  function Loading(props) {
    return html`<div style=${{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 20px", color: "var(--on-surface-variant)" }}>
      <span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 26)}</span>
      <span style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14 }}>${props.label || "Loading…"}</span>
    </div>`;
  }
  function Empty(props) {
    return html`<div style=${{ textAlign: "center", padding: 40, fontFamily: "var(--font-serif)", fontStyle: "italic", color: "var(--on-surface-variant)" }}>${props.children}</div>`;
  }
  function ErrorNote(props) {
    return html`<div style=${{ margin: "12px 16px", padding: "12px 14px", borderRadius: "var(--radius)", background: "var(--error-container)", color: "var(--on-error-container)", fontFamily: "var(--font-sans)", fontSize: 13 }}>${Ic("triangle-alert", 16)} ${props.children}</div>`;
  }

  function Chip(props) {
    var on = props.active;
    return html`<button onClick=${props.onClick} style=${{ flexShrink: 0, padding: "7px 14px", borderRadius: "var(--radius-full)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", border: on ? "1px solid var(--primary)" : "1px solid var(--outline-variant)", background: on ? "var(--primary)" : "var(--surface-container-lowest)", color: on ? "var(--on-primary)" : "var(--on-surface-variant)" }}>${props.children}</button>`;
  }

  // ── Hymn Directory ───────────────────────────────────────
  function HymnDirectoryScreen(props) {
    var st = useAsync(data.getHymns, []);
    var qS = useState(""), tagsS = useState([]);
    var hymns = st.data || [];
    var allTags = [];
    hymns.forEach(function (h) { h.tags.forEach(function (t) { if (allTags.indexOf(t) < 0) allTags.push(t); }); });
    allTags.sort();
    var q = qS[0], tags = tagsS[0];
    function toggle(t) { tagsS[1](tags.indexOf(t) < 0 ? tags.concat([t]) : tags.filter(function (x) { return x !== t; })); }
    var results = hymns.filter(function (h) {
      var mq = !q || data.lc(h.name).indexOf(data.lc(q)) >= 0 || data.lc(h.author).indexOf(data.lc(q)) >= 0;
      var mt = tags.length === 0 || tags.every(function (t) { return h.tags.indexOf(t) >= 0; });
      return mq && mt;
    });
    return html`
      <${Screen}>
        <${TopBar} title="Hymn Directory" onMenu=${props.openMenu} />
        <${Body} style=${{ paddingTop: 14 }}>
          <div style=${{ padding: "0 16px 12px" }}>
            <${SearchBar} placeholder="Search hymns & authors" value=${q} onChange=${function (e) { qS[1](e.target.value); }} />
          </div>
          ${allTags.length ? html`<div style=${{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 16px 12px" }}>
            ${allTags.map(function (t) { return html`<${Chip} key=${t} active=${tags.indexOf(t) >= 0} onClick=${function () { toggle(t); }}>${t}<//>`; })}
          </div>` : null}
          ${st.loading ? html`<${Loading} label="Loading hymns…" />` : st.error ? html`<${ErrorNote}>Couldn't load hymns.<//>` : html`
            <div style=${{ padding: "0 16px 4px" }}><${Overline}>${results.length} Hymns<//></div>
            <div style=${{ padding: "8px 16px calc(40px + env(safe-area-inset-bottom,0px))", display: "flex", flexDirection: "column", gap: 12 }}>
              ${results.map(function (h) {
                return html`<button key=${h.id} onClick=${function () { props.nav("hymnDetails", { hymn: h }); }} style=${{ display: "block", width: "100%", textAlign: "left", padding: 16, cursor: "pointer", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)" }}>
                  <div style=${{ fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 600, color: "var(--on-surface)", lineHeight: 1.25 }}>${h.name}</div>
                  ${h.author ? html`<div style=${{ fontFamily: "var(--font-serif)", fontSize: 14, fontStyle: "italic", color: "var(--on-surface-variant)", marginTop: 3 }}>${h.author}</div>` : null}
                  ${(h.tags.length || h.keys.length || h.hasSheet) ? html`<div style=${{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12, alignItems: "center" }}>
                    ${h.tags.map(function (t) { return html`<${Badge} key=${t} tone="secondary">${t}<//>`; })}
                    <span style=${{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--on-surface-variant)" }}>
                      ${h.keys.length ? html`<span>${h.keys.join(", ")}</span>` : null}
                      ${h.hasSheet ? html`<span style=${{ display: "flex", alignItems: "center", gap: 3 }}>${Ic("music", 13)} ${h.pages.length}</span>` : null}
                    </span>
                  </div>` : null}
                </button>`;
              })}
              ${results.length === 0 ? html`<${Empty}>No hymns match your search.<//>` : null}
            </div>`}
        </${Body}>
        <${FAB} icon="plus" label="Add hymn" onClick=${function () { props.nav("hymnManager", { new: true }); }} />
      </${Screen}>`;
  }

  // ── Hymn Details ─────────────────────────────────────────
  function HymnDetailsScreen(props) {
    var h = (props.params && props.params.hymn) || { name: "Hymn", lyricsWriter: "", musicWriter: "", tags: [], keys: [], pages: [], lastPlayed: "" };
    var writers = [h.lyricsWriter ? "Words: " + h.lyricsWriter : "", h.musicWriter ? "Music: " + h.musicWriter : ""].filter(Boolean).join("  ·  ");
    var stats = [["Sheets", String(h.pages.length)], ["Tags", String(h.tags.length)], ["Last sung", h.lastPlayed ? String(h.lastPlayed).slice(0, 10) : "—"]];
    return html`
      <${Screen}>
        <${TopBar} title="Hymn" onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "20px 16px calc(40px + env(safe-area-inset-bottom,0px))" }}>
          ${h.tags.length ? html`<${Overline}>${h.tags.join(" · ")}<//>` : null}
          <div style=${{ fontFamily: "var(--font-serif)", fontSize: 28, fontWeight: 600, color: "var(--primary)", lineHeight: 1.2, marginTop: 8 }}>${h.name}</div>
          ${writers ? html`<div style=${{ fontFamily: "var(--font-serif)", fontSize: 15, fontStyle: "italic", color: "var(--on-surface-variant)", marginTop: 4 }}>${writers}</div>` : null}
          <div style=${{ display: "flex", gap: 10, marginTop: 18 }}>
            ${stats.map(function (kv) { return html`<div key=${kv[0]} style=${{ flex: 1, background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", padding: "12px 10px", textAlign: "center" }}>
              <div style=${{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, color: "var(--on-surface)" }}>${kv[1]}</div>
              <div style=${{ fontFamily: "var(--font-sans)", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--on-surface-variant)", marginTop: 4 }}>${kv[0]}</div>
            </div>`; })}
          </div>
          <${Overline} style=${{ margin: "22px 0 10px" }}>Sheet Music<//>
          ${h.pages.length ? html`<div style=${{ display: "flex", flexDirection: "column", gap: 12 }}>
            ${h.pages.map(function (url, i) { return html`<img key=${i} src=${url} alt=${"Sheet page " + (i + 1)} loading="lazy" style=${{ width: "100%", display: "block", borderRadius: "var(--radius-xl)", border: "1px solid var(--outline-variant)", background: "var(--surface-container-lowest)" }} />`; })}
          </div>` : html`<div style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", height: 140, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--on-surface-variant)" }}>
            <span>${Ic("music", 28)}</span>
            <span style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5 }}>No sheet music uploaded yet</span>
          </div>`}
          <div style=${{ display: "flex", gap: 10, marginTop: 20 }}>
            <div style=${{ flex: 1 }}><${Button} variant="primary" size="md" style=${{ width: "100%" }} icon=${Ic("settings-2", 17)} onClick=${function () { props.nav("hymnManager", { edit: h.id }); }}>Manage Hymn<//></div>
            <div style=${{ flex: 1 }}><${Button} variant="secondary" size="md" style=${{ width: "100%" }} icon=${Ic("file-down", 17)}>Download<//></div>
          </div>
        </${Body}>
      </${Screen}>`;
  }

  // ── Member Directory ─────────────────────────────────────
  var STATUS_LABELS = { member: "Member", regular_attender: "Regular attender", visitor: "Visitor", inactive: "Inactive" };
  function PeopleScreen(props) {
    var st = useAsync(data.getPeople, []);
    var qS = useState(""), fS = useState("All");
    var people = st.data || [];
    var filters = ["All", "Members", "Attenders", "Visitors", "Needs care"];
    var q = qS[0], filter = fS[0];
    var results = people.filter(function (p) {
      var mq = !q || data.lc(p.name).indexOf(data.lc(q)) >= 0;
      var mf = true;
      if (filter === "Members") mf = p.status === "member";
      else if (filter === "Attenders") mf = p.status === "regular_attender";
      else if (filter === "Visitors") mf = p.status === "visitor";
      else if (filter === "Needs care") mf = !!p.shepherding;
      return mq && mf;
    });
    return html`
      <${Screen}>
        <${TopBar} title="Member Directory" onMenu=${props.openMenu} />
        <${Body} style=${{ paddingTop: 14 }}>
          <div style=${{ padding: "0 16px 12px" }}><${SearchBar} placeholder="Search people" value=${q} onChange=${function (e) { qS[1](e.target.value); }} /></div>
          <div style=${{ display: "flex", gap: 8, overflowX: "auto", padding: "0 16px 12px" }}>
            ${filters.map(function (f) { return html`<${Chip} key=${f} active=${f === filter} onClick=${function () { fS[1](f); }}>${f}<//>`; })}
          </div>
          ${st.loading ? html`<${Loading} label="Loading people…" />` : st.error ? html`<${ErrorNote}>Couldn't load the directory.<//>` : html`
            <div style=${{ padding: "0 16px 4px" }}><${Overline}>${results.length} People<//></div>
            <div style=${{ padding: "8px 16px 90px" }}>
              <div style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", overflow: "hidden" }}>
                ${results.map(function (p, i) {
                  var s = statusTone(p.shepherding);
                  return html`<button key=${p.id} onClick=${function () { props.nav("personDetail", { person: p }); }} style=${{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "12px 14px", cursor: "pointer", border: "none", background: "transparent", borderBottom: i === results.length - 1 ? "none" : "1px solid var(--outline-variant)" }}>
                    <div style=${{ position: "relative", flexShrink: 0 }}>
                      <${Avatar} name=${p.name} size=${44} />
                      ${s ? html`<span style=${{ position: "absolute", right: -1, bottom: -1, width: 13, height: 13, borderRadius: "50%", background: s.color, border: "2px solid var(--surface-container-lowest)" }}></span>` : null}
                    </div>
                    <div style=${{ flex: 1, minWidth: 0 }}>
                      <div style=${{ fontFamily: "var(--font-sans)", fontSize: 15.5, fontWeight: 600, color: "var(--on-surface)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>${p.name}</div>
                      ${p.role ? html`<div style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>${p.role}</div>` : null}
                    </div>
                    ${p.tags.indexOf("Red Flag") >= 0 ? html`<span style=${{ color: "var(--error)" }}>${Ic("flag", 15)}</span>` : null}
                    <span style=${{ color: "var(--outline)" }}>${Ic("chevron-right", 18)}</span>
                  </button>`;
                })}
                ${results.length === 0 ? html`<${Empty}>No people match.<//>` : null}
              </div>
            </div>`}
        </${Body}>
        <${FAB} icon="user-plus" label="Add person" />
      </${Screen}>`;
  }

  // ── Person Detail ────────────────────────────────────────
  function PersonDetailScreen(props) {
    var p = (props.params && props.params.person) || { name: "Person", status: "member", tags: [], involvements: 0 };
    var s = statusTone(p.shepherding);
    var contact = [["mail", p.email], ["phone", p.phone]].filter(function (r) { return r[1]; });
    return html`
      <${Screen}>
        <${TopBar} title="Directory" onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "22px 16px calc(40px + env(safe-area-inset-bottom,0px))" }}>
          <div style=${{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 22 }}>
            <${Avatar} name=${p.name} size=${82} />
            <div style=${{ fontFamily: "var(--font-serif)", fontSize: 23, fontWeight: 600, color: "var(--on-surface)", marginTop: 12 }}>${p.name}</div>
            <div style=${{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <${Badge} tone=${p.status === "member" ? "primary" : p.status === "visitor" ? "tertiary" : "secondary"}>${STATUS_LABELS[p.status] || p.status}<//>
              ${p.tags.map(function (t) { return html`<${Badge} key=${t} tone=${t === "Red Flag" ? "neutral" : "neutral"}>${t}<//>`; })}
            </div>
          </div>
          ${contact.length ? html`
            <${Overline} style=${{ margin: "0 0 8px 4px" }}>Contact<//>
            <div style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", overflow: "hidden", marginBottom: 18 }}>
              ${contact.map(function (r, i) { return html`<div key=${r[0]} style=${{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderBottom: i === contact.length - 1 ? "none" : "1px solid var(--outline-variant)" }}>
                <span style=${{ color: "var(--secondary)" }}>${Ic(r[0], 18)}</span>
                <span style=${{ fontFamily: "var(--font-sans)", fontSize: 14.5, color: "var(--on-surface)" }}>${r[1]}</span>
              </div>`; })}
            </div>` : null}
          <${Overline} style=${{ margin: "0 0 8px 4px" }}>Shepherding<//>
          <div style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", padding: 16 }}>
            ${s ? html`<div style=${{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span style=${{ width: 10, height: 10, borderRadius: "50%", background: s.color }}></span>
              <span style=${{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, color: "var(--on-surface)" }}>${s.label}</span>
            </div>` : html`<div style=${{ fontFamily: "var(--font-serif)", fontSize: 14, fontStyle: "italic", color: "var(--on-surface-variant)", marginBottom: 14 }}>No shepherding status set.</div>`}
            <${Button} variant="secondary" size="md" style=${{ width: "100%" }} icon=${Ic("shield", 16)} onClick=${function () { props.nav("shepherd"); }}>Open Shepherd Dashboard<//>
          </div>
        </${Body}>
      </${Screen}>`;
  }

  // ── Shared: segmented control + bar row ──────────────────
  function Segmented(props) {
    return html`<div style=${{ display: "flex", background: "var(--surface-container)", borderRadius: "var(--radius)", padding: 3, border: "1px solid var(--outline-variant)" }}>
      ${props.options.map(function (o) {
        var on = o === props.value;
        return html`<button key=${o} onClick=${function () { props.onChange(o); }} style=${{ flex: 1, padding: "8px 6px", border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, letterSpacing: "0.02em", background: on ? "var(--surface-container-lowest)" : "transparent", color: on ? "var(--primary)" : "var(--on-surface-variant)", boxShadow: on ? "var(--shadow-xs)" : "none" }}>${o}</button>`;
      })}
    </div>`;
  }
  function svcLabel(dateStr) {
    var d = new Date(String(dateStr) + "T00:00:00");
    if (isNaN(d.getTime())) return { mon: "", day: String(dateStr), year: "" };
    return { mon: d.toLocaleDateString(undefined, { month: "short" }).toUpperCase(), day: String(d.getDate()), year: String(d.getFullYear()) };
  }

  // ── Service Calendar ─────────────────────────────────────
  // Native port of mobile/screens_calendar.jsx: every Sunday is a slot,
  // grouped Year › Month (blank until scheduled), with a Historic toggle,
  // List / Table views, a month Directory sheet, Jump-to-Upcoming, and per-
  // service Guide + Order-of-Service actions. Wired to real getServices data.
  // "Inject service" opens the proven desktop scheduler in-shell (that shift
  // is a destructive collectionGroup batch — kept on tested code, not re-ported).
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function pad2(n) { return String(n).length < 2 ? "0" + n : String(n); }
  function keyOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function parseKey(s) { var d = new Date(String(s) + "T00:00:00"); return isNaN(d.getTime()) ? null : d; }
  function sundayOf(d) { var x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function scrollToId(id) { var el = document.getElementById(id); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }

  var CAL_LABEL = { fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--on-surface-variant)" };

  // Small rectangular status chip on the date cards.
  function CalChip(props) {
    var tones = {
      tertiary: { bg: "var(--tertiary-container)", fg: "var(--on-tertiary-container)" },
      secondary: { bg: "var(--secondary-container)", fg: "var(--on-secondary-container)" },
      error: { bg: "var(--error-container)", fg: "var(--on-error-container)" },
    };
    var t = tones[props.tone] || tones.secondary;
    return html`<span style=${{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: "var(--radius-sm)", background: t.bg, color: t.fg, fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600 }}>${Ic(props.icon, 12)}${props.children}</span>`;
  }

  function CalSwitch(props) {
    return html`<button onClick=${props.onClick} role="switch" aria-checked=${props.on} style=${{ position: "relative", width: 44, height: 26, flexShrink: 0, border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-full)", cursor: "pointer", background: props.on ? "var(--primary)" : "var(--surface-container)", transition: "background 0.2s" }}>
      <span style=${{ position: "absolute", top: 2, left: props.on ? 20 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "var(--shadow-xs)", transition: "left 0.2s" }} />
    </button>`;
  }

  function CalSheet(props) {
    return html`<${M.Fragment}>
      <div onClick=${props.onClose} style=${{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(14,28,54,0.42)", backdropFilter: "blur(1.5px)" }} />
      <div style=${{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 51, maxHeight: "78%", background: "var(--surface-container-lowest)", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTop: "1px solid var(--outline-variant)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column" }}>
        <div style=${{ padding: "16px 18px 12px", borderBottom: "1px solid var(--outline-variant)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style=${{ fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 600, color: "var(--primary)" }}>${props.title}</div>
            ${props.subtitle ? html`<div style=${Object.assign({}, CAL_LABEL, { marginTop: 4 })}>${props.subtitle}</div>` : null}
          </div>
          <button onClick=${props.onClose} aria-label="Close" style=${{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--on-surface-variant)", cursor: "pointer", flexShrink: 0 }}>${Ic("x", 20)}</button>
        </div>
        <div style=${{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))" }}>${props.children}</div>
      </div>
    </${M.Fragment}>`;
  }

  function calActBtn(primary) {
    return { flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 8px", borderRadius: "var(--radius-full)", cursor: "pointer", background: primary ? "var(--secondary)" : "transparent", color: primary ? "var(--on-secondary)" : "var(--secondary)", border: primary ? "1px solid var(--secondary)" : "1px solid var(--outline)", fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600 };
  }
  function calDirRow(isYear) {
    return { width: "100%", textAlign: "left", padding: isYear ? "12px 18px 6px" : "8px 18px 8px 34px", border: "none", background: "transparent", cursor: "pointer", fontFamily: isYear ? "var(--font-display)" : "var(--font-sans)", fontSize: isYear ? 16 : 14, fontWeight: isYear ? 600 : 500, color: isYear ? "var(--primary)" : "var(--on-surface-variant)" };
  }

  // Horizontally-scrolling table block for one month (columns that exist in the data).
  function CalTable(props) {
    var TH = { padding: "10px 12px", textAlign: "left", fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--primary)", borderBottom: "1px solid var(--outline-variant)", whiteSpace: "nowrap", background: "var(--surface-container-low)" };
    var TD = { padding: "11px 12px", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--on-surface-variant)", borderBottom: "1px solid var(--outline-variant)", whiteSpace: "nowrap", verticalAlign: "top" };
    var cols = ["Date", "Theme", "Leader", "Preacher", "Music", "Baptism", "Sermonette"];
    function dash(v) { return v && String(v).length ? v : "—"; }
    function open(d) { if (props.onOpen) props.onOpen(d); }
    return html`<div style=${{ margin: "0 16px", overflowX: "auto", WebkitOverflowScrolling: "touch", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", background: "var(--surface-container-lowest)" }}>
      <table style=${{ borderCollapse: "collapse", minWidth: 720 }}>
        <thead><tr>${cols.map(function (h) { return html`<th key=${h} style=${TH}>${h}</th>`; })}</tr></thead>
        <tbody>
          ${props.dates.map(function (d) {
            var s = props.byDate[keyOf(d)] || {};
            return html`<tr key=${keyOf(d)} onClick=${function () { open(d); }} style=${{ cursor: "pointer" }}>
              <td style=${Object.assign({}, TD, { color: "var(--on-surface)", fontWeight: 500 })}>${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</td>
              <td style=${Object.assign({}, TD, { whiteSpace: "normal", minWidth: 160, color: "var(--primary)" })}>${dash(s.theme)}</td>
              <td style=${TD}>${dash(s.serviceLeader)}</td>
              <td style=${TD}>${dash(s.preacher)}</td>
              <td style=${TD}>${dash(s.musicLeader)}</td>
              <td style=${TD}>${s.hasBaptism ? "Yes" : "—"}</td>
              <td style=${TD}>${dash(s.sermonette)}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
  }

  function CalendarScreen(props) {
    var st = useAsync(data.getServices, []);
    var viewS = useState("List");
    var histS = useState(false);
    var dirS = useState(false);
    var hlS = useState(null);
    var view = viewS[0], hist = histS[0];

    var services = st.data || [];
    var byDate = {};
    services.forEach(function (s) { byDate[s.date] = s; });
    var today = new Date().toISOString().slice(0, 10);

    // Sunday range: from the earliest of (today, first scheduled Sunday) through
    // the later of (last scheduled Sunday, ~120 days out) so upcoming blank slots
    // are always available to schedule into.
    var keys = services.map(function (s) { return s.date; }).filter(function (k) { return !!parseKey(k); });
    var minKey = keys.length ? keys.reduce(function (a, b) { return a < b ? a : b; }) : today;
    var maxKey = keys.length ? keys.reduce(function (a, b) { return a > b ? a : b; }) : today;
    var startD = sundayOf(parseKey(minKey < today ? minKey : today) || new Date());
    var endD = sundayOf(addDays(new Date(), 120));
    var maxD = sundayOf(parseKey(maxKey) || new Date());
    if (maxD.getTime() > endD.getTime()) endD = maxD;
    var sundays = [];
    for (var dd = new Date(startD.getTime()); dd.getTime() <= endD.getTime(); dd = addDays(dd, 7)) sundays.push(new Date(dd.getTime()));

    var upcomingKey = null;
    for (var u = 0; u < sundays.length; u++) { if (keyOf(sundays[u]) >= today) { upcomingKey = keyOf(sundays[u]); break; } }

    var shown = hist ? sundays : sundays.filter(function (d) { return keyOf(d) >= today; });

    // Group into [{ year, months: [{ mi, month, dates: [] }] }]
    var grouped = [];
    shown.forEach(function (d) {
      var y = d.getFullYear(), mi = d.getMonth();
      var yg = null, i;
      for (i = 0; i < grouped.length; i++) { if (grouped[i].year === y) { yg = grouped[i]; break; } }
      if (!yg) { yg = { year: y, months: [] }; grouped.push(yg); }
      var mg = null;
      for (i = 0; i < yg.months.length; i++) { if (yg.months[i].mi === mi) { mg = yg.months[i]; break; } }
      if (!mg) { mg = { mi: mi, month: MONTH_NAMES[mi], dates: [] }; yg.months.push(mg); }
      mg.dates.push(d);
    });

    function jumpUpcoming() {
      if (!upcomingKey) return;
      var el = document.getElementById("cal-d-" + upcomingKey);
      if (el) { el.scrollIntoView({ block: "start", behavior: "smooth" }); hlS[1](upcomingKey); setTimeout(function () { hlS[1](null); }, 2000); }
    }
    function goGuide(s, complete) {
      if (s && !complete && !window.confirm("Warning: There are elements that you have not completed yet. Please do so before going to the service guide page.\n\nDo you still want to proceed to the editor?")) return;
      props.nav("serviceGuide");
    }
    function openScheduler() { window.location.href = "service-calendar.html?shell=mobile"; }

    // Jump to the upcoming service on first load / view switch.
    useEffect(function () {
      if (st.loading || !upcomingKey) return;
      var el = document.getElementById("cal-d-" + upcomingKey);
      if (el) el.scrollIntoView({ block: "start" });
    }, [st.loading, view]);

    function renderCard(d) {
      var key = keyOf(d);
      var s = byDate[key];
      var hl = hlS[0] === key;
      var complete = !!(s && s.theme && s.preacher && s.serviceLeader);
      return html`<div key=${key} id=${"cal-d-" + key} style=${{ background: "var(--surface-container-lowest)", borderRadius: "var(--radius-xl)", padding: 15, border: hl ? "2px solid var(--primary)" : "1px solid var(--outline-variant)", boxShadow: hl ? "var(--shadow-sm)" : "none", transition: "border-color 0.3s, box-shadow 0.3s" }}>
        <div style=${{ display: "flex", gap: 13 }}>
          <div style=${{ flexShrink: 0, width: 52, height: 52, borderRadius: "var(--radius)", background: "var(--primary-fixed)", color: "var(--primary)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style=${{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>${d.toLocaleDateString(undefined, { weekday: "short" })}</span>
            <span style=${{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, lineHeight: 1 }}>${d.getDate()}</span>
          </div>
          <div style=${{ flex: 1, minWidth: 0 }}>
            <div style=${{ fontFamily: "var(--font-sans)", fontSize: 14.5, fontWeight: 600, color: "var(--on-surface)" }}>${d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div>
            ${s ? html`<${M.Fragment}>
              <div style=${{ fontFamily: "var(--font-serif)", fontSize: 15, fontWeight: 600, color: "var(--primary)", marginTop: 3, lineHeight: 1.25 }}>${s.theme}</div>
              <div style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)", marginTop: 3 }}>${s.preacher ? "Preaching · " + s.preacher : "Sunday Service"}</div>
              <div style=${{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                ${s.hasBaptism ? html`<${CalChip} icon="droplets" tone="tertiary">Baptism<//>` : null}
                ${s.sermonette ? html`<${CalChip} icon="mic" tone="secondary">Sermonette<//>` : null}
                ${!complete ? html`<${CalChip} icon="triangle-alert" tone="error">Incomplete<//>` : null}
              </div>
            </${M.Fragment}>` : html`<div style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)", marginTop: 3 }}>Sunday Service · <span style=${{ fontStyle: "italic" }}>unscheduled</span></div>`}
          </div>
        </div>
        <div style=${{ display: "flex", gap: 8, marginTop: 13 }}>
          <button onClick=${function () { goGuide(s, complete); }} style=${calActBtn(true)}>${Ic("book-open", 16)} Service Guide</button>
          <button onClick=${function () { props.nav("serviceBuilder", { date: key }); }} style=${calActBtn(false)}>${Ic("list-checks", 16)} Order of Service</button>
        </div>
      </div>`;
    }

    return html`
      <${Screen}>
        <${TopBar} title="Service Calendar" onMenu=${props.openMenu} right=${html`
          <${BarAction} icon="list-tree" label="Directory" onClick=${function () { dirS[1](true); }} />
          <${BarAction} icon="calendar-plus" label="Inject service" onClick=${openScheduler} />
        `} />

        <div style=${{ flexShrink: 0, background: "var(--surface-container-lowest)", borderBottom: "1px solid var(--outline-variant)", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <label onClick=${function () { histS[1](!hist); }} style=${{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
            <span style=${CAL_LABEL}>Historic</span>
            <${CalSwitch} on=${hist} onClick=${function () { histS[1](!hist); }} />
          </label>
          <${Segmented} options=${["List", "Table"]} value=${view} onChange=${function (o) { viewS[1](o); }} />
        </div>

        <${Body}>
          ${st.loading ? html`<${Loading} label="Loading services…" />` : st.error ? html`<${ErrorNote}>Couldn't load services.<//>` : html`
            <div style=${{ padding: view === "List" ? "8px 16px 96px" : "8px 0 96px" }}>
              ${grouped.map(function (yg) { return html`
                <div key=${yg.year} id=${"cal-y-" + yg.year}>
                  <h2 style=${{ margin: view === "List" ? "14px 0 8px" : "14px 16px 8px", paddingBottom: 6, borderBottom: "1px solid var(--outline-variant)", fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--primary)" }}>${yg.year}</h2>
                  ${yg.months.map(function (mg) { return html`
                    <div key=${mg.mi} id=${"cal-m-" + yg.year + "-" + mg.mi} style=${{ marginBottom: 18 }}>
                      <h3 style=${{ margin: view === "List" ? "10px 0 8px" : "10px 16px 8px", fontFamily: "var(--font-serif)", fontSize: 17, fontWeight: 600, color: "var(--secondary)" }}>${mg.month}</h3>
                      ${view === "List"
                        ? html`<div style=${{ display: "flex", flexDirection: "column", gap: 10 }}>${mg.dates.map(function (d) { return renderCard(d); })}</div>`
                        : html`<${CalTable} dates=${mg.dates} byDate=${byDate} onOpen=${function (d) { props.nav("serviceBuilder", { date: keyOf(d) }); }} />`}
                    </div>`; })}
                </div>`; })}
              ${grouped.length === 0 ? html`<${Empty}>No services to show.<//>` : null}
            </div>`}
        </${Body}>

        <${FAB} icon="calendar-check" label="Jump to upcoming" onClick=${jumpUpcoming} />

        ${dirS[0] ? html`<${CalSheet} title="Directory" subtitle="Jump to a month" onClose=${function () { dirS[1](false); }}>
          <button onClick=${function () { dirS[1](false); setTimeout(jumpUpcoming, 60); }} style=${{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", border: "none", borderBottom: "1px solid var(--outline-variant)", background: "transparent", cursor: "pointer", color: "var(--primary)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>${Ic("calendar-check", 16)} Jump to Upcoming</button>
          ${grouped.map(function (yg) { return html`<div key=${yg.year}>
            <button onClick=${function () { dirS[1](false); setTimeout(function () { scrollToId("cal-y-" + yg.year); }, 60); }} style=${calDirRow(true)}>${yg.year}</button>
            ${yg.months.map(function (mg) { return html`<button key=${mg.mi} onClick=${function () { dirS[1](false); setTimeout(function () { scrollToId("cal-m-" + yg.year + "-" + mg.mi); }, 60); }} style=${calDirRow(false)}>${mg.month}</button>`; })}
          </div>`; })}
        </${CalSheet}>` : null}
      </${Screen}>`;
  }

  // The Shepherd Dashboard is a native screen (see mobile/screens-shepherd.js).
  // The rest of the shepherding cluster — Documents, People, Manage Tags, and a
  // person's file — are the real desktop pages, opened in-place with ?shell=mobile
  // (routed in app.js SHELL_PAGES / nav). Kept out of the Preact shell so mobile
  // gets every feature + the proven save logic — see mobile-shell.js.

  // ── In-shell placeholder for routes not yet ported ───────
  function ComingSoon(props) {
    var title = (props.params && props.params.title) || "Coming soon";
    var page = props.params && props.params.page;
    return html`
      <${Screen}>
        <${TopBar} title=${title} onMenu=${props.openMenu} />
        <${Body} style=${{ padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
          <span style=${{ color: "var(--primary)" }}>${Ic("hammer", 34)}</span>
          <div style=${{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 600, color: "var(--on-surface)", marginTop: 14, textAlign: "center" }}>${title}</div>
          <div style=${{ fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--on-surface-variant)", marginTop: 6, textAlign: "center", lineHeight: 1.5 }}>This screen is being built for mobile. You can open the full desktop version in the meantime.</div>
          ${page ? html`<div style=${{ marginTop: 22 }}><${Button} variant="secondary" size="md" icon=${Ic("external-link", 16)} onClick=${function () { window.location.href = page; }}>Open full page<//></div>` : null}
        </${Body}>
      </${Screen}>`;
  }

  M.SCREENS = Object.assign(M.SCREENS || {}, {
    hymnDirectory: HymnDirectoryScreen,
    hymnDetails: HymnDetailsScreen,
    people: PeopleScreen,
    personDetail: PersonDetailScreen,
    calendar: CalendarScreen,
    comingSoon: ComingSoon,
  });
})();
