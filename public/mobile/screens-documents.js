/* ============================================================
   screens-documents.js — native Document Library for the mobile shell.
   Ported from the Mosaic Mobile design (DocumentsScreen in
   screens_shepherd.jsx) and wired to the SAME elder_documents +
   elder_document_structure data as the desktop page
   (shepherding-documents.js). Byte-compatible tree shape, so folders
   and docs created here round-trip on desktop.

   Documents come in two docTypes: `note` → the native Document editor
   (screens-document-editor.js), `care-list` → the native Care List
   editor (screens-carelist.js). New-document flow lets you pick which;
   a Care List also picks the Filtered View (or a custom filter) that
   drives its rows.
   ============================================================ */
(function () {
  "use strict";
  var html = M.html, Ic = M.Ic, data = M.data, Fragment = M.Fragment;
  var useState = M.hooks.useState, useEffect = M.hooks.useEffect;
  var ui = M.ui, Screen = ui.Screen, TopBar = ui.TopBar, Body = ui.Body, FAB = ui.FAB;
  var Core = window.ShepherdingCore;
  var URG = Core.URGENCY_LEVELS, IMP = Core.IMPORTANCE_LEVELS, zoneKey = Core.statusZoneKey;

  var OVER = { fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--on-surface-variant)" };
  var iconBtn = { width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--on-surface-variant)", cursor: "pointer", borderRadius: 8, flexShrink: 0 };
  var inputStyle = { width: "100%", boxSizing: "border-box", padding: "10px 12px", background: "var(--surface-container-low)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", outline: "none", fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--on-surface)" };
  function pill(variant) {
    return { padding: "9px 16px", borderRadius: "var(--radius-full)", border: "none", background: variant === "ghost" ? "transparent" : "var(--primary)", color: variant === "ghost" ? "var(--on-surface-variant)" : "var(--on-primary)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
  }
  var card = { display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "13px 14px", cursor: "pointer", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)" };

  function genId() {
    return (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // ── Pure tree helpers (operate on a structure clone) ─────────
  function getFolderById(root, id) {
    for (var i = 0; i < (root.children || []).length; i++) {
      var c = root.children[i];
      if (c.type === "folder") { if (c.id === id) return c; var f = getFolderById(c, id); if (f) return f; }
    }
    return null;
  }
  function findParent(root, id) {
    for (var i = 0; i < (root.children || []).length; i++) {
      var c = root.children[i];
      if (c.id === id) return root;
      if (c.type === "folder") { var f = findParent(c, id); if (f) return f; }
    }
    return null;
  }
  function removeFromTree(root, id) {
    var idx = (root.children || []).findIndex(function (c) { return c.id === id; });
    if (idx !== -1) { root.children.splice(idx, 1); return true; }
    for (var i = 0; i < (root.children || []).length; i++) {
      if (root.children[i].type === "folder" && removeFromTree(root.children[i], id)) return true;
    }
    return false;
  }
  function getAllDocIds(node) {
    var ids = [];
    (node.children || []).forEach(function (c) {
      if (c.type === "document") ids.push(c.id);
      else if (c.type === "folder") ids = ids.concat(getAllDocIds(c));
    });
    return ids;
  }
  function isDescendant(root, potentialDescId, ancestorId) {
    var anc = getFolderById(root, ancestorId);
    if (!anc) return false;
    return getFolderById(anc, potentialDescId) !== null;
  }
  function getFolderOptions(root, depth, excludeId) {
    var out = [];
    (root.children || []).forEach(function (c) {
      if (c.type === "folder" && c.id !== excludeId) {
        out.push({ id: c.id, name: c.name, depth: depth });
        out = out.concat(getFolderOptions(c, depth + 1, excludeId));
      }
    });
    return out;
  }

  // ── Bottom sheet (shared shell) ──────────────────────────────
  function Sheet(props) {
    return html`<${Fragment}>
      <div onClick=${props.onClose} style=${{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(14,28,54,0.42)", backdropFilter: "blur(1.5px)" }}></div>
      <div style=${{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 51, maxHeight: "80%", background: "var(--surface-container-lowest)", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTop: "1px solid var(--outline-variant)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column" }}>
        <div style=${{ padding: "16px 18px 12px", borderBottom: "1px solid var(--outline-variant)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexShrink: 0 }}>
          <div style=${{ minWidth: 0 }}>
            <div style=${{ fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 600, color: "var(--primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>${props.title}</div>
            ${props.subtitle ? html`<div style=${Object.assign({}, OVER, { fontSize: 10, marginTop: 4 })}>${props.subtitle}</div>` : null}
          </div>
          <button onClick=${props.onClose} aria-label="Close" style=${iconBtn}>${Ic("x", 20)}</button>
        </div>
        <div style=${{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))" }}>${props.children}</div>
      </div>
    </${Fragment}>`;
  }

  // Centered modal (create).
  function Modal(props) {
    return html`<${Fragment}>
      <div onClick=${props.onClose} style=${{ position: "absolute", inset: 0, zIndex: 55, background: "rgba(14,28,54,0.42)", backdropFilter: "blur(1.5px)" }}></div>
      <div style=${{ position: "absolute", left: 16, right: 16, top: "50%", transform: "translateY(-50%)", zIndex: 56, maxHeight: "84%", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: 18, boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style=${{ padding: "16px 18px 12px", borderBottom: "1px solid var(--outline-variant)", flexShrink: 0 }}>
          <h2 style=${{ margin: 0, fontFamily: "var(--font-serif)", fontSize: 19, fontWeight: 600, color: "var(--primary)" }}>${props.title}</h2>
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

  // Compact 3×3 status-zone matrix for the custom care-list filter.
  function ZoneMatrix(props) {
    var cell = 38, labelW = 52;
    var cols = labelW + "px " + cell + "px " + cell + "px " + cell + "px";
    var urgHead = { urgent: "Urg.", somewhat_urgent: "Swht.", not_urgent: "Not" };
    var impRow = { important: "Imp.", somewhat_important: "Swht.", not_important: "Not" };
    var head = { textAlign: "center", fontFamily: "var(--font-sans)", fontSize: 9, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--on-surface-variant)" };
    function style(u, i, sel) {
      if (sel) return { border: "var(--primary)", bg: "var(--primary)", dot: true };
      var s = Core.statusScore(u, i);
      if (s <= 1) return { border: "rgba(179,38,30,0.4)", bg: "rgba(179,38,30,0.10)", dot: false };
      if (s <= 3) return { border: "rgba(62,97,129,0.35)", bg: "rgba(62,97,129,0.10)", dot: false };
      return { border: "var(--outline-variant)", bg: "var(--surface-container)", dot: false };
    }
    return html`<div style=${{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <div style=${{ display: "grid", gridTemplateColumns: cols, gap: 4 }}>
        <div></div>${URG.map(function (u) { return html`<div key=${u} style=${head}>${urgHead[u]}</div>`; })}
      </div>
      ${IMP.map(function (imp) {
        return html`<div key=${imp} style=${{ display: "grid", gridTemplateColumns: cols, gap: 4, alignItems: "center" }}>
          <div style=${{ textAlign: "right", paddingRight: 6, fontFamily: "var(--font-sans)", fontSize: 9, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--on-surface-variant)" }}>${impRow[imp]}</div>
          ${URG.map(function (u) {
            var sel = props.selected(u, imp), st = style(u, imp, sel);
            return html`<button key=${u} onClick=${function () { props.onCell(u, imp); }} style=${{ width: cell, height: cell, border: "2px solid " + st.border, background: st.bg, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", margin: "0 auto" }}>
              ${st.dot ? html`<span style=${{ width: 8, height: 8, borderRadius: "50%", background: "var(--on-primary)" }}></span>` : null}
            </button>`;
          })}
        </div>`;
      })}
    </div>`;
  }

  function fmtDocMeta(doc) {
    if (!doc) return "";
    var ts = doc.updatedAt || doc.createdAt;
    var dateStr = ts ? (ts.toDate ? ts.toDate() : new Date(ts)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
    var who = doc.updatedByName || doc.authorName || "";
    return [who, dateStr].filter(Boolean).join(" · ");
  }

  // ── Document Library ─────────────────────────────────────────
  function DocumentsScreen(props) {
    var loadingS = useState(true), errS = useState(false);
    var structureS = useState({ children: [] }), docsS = useState({});
    var viewsS = useState([]), tagsS = useState([]);
    var pathS = useState([]);
    var renameIdS = useState(null), renameValS = useState("");
    var createS = useState(null); // { type, filterMode, viewId, customTags, customZones }
    var menuS = useState(null);   // item action sheet: the item
    var moveS = useState(null);   // move sheet: the item
    var deleteS = useState(null); // delete confirm: the item
    var toastS = useState(null);

    var structure = structureS[0], docs = docsS[0], views = viewsS[0], tags = tagsS[0], path = pathS[0];
    function showToast(m, t) { toastS[1]({ message: m, type: t || "success" }); setTimeout(function () { toastS[1](null); }, 2600); }

    useEffect(function () {
      var alive = true;
      Promise.all([data.getDocumentStructure(), data.getElderDocuments(), data.getShepherdingViews(), data.getShepherdingTags()])
        .then(function (r) {
          if (!alive) return;
          structureS[1](r[0]);
          var map = {}; r[1].forEach(function (d) { map[d.id] = d; }); docsS[1](map);
          viewsS[1](r[2]); tagsS[1](r[3]); loadingS[1](false);
        })
        .catch(function () { if (alive) { errS[1](true); loadingS[1](false); } });
      return function () { alive = false; };
    }, []);

    function persist(next) { structureS[1](next); data.saveDocumentStructure(next).catch(function () { showToast("Error saving changes", "error"); }); }

    var currentFolder = path.length === 0 ? structure : (getFolderById(structure, path[path.length - 1]) || structure);
    var children = (currentFolder.children || []);
    var folders = children.filter(function (c) { return c.type === "folder"; });
    var docItems = children.filter(function (c) { return c.type === "document"; });

    // Breadcrumb crumbs: Library + each folder in the path.
    var crumbs = [{ id: null, name: "Library" }];
    path.forEach(function (fid) { var f = getFolderById(structure, fid); crumbs.push({ id: fid, name: (f && f.name) || "Folder" }); });

    function navInto(fid) { renameIdS[1](null); pathS[1](path.concat([fid])); }
    function navToCrumb(idx) { renameIdS[1](null); pathS[1](path.slice(0, idx)); } // idx into path (crumb 0 = root)

    function openDoc(id) {
      var d = docs[id];
      if (d && d.docType === "care-list") props.nav("careList", { id: id });
      else props.nav("documentEditor", { id: id });
    }

    // ── Create ──
    function openCreate() {
      createS[1]({ type: "note", filterMode: "preset", viewId: (views[0] && views[0].id) || null, customTags: [], customZones: [] });
    }
    function doCreate() {
      var c = createS[0]; if (!c) return;
      var opts = { type: c.type };
      if (c.type === "care-list") {
        if (c.filterMode === "custom") opts.filterConfig = { filterTags: c.customTags.slice(), filterMode: "any", statusZoneFilters: c.customZones.slice() };
        else { if (!c.viewId) return; opts.filterId = c.viewId; }
      }
      createS[1](null);
      data.createElderDocument(opts, props.user).then(function (id) {
        var d = { id: id, title: opts.title || (c.type === "care-list" ? "New Care List" : "New Document"), docType: c.type, authorName: (props.user && props.user.name) || "" };
        docsS[1](Object.assign({}, docs, (function () { var o = {}; o[id] = d; return o; })()));
        var next = clone(structure);
        var folder = path.length === 0 ? next : (getFolderById(next, path[path.length - 1]) || next);
        if (!folder.children) folder.children = [];
        folder.children.push({ type: "document", id: id });
        structureS[1](next);
        // Route by the type we just created — the docs map closure here is stale
        // (doesn't yet contain the new doc), so don't rely on openDoc's lookup.
        data.saveDocumentStructure(next).then(function () { props.nav(c.type === "care-list" ? "careList" : "documentEditor", { id: id }); })
          .catch(function () { showToast("Error creating document", "error"); });
      }).catch(function () { showToast("Error creating document", "error"); });
    }
    function createFolder() {
      var fid = genId();
      var next = clone(structure);
      var folder = path.length === 0 ? next : (getFolderById(next, path[path.length - 1]) || next);
      if (!folder.children) folder.children = [];
      folder.children.unshift({ type: "folder", id: fid, name: "New Folder", children: [] });
      persist(next);
      renameIdS[1](fid); renameValS[1]("New Folder");
    }

    // ── Rename ──
    function startRename(item) {
      renameValS[1](item.type === "folder" ? item.name : ((docs[item.id] && docs[item.id].title) || "Untitled Document"));
      renameIdS[1](item.id); menuS[1](null);
    }
    function finishRename(item) {
      if (renameIdS[0] !== item.id) return;
      var name = renameValS[0].trim() || (item.type === "folder" ? "New Folder" : "New Document");
      renameIdS[1](null);
      if (item.type === "folder") {
        var next = clone(structure); var f = getFolderById(next, item.id); if (f) f.name = name; persist(next);
      } else {
        docsS[1](Object.assign({}, docs, (function () { var o = {}; o[item.id] = Object.assign({}, docs[item.id], { title: name }); return o; })()));
        data.renameElderDocument(item.id, name, props.user).catch(function () { showToast("Error renaming", "error"); });
      }
    }

    // ── Move ──
    function doMove(item, targetId) {
      moveS[1](null); menuS[1](null);
      if (item.type === "folder" && targetId !== "__root__" && (targetId === item.id || isDescendant(structure, targetId, item.id))) {
        showToast("Cannot move a folder into itself", "error"); return;
      }
      var next = clone(structure);
      var snapshot = item.type === "folder" ? (getFolderById(next, item.id) || { type: "folder", id: item.id, name: item.name, children: [] }) : { type: "document", id: item.id };
      removeFromTree(next, item.id);
      var target = targetId === "__root__" ? next : getFolderById(next, targetId);
      if (!target) { showToast("Error moving item", "error"); return; }
      if (!target.children) target.children = [];
      target.children.push(snapshot);
      persist(next);
      showToast("Moved");
    }

    // ── Delete ──
    function doDelete(item) {
      deleteS[1](null); menuS[1](null);
      var next = clone(structure);
      if (item.type === "document") {
        data.deleteElderDocuments([item.id]);
        var m = Object.assign({}, docs); delete m[item.id]; docsS[1](m);
      } else {
        var folder = getFolderById(structure, item.id);
        var ids = folder ? getAllDocIds(folder) : [];
        if (ids.length) data.deleteElderDocuments(ids);
        var m2 = Object.assign({}, docs); ids.forEach(function (id) { delete m2[id]; }); docsS[1](m2);
      }
      removeFromTree(next, item.id);
      persist(next);
      showToast("Deleted");
    }

    var userKnown = props.user !== undefined;
    var isElder = userKnown && !!props.user && (props.user.permissionLevel === "elder" || props.user.permissionLevel === "super_admin");
    var c = createS[0], menuItem = menuS[0], moveItem = moveS[0], delItem = deleteS[0];
    var folderOptions = moveItem ? getFolderOptions(structure, 0, moveItem.type === "folder" ? moveItem.id : null) : [];

    function renameField(item) {
      return html`<input id=${"rn-" + item.id} value=${renameValS[0]} autoFocus=${true}
        onInput=${function (e) { renameValS[1](e.target.value); }}
        onBlur=${function () { finishRename(item); }}
        onKeyDown=${function (e) { if (e.key === "Enter") finishRename(item); if (e.key === "Escape") renameIdS[1](null); }}
        onClick=${function (e) { e.stopPropagation(); }}
        style=${{ flex: 1, minWidth: 0, border: "none", borderBottom: "1px solid var(--primary)", background: "transparent", outline: "none", fontFamily: "var(--font-serif)", fontSize: 16, fontWeight: 600, color: "var(--on-surface)" }} />`;
    }

    return html`
      <${Screen}>
        <${TopBar} title="Document Library" onBack=${props.back} serif=${false} />
        <${Body} style=${{ paddingBottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}>
          ${!userKnown || loadingS[0] ? html`<div style=${{ display: "flex", justifyContent: "center", padding: "48px 20px", color: "var(--on-surface-variant)" }}><span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 26)}</span></div>`
          : !isElder ? html`<div style=${{ padding: "60px 24px", textAlign: "center", color: "var(--on-surface-variant)" }}><div style=${{ display: "inline-flex", opacity: 0.5 }}>${Ic("shield-alert", 40)}</div><p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, marginTop: 12 }}>Elder-only tools.</p></div>`
          : errS[0] ? html`<div style=${{ padding: "60px 24px", textAlign: "center", color: "var(--on-surface-variant)" }}><p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15 }}>Couldn't load the document library.</p></div>`
          : html`<${Fragment}>
            <div style=${{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, padding: "12px 16px", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--on-surface-variant)" }}>
              ${Ic("folder-open", 15)}
              ${crumbs.map(function (cr, i) {
                var isLast = i === crumbs.length - 1;
                return html`<${Fragment} key=${cr.id || "root"}>
                  ${i > 0 ? html`<span style=${{ color: "var(--outline)" }}>${Ic("chevron-right", 13)}</span>` : null}
                  <button onClick=${function () { navToCrumb(i); }} disabled=${isLast} style=${{ border: "none", background: "transparent", padding: "2px 2px", cursor: isLast ? "default" : "pointer", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: isLast ? 600 : 500, color: isLast ? "var(--on-surface)" : "var(--secondary)" }}>${cr.name}</button>
                </${Fragment}>`;
              })}
            </div>

            ${folders.length ? html`<${Fragment}>
              <div style=${Object.assign({}, OVER, { padding: "0 16px 8px" })}>Folders</div>
              <div style=${{ padding: "0 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                ${folders.map(function (f) {
                  var renaming = renameIdS[0] === f.id;
                  var count = ((getFolderById(structure, f.id) || {}).children || []).length;
                  return html`<div key=${f.id} style=${card}>
                    <span style=${{ color: "var(--secondary)", flexShrink: 0 }} onClick=${function () { if (!renaming) navInto(f.id); }}>${Ic("folder", 22)}</span>
                    ${renaming ? renameField(f) : html`<button onClick=${function () { navInto(f.id); }} style=${{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--font-serif)", fontSize: 16, fontWeight: 600, color: "var(--on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>${f.name}</button>`}
                    ${renaming ? null : html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)", flexShrink: 0 }}>${count}</span>`}
                    <button onClick=${function () { menuS[1](f); }} aria-label="Folder actions" style=${Object.assign({}, iconBtn, { width: 30, height: 30 })}>${Ic("ellipsis-vertical", 18)}</button>
                  </div>`;
                })}
              </div>
            </${Fragment}>` : null}

            <div style=${Object.assign({}, OVER, { padding: "0 16px 8px" })}>Documents</div>
            <div style=${{ padding: "0 16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              ${docItems.length === 0 && folders.length === 0 ? html`<div style=${{ padding: "30px 8px", textAlign: "center", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14, color: "var(--on-surface-variant)" }}>This folder is empty. Use “New” to add a document or folder.</div>`
                : docItems.length === 0 ? html`<div style=${{ padding: "8px", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13.5, color: "var(--on-surface-variant)" }}>No documents here.</div>`
                : docItems.map(function (it) {
                  var d = docs[it.id] || { title: "Untitled Document", docType: "note" };
                  var renaming = renameIdS[0] === it.id;
                  var isCare = d.docType === "care-list";
                  return html`<div key=${it.id} style=${card}>
                    <span style=${{ width: 38, height: 38, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-container)", color: "var(--primary)" }} onClick=${function () { if (!renaming) openDoc(it.id); }}>${Ic(isCare ? "table-2" : "file-text", 18)}</span>
                    <div style=${{ flex: 1, minWidth: 0 }} onClick=${function () { if (!renaming) openDoc(it.id); }}>
                      ${renaming ? renameField(it) : html`<${Fragment}>
                        <div style=${{ fontFamily: "var(--font-serif)", fontSize: 15.5, fontWeight: 600, color: "var(--on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>${d.title}</div>
                        <div style=${{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                          <span style=${{ padding: "1px 7px", borderRadius: "var(--radius-sm)", background: isCare ? "var(--primary-fixed)" : "var(--surface-container)", color: isCare ? "var(--primary)" : "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>${isCare ? "Care List" : "Note"}</span>
                          <span style=${{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>${fmtDocMeta(d)}</span>
                        </div>
                      </${Fragment}>`}
                    </div>
                    <button onClick=${function () { menuS[1](it); }} aria-label="Document actions" style=${Object.assign({}, iconBtn, { width: 30, height: 30 })}>${Ic("ellipsis-vertical", 18)}</button>
                  </div>`;
                })}
            </div>
          </${Fragment}>`}
        </${Body}>

        ${isElder && !loadingS[0] ? html`<${FAB} icon="plus" label="New document" onClick=${openCreate} />` : null}

        ${menuItem ? html`<${Sheet} title=${menuItem.type === "folder" ? menuItem.name : ((docs[menuItem.id] && docs[menuItem.id].title) || "Document")} subtitle=${menuItem.type === "folder" ? "Folder" : "Document"} onClose=${function () { menuS[1](null); }}>
          ${[
            ["pencil", "Rename", function () { startRename(menuItem); }],
            ["folder-input", "Move", function () { menuS[1](null); moveS[1](menuItem); }],
            ["trash-2", "Delete", function () { menuS[1](null); deleteS[1](menuItem); }],
          ].map(function (row) {
            var danger = row[0] === "trash-2";
            return html`<button key=${row[1]} onClick=${row[2]} style=${{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", border: "none", borderBottom: "1px solid var(--outline-variant)", background: "transparent", cursor: "pointer", textAlign: "left", color: danger ? "var(--error)" : "var(--on-surface)", fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 500 }}>${Ic(row[0], 19)} ${row[1]}</button>`;
          })}
        </${Sheet}>` : null}

        ${moveItem ? html`<${Sheet} title="Move “${moveItem.type === "folder" ? moveItem.name : ((docs[moveItem.id] && docs[moveItem.id].title) || "Document")}”" subtitle="Pick a destination" onClose=${function () { moveS[1](null); }}>
          <button onClick=${function () { doMove(moveItem, "__root__"); }} style=${{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", border: "none", borderBottom: "1px solid var(--outline-variant)", background: "transparent", cursor: "pointer", textAlign: "left", color: "var(--on-surface)", fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600 }}>${Ic("home", 18)} Library (root)</button>
          ${folderOptions.length === 0 ? html`<div style=${{ padding: "16px 18px", fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)" }}>No other folders yet.</div>`
            : folderOptions.map(function (o) {
              return html`<button key=${o.id} onClick=${function () { doMove(moveItem, o.id); }} style=${{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", paddingLeft: (18 + o.depth * 16) + "px", border: "none", borderBottom: "1px solid var(--outline-variant)", background: "transparent", cursor: "pointer", textAlign: "left", color: "var(--on-surface)", fontFamily: "var(--font-sans)", fontSize: 15 }}>${Ic("folder", 18)} ${o.name}</button>`;
            })}
        </${Sheet}>` : null}

        ${delItem ? html`<${Modal} title="Delete ${delItem.type === "folder" ? "folder" : "document"}?"
          onClose=${function () { deleteS[1](null); }}
          footer=${html`<${Fragment}><button onClick=${function () { deleteS[1](null); }} style=${pill("ghost")}>Cancel</button><button onClick=${function () { doDelete(delItem); }} style=${Object.assign({}, pill(), { background: "var(--error)" })}>Delete</button></${Fragment}>`}>
          <p style=${{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 14, lineHeight: 1.5, color: "var(--on-surface)" }}>
            ${delItem.type === "folder"
              ? html`Delete <strong>${delItem.name}</strong> and its ${(function () { var f = getFolderById(structure, delItem.id); return f ? getAllDocIds(f).length : 0; })()} document(s)? This cannot be undone.`
              : html`Delete <strong>${(docs[delItem.id] && docs[delItem.id].title) || "this document"}</strong>? This cannot be undone.`}
          </p>
        </${Modal}>` : null}

        ${c ? html`<${Modal} title="New Document" onClose=${function () { createS[1](null); }}
          footer=${html`<${Fragment}><button onClick=${function () { createS[1](null); }} style=${pill("ghost")}>Cancel</button><button onClick=${doCreate} disabled=${c.type === "care-list" && c.filterMode === "preset" && !c.viewId} style=${Object.assign({}, pill(), { opacity: (c.type === "care-list" && c.filterMode === "preset" && !c.viewId) ? 0.5 : 1 })}>Create</button></${Fragment}>`}>
          <div style=${{ display: "flex", gap: 10, marginBottom: 16 }}>
            ${[["note", "file-text", "Document", "Free-form elder notes."], ["care-list", "table-2", "Care List", "Filter-driven care table."]].map(function (opt) {
              var on = c.type === opt[0];
              return html`<button key=${opt[0]} onClick=${function () { createS[1](Object.assign({}, c, { type: opt[0] })); }} style=${{ flex: 1, textAlign: "left", padding: "14px 13px", borderRadius: "var(--radius-xl)", cursor: "pointer", border: on ? "2px solid var(--primary)" : "1px solid var(--outline-variant)", background: on ? "var(--primary-fixed)" : "var(--surface-container-lowest)" }}>
                <span style=${{ color: "var(--primary)", display: "inline-flex" }}>${Ic(opt[1], 22)}</span>
                <div style=${{ fontFamily: "var(--font-serif)", fontSize: 15, fontWeight: 600, color: "var(--on-surface)", marginTop: 8 }}>${opt[2]}</div>
                <div style=${{ fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--on-surface-variant)", marginTop: 2, lineHeight: 1.35 }}>${opt[3]}</div>
              </button>`;
            })}
          </div>
          ${c.type === "care-list" ? html`<div>
            <div style=${{ display: "flex", background: "var(--surface-container)", borderRadius: "var(--radius)", padding: 3, border: "1px solid var(--outline-variant)", marginBottom: 12 }}>
              ${[["preset", "Saved view"], ["custom", "Custom filter"]].map(function (o) {
                var on = c.filterMode === o[0];
                return html`<button key=${o[0]} onClick=${function () { createS[1](Object.assign({}, c, { filterMode: o[0] })); }} style=${{ flex: 1, padding: "7px 6px", border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600, background: on ? "var(--surface-container-lowest)" : "transparent", color: on ? "var(--primary)" : "var(--on-surface-variant)", boxShadow: on ? "var(--shadow-xs)" : "none" }}>${o[1]}</button>`;
              })}
            </div>
            ${c.filterMode === "preset" ? html`<${Fragment}>
              <div style=${Object.assign({}, OVER, { fontSize: 10, marginBottom: 8 })}>Drive rows from a Filtered View</div>
              ${views.length === 0 ? html`<div style=${{ fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)" }}>No saved views yet. Create one on the Shepherd Dashboard, or use a custom filter.</div>`
                : html`<div style=${{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                  ${views.map(function (v) {
                    var on = c.viewId === v.id;
                    return html`<button key=${v.id} onClick=${function () { createS[1](Object.assign({}, c, { viewId: v.id })); }} style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "11px 13px", borderRadius: "var(--radius)", cursor: "pointer", border: on ? "2px solid var(--primary)" : "1px solid var(--outline-variant)", background: "var(--surface-container-lowest)" }}>
                      <span style=${{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 500, color: "var(--on-surface)" }}>${v.title}</span>
                      ${on ? html`<span style=${{ color: "var(--primary)", display: "inline-flex" }}>${Ic("check", 16)}</span>` : null}
                    </button>`;
                  })}
                </div>`}
            </${Fragment}>` : html`<${Fragment}>
              <div style=${Object.assign({}, OVER, { fontSize: 10, marginBottom: 8 })}>Filter by tags</div>
              ${tags.length === 0 ? html`<div style=${{ fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)", marginBottom: 12 }}>No tags yet.</div>`
                : html`<div style=${{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                  ${tags.map(function (t) {
                    var on = c.customTags.indexOf(t.id) !== -1;
                    return html`<button key=${t.id} onClick=${function () { createS[1](Object.assign({}, c, { customTags: on ? c.customTags.filter(function (x) { return x !== t.id; }) : c.customTags.concat([t.id]) })); }} style=${{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: "var(--radius-full)", cursor: "pointer", border: on ? "none" : "1px solid var(--outline-variant)", background: on ? "var(--primary)" : "var(--surface-container)", color: on ? "var(--on-primary)" : "var(--on-surface)", fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 500 }}>${t.name}${on ? Ic("check", 13) : null}</button>`;
                  })}
                </div>`}
              <div style=${Object.assign({}, OVER, { fontSize: 10, marginBottom: 8 })}>Filter by status</div>
              <${ZoneMatrix}
                selected=${function (u, i) { return c.customZones.indexOf(zoneKey(u, i)) !== -1; }}
                onCell=${function (u, i) { var k = zoneKey(u, i); createS[1](Object.assign({}, c, { customZones: c.customZones.indexOf(k) !== -1 ? c.customZones.filter(function (x) { return x !== k; }) : c.customZones.concat([k]) })); }}
              />
            </${Fragment}>`}
          </div>` : html`<div style=${{ display: "flex", justifyContent: "flex-start" }}>
            <button onClick=${function () { createS[1](null); createFolder(); }} style=${{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", border: "1px dashed var(--outline-variant)", borderRadius: "var(--radius)", background: "transparent", color: "var(--secondary)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600 }}>${Ic("folder-plus", 16)} Create a folder instead</button>
          </div>`}
        </${Modal}>` : null}

        <${Toast} toast=${toastS[0]} />
      </${Screen}>`;
  }

  M.SCREENS = Object.assign(M.SCREENS || {}, { documents: DocumentsScreen });
})();
