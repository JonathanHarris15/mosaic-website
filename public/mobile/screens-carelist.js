/* ============================================================
   screens-carelist.js — native Care List editor for the mobile shell.
   Ported from the Mosaic Mobile design (screens_carelist) but wired to
   the SAME elder_documents care-list data as the desktop, using REAL
   TipTap editors (offline bundle: vendor/tiptap/tiptap.bundle.js) with
   the exact extension set + the shared inline-triggers extension
   (shepherding-inline-triggers.js). Cells serialize via editor.getJSON()
   so careListData stays byte-compatible with the desktop + the profile's
   care-list-note reader. Tag/status triggers dual-write through
   ShepherdingCore (source: 'document') exactly like shepherding-care-list.js.
   ============================================================ */
(function () {
  "use strict";
  var html = M.html, Ic = M.Ic, data = M.data, Fragment = M.Fragment;
  var useState = M.hooks.useState, useEffect = M.hooks.useEffect, useRef = M.hooks.useRef;
  var ui = M.ui, Screen = ui.Screen, TopBar = ui.TopBar, Body = ui.Body;
  var Core = window.ShepherdingCore;

  var CL_NAME_W = 176;

  // Offline TipTap bundle + inline triggers load once, shared with the Document
  // editor, via M.ensureTipTap() (mobile/tiptap-loader.js).
  var ensureTipTap = M.ensureTipTap;

  // The cell IS the TipTap mount element; stretch the ProseMirror editable to
  // fill it so tapping anywhere in the cell edits (no small inner box), and kill
  // the focus outline / mobile tap-highlight so the cell just reads as text.
  function injectStyles() {
    if (document.getElementById("cl-cell-styles")) return;
    var css = ""
      + ".cl-cell{display:flex;flex-direction:column;min-height:84px;cursor:text;}"
      + ".cl-cell .ProseMirror{flex:1;min-height:100%;outline:none;padding:10px 12px;box-sizing:border-box;font-family:var(--font-serif);font-size:14px;line-height:1.5;color:var(--on-surface);-webkit-tap-highlight-color:transparent;}"
      + ".cl-cell .ProseMirror p{margin:0 0 .4em;} .cl-cell .ProseMirror p:last-child{margin-bottom:0;}"
      + ".cl-cell .ProseMirror ul{list-style:disc;padding-left:1.4em;} .cl-cell .ProseMirror ol{list-style:decimal;padding-left:1.4em;}"
      + ".cl-cell .mention-chip{background:var(--primary-fixed);color:var(--primary);border-radius:3px;padding:0 4px;font-weight:500;}";
    var el = document.createElement("style"); el.id = "cl-cell-styles"; el.textContent = css;
    document.head.appendChild(el);
  }

  // People-only @mention suggestion (id format matches desktop: {kind:'person',id}).
  // A self-built DOM popup, like createDocMentionSuggestion in the desktop file.
  function makeMentionSuggestion(getPeople) {
    return {
      items: function (o) {
        var q = (o.query || "").toLowerCase();
        return getPeople().filter(function (p) { return p.name && p.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 20)
          .map(function (p) { return { id: JSON.stringify({ kind: "person", id: p.id }), label: p.name }; });
      },
      render: function () {
        var popup = null, sel = 0, cur = null;
        function draw(items, rect, command) {
          if (!popup) { popup = document.createElement("div"); popup.style.cssText = "position:fixed;z-index:9999;background:#fff;border:1px solid #c5c6d0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:200px;max-height:260px;overflow-y:auto;padding:4px 0;font-family:var(--font-sans);font-size:14px;"; document.body.appendChild(popup); }
          if (rect) { var r = typeof rect === "function" ? rect() : rect; if (r) { popup.style.left = Math.min(r.left, window.innerWidth - 220) + "px"; popup.style.top = (r.bottom + 4) + "px"; } }
          popup.innerHTML = "";
          if (!items.length) { var e = document.createElement("div"); e.style.cssText = "padding:8px 16px;color:#75777f;font-style:italic;"; e.textContent = "No matches"; popup.appendChild(e); return; }
          items.forEach(function (it, i) {
            var b = document.createElement("button"); b.type = "button";
            b.style.cssText = "display:block;width:100%;text-align:left;padding:7px 16px;cursor:pointer;border:none;background:" + (i === sel ? "#d8e2ff" : "transparent") + ";color:#1c1c18;font-size:14px;font-family:inherit;";
            b.textContent = it.label;
            b.addEventListener("mousedown", function (ev) { ev.preventDefault(); command(it); });
            popup.appendChild(b);
          });
        }
        return {
          onStart: function (p) { cur = p; sel = 0; draw(p.items, p.clientRect, p.command); },
          onUpdate: function (p) { cur = p; sel = 0; draw(p.items, p.clientRect, p.command); },
          onKeyDown: function (o) {
            if (!cur) return false;
            var n = cur.items.length;
            if (o.event.key === "Escape") { if (popup) { popup.remove(); popup = null; } return true; }
            if (!n) return false;
            if (o.event.key === "ArrowUp") { sel = (sel - 1 + n) % n; draw(cur.items, null, cur.command); return true; }
            if (o.event.key === "ArrowDown") { sel = (sel + 1) % n; draw(cur.items, null, cur.command); return true; }
            if (o.event.key === "Enter") { if (cur.items[sel]) cur.command(cur.items[sel]); return true; }
            return false;
          },
          onExit: function () { if (popup) { popup.remove(); popup = null; } cur = null; },
        };
      },
    };
  }

  // Filter people through a saved view config (mirrors shepherding-care-list.js applyFilter).
  function filterPeople(people, view) {
    var list = people.filter(function (p) { return !(p.membership && p.membership.status === "inactive"); });
    if (view) {
      if (view.filterTags && view.filterTags.length) {
        list = list.filter(function (p) {
          var pt = p.tags || [];
          return view.filterMode === "all" ? view.filterTags.every(function (t) { return pt.indexOf(t) !== -1; }) : view.filterTags.some(function (t) { return pt.indexOf(t) !== -1; });
        });
      }
      if (view.statusZoneFilters && view.statusZoneFilters.length) {
        list = list.filter(function (p) { return p.shepherdingStatus && view.statusZoneFilters.indexOf(p.shepherdingStatus.urgency + "__" + p.shepherdingStatus.importance) !== -1; });
      }
    }
    return list.sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || "")); });
  }

  function hiddenIds(tags) { var s = {}; tags.forEach(function (t) { if (t.hidePeople) s[t.id] = true; }); return s; }
  var shortStatus = function (s) { return s ? (Core.URGENCY_LABEL_SHORT[s.urgency] + " · " + Core.IMPORTANCE_LABEL_SHORT[s.importance]) : ""; };

  var toolBtn = function (active) { return { width: 34, height: 34, flexShrink: 0, border: "none", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: active ? "var(--primary)" : "transparent", color: active ? "var(--on-primary)" : "var(--on-surface-variant)" }; };
  var clSelect = { flexShrink: 0, border: "1px solid var(--outline-variant)", borderRadius: 6, padding: "6px 8px", fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--on-surface-variant)", background: "var(--surface-container-lowest)", cursor: "pointer" };
  var clDivider = { width: 1, height: 20, background: "var(--outline-variant)", margin: "0 3px", flexShrink: 0 };

  function CareListEditorScreen(props) {
    var user = props.user || {};
    var docId = (props.params && props.params.id) || null;

    var loadingS = useState(true), errS = useState(false), readyS = useState(false);
    var titleS = useState("");
    var columnsS = useState([]);
    var peopleS = useState([]), tagsS = useState([]), viewS = useState(null), filterTitleS = useState("…");
    var activeColS = useState(null);
    var colPickerS = useState(false), editingColS = useState(null), editingColNameS = useState("");
    var saveStatusS = useState("saved");
    var toastS = useState(null);
    var activeCellS = useState(null); // { personId, colId } — for toolbar enable + highlight

    // Imperative state (read by TipTap callbacks — kept in refs to dodge stale closures).
    var editorsRef = useRef({});      // personId -> { colId -> Editor }
    var cellElsRef = useRef({});      // "pid|cid" -> DOM el
    var refCbRef = useRef({});        // "pid|cid" -> stable ref callback
    var dataStoreRef = useRef({});    // personId -> { colId -> TipTap JSON }
    var peopleRef = useRef([]);       // current people (for trigger callbacks)
    var tagsRef = useRef([]);
    var userRef = useRef(user);
    var saveTimerRef = useRef(null);
    var activeEditorRef = useRef(null);

    peopleRef.current = peopleS[0]; tagsRef.current = tagsS[0]; userRef.current = user;

    function showToast(m, t) { toastS[1]({ message: m, type: t || "success" }); setTimeout(function () { toastS[1](null); }, 2600); }

    // ── Load: TipTap bundle + doc + people + tags + view ──
    useEffect(function () {
      var alive = true;
      injectStyles();
      if (!docId) { errS[1](true); loadingS[1](false); return; }
      ensureTipTap().then(function () { if (alive) readyS[1](true); }).catch(function () { if (alive) { errS[1](true); loadingS[1](false); } });
      Promise.all([data.getCareList(docId), data.getShepherdingPeople(), data.getShepherdingTags()])
        .then(function (r) {
          if (!alive) return;
          var doc = r[0];
          if (!doc) { errS[1](true); loadingS[1](false); return; }
          titleS[1](doc.title || "");
          // Columns (+ legacy migration: careListData[pid] as a bare TipTap doc).
          var cols = (doc.careListColumns && doc.careListColumns.length) ? doc.careListColumns : [{ id: "col_default", name: "Notes" }];
          var store = {};
          if (doc.careListData) {
            Object.keys(doc.careListData).forEach(function (pid) {
              var val = doc.careListData[pid];
              store[pid] = (val && typeof val === "object" && val.type === "doc") ? { col_default: val } : (val || {});
            });
          }
          dataStoreRef.current = store;
          columnsS[1](cols);
          activeColS[1](cols[0] ? cols[0].id : null);
          peopleS[1](r[1]); tagsS[1](r[2]);
          var viewId = doc.filterId || null;
          if (viewId) {
            data.getShepherdingView(viewId).then(function (v) { if (!alive) return; viewS[1](v); filterTitleS[1]((v && v.title) || "Untitled Filter"); loadingS[1](false); });
          } else {
            viewS[1](doc.filterConfig || null); filterTitleS[1](doc.filterConfig ? "Custom Filter" : "All members"); loadingS[1](false);
          }
        })
        .catch(function () { if (alive) { errS[1](true); loadingS[1](false); } });
      return function () {
        alive = false;
        // Tear down all editors on unmount.
        var es = editorsRef.current;
        Object.keys(es).forEach(function (pid) { Object.keys(es[pid]).forEach(function (cid) { try { es[pid][cid].destroy(); } catch (e) {} }); });
        editorsRef.current = {};
      };
    }, [docId]);

    var filtered = filterPeople(peopleS[0], viewS[0]);
    var activeCol = columnsS[0].filter(function (c) { return c.id === activeColS[0]; })[0] || columnsS[0][0];

    // ── Save (debounced) ──
    function scheduleSave() {
      saveStatusS[1]("unsaved");
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(doSave, 1500);
    }
    function doSave() {
      saveStatusS[1]("saving");
      // Refresh the store from any live editors before serializing.
      var es = editorsRef.current;
      Object.keys(es).forEach(function (pid) {
        Object.keys(es[pid]).forEach(function (cid) {
          if (!dataStoreRef.current[pid]) dataStoreRef.current[pid] = {};
          try { dataStoreRef.current[pid][cid] = es[pid][cid].getJSON(); } catch (e) {}
        });
      });
      data.saveCareList(docId, { title: titleS[0], careListColumns: columnsS[0], careListData: dataStoreRef.current }, user)
        .then(function () { saveStatusS[1]("saved"); })
        .catch(function () { saveStatusS[1]("unsaved"); showToast("Error saving care list", "error"); });
    }

    // ── Trigger callbacks (wired to real dual-writes, source: 'document') ──
    function computeHidden(newTags) { var h = hiddenIds(tagsRef.current); return newTags.some(function (id) { return !!h[id]; }); }
    function patchPerson(pid, patch) { peopleS[1](peopleRef.current.map(function (p) { return p.id === pid ? Object.assign({}, p, patch) : p; })); }
    function onTagAdd(pid, tagId, tagName) {
      var cur = (peopleRef.current.filter(function (p) { return p.id === pid; })[0] || {}).tags || [];
      if (cur.indexOf(tagId) !== -1) return;
      var newTags = cur.concat([tagId]);
      data.toggleShepherdingTag(pid, tagId, tagName, true, computeHidden(newTags), userRef.current, "document", docId)
        .then(function () { patchPerson(pid, { tags: newTags }); showToast("Tag #" + tagName + " added"); })
        .catch(function () { showToast("Error adding tag", "error"); });
    }
    function onTagRemove(pid, tagId, tagName) {
      var cur = (peopleRef.current.filter(function (p) { return p.id === pid; })[0] || {}).tags || [];
      var newTags = cur.filter(function (t) { return t !== tagId; });
      data.toggleShepherdingTag(pid, tagId, tagName, false, computeHidden(newTags), userRef.current, "document", docId)
        .then(function () { patchPerson(pid, { tags: newTags }); showToast("Tag #" + tagName + " removed"); })
        .catch(function () { showToast("Error removing tag", "error"); });
    }
    function onStatusChange(pid, urg, imp) {
      var prev = (peopleRef.current.filter(function (p) { return p.id === pid; })[0] || {}).shepherdingStatus || null;
      var next = (urg && imp) ? { urgency: urg, importance: imp } : null;
      return data.setShepherdingStatus(pid, next, prev, userRef.current, "document", docId)
        .then(function (activityId) { patchPerson(pid, { shepherdingStatus: next }); showToast(next ? "Status updated" : "Status cleared"); return activityId; })
        .catch(function () { showToast("Error updating status", "error"); });
    }
    function onStatusUndo(pid, activityId, prevUrg, prevImp) {
      var prev = (prevUrg && prevImp) ? { urgency: prevUrg, importance: prevImp } : null;
      return data.revertShepherdingStatus(pid, prev, activityId).then(function () { patchPerson(pid, { shepherdingStatus: prev }); }).catch(function () {});
    }
    function createTag(name) {
      var t = name.trim(); if (!t) return Promise.reject();
      var existing = tagsRef.current.filter(function (x) { return x.name.toLowerCase() === t.toLowerCase(); })[0];
      if (existing) return Promise.resolve(existing);
      return data.createShepherdingTag(t).then(function (tag) { tagsS[1](tagsRef.current.concat([tag]).sort(function (a, b) { return a.name.localeCompare(b.name); })); return tag; });
    }

    // ── Editor mounting ──
    function mountEditor(pid, cid) {
      var key = pid + "|" + cid;
      var el = cellElsRef.current[key];
      if (!el || !window._TipTap) return;
      if (editorsRef.current[pid] && editorsRef.current[pid][cid]) return;
      var T = window._TipTap;
      var content = (dataStoreRef.current[pid] && dataStoreRef.current[pid][cid]) || "";
      var triggerExt = window.createInlineTriggersExtension({
        personId: pid,
        getAllTags: function () { return tagsRef.current; },
        getPersonTags: function () { var p = peopleRef.current.filter(function (x) { return x.id === pid; })[0]; return (p && p.tags) || []; },
        getCurrentStatus: function () { var p = peopleRef.current.filter(function (x) { return x.id === pid; })[0]; return (p && p.shepherdingStatus) || null; },
        createTag: createTag,
        onTagAdd: function (tagId, tagName) { return onTagAdd(pid, tagId, tagName); },
        onTagRemove: function (tagId, tagName) { return onTagRemove(pid, tagId, tagName); },
        onStatusChange: function (u, i) { return onStatusChange(pid, u, i); },
        onStatusUndo: function (activityId, u, i) { return onStatusUndo(pid, activityId, u, i); },
      });
      var ed = new T.Editor({
        element: el,
        extensions: [
          T.StarterKit, T.Underline, T.TextStyle, T.FontFamily, T.FontSize,
          T.Highlight.configure({ multicolor: true }),
          T.Table.configure({ resizable: false }), T.TableRow, T.TableHeader, T.TableCell,
          T.Mention.configure({ HTMLAttributes: { class: "mention-chip" }, suggestion: makeMentionSuggestion(function () { return peopleRef.current; }) }),
          triggerExt,
        ],
        content: content,
        onUpdate: function () {
          if (!dataStoreRef.current[pid]) dataStoreRef.current[pid] = {};
          try { dataStoreRef.current[pid][cid] = ed.getJSON(); } catch (e) {}
          scheduleSave();
        },
        onFocus: function () { activeEditorRef.current = ed; activeCellS[1]({ personId: pid, colId: cid }); },
      });
      if (!editorsRef.current[pid]) editorsRef.current[pid] = {};
      editorsRef.current[pid][cid] = ed;
    }
    function destroyEditor(pid, cid) {
      if (editorsRef.current[pid] && editorsRef.current[pid][cid]) {
        try { editorsRef.current[pid][cid].getJSON && (dataStoreRef.current[pid] = dataStoreRef.current[pid] || {}, dataStoreRef.current[pid][cid] = editorsRef.current[pid][cid].getJSON()); } catch (e) {}
        try { editorsRef.current[pid][cid].destroy(); } catch (e) {}
        delete editorsRef.current[pid][cid];
      }
    }
    function cellRef(pid, cid) {
      var key = pid + "|" + cid;
      if (!refCbRef.current[key]) {
        refCbRef.current[key] = function (el) {
          if (el) { cellElsRef.current[key] = el; if (readyS[0]) mountEditor(pid, cid); }
          else { delete cellElsRef.current[key]; destroyEditor(pid, cid); }
        };
      }
      return refCbRef.current[key];
    }
    // Mount pass: when TipTap becomes ready or the visible column/people change,
    // mount editors for any visible cell that has a mounted element but no editor.
    useEffect(function () {
      if (!readyS[0] || !activeCol) return;
      filtered.forEach(function (p) { mountEditor(p.id, activeCol.id); });
    });

    // ── Toolbar ──
    function withActive(fn) { var ed = activeEditorRef.current; if (!ed) return; ed.chain().focus(); fn(ed); }
    function exec(cmd) { withActive(function (ed) { ed.chain().focus()[cmd]().run(); }); }
    function setFont(v) { withActive(function (ed) { v ? ed.chain().focus().setFontFamily(v).run() : ed.chain().focus().unsetFontFamily().run(); }); }
    function setSize(v) { withActive(function (ed) { v ? ed.chain().focus().setFontSize(v).run() : ed.chain().focus().unsetFontSize().run(); }); }

    // ── Column management ──
    function addColumn() {
      var id = "col_" + Date.now();
      var cols = columnsS[0].concat([{ id: id, name: "Column " + (columnsS[0].length + 1) }]);
      columnsS[1](cols); activeColS[1](id); colPickerS[1](false);
      editingColS[1](id); editingColNameS[1]("Column " + columnsS[0].length);
      scheduleSave();
    }
    function saveColName(id) {
      columnsS[1](columnsS[0].map(function (c) { return c.id === id ? Object.assign({}, c, { name: editingColNameS[0].trim() || "Untitled" }) : c; }));
      editingColS[1](null); scheduleSave();
    }
    function deleteColumn(id) {
      if (columnsS[0].length <= 1) { showToast("Cannot delete the last column", "error"); return; }
      if (!window.confirm("Delete this column? Its content will be permanently lost.")) return;
      filtered.forEach(function (p) { destroyEditor(p.id, id); if (dataStoreRef.current[p.id]) delete dataStoreRef.current[p.id][id]; });
      var rest = columnsS[0].filter(function (c) { return c.id !== id; });
      columnsS[1](rest);
      if (activeColS[0] === id) activeColS[1](rest[0].id);
      scheduleSave();
    }

    var userKnown = props.user !== undefined;
    var isElder = userKnown && !!props.user && (props.user.role === "elder" || props.user.role === "super_admin");
    var saveStatus = saveStatusS[0];
    var saveLabel = saveStatus === "saving" ? "Saving…" : saveStatus === "unsaved" ? "Unsaved changes" : "Saved";
    var hasActive = !!activeCellS[0];

    if (!userKnown || loadingS[0]) {
      return html`<${Screen}><${TopBar} title="Care List" onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "16px" }}><div style=${{ display: "flex", justifyContent: "center", padding: "48px 20px", color: "var(--on-surface-variant)" }}><span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 26)}</span></div></${Body}></${Screen}>`;
    }
    if (!isElder) {
      return html`<${Screen}><${TopBar} title="Care List" onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "60px 24px", textAlign: "center" }}><div style=${{ display: "inline-flex", opacity: 0.5, color: "var(--on-surface-variant)" }}>${Ic("shield-alert", 40)}</div><p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, marginTop: 12, color: "var(--on-surface-variant)" }}>Elder-only tools.</p></${Body}></${Screen}>`;
    }
    if (errS[0]) {
      return html`<${Screen}><${TopBar} title="Care List" onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "60px 24px", textAlign: "center" }}><p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, color: "var(--on-surface-variant)" }}>Couldn't load this care list.</p></${Body}></${Screen}>`;
    }

    return html`
      <${Screen}>
        <${TopBar} title="Care List" onBack=${props.back} serif=${false}
          right=${html`<span style=${{ display: "flex", alignItems: "center", gap: 5, paddingRight: 8, fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500, color: saveStatus === "unsaved" ? "var(--outline)" : "var(--on-surface-variant)" }}>
            ${saveStatus === "saving" ? html`<span style=${{ display: "flex", animation: "mspin 0.7s linear infinite" }}>${Ic("loader-circle", 13)}</span>` : saveStatus === "saved" ? Ic("check", 14) : null}
            ${saveLabel}
          </span>`} />

        <div style=${{ flexShrink: 0, padding: "12px 16px 10px", borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container-lowest)" }}>
          <input value=${titleS[0]} onInput=${function (e) { titleS[1](e.target.value); scheduleSave(); }} placeholder="Care List title…"
            style=${{ width: "100%", boxSizing: "border-box", border: "none", background: "transparent", outline: "none", padding: "2px 0 6px", fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--primary)", letterSpacing: "0.02em" }} />
          <div style=${{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <span style=${{ display: "inline-flex", color: "var(--secondary)" }}>${Ic("list-filter", 13)}</span>
            <span style=${{ fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600, color: "var(--secondary)" }}>Filter: ${filterTitleS[0]}</span>
          </div>
        </div>

        <div style=${{ flexShrink: 0, display: "flex", alignItems: "center", gap: 3, padding: "8px 10px", borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container)", overflowX: "auto", opacity: hasActive ? 1 : 0.55, pointerEvents: hasActive ? "auto" : "none" }}>
          <select onChange=${function (e) { setFont(e.target.value); e.target.selectedIndex = 0; }} style=${clSelect}>
            <option value="">Font</option><option value="var(--font-sans)">Sans</option><option value="var(--font-serif)">Serif</option><option value="monospace">Mono</option>
          </select>
          <select onChange=${function (e) { setSize(e.target.value); e.target.selectedIndex = 0; }} style=${clSelect}>
            <option value="">Size</option><option value="12px">12</option><option value="14px">14</option><option value="16px">16</option><option value="18px">18</option><option value="20px">20</option><option value="24px">24</option>
          </select>
          <span style=${clDivider}></span>
          <button onMouseDown=${function (e) { e.preventDefault(); exec("toggleBold"); }} style=${toolBtn(false)} title="Bold"><b style=${{ fontSize: 15 }}>B</b></button>
          <button onMouseDown=${function (e) { e.preventDefault(); exec("toggleItalic"); }} style=${toolBtn(false)} title="Italic"><i style=${{ fontSize: 15 }}>I</i></button>
          <button onMouseDown=${function (e) { e.preventDefault(); exec("toggleUnderline"); }} style=${toolBtn(false)} title="Underline"><u style=${{ fontSize: 15 }}>U</u></button>
          <span style=${clDivider}></span>
          <button onMouseDown=${function (e) { e.preventDefault(); exec("toggleBulletList"); }} style=${toolBtn(false)} title="Bullet list">${Ic("list", 17)}</button>
          <button onMouseDown=${function (e) { e.preventDefault(); exec("toggleOrderedList"); }} style=${toolBtn(false)} title="Numbered list">${Ic("list-ordered", 17)}</button>
        </div>

        <div style=${{ flexShrink: 0, padding: "7px 16px", borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container-lowest)", fontFamily: "var(--font-sans)", fontSize: 10.5, color: "var(--on-surface-variant)", display: "flex", flexWrap: "wrap", gap: 10 }}>
          <span><b style=${{ color: "var(--primary)" }}>@</b> mention</span>
          <span><b style=${{ color: "var(--primary)" }}>#</b> add tag</span>
          <span><b style=${{ color: "var(--primary)" }}>-#</b> remove tag</span>
          <span><b style=${{ color: "var(--primary)" }}>$$</b> status</span>
        </div>

        <div style=${{ flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch", background: "var(--surface-container-lowest)" }}>
          <div style=${{ display: "flex", position: "sticky", top: 0, zIndex: 20, background: "var(--surface-container)", borderBottom: "1px solid var(--outline-variant)" }}>
            <div style=${{ width: CL_NAME_W, flexShrink: 0, padding: "10px 12px", borderRight: "1px solid var(--outline-variant)", display: "flex", alignItems: "center", fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--on-surface-variant)" }}>Person</div>
            <button onClick=${function () { colPickerS[1](true); }} style=${{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}>
              <span style=${{ flex: 1, minWidth: 0, fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>${activeCol ? activeCol.name : "—"}</span>
              ${columnsS[0].length > 1 ? html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 10, color: "var(--on-surface-variant)", flexShrink: 0 }}>${columnsS[0].findIndex(function (c) { return c.id === (activeCol && activeCol.id); }) + 1}/${columnsS[0].length}</span>` : null}
              <span style=${{ color: "var(--primary)", display: "inline-flex", flexShrink: 0 }}>${Ic("chevrons-up-down", 16)}</span>
            </button>
          </div>

          ${filtered.length === 0 ? html`<div style=${{ padding: "40px 20px", textAlign: "center", fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)" }}>No people match this filter.</div>`
            : !activeCol ? null : filtered.map(function (p, idx) {
              var isActive = activeCellS[0] && activeCellS[0].personId === p.id && activeCellS[0].colId === activeCol.id;
              return html`<div key=${p.id} style=${{ display: "flex", borderBottom: "1px solid var(--outline-variant)", background: idx % 2 ? "var(--surface-container-low)" : "var(--surface-container-lowest)" }}>
                <div style=${{ width: CL_NAME_W, flexShrink: 0, padding: "12px 12px", borderRight: "1px solid var(--outline-variant)", display: "flex", flexDirection: "column", gap: 6 }}>
                  <button onClick=${function () { props.nav("shepherdProfile", { id: p.id, from: "carelist" }); }} style=${{ border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: 700, color: "var(--primary)", textDecoration: "underline", textDecorationColor: "rgba(24,47,87,0.25)" }}>${p.name || "(no name)"}</button>
                  <div style=${{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    ${(p.tags || []).map(function (t) { var tag = tagsS[0].filter(function (x) { return x.id === t; })[0]; return html`<span key=${t} style=${{ padding: "1px 7px", borderRadius: "var(--radius-full)", background: "var(--secondary-container)", color: "var(--on-secondary-container)", fontFamily: "var(--font-sans)", fontSize: 9.5, fontWeight: 600 }}>${tag ? tag.name : t}</span>`; })}
                  </div>
                  ${p.shepherdingStatus ? html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 500, color: "var(--secondary)" }}>${shortStatus(p.shepherdingStatus)}</span>` : null}
                </div>
                <div style=${{ flex: 1, minWidth: 0, background: isActive ? "rgba(24,47,87,0.03)" : "transparent" }}>
                  <div key=${activeCol.id} ref=${cellRef(p.id, activeCol.id)} class="cl-cell"></div>
                </div>
              </div>`;
            })}
        </div>

        ${colPickerS[0] ? html`<${Fragment}>
          <div onClick=${function () { colPickerS[1](false); editingColS[1](null); }} style=${{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(14,28,54,0.42)", backdropFilter: "blur(1.5px)" }}></div>
          <div style=${{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 51, maxHeight: "80%", background: "var(--surface-container-lowest)", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTop: "1px solid var(--outline-variant)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column" }}>
            <div style=${{ padding: "16px 18px 12px", borderBottom: "1px solid var(--outline-variant)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexShrink: 0 }}>
              <div>
                <div style=${{ fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 600, color: "var(--primary)" }}>Columns</div>
                <div style=${{ fontFamily: "var(--font-sans)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--on-surface-variant)", marginTop: 4 }}>Pick a column to view</div>
              </div>
              <button onClick=${function () { colPickerS[1](false); editingColS[1](null); }} aria-label="Close" style=${{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--on-surface-variant)", cursor: "pointer", flexShrink: 0 }}>${Ic("x", 20)}</button>
            </div>
            <div style=${{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
              ${columnsS[0].map(function (col) {
                var on = activeCol && col.id === activeCol.id;
                return html`<div key=${col.id} style=${{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderBottom: "1px solid var(--outline-variant)", background: on ? "var(--primary-fixed)" : "transparent" }}>
                  ${editingColS[0] === col.id
                    ? html`<input value=${editingColNameS[0]} onInput=${function (e) { editingColNameS[1](e.target.value); }} onBlur=${function () { saveColName(col.id); }} onKeyDown=${function (e) { if (e.key === "Enter") saveColName(col.id); if (e.key === "Escape") editingColS[1](null); }}
                        style=${{ flex: 1, minWidth: 0, border: "none", borderBottom: "1px solid var(--primary)", background: "transparent", outline: "none", fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--on-surface)" }} />`
                    : html`<${Fragment}>
                        <button onClick=${function () { activeColS[1](col.id); colPickerS[1](false); }} style=${{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9, border: "none", background: "transparent", cursor: "pointer", textAlign: "left", padding: 0 }}>
                          <span style=${{ width: 18, flexShrink: 0, color: "var(--primary)", display: "inline-flex" }}>${on ? Ic("check", 17) : null}</span>
                          <span style=${{ fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: on ? 600 : 500, color: "var(--on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>${col.name}</span>
                        </button>
                        <button onClick=${function () { editingColS[1](col.id); editingColNameS[1](col.name); }} aria-label="Rename column" style=${{ width: 32, height: 32, border: "none", background: "transparent", color: "var(--on-surface-variant)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6 }}>${Ic("pencil", 16)}</button>
                        ${columnsS[0].length > 1 ? html`<button onClick=${function () { deleteColumn(col.id); }} aria-label="Delete column" style=${{ width: 32, height: 32, border: "none", background: "transparent", color: "var(--error)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6 }}>${Ic("trash-2", 16)}</button>` : null}
                      </${Fragment}>`}
                </div>`;
              })}
              <button onClick=${addColumn} style=${{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "14px 18px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left", color: "var(--primary)", fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600 }}>${Ic("plus", 18)} Create new column</button>
            </div>
          </div>
        </${Fragment}>` : null}

        ${toastS[0] ? html`<div style=${{ position: "absolute", bottom: "calc(28px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", zIndex: 70, padding: "11px 18px", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)", background: toastS[0].type === "error" ? "var(--error)" : "var(--primary)", color: "#fff", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", maxWidth: "90%" }}>${toastS[0].message}</div>` : null}
      </${Screen}>`;
  }

  M.SCREENS = Object.assign(M.SCREENS || {}, { careList: CareListEditorScreen });
})();
