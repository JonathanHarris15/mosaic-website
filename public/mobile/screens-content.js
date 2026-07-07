/* ============================================================
   screens-content.js — content screens for the mobile shell,
   ported from the Mosaic Mobile design and wired to real Firestore
   data via M.data loaders. Registered into M.SCREENS (merged by
   app.js, which owns the router).
   ============================================================ */
(function () {
  "use strict";
  var html = M.html, Ic = M.Ic, useAsync = M.useAsync, data = M.data;
  var useState = M.hooks.useState;
  var ui = M.ui;
  var Screen = ui.Screen, TopBar = ui.TopBar, Body = ui.Body,
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
            <div style=${{ flex: 1 }}><${Button} variant="primary" size="md" style=${{ width: "100%" }} icon=${Ic("plus", 17)}>Add to Service<//></div>
            <div style=${{ flex: 1 }}><${Button} variant="secondary" size="md" style=${{ width: "100%" }} icon=${Ic("file-down", 17)}>Download<//></div>
          </div>
        </${Body}>
      </${Screen}>`;
  }

  // ── Hymn Manager ─────────────────────────────────────────
  function HymnManagerScreen(props) {
    var st = useAsync(data.getHymns, []);
    var qS = useState("");
    var hymns = st.data || [];
    var results = hymns.filter(function (h) { return !qS[0] || data.lc(h.name).indexOf(data.lc(qS[0])) >= 0; });
    var noSheet = hymns.filter(function (h) { return !h.hasSheet; }).length;
    return html`
      <${Screen}>
        <${TopBar} title="Hymn Manager" onMenu=${props.openMenu} />
        <${Body} style=${{ paddingTop: 14 }}>
          <div style=${{ padding: "0 16px 12px" }}><${SearchBar} placeholder="Search catalog" value=${qS[0]} onChange=${function (e) { qS[1](e.target.value); }} /></div>
          <div style=${{ padding: "0 16px 12px", display: "flex", gap: 10 }}>
            <div style=${{ flex: 1, background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
              <div style=${{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--primary)" }}>${hymns.length}</div>
              <div style=${{ fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--on-surface-variant)" }}>In catalog</div>
            </div>
            <div style=${{ flex: 1, background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
              <div style=${{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--warning)" }}>${noSheet}</div>
              <div style=${{ fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--on-surface-variant)" }}>No sheet music</div>
            </div>
          </div>
          ${st.loading ? html`<${Loading} label="Loading catalog…" />` : html`
            <${Overline} style=${{ padding: "0 16px 8px" }}>Catalog<//>
            <div style=${{ padding: "0 16px 90px", display: "flex", flexDirection: "column", gap: 10 }}>
              ${results.map(function (h) {
                return html`<div key=${h.id} style=${{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)" }}>
                  <div style=${{ flex: 1, minWidth: 0 }}>
                    <div style=${{ fontFamily: "var(--font-serif)", fontSize: 16, fontWeight: 600, color: "var(--on-surface)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>${h.name}</div>
                    <div style=${{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                      ${h.hasSheet
                        ? html`<span style=${{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--success)" }}>${Ic("music", 13)} ${h.pages.length} page${h.pages.length === 1 ? "" : "s"}</span>`
                        : html`<span style=${{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--on-surface-variant)" }}>${Ic("music-2", 13)} No sheet music</span>`}
                    </div>
                  </div>
                  <button aria-label="Edit hymn" style=${{ width: 40, height: 40, border: "1px solid var(--outline-variant)", background: "var(--surface-container-low)", borderRadius: "var(--radius)", color: "var(--on-surface-variant)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>${Ic("pencil", 17)}</button>
                </div>`;
              })}
              ${results.length === 0 ? html`<${Empty}>No hymns found.<//>` : null}
            </div>`}
        </${Body}>
        <${FAB} icon="plus" label="Add hymn" />
      </${Screen}>`;
  }

  // ── People's Directory ───────────────────────────────────
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
        <${TopBar} title="People's Directory" onMenu=${props.openMenu} />
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
  function CalendarScreen(props) {
    var st = useAsync(data.getServices, []);
    var tabS = useState("Upcoming");
    var today = new Date().toISOString().slice(0, 10);
    var all = st.data || [];
    var list = all.filter(function (s) {
      var upcoming = String(s.date) >= today;
      return tabS[0] === "Upcoming" ? upcoming : !upcoming;
    });
    return html`
      <${Screen}>
        <${TopBar} title="Service Calendar" onMenu=${props.openMenu} />
        <${Body} style=${{ paddingTop: 14 }}>
          <div style=${{ padding: "0 16px 14px" }}><${Segmented} options=${["Upcoming", "Past"]} value=${tabS[0]} onChange=${function (o) { tabS[1](o); }} /></div>
          ${st.loading ? html`<${Loading} label="Loading services…" />` : st.error ? html`<${ErrorNote}>Couldn't load services.<//>` : html`
            <div style=${{ padding: "0 16px 90px", display: "flex", flexDirection: "column", gap: 12 }}>
              ${list.map(function (s) {
                var lab = svcLabel(s.date);
                var complete = !!(s.theme && s.preacher && s.serviceLeader);
                return html`<button key=${s.id} onClick=${function () { props.nav("serviceBuilder", { date: s.date }); }} style=${{ display: "flex", gap: 14, width: "100%", textAlign: "left", padding: 16, cursor: "pointer", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)" }}>
                  <div style=${{ flexShrink: 0, width: 52, textAlign: "center" }}>
                    <div style=${{ fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", color: "var(--secondary)" }}>${lab.mon}</div>
                    <div style=${{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 600, color: "var(--primary)", lineHeight: 1 }}>${lab.day}</div>
                    ${lab.year ? html`<div style=${{ fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600, color: "var(--on-surface-variant)", marginTop: 3 }}>${lab.year}</div>` : null}
                  </div>
                  <div style=${{ flex: 1, minWidth: 0, borderLeft: "1px solid var(--outline-variant)", paddingLeft: 14 }}>
                    <div style=${{ fontFamily: "var(--font-serif)", fontSize: 17, fontWeight: 600, color: "var(--on-surface)", lineHeight: 1.25 }}>${s.theme}</div>
                    ${s.preacher ? html`<div style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)", marginTop: 4 }}>Preaching · ${s.preacher}</div>` : null}
                    <div style=${{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      ${s.hasBaptism ? html`<${Badge} tone="tertiary" icon=${Ic("droplet", 12)}>Baptism<//>` : null}
                      ${s.sermonette ? html`<${Badge} tone="secondary" icon=${Ic("mic", 12)}>Sermonette<//>` : null}
                      ${!complete ? html`<${Badge} tone="neutral" icon=${Ic("triangle-alert", 12)}>Incomplete<//>` : null}
                    </div>
                  </div>
                </button>`;
              })}
              ${list.length === 0 ? html`<${Empty}>No ${tabS[0].toLowerCase()} services.<//>` : null}
            </div>`}
        </${Body}>
      </${Screen}>`;
  }

  // The Shepherd Dashboard, Document Library, and the rest of the shepherding
  // cluster are the real desktop pages, opened in-place with ?shell=mobile
  // (routed in app.js SHELL_PAGES). Kept out of the Preact shell so mobile gets
  // every feature + the proven save logic — see mobile-shell.js.

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
    hymnManager: HymnManagerScreen,
    people: PeopleScreen,
    personDetail: PersonDetailScreen,
    calendar: CalendarScreen,
    comingSoon: ComingSoon,
  });
})();
