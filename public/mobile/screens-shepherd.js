/* ============================================================
   screens-shepherd.js — native Shepherd Dashboard for the mobile
   shell. Ported from the Mosaic Mobile design (screens_shepherd_dash
   + screens_shepherd_util) to Preact/htm and wired to real Firestore
   data via M.data. The Shepherding Status value model + Tag-Hold
   logic come from window.ShepherdingCore (single source of truth).

   The dashboard is native; its destinations (Documents, People,
   Manage Tags, and a person's file) open the proven desktop pages
   in-shell — see SHELL_PAGES / nav() in app.js.
   ============================================================ */
(function () {
  "use strict";
  var html = M.html, Ic = M.Ic, data = M.data, Fragment = M.Fragment;
  var useState = M.hooks.useState, useEffect = M.hooks.useEffect;
  var ui = M.ui;
  var Screen = ui.Screen, TopBar = ui.TopBar, Body = ui.Body;
  var Core = window.ShepherdingCore;

  var URG = Core.URGENCY_LEVELS, IMP = Core.IMPORTANCE_LEVELS;
  var URGL = Core.URGENCY_LABEL, IMPL = Core.IMPORTANCE_LABEL;
  var zoneKey = Core.statusZoneKey;

  // Warm status-matrix cell styling by urgency×importance score band (inline —
  // the shell doesn't use Tailwind, so we can't reuse Core.statusCellColor).
  function cellStyle(u, i, selected) {
    if (selected) return { border: "var(--primary)", bg: "var(--primary)", dot: true };
    var s = Core.statusScore(u, i);
    if (s <= 1) return { border: "rgba(179,38,30,0.4)", bg: "rgba(179,38,30,0.10)", dot: false };
    if (s <= 3) return { border: "rgba(62,97,129,0.35)", bg: "rgba(62,97,129,0.10)", dot: false };
    return { border: "var(--outline-variant)", bg: "var(--surface-container)", dot: false };
  }

  var OVER = { fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--on-surface-variant)" };
  var iconBtn = { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--on-surface-variant)", cursor: "pointer", borderRadius: 8 };
  var inputStyle = { width: "100%", boxSizing: "border-box", padding: "10px 12px", background: "var(--surface-container-low)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", outline: "none", fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--on-surface)" };
  function pill(variant) {
    return { padding: variant === "lg" ? "10px 20px" : "9px 16px", borderRadius: "var(--radius-full)", border: "none", background: variant === "ghost" ? "transparent" : "var(--primary)", color: variant === "ghost" ? "var(--on-surface-variant)" : "var(--on-primary)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
  }

  // ── Shared bits (Preact ports of the design util) ────────────
  function Field(props) {
    return html`<label style=${{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style=${{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--on-surface-variant)" }}>${props.label}</span>
      ${props.children}
    </label>`;
  }

  function TagChip(props) {
    var on = props.on;
    return html`<button onClick=${props.onClick} style=${{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: "var(--radius-full)", cursor: "pointer", border: on ? "none" : "1px solid var(--outline-variant)", background: on ? "var(--primary)" : "var(--surface-container)", color: on ? "var(--on-primary)" : "var(--on-surface)", fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 500 }}>${props.label}${on ? Ic("check", 13) : null}</button>`;
  }

  // Urgency × importance matrix. selected(u,i) -> bool; onCell(u,i).
  function StatusMatrix(props) {
    var cell = props.cell || 44, labelW = props.labelW || 66, compact = props.compact;
    var urgHead = compact ? { urgent: "Urg.", somewhat_urgent: "Swht.", not_urgent: "Not" } : { urgent: "Urgent", somewhat_urgent: "Somewhat", not_urgent: "Not Urgent" };
    var impRow = { important: "Imp.", somewhat_important: "Swht.", not_important: "Not" };
    var cols = labelW + "px " + cell + "px " + cell + "px " + cell + "px";
    var headStyle = { textAlign: "center", fontFamily: "var(--font-sans)", fontSize: 9, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--on-surface-variant)" };
    return html`<div style=${{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <div style=${{ display: "grid", gridTemplateColumns: cols, gap: 4 }}>
        <div></div>
        ${URG.map(function (u) { return html`<div key=${u} style=${headStyle}>${urgHead[u]}</div>`; })}
      </div>
      ${IMP.map(function (imp) {
        return html`<div key=${imp} style=${{ display: "grid", gridTemplateColumns: cols, gap: 4, alignItems: "center" }}>
          <div style=${{ textAlign: "right", paddingRight: 6, fontFamily: "var(--font-sans)", fontSize: 9, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--on-surface-variant)" }}>${impRow[imp]}</div>
          ${URG.map(function (u) {
            var sel = props.selected(u, imp);
            var st = cellStyle(u, imp, sel);
            return html`<button key=${u} onClick=${function () { props.onCell(u, imp); }} style=${{ width: cell, height: cell, border: "2px solid " + st.border, background: st.bg, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", margin: "0 auto", boxShadow: sel ? "0 0 0 3px rgba(24,47,87,0.15)" : "none" }}>
              ${st.dot ? html`<span style=${{ width: cell > 40 ? 10 : 8, height: cell > 40 ? 10 : 8, borderRadius: "50%", background: "var(--on-primary)" }}></span>` : null}
            </button>`;
          })}
        </div>`;
      })}
    </div>`;
  }

  // Centered modal.
  function Modal(props) {
    return html`<${Fragment}>
      <div onClick=${props.onClose} style=${{ position: "absolute", inset: 0, zIndex: 55, background: "rgba(14,28,54,0.42)", backdropFilter: "blur(1.5px)" }}></div>
      <div style=${{ position: "absolute", left: 16, right: 16, top: "50%", transform: "translateY(-50%)", zIndex: 56, maxHeight: "84%", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: 18, boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style=${{ padding: "16px 18px 12px", borderBottom: "1px solid var(--outline-variant)", flexShrink: 0 }}>
          <h2 style=${{ margin: 0, fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 600, color: "var(--primary)" }}>${props.title}</h2>
        </div>
        <div style=${{ padding: 18, overflowY: "auto", flex: 1 }}>${props.children}</div>
        ${props.footer ? html`<div style=${{ padding: "12px 18px", borderTop: "1px solid var(--outline-variant)", display: "flex", justifyContent: "flex-end", gap: 10, flexShrink: 0 }}>${props.footer}</div>` : null}
      </div>
    </${Fragment}>`;
  }

  function Toast(props) {
    if (!props.toast) return null;
    return html`<div style=${{ position: "absolute", bottom: "calc(28px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", zIndex: 70, padding: "11px 18px", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)", background: props.toast.type === "error" ? "var(--error)" : "var(--primary)", color: "#fff", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", maxWidth: "90%" }}>${props.toast.message}</div>`;
  }

  // ── View filter logic (mirrors shepherding-dashboard.js) ─────
  function viewTagHoldDays(view, tagId) {
    if (view.tagHoldFilters && view.tagHoldFilters[tagId] != null) return view.tagHoldFilters[tagId];
    return view.minHoldDays || 0;
  }
  function viewTagCmp(view, tagId) { return (view.tagHoldCmp && view.tagHoldCmp[tagId]) || "gte"; }
  function viewHasHoldFilter(view) {
    if (view.minHoldDays > 0) return true;
    var f = view.tagHoldFilters;
    return !!f && Object.keys(f).some(function (k) { return f[k] > 0; });
  }
  function peopleForView(view, people, tagHolds) {
    var result = people.filter(function (p) { return !window.ShepherdingCore.isInactiveMembership(p.membership); });
    if (view.filterTags && view.filterTags.length > 0) {
      var matches = function (p, t) {
        if ((p.tags || []).indexOf(t) === -1) return false;
        var min = viewTagHoldDays(view, t);
        if (min <= 0) return true;
        var h = (tagHolds[p.id] || {})[t];
        return Core.holdSatisfies(h && h.durationMs, min, viewTagCmp(view, t));
      };
      result = result.filter(function (p) {
        return view.filterMode === "all"
          ? view.filterTags.every(function (t) { return matches(p, t); })
          : view.filterTags.some(function (t) { return matches(p, t); });
      });
    }
    if (view.statusZoneFilters && view.statusZoneFilters.length > 0) {
      result = result.filter(function (p) {
        return p.shepherdingStatus && view.statusZoneFilters.indexOf(zoneKey(p.shepherdingStatus.urgency, p.shepherdingStatus.importance)) !== -1;
      });
    }
    return result;
  }
  // Preserve hold config the mobile view editor can't show, for tags kept selected.
  function preserveHolds(view, filterTags) {
    var holds = {}, cmp = {}, src = view.tagHoldFilters || {}, srcCmp = view.tagHoldCmp || {};
    filterTags.forEach(function (t) { if (src[t] > 0) { holds[t] = src[t]; if (srcCmp[t] === "lt") cmp[t] = "lt"; } });
    return { tagHoldFilters: holds, tagHoldCmp: cmp };
  }

  function fmtDue(ts) {
    if (!ts) return "";
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  // ── Shepherd Dashboard ───────────────────────────────────────
  function ShepherdScreen(props) {
    var user = props.user || {};
    var loadingS = useState(true), errS = useState(false);
    var remindersS = useState([]), viewsS = useState([]), peopleS = useState([]), tagsS = useState([]), holdsS = useState({});
    var selectedS = useState(null);
    var toastS = useState(null);
    var rmndModalS = useState(false), rmndFormS = useState({ title: "", due: "" });
    var viewModalS = useState(null); // { editingId, title, filterTags, filterMode, statusZones }

    var reminders = remindersS[0], views = viewsS[0], people = peopleS[0], tags = tagsS[0], holds = holdsS[0];
    var toast = toastS[0];
    function showToast(message, type) { toastS[1]({ message: message, type: type || "success" }); setTimeout(function () { toastS[1](null); }, 2600); }

    // Load everything; fetch Tag-Hold history only if a view needs it (ADR-0011).
    useEffect(function () {
      var alive = true;
      Promise.all([data.getShepherdingReminders(), data.getShepherdingViews(), data.getShepherdingPeople(), data.getShepherdingTags()])
        .then(function (res) {
          if (!alive) return;
          remindersS[1](res[0]); viewsS[1](res[1]); peopleS[1](res[2]); tagsS[1](res[3]);
          if (res[1].some(viewHasHoldFilter)) {
            data.getShepherdingTagHolds(res[2]).then(function (h) { if (alive) holdsS[1](h); });
          }
          loadingS[1](false);
        })
        .catch(function () { if (alive) { errS[1](true); loadingS[1](false); } });
      return function () { alive = false; };
    }, []);

    function reloadViews(selectId) {
      return data.getShepherdingViews().then(function (list) {
        viewsS[1](list);
        if (list.some(viewHasHoldFilter)) data.getShepherdingTagHolds(people).then(holdsS[1]);
        if (selectId !== undefined) selectedS[1](selectId);
      });
    }
    function reloadReminders() { return data.getShepherdingReminders().then(remindersS[1]); }

    function tagName(id) { for (var i = 0; i < tags.length; i++) { if (tags[i].id === id) return tags[i].name; } return id; }

    // ── Filtered Views ──
    function openNewView() { viewModalS[1]({ editingId: null, title: "", filterTags: [], filterMode: "any", statusZones: [] }); }
    function openEditView(v) { viewModalS[1]({ editingId: v.id, title: v.title || "", filterTags: (v.filterTags || []).slice(), filterMode: v.filterMode || "any", statusZones: (v.statusZoneFilters || []).slice() }); }
    function saveView() {
      var vm = viewModalS[0];
      if (!vm || !vm.title.trim()) return;
      if (vm.editingId) {
        var existing = views.filter(function (v) { return v.id === vm.editingId; })[0] || {};
        var kept = preserveHolds(existing, vm.filterTags);
        data.updateShepherdingView(vm.editingId, {
          title: vm.title.trim(), filterTags: vm.filterTags, filterMode: vm.filterMode, statusZoneFilters: vm.statusZones,
          tagHoldFilters: kept.tagHoldFilters, tagHoldCmp: kept.tagHoldCmp,
        }).then(function () { viewModalS[1](null); reloadViews(vm.editingId); showToast("View updated"); })
          .catch(function () { showToast("Error updating view", "error"); });
      } else {
        data.addShepherdingView({
          title: vm.title.trim(), filterTags: vm.filterTags, filterMode: vm.filterMode, statusZoneFilters: vm.statusZones,
          tagHoldFilters: {}, tagHoldCmp: {},
        }, user).then(function (newId) { viewModalS[1](null); reloadViews(newId); showToast("Filtered view created"); })
          .catch(function () { showToast("Error creating view", "error"); });
      }
    }
    function deleteView(id) {
      if (!window.confirm("Are you sure you want to delete this view?")) return;
      data.deleteShepherdingView(id).then(function () {
        viewsS[1](views.filter(function (v) { return v.id !== id; }));
        if (selectedS[0] === id) selectedS[1](null);
        showToast("View deleted");
      }).catch(function () { showToast("Error deleting view", "error"); });
    }

    // ── Reminders ──
    function addReminder() {
      var f = rmndFormS[0];
      if (!f.title.trim() || !f.due) return;
      var due = new Date(f.due);
      if (isNaN(due.getTime())) return;
      data.addShepherdingReminder(f.title.trim(), due, user).then(function () {
        rmndFormS[1]({ title: "", due: "" }); rmndModalS[1](false); reloadReminders(); showToast("Reminder added");
      }).catch(function () { showToast("Error adding reminder", "error"); });
    }
    function deleteReminder(id) {
      data.deleteShepherdingReminder(id).then(function () {
        remindersS[1](reminders.filter(function (r) { return r.id !== id; })); showToast("Reminder deleted");
      }).catch(function () { showToast("Error deleting reminder", "error"); });
    }

    var navCards = [
      { icon: "folder-open", title: "Documents", desc: "Elder notes & meeting minutes.", go: function () { props.nav("documents"); } },
      { icon: "users", title: "People", desc: "View & manage member profiles.", go: function () { props.nav("shepherdPeople"); } },
      { icon: "tag", title: "Manage Tags", desc: "Create, rename & merge shepherding tags.", go: function () { props.nav("shepherdTags"); } },
      // Relations Viewer: placeholder card, intentionally not linked yet — the
      // visual relationship dashboard is still being designed (see PRD).
      { icon: "waypoints", title: "Relations Viewer", desc: "See how members are connected.", soon: true, go: function () {} },
    ];

    var userKnown = props.user !== undefined; // undefined = still resolving auth
    var isElder = userKnown && !!props.user && (props.user.role === "elder" || props.user.role === "super_admin");
    var vm = viewModalS[0];
    var selectedView = views.filter(function (v) { return v.id === selectedS[0]; })[0];

    return html`
      <${Screen}>
        <${TopBar} title="Shepherd" onMenu=${props.openMenu} serif=${false} />
        <${Body} style=${{ padding: "16px 16px 40px" }}>
          ${!userKnown ? html`<div style=${{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 20px", color: "var(--on-surface-variant)" }}>
              <span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 26)}</span>
            </div>`
          : !isElder ? html`<div style=${{ padding: "60px 24px", textAlign: "center", color: "var(--on-surface-variant)" }}>
              <div style=${{ display: "inline-flex", opacity: 0.5 }}>${Ic("shield-alert", 40)}</div>
              <p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, marginTop: 12 }}>Elder-only tools.</p>
            </div>`
          : html`
          <div style=${{ marginBottom: 18 }}>
            <div style=${{ fontFamily: "var(--font-serif)", fontSize: 24, fontWeight: 600, color: "var(--primary)" }}>Shepherd Dashboard</div>
            <p style=${{ margin: "4px 0 0", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--on-surface-variant)" }}>Elder-only tools for member care.</p>
          </div>

          <div style=${{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            ${navCards.map(function (c) {
              return html`<button key=${c.title} onClick=${c.go} disabled=${!!c.soon} style=${{ display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left", padding: 16, cursor: c.soon ? "default" : "pointer", background: "var(--surface-container-lowest)", border: c.soon ? "1px dashed var(--outline-variant)" : "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", opacity: c.soon ? 0.65 : 1 }}>
                <span style=${{ width: 48, height: 48, borderRadius: "var(--radius-full)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-container)", color: "var(--primary)" }}>${Ic(c.icon, 24)}</span>
                <div style=${{ flex: 1, minWidth: 0 }}>
                  <div style=${{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-serif)", fontSize: 17, fontWeight: 600, color: "var(--on-surface)" }}>${c.title}${c.soon ? html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--on-surface-variant)", background: "var(--surface-container)", padding: "2px 7px", borderRadius: "var(--radius-full)" }}>Soon</span>` : null}</div>
                  <div style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)", marginTop: 2 }}>${c.desc}</div>
                </div>
                ${c.soon ? null : html`<span style=${{ color: "var(--outline)" }}>${Ic("chevron-right", 18)}</span>`}
              </button>`;
            })}
          </div>

          <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style=${OVER}>Filtered Views</span>
            <button onClick=${openNewView} style=${{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", border: "none", borderRadius: "var(--radius)", background: "var(--primary)", color: "var(--on-primary)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600 }}>${Ic("plus", 15)} New View</button>
          </div>

          ${loadingS[0] ? html`<p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14, color: "var(--on-surface-variant)", margin: "0 0 22px" }}>Loading…</p>`
            : views.length === 0 ? html`<p style=${{ fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)", margin: "0 0 22px" }}>No filtered views yet. Create one to see a custom subset of people here.</p>`
            : html`<${Fragment}>
              <div style=${{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                ${views.map(function (v) {
                  var on = selectedS[0] === v.id;
                  return html`<button key=${v.id} onClick=${function () { selectedS[1](on ? null : v.id); }} style=${{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: "var(--radius-full)", cursor: "pointer", border: on ? "none" : "1px solid var(--outline-variant)", background: on ? "var(--primary)" : "var(--surface-container-lowest)", color: on ? "var(--on-primary)" : "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600 }}>${v.title}${on ? Ic("x", 13) : null}</button>`;
                })}
              </div>
              ${selectedView ? renderViewCard(selectedView) : null}
            </${Fragment}>`}

          <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style=${OVER}>Reminders</span>
            <button onClick=${function () { rmndModalS[1](true); }} style=${{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", border: "none", borderRadius: "var(--radius)", background: "var(--primary)", color: "var(--on-primary)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600 }}>${Ic("plus", 15)} Add</button>
          </div>
          ${loadingS[0] ? null
            : reminders.length === 0 ? html`<p style=${{ fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)", margin: 0 }}>No upcoming reminders.</p>`
            : html`<div style=${{ display: "flex", flexDirection: "column", gap: 8 }}>
              ${reminders.map(function (r) {
                return html`<div key=${r.id} style=${{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, background: "var(--surface-container)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
                  <div style=${{ minWidth: 0 }}>
                    <div style=${{ fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--on-surface)" }}>${r.title}</div>
                    <div style=${{ display: "flex", alignItems: "center", gap: 5, marginTop: 4, fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--on-surface-variant)" }}>${Ic("clock", 13)} ${fmtDue(r.dueDatetime)}</div>
                  </div>
                  <button onClick=${function () { deleteReminder(r.id); }} aria-label="Delete reminder" style=${Object.assign({}, iconBtn, { flexShrink: 0 })}>${Ic("trash-2", 16)}</button>
                </div>`;
              })}
            </div>`}
          `}
        </${Body}>

        ${rmndModalS[0] ? html`<${Modal} onClose=${function () { rmndModalS[1](false); }} title="Add Reminder"
          footer=${html`<${Fragment}><button onClick=${function () { rmndModalS[1](false); }} style=${pill("ghost")}>Cancel</button><button onClick=${addReminder} style=${pill()}>Add Reminder</button></${Fragment}>`}>
          <div style=${{ display: "flex", flexDirection: "column", gap: 14 }}>
            <${Field} label="Title"><input value=${rmndFormS[0].title} onInput=${function (e) { rmndFormS[1](Object.assign({}, rmndFormS[0], { title: e.target.value })); }} placeholder="e.g. Follow up with the Johnson family" style=${inputStyle} /></${Field}>
            <${Field} label="Due date & time"><input type="datetime-local" value=${rmndFormS[0].due} onInput=${function (e) { rmndFormS[1](Object.assign({}, rmndFormS[0], { due: e.target.value })); }} style=${inputStyle} /></${Field}>
          </div>
        </${Modal}>` : null}

        ${vm ? html`<${Modal} onClose=${function () { viewModalS[1](null); }} title=${vm.editingId ? "Edit Filtered View" : "New Filtered View"}
          footer=${html`<${Fragment}><button onClick=${function () { viewModalS[1](null); }} style=${pill("ghost")}>Cancel</button><button onClick=${saveView} style=${pill()}>${vm.editingId ? "Save Changes" : "Create View"}</button></${Fragment}>`}>
          <div style=${{ display: "flex", flexDirection: "column", gap: 16 }}>
            <${Field} label="View title"><input value=${vm.title} onInput=${function (e) { viewModalS[1](Object.assign({}, vm, { title: e.target.value })); }} placeholder="e.g. Red Flag Members" style=${inputStyle} /></${Field}>
            <div>
              <div style=${Object.assign({}, OVER, { fontSize: 10, marginBottom: 8 })}>Filter by tags</div>
              ${tags.length === 0 ? html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)" }}>No tags yet. Create some on the Manage Tags page.</span>`
                : html`<div style=${{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                ${tags.map(function (t) {
                  var on = vm.filterTags.indexOf(t.id) !== -1;
                  return html`<${TagChip} key=${t.id} label=${t.name} on=${on} onClick=${function () { viewModalS[1](Object.assign({}, vm, { filterTags: on ? vm.filterTags.filter(function (x) { return x !== t.id; }) : vm.filterTags.concat([t.id]) })); }} />`;
                })}
              </div>`}
            </div>
            ${vm.filterTags.length > 1 ? html`<div>
              <div style=${Object.assign({}, OVER, { fontSize: 10, marginBottom: 8 })}>Match mode</div>
              <div style=${{ display: "flex", gap: 16 }}>
                ${[["any", "Match any tag"], ["all", "Match all tags"]].map(function (opt) {
                  var on = vm.filterMode === opt[0];
                  return html`<label key=${opt[0]} onClick=${function () { viewModalS[1](Object.assign({}, vm, { filterMode: opt[0] })); }} style=${{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--on-surface)" }}>
                    <span style=${{ width: 18, height: 18, borderRadius: "50%", border: "2px solid " + (on ? "var(--primary)" : "var(--outline-variant)"), display: "inline-flex", alignItems: "center", justifyContent: "center" }}>${on ? html`<span style=${{ width: 9, height: 9, borderRadius: "50%", background: "var(--primary)" }}></span>` : null}</span>
                    ${opt[1]}
                  </label>`;
                })}
              </div>
            </div>` : null}
            <div>
              <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style=${Object.assign({}, OVER, { fontSize: 10 })}>Filter by status</span>
                ${vm.statusZones.length ? html`<button onClick=${function () { viewModalS[1](Object.assign({}, vm, { statusZones: [] })); }} style=${{ border: "none", background: "none", color: "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>Clear</button>` : null}
              </div>
              <${StatusMatrix} compact=${true} cell=${38} labelW=${52}
                selected=${function (u, i) { return vm.statusZones.indexOf(zoneKey(u, i)) !== -1; }}
                onCell=${function (u, i) { var k = zoneKey(u, i); viewModalS[1](Object.assign({}, vm, { statusZones: vm.statusZones.indexOf(k) !== -1 ? vm.statusZones.filter(function (x) { return x !== k; }) : vm.statusZones.concat([k]) })); }}
              />
            </div>
          </div>
        </${Modal}>` : null}

        <${Toast} toast=${toast} />
      </${Screen}>`;

    // Rendered inside the component so it closes over people/holds/handlers.
    function renderViewCard(v) {
      var vp = peopleForView(v, people, holds);
      return html`<div style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", overflow: "hidden", marginBottom: 22 }}>
        <div style=${{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--outline-variant)" }}>
          <div style=${{ minWidth: 0 }}>
            <div style=${{ fontFamily: "var(--font-serif)", fontSize: 16.5, fontWeight: 600, color: "var(--on-surface)" }}>${v.title}</div>
            <div style=${{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6, alignItems: "center" }}>
              ${(v.filterTags || []).map(function (t) { return html`<span key=${t} style=${{ padding: "2px 8px", borderRadius: "var(--radius-sm)", background: "var(--secondary-container)", color: "var(--on-secondary-container)", fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 600 }}>${tagName(t)}</span>`; })}
              ${(v.statusZoneFilters || []).length ? html`<span style=${{ padding: "2px 8px", borderRadius: "var(--radius-sm)", background: "var(--primary-fixed)", color: "var(--primary)", fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 600 }}>${v.statusZoneFilters.length} zone${v.statusZoneFilters.length === 1 ? "" : "s"}</span>` : null}
              ${!(v.filterTags || []).length && !(v.statusZoneFilters || []).length ? html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--on-surface-variant)" }}>All active members</span>` : null}
            </div>
          </div>
          <div style=${{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button onClick=${function () { openEditView(v); }} aria-label="Edit view" style=${iconBtn}>${Ic("pencil", 16)}</button>
            <button onClick=${function () { deleteView(v.id); }} aria-label="Delete view" style=${Object.assign({}, iconBtn, { color: "var(--error)" })}>${Ic("trash-2", 16)}</button>
          </div>
        </div>
        ${vp.length === 0 ? html`<div style=${{ padding: 16, fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)" }}>No people match this filter.</div>`
          : vp.map(function (p, i) {
            return html`<button key=${p.id} onClick=${function () { props.nav("shepherdProfile", { id: p.id, from: "dashboard" }); }} style=${{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", textAlign: "left", border: "none", borderTop: i === 0 ? "none" : "1px solid var(--outline-variant)", background: "transparent", cursor: "pointer" }}>
              <div style=${{ flex: 1, minWidth: 0 }}>
                <div style=${{ fontFamily: "var(--font-sans)", fontSize: 14.5, fontWeight: 600, color: "var(--on-surface)" }}>${p.name || "(no name)"}</div>
                <div style=${{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                  ${(p.tags || []).map(function (t) { return html`<span key=${t} style=${{ padding: "2px 7px", borderRadius: "var(--radius-sm)", background: "var(--primary-fixed)", color: "var(--primary)", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600 }}>${tagName(t)}</span>`; })}
                </div>
              </div>
              <span style=${{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, color: "var(--primary)", flexShrink: 0 }}>View</span>
            </button>`;
          })}
      </div>`;
    }
  }

  // ── Shepherding People list ──────────────────────────────────
  var SP_OVER = { fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--on-surface-variant)" };

  function statusScore(st) { return st ? Core.statusScore(st.urgency, st.importance) : 99; }
  function fmtShortDate(ts) {
    if (!ts) return null;
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    return isNaN(d.getTime()) ? null : d.toLocaleDateString("default", { month: "short", day: "numeric", year: "numeric" });
  }
  // The Membership Track label for a person's membership object (ADR-0012):
  // Inactive dominates, then the stage's label, falling back to the legacy status
  // string for records not yet migrated.
  function membershipLabel(m) {
    if (!m) return null;
    if (typeof m === "string") return m;
    if (m.inactive) return "Inactive";
    if (m.stage) return (window.ShepherdingCore.MEMBERSHIP_STAGE_LABEL[m.stage] || m.stage);
    return m.status || null;
  }
  function hiddenIdsFrom(tags) { var s = {}; tags.forEach(function (t) { if (t.hidePeople) s[t.id] = true; }); return s; }

  function ShepherdPeopleScreen(props) {
    var user = props.user || {};
    var loadingS = useState(true), errS = useState(false);
    var peopleS = useState([]), notesDatesS = useState({}), tagsS = useState([]), viewsS = useState([]);
    var searchS = useState(""), sortByS = useState("name"), filtersOpenS = useState(false);
    var tagFiltersS = useState([]), tagModeS = useState("any"), statusZonesS = useState([]);
    var showSaveS = useState(false), saveNameS = useState("");
    var tagModalS = useState(null), addModalS = useState(false);
    var newPersonS = useState({ name: "", email: "", phone: "", address: "", birthday: "", sex: "" });
    var toastS = useState(null);

    var people = peopleS[0], notesDates = notesDatesS[0], tags = tagsS[0], views = viewsS[0];
    var tagFilters = tagFiltersS[0], tagMode = tagModeS[0], statusZones = statusZonesS[0];
    function showToast(m, t) { toastS[1]({ message: m, type: t || "success" }); setTimeout(function () { toastS[1](null); }, 2600); }
    function tagName(id) { for (var i = 0; i < tags.length; i++) { if (tags[i].id === id) return tags[i].name; } return id; }

    useEffect(function () {
      var alive = true;
      Promise.all([data.getShepherdingPeople(), data.getShepherdingLastNoteDates(), data.getShepherdingTags(), data.getShepherdingViews()])
        .then(function (r) { if (!alive) return; peopleS[1](r[0]); notesDatesS[1](r[1]); tagsS[1](r[2]); viewsS[1](r[3]); loadingS[1](false); })
        .catch(function () { if (alive) { errS[1](true); loadingS[1](false); } });
      return function () { alive = false; };
    }, []);

    var filtered = people.filter(function (p) {
      if (searchS[0] && String(p.name || "").toLowerCase().indexOf(searchS[0].toLowerCase()) === -1) return false;
      if (tagFilters.length) {
        var ok = tagMode === "all" ? tagFilters.every(function (t) { return (p.tags || []).indexOf(t) !== -1; }) : tagFilters.some(function (t) { return (p.tags || []).indexOf(t) !== -1; });
        if (!ok) return false;
      }
      if (statusZones.length) {
        if (!p.shepherdingStatus) return false;
        if (statusZones.indexOf(zoneKey(p.shepherdingStatus.urgency, p.shepherdingStatus.importance)) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (sortByS[0] === "name") return String(a.name || "").localeCompare(String(b.name || ""));
      return statusScore(a.shepherdingStatus) - statusScore(b.shepherdingStatus);
    });

    var activeFilterCount = tagFilters.length + statusZones.length;
    var tagModalPerson = tagModalS[0] ? people.filter(function (p) { return p.id === tagModalS[0].id; })[0] : null;

    function togglePersonTag(person, tagId) {
      var has = (person.tags || []).indexOf(tagId) !== -1;
      var newTags = has ? (person.tags || []).filter(function (x) { return x !== tagId; }) : (person.tags || []).concat([tagId]);
      var hid = hiddenIdsFrom(tags);
      var shepherdingHidden = newTags.some(function (id) { return !!hid[id]; });
      data.toggleShepherdingTag(person.id, tagId, tagName(tagId), !has, shepherdingHidden, user, "people_list")
        .then(function () { peopleS[1](people.map(function (p) { return p.id === person.id ? Object.assign({}, p, { tags: newTags, shepherdingHidden: shepherdingHidden }) : p; })); showToast(has ? "Tag removed" : "Tag applied"); })
        .catch(function () { showToast("Error updating tags", "error"); });
    }
    function addPerson() {
      var np = newPersonS[0];
      if (!np.name.trim()) return;
      data.addShepherdingPerson(np).then(function (newId) {
        newPersonS[1]({ name: "", email: "", phone: "", address: "", birthday: "", sex: "" });
        addModalS[1](false); props.nav("shepherdProfile", { id: newId, from: "people" });
      }).catch(function () { showToast("Error adding person", "error"); });
    }
    function saveView() {
      var t = saveNameS[0].trim(); if (!t) return;
      data.addShepherdingView({ title: t, filterTags: tagFilters.slice(), filterMode: tagMode, statusZoneFilters: statusZones.slice(), sortBy: sortByS[0], tagHoldFilters: {}, tagHoldCmp: {} }, user)
        .then(function () { saveNameS[1](""); showSaveS[1](false); data.getShepherdingViews().then(viewsS[1]); showToast("View saved"); })
        .catch(function () { showToast("Error saving view", "error"); });
    }
    function loadView(v) { tagFiltersS[1]((v.filterTags || []).slice()); tagModeS[1](v.filterMode || "any"); statusZonesS[1]((v.statusZoneFilters || []).slice()); if (v.sortBy) sortByS[1](v.sortBy); showToast("Loaded “" + v.title + "”"); }

    var userKnown = props.user !== undefined;
    var isElder = userKnown && !!props.user && (props.user.role === "elder" || props.user.role === "super_admin");
    var addBtn = html`<button onClick=${function () { addModalS[1](true); }} aria-label="Add person" style=${Object.assign({}, iconBtn, { color: "var(--primary)", marginRight: 4, width: 40, height: 40 })}>${Ic("user-plus", 20)}</button>`;

    return html`
      <${Screen}>
        <${TopBar} title="People" onBack=${props.back} serif=${false} right=${isElder ? addBtn : null} />
        <${Body} style=${{ padding: "14px 16px 40px" }}>
          ${!userKnown ? html`<div style=${{ display: "flex", justifyContent: "center", padding: "48px 20px", color: "var(--on-surface-variant)" }}><span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 26)}</span></div>`
          : !isElder ? html`<div style=${{ padding: "60px 24px", textAlign: "center", color: "var(--on-surface-variant)" }}><div style=${{ display: "inline-flex", opacity: 0.5 }}>${Ic("shield-alert", 40)}</div><p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, marginTop: 12 }}>Elder-only tools.</p></div>`
          : html`
          <div style=${{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <div style=${{ fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 600, color: "var(--primary)" }}>People</div>
            <div style=${{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--on-surface-variant)" }}>${filtered.length} of ${people.length}</div>
          </div>

          <label style=${{ display: "flex", alignItems: "center", gap: 8, height: 46, padding: "0 14px", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", color: "var(--on-surface-variant)", marginBottom: 10 }}>
            ${Ic("search", 18)}
            <input value=${searchS[0]} onInput=${function (e) { searchS[1](e.target.value); }} placeholder="Search by name…" style=${{ flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--on-surface)" }} />
          </label>

          <div style=${{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick=${function () { filtersOpenS[1](!filtersOpenS[0]); }} style=${{ flex: 1, display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, color: "var(--on-surface)" }}>
              ${Ic("sliders-horizontal", 17)} Filters
              ${activeFilterCount ? html`<span style=${{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "var(--primary)", color: "var(--on-primary)", fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>${activeFilterCount}</span>` : null}
              <span style=${{ marginLeft: "auto", transform: filtersOpenS[0] ? "rotate(180deg)" : "none", transition: "transform 0.2s", display: "inline-flex" }}>${Ic("chevron-down", 16)}</span>
            </button>
          </div>

          <div style=${{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style=${Object.assign({}, SP_OVER, { letterSpacing: "0.14em" })}>Sort</span>
            <div style=${{ display: "flex", background: "var(--surface-container)", borderRadius: "var(--radius)", padding: 3, border: "1px solid var(--outline-variant)", flex: 1 }}>
              ${[["name", "Name"], ["attention", "Needs Attention"]].map(function (o) {
                var on = sortByS[0] === o[0];
                return html`<button key=${o[0]} onClick=${function () { sortByS[1](o[0]); }} style=${{ flex: 1, padding: "7px 6px", border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600, background: on ? "var(--surface-container-lowest)" : "transparent", color: on ? "var(--primary)" : "var(--on-surface-variant)", boxShadow: on ? "var(--shadow-xs)" : "none" }}>${o[1]}</button>`;
              })}
            </div>
          </div>

          ${filtersOpenS[0] ? html`<div style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", marginBottom: 16, overflow: "hidden" }}>
            <div style=${{ padding: 16, borderBottom: "1px solid var(--outline-variant)" }}>
              <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style=${SP_OVER}>Saved Views</span>
                <button onClick=${function () { showSaveS[1](!showSaveS[0]); }} aria-label="Save current filters" style=${Object.assign({}, iconBtn, { width: 28, height: 28 })}>${Ic("bookmark-plus", 16)}</button>
              </div>
              ${showSaveS[0] ? html`<div style=${{ display: "flex", gap: 6, marginBottom: 10 }}>
                <input value=${saveNameS[0]} onInput=${function (e) { saveNameS[1](e.target.value); }} placeholder="View name…" style=${Object.assign({}, inputStyle, { flex: 1, padding: "7px 10px", fontSize: 13 })} />
                <button onClick=${saveView} style=${Object.assign({}, pill(), { padding: "7px 12px", fontSize: 12 })}>Save</button>
              </div>` : null}
              ${views.length === 0 ? html`<div style=${{ fontFamily: "var(--font-sans)", fontSize: 12, fontStyle: "italic", color: "var(--on-surface-variant)" }}>No saved views yet.</div>`
                : views.map(function (v) {
                  return html`<div key=${v.id} style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 0" }}>
                    <button onClick=${function () { loadView(v); }} style=${{ flex: 1, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: 500, color: "var(--on-surface)" }}>${v.title}</button>
                    <button onClick=${function () { data.deleteShepherdingView(v.id).then(function () { viewsS[1](views.filter(function (x) { return x.id !== v.id; })); }); }} aria-label="Delete saved view" style=${Object.assign({}, iconBtn, { width: 26, height: 26 })}>${Ic("x", 15)}</button>
                  </div>`;
                })}
            </div>
            <div style=${{ padding: 16, borderBottom: "1px solid var(--outline-variant)" }}>
              <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style=${SP_OVER}>Filter by Tags</span>
                ${tagFilters.length > 1 ? html`<div style=${{ display: "flex", gap: 4 }}>
                  ${[["any", "Any"], ["all", "All"]].map(function (o) {
                    var on = tagMode === o[0];
                    return html`<button key=${o[0]} onClick=${function () { tagModeS[1](o[0]); }} style=${{ padding: "3px 9px", borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", background: on ? "var(--secondary-container)" : "transparent", color: on ? "var(--on-secondary-container)" : "var(--on-surface-variant)" }}>${o[1]}</button>`;
                  })}
                </div>` : null}
              </div>
              ${tags.length === 0 ? html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 12, fontStyle: "italic", color: "var(--on-surface-variant)" }}>No tags yet.</span>`
                : html`<div style=${{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  ${tags.map(function (t) { var on = tagFilters.indexOf(t.id) !== -1; return html`<${TagChip} key=${t.id} label=${t.name} on=${on} onClick=${function () { tagFiltersS[1](on ? tagFilters.filter(function (x) { return x !== t.id; }) : tagFilters.concat([t.id])); }} />`; })}
                </div>`}
            </div>
            <div style=${{ padding: 16 }}>
              <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style=${SP_OVER}>Filter by Status</span>
                ${statusZones.length ? html`<button onClick=${function () { statusZonesS[1]([]); }} style=${{ border: "none", background: "none", color: "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>Clear</button>` : null}
              </div>
              <${StatusMatrix} compact=${true} cell=${38} labelW=${52}
                selected=${function (u, i) { return statusZones.indexOf(zoneKey(u, i)) !== -1; }}
                onCell=${function (u, i) { var k = zoneKey(u, i); statusZonesS[1](statusZones.indexOf(k) !== -1 ? statusZones.filter(function (x) { return x !== k; }) : statusZones.concat([k])); }}
              />
            </div>
          </div>` : null}

          ${loadingS[0] ? html`<div style=${{ display: "flex", justifyContent: "center", padding: "40px 20px", color: "var(--on-surface-variant)" }}><span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 24)}</span></div>`
          : filtered.length === 0 ? html`<div style=${{ padding: "60px 20px", textAlign: "center", color: "var(--on-surface-variant)" }}>
              <div style=${{ display: "inline-flex", opacity: 0.5 }}>${Ic("user-search", 44)}</div>
              <p style=${{ fontFamily: "var(--font-sans)", fontSize: 13.5, fontStyle: "italic", marginTop: 10 }}>No members found matching your search.</p>
            </div>`
          : html`<div style=${{ display: "flex", flexDirection: "column", gap: 10 }}>
            ${filtered.map(function (p) {
              var st = p.shepherdingStatus;
              var strong = st && st.urgency === "urgent" && st.importance === "important";
              var last = fmtShortDate(notesDates[p.id]);
              return html`<div key=${p.id} style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", padding: 15 }}>
                <button onClick=${function () { props.nav("shepherdProfile", { id: p.id, from: "people" }); }} style=${{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, border: "none", background: "transparent", cursor: "pointer", textAlign: "left", padding: 0 }}>
                  <div style=${{ flex: 1, minWidth: 0 }}>
                    <div style=${{ fontFamily: "var(--font-sans)", fontSize: 15.5, fontWeight: 700, color: "var(--primary)" }}>${p.name || "(no name)"}</div>
                    ${st ? html`<div style=${{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                      <span style=${{ fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: strong ? "var(--error)" : "var(--secondary)" }}>${URGL[st.urgency]}</span>
                      <span style=${{ fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--on-surface-variant)" }}>· ${IMPL[st.importance]}</span>
                    </div>` : html`<div style=${{ fontFamily: "var(--font-sans)", fontSize: 11, fontStyle: "italic", color: "var(--outline)", marginTop: 3 }}>No status</div>`}
                  </div>
                  <span style=${{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-container)", color: "var(--on-surface-variant)" }}>${Ic("chevron-right", 17)}</span>
                </button>
                <div style=${{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--outline-variant)" }}>
                  <button onClick=${function () { tagModalS[1](p); }} aria-label="Edit tags" style=${Object.assign({}, iconBtn, { width: 28, height: 28, background: "var(--surface-container)", flexShrink: 0 })}>${Ic("pencil", 14)}</button>
                  <div style=${{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5 }}>
                    ${(p.tags || []).length ? (p.tags || []).map(function (t) { return html`<span key=${t} style=${{ padding: "2px 8px", borderRadius: "var(--radius-sm)", background: "rgba(24,47,87,0.10)", color: "var(--primary)", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, letterSpacing: "0.02em", textTransform: "uppercase" }}>${tagName(t)}</span>`; }) : html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 10, fontStyle: "italic", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--outline)" }}>No tags</span>`}
                  </div>
                  <span style=${{ fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--on-surface-variant)", flexShrink: 0 }}>${last || "—"}</span>
                </div>
              </div>`;
            })}
          </div>`}
          `}
        </${Body}>

        ${tagModalPerson ? html`<${Modal} onClose=${function () { tagModalS[1](null); }} title="Manage Tags"
          footer=${html`<button onClick=${function () { tagModalS[1](null); }} style=${pill()}>Done</button>`}>
          <div style=${{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--on-surface-variant)", marginBottom: 12 }}>${tagModalPerson.name}</div>
          ${tags.length === 0 ? html`<div style=${{ fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)" }}>No tags defined. Create some on the Manage Tags page.</div>`
            : html`<div style=${{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            ${tags.map(function (t) {
              var on = (tagModalPerson.tags || []).indexOf(t.id) !== -1;
              return html`<button key=${t.id} onClick=${function () { togglePersonTag(tagModalPerson, t.id); }} style=${{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: "var(--radius-full)", cursor: "pointer", border: on ? "none" : "1px solid var(--outline-variant)", background: on ? "var(--primary)" : "var(--surface-container)", color: on ? "var(--on-primary)" : "var(--on-surface)", fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 500 }}>
                ${Ic(on ? "check-circle-2" : "circle-plus", 14)} ${t.name}
              </button>`;
            })}
          </div>`}
        </${Modal}>` : null}

        ${addModalS[0] ? html`<${Modal} onClose=${function () { addModalS[1](false); }} title="Add New Person"
          footer=${html`<${Fragment}><button onClick=${function () { addModalS[1](false); }} style=${pill("ghost")}>Cancel</button><button onClick=${addPerson} style=${pill()}>Add Person</button></${Fragment}>`}>
          <div style=${{ display: "flex", flexDirection: "column", gap: 12 }}>
            ${[["name", "Full Name", "text", "Required"], ["email", "Email", "email", ""], ["phone", "Phone", "tel", ""], ["birthday", "Birthday", "date", ""]].map(function (f) {
              return html`<${Field} key=${f[0]} label=${f[1]}><input type=${f[2]} value=${newPersonS[0][f[0]]} placeholder=${f[3]} onInput=${function (e) { var n = {}; n[f[0]] = e.target.value; newPersonS[1](Object.assign({}, newPersonS[0], n)); }} style=${inputStyle} /></${Field}>`;
            })}
            <${Field} label="Address"><textarea rows=${2} value=${newPersonS[0].address} onInput=${function (e) { newPersonS[1](Object.assign({}, newPersonS[0], { address: e.target.value })); }} style=${Object.assign({}, inputStyle, { resize: "vertical" })}></textarea></${Field}>
            <${Field} label="Sex">
              <div style=${{ position: "relative" }}>
                <select value=${newPersonS[0].sex} onChange=${function (e) { newPersonS[1](Object.assign({}, newPersonS[0], { sex: e.target.value })); }} style=${Object.assign({}, inputStyle, { appearance: "none", WebkitAppearance: "none", paddingRight: 36, cursor: "pointer" })}>
                  <option value="">Unknown</option><option value="male">Male</option><option value="female">Female</option>
                </select>
                <span style=${{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--on-surface-variant)" }}>${Ic("chevron-down", 16)}</span>
              </div>
            </${Field}>
          </div>
        </${Modal}>` : null}

        <${Toast} toast=${toastS[0]} />
      </${Screen}>`;
  }

  // ── Shepherding Profile (person file) ────────────────────────
  var NOTE_TYPES = ["Elder Check-in", "Elder Interview", "Elder Meeting", "Life Update", "Prayer Request", "Other"];
  var SF_H2 = { margin: 0, fontFamily: "var(--font-serif)", fontSize: 17, fontWeight: 600, color: "var(--primary)" };
  var SF_PANEL = { background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", padding: 16 };
  var SF_OVER = { fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--on-surface-variant)" };

  function fmtStatus(st) { return !st ? "No status" : (URGL[st.urgency] + " · " + IMPL[st.importance]); }
  function fmtLongDate(val) {
    if (!val) return "";
    if (typeof val === "string" && val.indexOf("-") !== -1) { var p = val.split("-"); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("default", { month: "long", day: "numeric", year: "numeric" }); }
    var d = val.toDate ? val.toDate() : new Date(val);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("default", { month: "long", day: "numeric", year: "numeric" });
  }
  function fmtEntryDate(ts) { return fmtShortDate(ts) || "Just now"; }
  // Plain text -> minimal TipTap doc, so notes written on mobile render on desktop.
  function textToTiptap(text) {
    return { type: "doc", content: String(text || "").split(/\n/).map(function (line) { return line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" }; }) };
  }

  // Non-interactive 3×3 mini matrix highlighting one status cell.
  function MiniMatrix(props) {
    return html`<div style=${{ display: "grid", gridTemplateColumns: "repeat(3, 14px)", gridAutoRows: "14px", gap: 2 }}>
      ${IMP.map(function (imp) { return URG.map(function (urg) {
        var sel = props.status && props.status.urgency === urg && props.status.importance === imp;
        var st = cellStyle(urg, imp, sel);
        return html`<span key=${urg + imp} style=${{ width: 14, height: 14, borderRadius: 3, border: "1.5px solid " + st.border, background: st.bg }}></span>`;
      }); })}
    </div>`;
  }

  // MS-98: per-person Documents directory shown in the profile's Documents tab.
  // Reuses the shared tree engine (window.ShepherdingDocsCore) over this Person's
  // own structure doc (person_<id>); documents carry ownerPersonId and can be
  // opted into the global Library. Notes only (matches desktop scope).
  function ProfileDocuments(props) {
    var DC = window.ShepherdingDocsCore;
    var pid = props.pid, user = props.user, nav = props.nav, showToast = props.showToast;
    var structDocId = "person_" + pid;
    var loadingS = useState(true);
    var structureS = useState({ children: [] }), docsS = useState({});
    var pathS = useState([]), renameIdS = useState(null), renameValS = useState("");
    var moveS = useState(null), deleteS = useState(null);
    var structure = structureS[0], docs = docsS[0], path = pathS[0];
    function clone(x) { return JSON.parse(JSON.stringify(x)); }
    function persist(next) { structureS[1](next); data.saveDocumentStructure(next, structDocId).catch(function () { showToast("Error saving", "error"); }); }

    useEffect(function () {
      var alive = true;
      Promise.all([data.getDocumentStructure(structDocId), data.getElderDocuments()]).then(function (r) {
        if (!alive) return;
        structureS[1](r[0]);
        var map = {}; r[1].forEach(function (d) { map[d.id] = d; }); docsS[1](map);
        loadingS[1](false);
      }).catch(function () { if (alive) loadingS[1](false); });
      return function () { alive = false; };
    }, [pid]);

    var currentFolder = path.length === 0 ? structure : (DC.getFolderById(structure, path[path.length - 1]) || structure);
    var children = currentFolder.children || [];
    var folders = children.filter(function (c) { return c.type === "folder"; });
    var docItems = children.filter(function (c) { return c.type === "document"; });
    var crumbs = [{ id: null, name: "Documents" }];
    path.forEach(function (fid) { var f = DC.getFolderById(structure, fid); crumbs.push({ id: fid, name: (f && f.name) || "Folder" }); });

    function navInto(fid) { renameIdS[1](null); pathS[1](path.concat([fid])); }
    function navToCrumb(idx) { renameIdS[1](null); pathS[1](path.slice(0, idx)); }
    function openDoc(id) { nav("documentEditor", { id: id }); }
    function createDoc() {
      data.createElderDocument({ type: "note", ownerPersonId: pid }, user).then(function (id) {
        var next = clone(structure);
        var folder = path.length === 0 ? next : (DC.getFolderById(next, path[path.length - 1]) || next);
        if (!folder.children) folder.children = [];
        folder.children.push({ type: "document", id: id });
        data.saveDocumentStructure(next, structDocId).then(function () { nav("documentEditor", { id: id }); }).catch(function () { showToast("Error creating", "error"); });
      }).catch(function () { showToast("Error creating", "error"); });
    }
    function createFolder() {
      var fid = DC.newId(); var next = clone(structure);
      var folder = path.length === 0 ? next : (DC.getFolderById(next, path[path.length - 1]) || next);
      if (!folder.children) folder.children = [];
      folder.children.unshift({ type: "folder", id: fid, name: "New Folder", children: [] });
      persist(next); renameIdS[1](fid); renameValS[1]("New Folder");
    }
    function startRename(item) { renameValS[1](item.type === "folder" ? item.name : ((docs[item.id] && docs[item.id].title) || "Untitled Document")); renameIdS[1](item.id); }
    function finishRename(item) {
      if (renameIdS[0] !== item.id) return;
      var name = renameValS[0].trim() || (item.type === "folder" ? "New Folder" : "New Document");
      renameIdS[1](null);
      if (item.type === "folder") { var next = clone(structure); var f = DC.getFolderById(next, item.id); if (f) f.name = name; persist(next); }
      else { docsS[1](Object.assign({}, docs, (function () { var o = {}; o[item.id] = Object.assign({}, docs[item.id], { title: name }); return o; })())); data.renameElderDocument(item.id, name, user).catch(function () { showToast("Error renaming", "error"); }); }
    }
    function doMove(item, targetId) {
      moveS[1](null);
      var next = clone(structure);
      if (item.type === "folder" && targetId !== "__root__" && (targetId === item.id || DC.isDescendant(next, targetId, item.id))) { showToast("Can't move a folder into itself", "error"); return; }
      DC.moveNode(next, item, targetId); persist(next); showToast("Moved");
    }
    function doDelete(item) {
      deleteS[1](null);
      var next = clone(structure);
      var ids = item.type === "document" ? [item.id] : (function () { var f = DC.getFolderById(structure, item.id); return f ? DC.getAllDocIds(f) : []; })();
      if (ids.length) { data.deleteElderDocuments(ids); data.pruneElderDocsFromLibrary(ids); }
      var m = Object.assign({}, docs); ids.forEach(function (id) { delete m[id]; }); docsS[1](m);
      DC.removeFromTree(next, item.id); persist(next); showToast("Deleted");
    }
    function addToLibrary(item) {
      data.addElderDocToLibrary(item.id, "__root__").then(function (ok) {
        if (ok) { docsS[1](Object.assign({}, docs, (function () { var o = {}; o[item.id] = Object.assign({}, docs[item.id], { inLibrary: true }); return o; })())); showToast("Added to the Library"); }
        else showToast("Already in the Library");
      }).catch(function () { showToast("Error", "error"); });
    }

    var moveItem = moveS[0], delItem = deleteS[0];
    var folderOptions = moveItem ? DC.getFolderOptions(structure, moveItem.type === "folder" ? moveItem.id : null) : [];
    var rowCard = { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 14px", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)" };

    function renameField(item) {
      return html`<input value=${renameValS[0]} autoFocus=${true} onInput=${function (e) { renameValS[1](e.target.value); }} onBlur=${function () { finishRename(item); }} onKeyDown=${function (e) { if (e.key === "Enter") finishRename(item); if (e.key === "Escape") renameIdS[1](null); }} style=${{ flex: 1, minWidth: 0, border: "none", borderBottom: "1px solid var(--primary)", background: "transparent", outline: "none", fontFamily: "var(--font-serif)", fontSize: 15, fontWeight: 600, color: "var(--on-surface)" }} />`;
    }
    function rowActions(item) {
      return html`<div style=${{ display: "flex", gap: 2, flexShrink: 0 }}>
        ${item.type === "document" && !(docs[item.id] && docs[item.id].inLibrary) ? html`<button onClick=${function () { addToLibrary(item); }} aria-label="Add to Library" style=${Object.assign({}, iconBtn, { width: 30, height: 30 })}>${Ic("library-big", 15)}</button>` : null}
        <button onClick=${function () { startRename(item); }} aria-label="Rename" style=${Object.assign({}, iconBtn, { width: 30, height: 30 })}>${Ic("pencil", 15)}</button>
        <button onClick=${function () { moveS[1](item); }} aria-label="Move" style=${Object.assign({}, iconBtn, { width: 30, height: 30 })}>${Ic("folder-input", 15)}</button>
        <button onClick=${function () { deleteS[1](item); }} aria-label="Delete" style=${Object.assign({}, iconBtn, { width: 30, height: 30, color: "var(--error)" })}>${Ic("trash-2", 15)}</button>
      </div>`;
    }

    return html`<div style=${{ marginTop: 16 }}>
      <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <div style=${{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--on-surface-variant)", minWidth: 0 }}>
          ${crumbs.map(function (cr, i) { var isLast = i === crumbs.length - 1; return html`<${Fragment} key=${cr.id || "root"}>${i > 0 ? html`<span style=${{ color: "var(--outline)" }}>${Ic("chevron-right", 13)}</span>` : null}<button onClick=${function () { navToCrumb(i); }} disabled=${isLast} style=${{ border: "none", background: "transparent", cursor: isLast ? "default" : "pointer", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: isLast ? 600 : 500, color: isLast ? "var(--on-surface)" : "var(--secondary)" }}>${cr.name}</button></${Fragment}>`; })}
        </div>
        <div style=${{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick=${createFolder} aria-label="New folder" style=${{ display: "inline-flex", alignItems: "center", padding: "7px 10px", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", background: "transparent", color: "var(--on-surface-variant)", cursor: "pointer" }}>${Ic("folder-plus", 15)}</button>
          <button onClick=${createDoc} style=${{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", border: "none", borderRadius: "var(--radius)", background: "var(--primary)", color: "var(--on-primary)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600 }}>${Ic("plus", 15)} New</button>
        </div>
      </div>
      ${loadingS[0] ? html`<div style=${{ display: "flex", justifyContent: "center", padding: 30, color: "var(--on-surface-variant)" }}><span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 22)}</span></div>`
        : (folders.length === 0 && docItems.length === 0) ? html`<p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14, color: "var(--on-surface-variant)", textAlign: "center", padding: "24px 8px" }}>No documents yet. Use “New” to add one.</p>`
        : html`<div style=${{ display: "flex", flexDirection: "column", gap: 10 }}>
          ${folders.map(function (f) { var renaming = renameIdS[0] === f.id; return html`<div key=${f.id} style=${rowCard}>
            <span style=${{ color: "var(--secondary)", flexShrink: 0 }} onClick=${function () { if (!renaming) navInto(f.id); }}>${Ic("folder", 20)}</span>
            ${renaming ? renameField(f) : html`<button onClick=${function () { navInto(f.id); }} style=${{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--font-serif)", fontSize: 15, fontWeight: 600, color: "var(--on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>${f.name}</button>`}
            ${renaming ? null : rowActions(f)}
          </div>`; })}
          ${docItems.map(function (it) { var d = docs[it.id] || { title: "Untitled Document" }; var renaming = renameIdS[0] === it.id; return html`<div key=${it.id} style=${rowCard}>
            <span style=${{ width: 34, height: 34, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-container)", color: "var(--primary)" }} onClick=${function () { if (!renaming) openDoc(it.id); }}>${Ic("file-text", 17)}</span>
            ${renaming ? renameField(it) : html`<button onClick=${function () { openDoc(it.id); }} style=${{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", overflow: "hidden" }}>
              <div style=${{ display: "flex", alignItems: "center", gap: 6 }}><span style=${{ fontFamily: "var(--font-serif)", fontSize: 15, fontWeight: 600, color: "var(--on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>${d.title}</span>${d.inLibrary ? html`<span style=${{ color: "var(--primary)", display: "inline-flex", flexShrink: 0 }} title="Also in the Library">${Ic("library-big", 13)}</span>` : null}</div>
            </button>`}
            ${renaming ? null : rowActions(it)}
          </div>`; })}
        </div>`}
      ${moveItem ? html`<${Modal} title="Move" onClose=${function () { moveS[1](null); }} footer=${html`<button onClick=${function () { moveS[1](null); }} style=${pill("ghost")}>Cancel</button>`}>
        <button onClick=${function () { doMove(moveItem, "__root__"); }} style=${{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 8px", border: "none", borderBottom: "1px solid var(--outline-variant)", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600, color: "var(--on-surface)" }}>${Ic("home", 17)} Home (root)</button>
        ${folderOptions.map(function (o) { return html`<button key=${o.id} onClick=${function () { doMove(moveItem, o.id); }} style=${{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 8px", paddingLeft: (8 + o.depth * 16) + "px", border: "none", borderBottom: "1px solid var(--outline-variant)", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--on-surface)" }}>${Ic("folder", 17)} ${o.name}</button>`; })}
      </${Modal}>` : null}
      ${delItem ? html`<${Modal} title="Delete?" onClose=${function () { deleteS[1](null); }} footer=${html`<${Fragment}><button onClick=${function () { deleteS[1](null); }} style=${pill("ghost")}>Cancel</button><button onClick=${function () { doDelete(delItem); }} style=${Object.assign({}, pill(), { background: "var(--error)" })}>Delete</button></${Fragment}>`}>
        <p style=${{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 14, lineHeight: 1.5, color: "var(--on-surface)" }}>${delItem.type === "folder" ? html`Delete “${delItem.name}” and everything in it? This cannot be undone.` : html`Delete “${(docs[delItem.id] && docs[delItem.id].title) || "this document"}”? This removes it from the profile and the Library. This cannot be undone.`}</p>
      </${Modal}>` : null}
    </div>`;
  }

  function ShepherdProfileScreen(props) {
    var user = props.user || {};
    var pid = (props.params && props.params.id) || null;
    var loadingS = useState(true), errS = useState(false);
    var personS = useState(null), notesS = useState([]), activityS = useState([]), tagsS = useState([]);
    var collapseS = useState(false), editorS = useState(null), newTagS = useState(""), editProfileS = useState(null), explEditS = useState({}), toastS = useState(null);
    var familiesS = useState([]), rosterS = useState([]); // Family graph + name lookup (MS-88)
    var relsS = useState([]), relTypesS = useState([]);   // Relationship graph (MS-89)
    var tabS = useState("record"); // MS-98: 'record' | 'documents'
    var drawerS = useState(false);  // details side drawer (member details/tags/track/status/relationships)

    var person = personS[0], notes = notesS[0], activity = activityS[0], tags = tagsS[0];
    var families = familiesS[0], roster = rosterS[0], rels = relsS[0], relTypes = relTypesS[0];
    function rosterName(id) { for (var i = 0; i < roster.length; i++) { if (roster[i].id === id) return roster[i].name; } return "(unknown)"; }
    function showToast(m, t) { toastS[1]({ message: m, type: t || "success" }); setTimeout(function () { toastS[1](null); }, 2400); }
    function tagName(id) { for (var i = 0; i < tags.length; i++) { if (tags[i].id === id) return tags[i].name; } return id; }
    function reloadNotes() { return data.getShepherdingNotes(pid).then(notesS[1]); }
    function reloadActivity() { return data.getShepherdingActivity(pid).then(activityS[1]); }

    useEffect(function () {
      var alive = true;
      if (!pid) { errS[1](true); loadingS[1](false); return; }
      data.getPerson(pid).then(function (p) {
        if (!alive) return;
        if (!p) { errS[1](true); loadingS[1](false); return; }
        personS[1](p);
        Promise.all([data.getShepherdingNotes(pid), data.getShepherdingActivity(pid), data.getShepherdingTags(), data.getFamilies(), data.getPeople(), data.getRelationships(), data.getRelationshipTypes()])
          .then(function (r) { if (!alive) return; notesS[1](r[0]); activityS[1](r[1]); tagsS[1](r[2]); familiesS[1](r[3]); rosterS[1](r[4]); relsS[1](r[5]); relTypesS[1](r[6]); loadingS[1](false); });
      }).catch(function () { if (alive) { errS[1](true); loadingS[1](false); } });
      return function () { alive = false; };
    }, [pid]);

    function setStatus(urg, imp) {
      var cur = person.shepherdingStatus;
      var same = cur && cur.urgency === urg && cur.importance === imp;
      var next = same ? null : { urgency: urg, importance: imp };
      data.setShepherdingStatus(pid, next, cur || null, user).then(function () {
        personS[1](Object.assign({}, person, { shepherdingStatus: next })); reloadActivity(); showToast(same ? "Status cleared" : "Status updated");
      }).catch(function () { showToast("Error updating status", "error"); });
    }
    // Move this Person along the Membership Track (ADR-0012). The stage is the
    // source of truth; data.setMembership re-projects the Membership Tags and logs
    // one Membership Change. Inactive keeps the stage but flips the flag.
    function commitMembership(next) {
      var m = person.membership || {};
      var previous = { stage: m.stage || null, inactive: !!m.inactive };
      if (previous.stage === next.stage && previous.inactive === next.inactive) return;
      data.setMembership(pid, person.tags || [], previous, next, user, "profile").then(function () {
        var newTags = Core.applyMembershipTags(person.tags || [], next);
        personS[1](Object.assign({}, person, { membership: Object.assign({}, m, { stage: next.stage, inactive: next.inactive }), tags: newTags }));
        reloadActivity();
        showToast(Core.describeMembershipChange(Core.buildMembershipChange({ previous: previous, next: next })));
      }).catch(function () { showToast("Error updating membership", "error"); });
    }
    function setMembershipStage(idx) {
      var stage = Core.MEMBERSHIP_STAGES[Number(idx)];
      if (stage) commitMembership({ stage: stage, inactive: false });
    }
    function toggleInactive() {
      var m = person.membership || {};
      commitMembership({ stage: m.stage || null, inactive: !m.inactive });
    }
    function toggleTag(tagId) {
      if (window.ShepherdingCore.isProjectedTagId(tagId)) { showToast("This tag is set by the system, not manual tagging", "error"); return; }
      var has = (person.tags || []).indexOf(tagId) !== -1;
      var newTags = has ? (person.tags || []).filter(function (x) { return x !== tagId; }) : (person.tags || []).concat([tagId]);
      var hid = hiddenIdsFrom(tags);
      var shepherdingHidden = newTags.some(function (id) { return !!hid[id]; });
      data.toggleShepherdingTag(pid, tagId, tagName(tagId), !has, shepherdingHidden, user, "profile").then(function () {
        personS[1](Object.assign({}, person, { tags: newTags, shepherdingHidden: shepherdingHidden })); reloadActivity();
      }).catch(function () { showToast("Error updating tags", "error"); });
    }
    function createTag() {
      var name = newTagS[0].trim(); if (!name) return;
      if (tags.some(function (t) { return t.name.toLowerCase() === name.toLowerCase(); })) { showToast("Tag already exists", "error"); return; }
      data.createShepherdingTag(name).then(function (tag) {
        tagsS[1](tags.concat([tag]).sort(function (a, b) { return a.name.localeCompare(b.name); }));
        newTagS[1]("");
        // Apply the new tag to this person (matches the design's create-and-apply).
        var newTags = (person.tags || []).concat([tag.id]);
        var hid = hiddenIdsFrom(tags.concat([tag]));
        var shepherdingHidden = newTags.some(function (id) { return !!hid[id]; });
        data.toggleShepherdingTag(pid, tag.id, tag.name, true, shepherdingHidden, user, "profile").then(function () {
          personS[1](Object.assign({}, person, { tags: newTags })); reloadActivity();
        });
      }).catch(function () { showToast("Error creating tag", "error"); });
    }
    function saveNote() {
      var ed = editorS[0]; if (!ed) return;
      var body = ed.body || "";
      if (!body.trim()) return;
      var payload = { type: ed.type, subject: (ed.subject || "").trim(), contentJson: textToTiptap(body), content: body };
      var op = ed.id ? data.updateShepherdingNote(pid, ed.id, payload, user) : data.addShepherdingNote(pid, payload, user);
      op.then(function () { editorS[1](null); reloadNotes(); showToast(ed.id ? "Note updated" : "Note added"); })
        .catch(function () { showToast("Error saving note", "error"); });
    }
    function deleteNote(id) {
      if (!window.confirm("Delete this note? This cannot be undone.")) return;
      data.deleteShepherdingNote(pid, id).then(function () { notesS[1](notes.filter(function (n) { return n.id !== id; })); showToast("Note deleted"); })
        .catch(function () { showToast("Error deleting note", "error"); });
    }
    function saveExpl(id) {
      var draft = explEditS[0][id] || "";
      data.saveShepherdingExplanation(pid, id, draft.trim()).then(function () {
        reloadActivity(); var n = Object.assign({}, explEditS[0]); delete n[id]; explEditS[1](n); showToast("Explanation saved");
      }).catch(function () { showToast("Error saving explanation", "error"); });
    }
    function saveProfileDetails() {
      var ep = editProfileS[0];
      data.updateShepherdingPersonDetails(pid, ep).then(function () {
        personS[1](Object.assign({}, person, { contact: { email: ep.email, phone: ep.phone, address: ep.address }, birthday: ep.birthday })); editProfileS[1](null); showToast("Details saved");
      }).catch(function () { showToast("Error saving details", "error"); });
    }

    var userKnown = props.user !== undefined;
    var isElder = userKnown && !!props.user && (props.user.role === "elder" || props.user.role === "super_admin");
    var fromLabel = (props.params && props.params.from === "dashboard") ? "Dashboard" : "People";
    var editor = editorS[0], editProfile = editProfileS[0];

    if (!userKnown || loadingS[0]) {
      return html`<${Screen}><${TopBar} title=${fromLabel} onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "16px" }}><div style=${{ display: "flex", justifyContent: "center", padding: "48px 20px", color: "var(--on-surface-variant)" }}><span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 26)}</span></div></${Body}></${Screen}>`;
    }
    if (!isElder) {
      return html`<${Screen}><${TopBar} title=${fromLabel} onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "60px 24px", textAlign: "center" }}><div style=${{ display: "inline-flex", opacity: 0.5, color: "var(--on-surface-variant)" }}>${Ic("shield-alert", 40)}</div><p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, marginTop: 12, color: "var(--on-surface-variant)" }}>Elder-only tools.</p></${Body}></${Screen}>`;
    }
    if (errS[0] || !person) {
      return html`<${Screen}><${TopBar} title=${fromLabel} onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "60px 24px", textAlign: "center" }}><p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, color: "var(--on-surface-variant)" }}>Couldn't load this person.</p></${Body}></${Screen}>`;
    }

    var record = Core.assemblePastoralRecord(notes, activity, {});
    var visible = collapseS[0] ? record.filter(function (e) { return e._entryKind === "note"; }) : record;
    var addableTags = tags.filter(function (t) { return (person.tags || []).indexOf(t.id) === -1 && !window.ShepherdingCore.isProjectedTagId(t.id); });
    var mLabel = membershipLabel(person.membership);
    var details = [
      person.contact && person.contact.email && { icon: "mail", text: person.contact.email },
      person.contact && person.contact.phone && { icon: "phone", text: person.contact.phone },
      person.contact && person.contact.address && { icon: "map-pin", text: person.contact.address },
      person.birthday && { icon: "cake", text: fmtLongDate(person.birthday), tone: "var(--secondary)" },
      person.baptismDate && { icon: "droplet", text: "Baptized " + fmtLongDate(person.baptismDate), tone: "#2A6FA8" },
    ].filter(Boolean);

    return html`
      <${Screen}>
        <${TopBar} title=${fromLabel} onBack=${props.back} serif=${false} right=${html`<button onClick=${function () { drawerS[1](true); }} aria-label="Details" style=${{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--on-surface)", cursor: "pointer", borderRadius: 10 }}>${Ic("menu", 22)}</button>`} />
        <${Body} style=${{ padding: "16px 16px 44px" }}>
          <div style=${{ marginBottom: 16 }}>
            <h1 style=${{ margin: 0, fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 600, color: "var(--primary)", letterSpacing: "0.02em" }}>${person.name}</h1>
            <div style=${{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <span style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)", textTransform: "capitalize" }}>${person.sex || "Unknown"}</span>
              ${mLabel ? html`<span style=${{ padding: "2px 9px", borderRadius: "var(--radius-full)", background: "rgba(62,97,129,0.12)", color: "var(--secondary)", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(62,97,129,0.2)" }}>${mLabel}</span>` : null}
            </div>
          </div>

          ${drawerS[0] ? html`<${Fragment}>
            <div onClick=${function () { drawerS[1](false); }} style=${{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(14,28,54,0.42)", backdropFilter: "blur(1.5px)" }}></div>
            <div style=${{ position: "absolute", top: 0, right: 0, bottom: 0, zIndex: 41, width: "88%", maxWidth: 420, background: "var(--surface-container-lowest)", borderLeft: "1px solid var(--outline-variant)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column" }}>
              <div style=${{ padding: "14px 16px", borderBottom: "1px solid var(--outline-variant)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <div style=${{ fontFamily: "var(--font-serif)", fontSize: 17, fontWeight: 600, color: "var(--primary)" }}>Details</div>
                <button onClick=${function () { drawerS[1](false); }} aria-label="Close" style=${iconBtn}>${Ic("x", 20)}</button>
              </div>
              <div style=${{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: 16, paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", gap: 12 }}>

          <div style=${Object.assign({}, SF_PANEL, { marginBottom: 12 })}>
            <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style=${SF_H2}>Member Details</h2>
              <button onClick=${function () { editProfileS[1](Object.assign({}, person.contact || {}, { birthday: person.birthday || "" })); }} style=${{ display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "transparent", color: "var(--secondary)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600 }}>${Ic("pencil", 15)} Edit</button>
            </div>
            ${details.length ? html`<div style=${{ display: "flex", flexDirection: "column", gap: 11 }}>
              ${details.map(function (d, i) { return html`<div key=${i} style=${{ display: "flex", alignItems: "flex-start", gap: 11, color: d.tone || "var(--on-surface-variant)" }}>
                <span style=${{ display: "inline-flex", flexShrink: 0 }}>${Ic(d.icon, 18)}</span>
                <span style=${{ fontFamily: "var(--font-sans)", fontSize: 13.5, color: d.tone || "var(--on-surface)" }}>${d.text}</span>
              </div>`; })}
            </div>` : html`<p style=${{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)" }}>No contact details provided.</p>`}
          </div>

          ${(function () {
            var rel = window.FamilyCore.resolveRelations(families, pid);
            if (!rel.spouseId && !rel.childIds.length && !rel.parentIds.length) return null;
            var rows = [];
            if (rel.spouseId) rows.push(["heart", "Spouse", [rel.spouseId]]);
            if (rel.childIds.length) rows.push(["baby", "Children", rel.childIds]);
            if (rel.parentIds.length) rows.push(["users", "Parents", rel.parentIds]);
            return html`<div style=${Object.assign({}, SF_PANEL, { marginBottom: 12 })}>
              <h2 style=${Object.assign({}, SF_H2, { marginBottom: 12 })}>Family</h2>
              <div style=${{ display: "flex", flexDirection: "column", gap: 10 }}>
                ${rows.map(function (row) { return html`<div key=${row[1]} style=${{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style=${{ display: "inline-flex", flexShrink: 0, color: "var(--secondary)" }}>${Ic(row[0], 17)}</span>
                  <div style=${{ flex: 1 }}>
                    <div style=${Object.assign({}, SF_OVER, { fontSize: 9, marginBottom: 2 })}>${row[1]}</div>
                    <div style=${{ fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--on-surface)" }}>${row[2].map(function (id) { return rosterName(id); }).join(", ")}</div>
                  </div>
                </div>`; })}
              </div>
            </div>`;
          })()}

          ${(function () {
            var edges = window.RelationshipCore.edgesForPerson(rels, pid);
            if (!edges.length) return null;
            return html`<div style=${Object.assign({}, SF_PANEL, { marginBottom: 12 })}>
              <h2 style=${Object.assign({}, SF_H2, { marginBottom: 12 })}>Relationships</h2>
              <div style=${{ display: "flex", flexDirection: "column", gap: 8 }}>
                ${edges.map(function (edge) {
                  var type = null; for (var i = 0; i < relTypes.length; i++) { if (relTypes[i].id === edge.typeId) { type = relTypes[i]; break; } }
                  var d = window.RelationshipCore.describeRelationship(edge, type, pid, rosterName);
                  return html`<div key=${edge.id} style=${{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style=${{ display: "inline-flex", flexShrink: 0, color: "var(--secondary)" }}>${Ic(d.directional ? "move-right" : "arrow-left-right", 16)}</span>
                    <span style=${{ fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--on-surface)" }}>${d.directional ? d.sentence : (d.typeName + " · " + rosterName(d.otherId))}</span>
                  </div>`;
                })}
              </div>
            </div>`;
          })()}

          <div style=${Object.assign({}, SF_PANEL, { marginBottom: 12 })}>
            <h2 style=${Object.assign({}, SF_H2, { marginBottom: 12 })}>Shepherding Tags</h2>
            <div style=${{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              ${(person.tags || []).length ? (person.tags || []).map(function (t) { var mt = window.ShepherdingCore.isProjectedTagId(t); return html`<span key=${t} style=${{ display: "inline-flex", alignItems: "center", gap: 6, padding: mt ? "5px 12px" : "5px 8px 5px 12px", borderRadius: "var(--radius-full)", background: mt ? "var(--primary-fixed)" : "var(--primary)", color: mt ? "var(--primary)" : "var(--on-primary)", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500 }}>
                ${mt ? html`${Ic("lock", 11)}` : null}${tagName(t)}
                ${mt ? null : html`<button onClick=${function () { toggleTag(t); }} aria-label="Remove tag" style=${{ width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--on-primary)", cursor: "pointer", opacity: 0.8 }}>${Ic("x", 12)}</button>`}
              </span>`; }) : html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)" }}>No tags applied.</span>`}
            </div>
            ${addableTags.length ? html`<${Fragment}>
              <div style=${Object.assign({}, SF_OVER, { margin: "14px 0 8px" })}>Add tag</div>
              <div style=${{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                ${addableTags.map(function (t) { return html`<button key=${t.id} onClick=${function () { toggleTag(t.id); }} style=${{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: "var(--radius-full)", border: "none", background: "var(--surface-container)", color: "var(--on-surface)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500 }}>${Ic("plus", 13)} ${t.name}</button>`; })}
              </div>
            </${Fragment}>` : null}
            <div style=${{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--outline-variant)" }}>
              <div style=${Object.assign({}, SF_OVER, { marginBottom: 8 })}>Create tag</div>
              <div style=${{ display: "flex", gap: 8 }}>
                <input value=${newTagS[0]} onInput=${function (e) { newTagS[1](e.target.value); }} onKeyDown=${function (e) { if (e.key === "Enter") createTag(); }} placeholder="New tag name…" style=${Object.assign({}, inputStyle, { flex: 1 })} />
                <button onClick=${createTag} style=${pill()}>Create</button>
              </div>
            </div>
          </div>

          <div style=${Object.assign({}, SF_PANEL, { marginBottom: 12 })}>
            <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style=${SF_H2}>Membership Track</h2>
              <span style=${{ padding: "2px 9px", borderRadius: "var(--radius-full)", fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", background: (person.membership && person.membership.inactive) ? "var(--surface-container-high)" : "var(--primary-fixed)", color: (person.membership && person.membership.inactive) ? "var(--on-surface-variant)" : "var(--primary)" }}>${membershipLabel(person.membership) || "Not set"}</span>
            </div>
            <input type="range" min="0" max=${Core.MEMBERSHIP_STAGES.length - 1} step="1"
              value=${Math.max(0, Core.MEMBERSHIP_STAGES.indexOf(person.membership && person.membership.stage))}
              disabled=${!!(person.membership && person.membership.inactive)}
              onChange=${function (e) { setMembershipStage(e.target.value); }}
              style=${{ width: "100%", accentColor: "var(--primary)", opacity: (person.membership && person.membership.inactive) ? 0.45 : 1 }} />
            <div style=${{ display: "flex", justifyContent: "space-between", gap: 2, marginTop: 4 }}>
              ${Core.MEMBERSHIP_STAGES.map(function (stage, i) {
                var on = !(person.membership && person.membership.inactive) && Core.MEMBERSHIP_STAGES.indexOf(person.membership && person.membership.stage) === i;
                return html`<span key=${stage} style=${{ flex: 1, textAlign: "center", fontFamily: "var(--font-sans)", fontSize: 8.5, lineHeight: 1.15, color: on ? "var(--primary)" : "var(--on-surface-variant)", fontWeight: on ? 700 : 400 }}>${Core.MEMBERSHIP_STAGE_LABEL[stage]}</span>`;
              })}
            </div>
            <button onClick=${toggleInactive} style=${{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, border: "1px solid " + ((person.membership && person.membership.inactive) ? "var(--primary)" : "var(--outline-variant)"), background: (person.membership && person.membership.inactive) ? "var(--primary)" : "transparent", color: (person.membership && person.membership.inactive) ? "var(--on-primary)" : "var(--on-surface-variant)" }}>
              ${Ic((person.membership && person.membership.inactive) ? "toggle-right" : "toggle-left", 15)} ${(person.membership && person.membership.inactive) ? "Inactive — tap to reactivate" : "Mark inactive"}
            </button>
          </div>

          <div style=${Object.assign({}, SF_PANEL, { marginBottom: 12 })}>
            <h2 style=${Object.assign({}, SF_H2, { marginBottom: 14 })}>Pastoral Status</h2>
            <${StatusMatrix} cell=${50} labelW=${70}
              selected=${function (u, i) { return person.shepherdingStatus && person.shepherdingStatus.urgency === u && person.shepherdingStatus.importance === i; }}
              onCell=${setStatus}
            />
            <div style=${{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--outline-variant)" }}>
              ${person.shepherdingStatus ? html`<${Fragment}>
                <span style=${{ color: "var(--secondary)", display: "inline-flex" }}>${Ic("circle-dot", 15)}</span>
                <span style=${{ fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: 500, color: "var(--on-surface)" }}>${fmtStatus(person.shepherdingStatus)}</span>
                <button onClick=${function () { setStatus(person.shepherdingStatus.urgency, person.shepherdingStatus.importance); }} style=${{ marginLeft: "auto", border: "none", background: "none", color: "var(--on-surface-variant)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600 }}>Clear</button>
              </${Fragment}>` : html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)" }}>Tap a cell to set status.</span>`}
            </div>
          </div>
              </div>
            </div>
          </${Fragment}>` : null}

          <div style=${{ display: "flex", gap: 4, borderBottom: "1px solid var(--outline-variant)", margin: "18px 2px 0" }}>
            ${[["record", "Pastoral Record"], ["documents", "Documents"]].map(function (t) { var on = tabS[0] === t[0]; return html`<button key=${t[0]} onClick=${function () { tabS[1](t[0]); }} style=${{ padding: "9px 12px", border: "none", borderBottom: on ? "2px solid var(--primary)" : "2px solid transparent", background: "transparent", color: on ? "var(--primary)" : "var(--on-surface-variant)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, marginBottom: -1 }}>${t[1]}</button>`; })}
          </div>

          ${tabS[0] === "documents" ? html`<${ProfileDocuments} pid=${pid} user=${user} nav=${props.nav} showToast=${showToast} />` : html`<${Fragment}>
          <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "20px 2px 12px" }}>
            <h2 style=${SF_H2}>Pastoral Record</h2>
            <div style=${{ display: "flex", gap: 6 }}>
              <button onClick=${function () { collapseS[1](!collapseS[0]); }} style=${{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 10px", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", background: collapseS[0] ? "var(--surface-container)" : "transparent", color: "var(--on-surface-variant)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600 }}>${Ic(collapseS[0] ? "unfold-vertical" : "fold-vertical", 14)} ${collapseS[0] ? "Show" : "Collapse"}</button>
              <button onClick=${function () { editorS[1]({ id: null, type: NOTE_TYPES[0], subject: "", body: "" }); }} style=${{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", border: "none", borderRadius: "var(--radius)", background: "var(--primary)", color: "var(--on-primary)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600 }}>${Ic("plus", 15)} Add Note</button>
            </div>
          </div>

          ${visible.length === 0 ? html`<p style=${{ fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)", margin: 0 }}>No record yet. Add the first note.</p>`
            : html`<div style=${{ display: "flex", flexDirection: "column", gap: 12 }}>
            ${visible.map(function (e) {
              if (e._entryKind === "note") {
                return html`<div key=${e.id} style=${SF_PANEL}>
                  <div style=${{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style=${{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span style=${{ padding: "3px 9px", borderRadius: "var(--radius-sm)", background: "var(--secondary-container)", color: "var(--on-secondary-container)", fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 600 }}>${e.type}</span>
                      ${e.subject ? html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: 600, color: "var(--on-surface)" }}>${e.subject}</span>` : null}
                    </div>
                    ${e.isCareList ? null : html`<div style=${{ display: "flex", gap: 2, flexShrink: 0 }}>
                      <button onClick=${function () { editorS[1]({ id: e.id, type: e.type || NOTE_TYPES[0], subject: e.subject || "", body: e.content || "" }); }} aria-label="Edit note" style=${Object.assign({}, iconBtn, { width: 30, height: 30 })}>${Ic("pencil", 15)}</button>
                      <button onClick=${function () { deleteNote(e.id); }} aria-label="Delete note" style=${Object.assign({}, iconBtn, { width: 30, height: 30, color: "var(--error)" })}>${Ic("trash-2", 15)}</button>
                    </div>`}
                  </div>
                  <div style=${{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--on-surface-variant)", marginTop: 6 }}>${fmtEntryDate(e.createdAt)} · by ${e.authorName || "Elder"}${e.updatedAt ? " · (edited)" : ""}</div>
                  <div style=${{ fontFamily: "var(--font-serif)", fontSize: 14.5, lineHeight: 1.55, color: "var(--on-surface)", marginTop: 8, paddingTop: 10, borderTop: "1px solid var(--outline-variant)", whiteSpace: "pre-wrap" }}>${e.content || ""}</div>
                </div>`;
              }
              if (e._entryKind === "status_change") {
                var editing = explEditS[0][e.id] !== undefined;
                return html`<div key=${e.id} style=${SF_PANEL}>
                  <div style=${{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <span style=${{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: "var(--radius-sm)", background: "var(--surface-container)", color: "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 600 }}>${Ic("arrow-up-down", 12)} Status changed</span>
                    <span style=${{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--on-surface-variant)" }}>${fmtEntryDate(e.createdAt)} · by ${e.authorName || "Elder"}</span>
                  </div>
                  <div style=${{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--outline-variant)" }}>
                    <div style=${{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                      <${MiniMatrix} status=${e.previousStatus} />
                      <span style=${{ fontFamily: "var(--font-sans)", fontSize: 10, color: "var(--on-surface-variant)" }}>${e.previousStatus ? fmtStatus(e.previousStatus) : "No status"}</span>
                    </div>
                    <span style=${{ color: "var(--on-surface-variant)", display: "inline-flex" }}>${Ic("arrow-right", 18)}</span>
                    <div style=${{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                      <${MiniMatrix} status=${e.newStatus} />
                      <span style=${{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 500, color: e.newStatus ? "var(--on-surface)" : "var(--on-surface-variant)", fontStyle: e.newStatus ? "normal" : "italic" }}>${e.newStatus ? fmtStatus(e.newStatus) : "Cleared"}</span>
                    </div>
                  </div>
                  <div style=${{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--outline-variant)" }}>
                    ${editing ? html`<div style=${{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <textarea value=${explEditS[0][e.id]} onInput=${function (ev) { var n = Object.assign({}, explEditS[0]); n[e.id] = ev.target.value; explEditS[1](n); }} placeholder="Why was this status changed?" rows=${2} style=${Object.assign({}, inputStyle, { resize: "none" })}></textarea>
                      <div style=${{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        <button onClick=${function () { var n = Object.assign({}, explEditS[0]); delete n[e.id]; explEditS[1](n); }} style=${Object.assign({}, pill("ghost"), { padding: "6px 12px", fontSize: 12 })}>Cancel</button>
                        <button onClick=${function () { saveExpl(e.id); }} style=${Object.assign({}, pill(), { padding: "6px 12px", fontSize: 12 })}>Save</button>
                      </div>
                    </div>` : html`<div style=${{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      ${e.explanation ? html`<p style=${{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--on-surface)" }}>${e.explanation}</p>` : html`<span></span>`}
                      <button onClick=${function () { var n = Object.assign({}, explEditS[0]); n[e.id] = e.explanation || ""; explEditS[1](n); }} style=${{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "none", color: "var(--on-surface-variant)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>${Ic("pencil-line", 14)} ${e.explanation ? "Edit" : "Add"} explanation</button>
                    </div>`}
                  </div>
                </div>`;
              }
              if (e._entryKind === "membership_change") {
                return html`<div key=${e.id} style=${Object.assign({}, SF_PANEL, { padding: "12px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 })}>
                  <span style=${{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: "var(--radius-sm)", background: "var(--primary-fixed)", color: "var(--primary)", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600 }}>${Ic("trending-up", 13)} ${Core.describeMembershipChange(e)}</span>
                  <span style=${{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--on-surface-variant)", marginLeft: "auto" }}>${e.authorName || "Elder"} · ${fmtEntryDate(e.createdAt)}</span>
                </div>`;
              }
              return html`<div key=${e.id} style=${Object.assign({}, SF_PANEL, { padding: "12px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 })}>
                <span style=${{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--on-surface)", fontFamily: "var(--font-sans)", fontSize: 13 }}>${Ic("tag", 14)} Tag <strong>${e.tagName || tagName(e.tagId)}</strong> ${e.action}</span>
                <span style=${{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--on-surface-variant)", marginLeft: "auto" }}>${e.authorName || "Elder"} · ${fmtEntryDate(e.createdAt)}</span>
              </div>`;
            })}
          </div>`}
          </${Fragment}>`}
        </${Body}>

        ${editor ? html`<${Modal} onClose=${function () { editorS[1](null); }} title=${editor.id ? "Edit Note" : "New Note"}
          footer=${html`<${Fragment}><button onClick=${function () { editorS[1](null); }} style=${pill("ghost")}>Cancel</button><button onClick=${saveNote} style=${pill()}>${editor.id ? "Save Changes" : "Add Note"}</button></${Fragment}>`}>
          <div style=${{ display: "flex", flexDirection: "column", gap: 14 }}>
            <${Field} label="Note type">
              <div style=${{ position: "relative" }}>
                <select value=${editor.type} onChange=${function (e) { editorS[1](Object.assign({}, editor, { type: e.target.value })); }} style=${Object.assign({}, inputStyle, { appearance: "none", WebkitAppearance: "none", paddingRight: 36, cursor: "pointer" })}>
                  ${NOTE_TYPES.map(function (t) { return html`<option key=${t} value=${t}>${t}</option>`; })}
                </select>
                <span style=${{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--on-surface-variant)" }}>${Ic("chevron-down", 16)}</span>
              </div>
            </${Field}>
            <${Field} label="Title (optional)"><input value=${editor.subject} onInput=${function (e) { editorS[1](Object.assign({}, editor, { subject: e.target.value })); }} placeholder="Brief title…" style=${inputStyle} /></${Field}>
            <div style=${{ display: "flex", flexDirection: "column" }}>
              <div style=${{ display: "flex", gap: 2, padding: "6px 8px", background: "var(--surface-container)", border: "1px solid var(--outline-variant)", borderBottom: "none", borderRadius: "var(--radius) var(--radius) 0 0" }}>
                ${["bold", "italic", "underline", "list", "list-ordered", "highlighter"].map(function (ic) { return html`<span key=${ic} style=${{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--on-surface-variant)" }}>${Ic(ic, 16)}</span>`; })}
              </div>
              <textarea value=${editor.body} onInput=${function (e) { editorS[1](Object.assign({}, editor, { body: e.target.value })); }} placeholder="Write the note…" rows=${6} style=${Object.assign({}, inputStyle, { borderRadius: "0 0 var(--radius) var(--radius)", resize: "vertical", lineHeight: 1.5, fontFamily: "var(--font-serif)", fontSize: 14.5 })}></textarea>
            </div>
          </div>
        </${Modal}>` : null}

        ${editProfile ? html`<${Modal} onClose=${function () { editProfileS[1](null); }} title="Edit Member Details"
          footer=${html`<${Fragment}><button onClick=${function () { editProfileS[1](null); }} style=${pill("ghost")}>Cancel</button><button onClick=${saveProfileDetails} style=${pill()}>Save</button></${Fragment}>`}>
          <div style=${{ display: "flex", flexDirection: "column", gap: 12 }}>
            <${Field} label="Email"><input type="email" value=${editProfile.email || ""} onInput=${function (e) { editProfileS[1](Object.assign({}, editProfile, { email: e.target.value })); }} style=${inputStyle} /></${Field}>
            <${Field} label="Phone"><input type="tel" value=${editProfile.phone || ""} onInput=${function (e) { editProfileS[1](Object.assign({}, editProfile, { phone: e.target.value })); }} style=${inputStyle} /></${Field}>
            <${Field} label="Address"><textarea rows=${2} value=${editProfile.address || ""} onInput=${function (e) { editProfileS[1](Object.assign({}, editProfile, { address: e.target.value })); }} style=${Object.assign({}, inputStyle, { resize: "vertical" })}></textarea></${Field}>
            <${Field} label="Birthday"><input type="date" value=${editProfile.birthday || ""} onInput=${function (e) { editProfileS[1](Object.assign({}, editProfile, { birthday: e.target.value })); }} style=${inputStyle} /></${Field}>
          </div>
        </${Modal}>` : null}

        <${Toast} toast=${toastS[0]} />
      </${Screen}>`;
  }

  M.SCREENS = Object.assign(M.SCREENS || {}, { shepherd: ShepherdScreen, shepherdPeople: ShepherdPeopleScreen, shepherdProfile: ShepherdProfileScreen });
})();
