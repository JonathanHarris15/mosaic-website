/* ============================================================
   screens-document-editor.js — native Elder Document (note) editor for
   the mobile shell. Full-fidelity port of the desktop editor
   (shepherding-document.js): a real TipTap document bound to
   elder_documents/{id}.contentJson, with linked Person Panels (each a
   nested editor over a person's shepherding_note, with inline #/-#/$$
   triggers + a status matrix), a `/` slash picker to insert panels,
   grouped @-mentions (people/notes/docs/folders), auto-save, panel
   delete/unlink, cross-tab sync and orphan recovery.

   Uses the offline TipTap bundle (M.ensureTipTap) + the shared
   inline-triggers extension, exactly like screens-carelist.js, so
   contentJson stays byte-compatible with the desktop pages.
   ============================================================ */
(function () {
  "use strict";
  var html = M.html, Ic = M.Ic, data = M.data, Fragment = M.Fragment;
  var useState = M.hooks.useState, useEffect = M.hooks.useEffect, useRef = M.hooks.useRef;
  var ui = M.ui, Screen = ui.Screen, TopBar = ui.TopBar, Body = ui.Body;

  // ── Module-level state (one editor active at a time, like desktop) ──────────
  var _docEditor = null;
  // Loaded doc kept outside component state (the editor reads it once at mount).
  var _docLoaded = {};
  var _currentDocId = null, _currentDocTitle = "", _user = null, _nav = null;
  var _mentionPeople = [], _mentionNotes = [], _mentionDocs = [], _mentionFolders = [];
  var _peopleList = [], _docTypeById = {}, _allTagsList = [];
  var NOTE_TYPES_ALL = ["Elder Check-in", "Elder Interview", "Elder Meeting", "Life Update", "Prayer Request", "Other", "Create New Note Type"];

  function computeHidden(tagIds) {
    var hidden = {}; _allTagsList.forEach(function (t) { if (t.hidePeople) hidden[t.id] = true; });
    return (tagIds || []).some(function (id) { return !!hidden[id]; });
  }

  // ── One-time editor content CSS (mobile shell has no ProseMirror styles) ────
  function injectStyles() {
    if (document.getElementById("doc-editor-styles")) return;
    var css = ""
      + ".doc-pm .ProseMirror{outline:none;min-height:100%;box-sizing:border-box;font-family:var(--font-serif);font-size:16px;line-height:1.6;color:var(--on-surface);}"
      + ".doc-pm .ProseMirror p{margin:0 0 0.5em;} .doc-pm .ProseMirror p:last-child{margin-bottom:0;}"
      + ".doc-pm .ProseMirror ul{list-style:disc;padding-left:1.5em;margin-bottom:0.5em;} .doc-pm .ProseMirror ol{list-style:decimal;padding-left:1.5em;margin-bottom:0.5em;} .doc-pm .ProseMirror li p{margin:0;}"
      + ".doc-pm .ProseMirror blockquote{border-left:3px solid var(--outline-variant);margin:0 0 0.5em;padding-left:12px;color:var(--on-surface-variant);}"
      + ".doc-pm .mention-chip{display:inline;background:var(--primary-fixed);color:var(--primary);border-radius:3px;padding:0 4px;font-weight:500;text-decoration:none;cursor:pointer;}"
      + ".doc-pm .ProseMirror table{border-collapse:collapse;width:100%;margin-bottom:0.5em;table-layout:fixed;} .doc-pm .ProseMirror th,.doc-pm .ProseMirror td{border:1px solid var(--outline-variant);padding:4px 8px;min-width:50px;vertical-align:top;} .doc-pm .ProseMirror th{background:var(--surface-container);font-weight:600;}"
      + ".person-panel{border:1px solid var(--primary-fixed-dim,#b2c6f8);border-radius:8px;margin:10px 0;overflow:hidden;display:block;background:var(--surface-container-low);}"
      + ".person-panel-header{background:var(--primary-fixed);border-bottom:1px solid var(--outline-variant);padding:7px 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}"
      + ".person-panel-name{font-family:var(--font-sans);font-size:13px;font-weight:600;color:var(--primary);background:transparent;border:none;cursor:pointer;padding:2px 6px;border-radius:4px;white-space:nowrap;}"
      + ".person-panel-type{font-family:var(--font-sans);font-size:12px;color:var(--on-surface-variant);background:var(--surface-container-lowest);border:1px solid var(--outline-variant);border-radius:4px;padding:3px 4px;cursor:pointer;}"
      + ".person-panel-status{font-family:var(--font-sans);font-size:12px;color:var(--on-surface-variant);background:transparent;border:1px solid var(--outline-variant);border-radius:4px;padding:3px 6px;cursor:pointer;white-space:nowrap;}"
      + ".person-panel-view-link{font-family:var(--font-sans);font-size:12px;color:var(--secondary);text-decoration:none;margin-left:auto;white-space:nowrap;cursor:pointer;}"
      + ".person-panel-delete{background:transparent;border:none;cursor:pointer;color:var(--on-surface-variant);padding:2px;display:flex;align-items:center;line-height:1;flex-shrink:0;}"
      + ".person-panel-body{background:var(--surface-container-lowest);} .person-panel-body .ProseMirror{min-height:72px;padding:12px;box-sizing:border-box;font-family:var(--font-serif);font-size:14.5px;line-height:1.55;color:var(--on-surface);}";
    var el = document.createElement("style"); el.id = "doc-editor-styles"; el.textContent = css;
    document.head.appendChild(el);
  }

  // ── Grouped @-mention suggestion (self-built popup) ─────────────────────────
  function createDocMentionSuggestion() {
    return {
      items: function (o) {
        var q = (o.query || "").toLowerCase();
        var match = function (arr) { return arr.filter(function (i) { return i.label.toLowerCase().indexOf(q) !== -1; }); };
        return [].concat(match(_mentionPeople), match(_mentionNotes), match(_mentionDocs), match(_mentionFolders)).slice(0, 30);
      },
      render: function () {
        var popup = null, selectedIndex = 0, currentProps = null;
        function getKind(item) { try { return JSON.parse(item.id).kind; } catch (e) { return "unknown"; } }
        function buildGrouped(items) {
          var groups = { person: [], note: [], elder_document: [], elder_folder: [] };
          items.forEach(function (item) { var k = getKind(item); (groups[k] || groups.elder_document).push(item); });
          var out = [];
          if (groups.person.length) { out.push({ _hdr: "People" }); out = out.concat(groups.person); }
          if (groups.note.length) { out.push({ _hdr: "Notes" }); out = out.concat(groups.note); }
          if (groups.elder_document.length) { out.push({ _hdr: "Documents" }); out = out.concat(groups.elder_document); }
          if (groups.elder_folder.length) { out.push({ _hdr: "Folders" }); out = out.concat(groups.elder_folder); }
          return out;
        }
        function redraw(items, rect, selIdx, command) {
          if (!popup) {
            popup = document.createElement("div");
            popup.style.cssText = 'position:fixed;z-index:9999;background:var(--surface-container-lowest,#fff);border:1px solid var(--outline-variant,#c5c6d0);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:220px;max-height:280px;overflow-y:auto;padding:4px 0;font-family:var(--font-sans);font-size:14px;';
            document.body.appendChild(popup);
          }
          if (rect) { var r = typeof rect === "function" ? rect() : rect; if (r) { popup.style.left = Math.min(r.left, window.innerWidth - 240) + "px"; popup.style.top = (r.bottom + 4) + "px"; } }
          popup.innerHTML = "";
          if (!items.length) { var e = document.createElement("div"); e.style.cssText = "padding:8px 16px;color:var(--on-surface-variant,#75777f);font-style:italic;"; e.textContent = "No matches"; popup.appendChild(e); return; }
          var grouped = buildGrouped(items), si = 0;
          grouped.forEach(function (entry) {
            if (entry._hdr) {
              var h = document.createElement("div");
              h.style.cssText = "padding:4px 16px 2px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--on-surface-variant,#75777f);";
              h.textContent = entry._hdr; popup.appendChild(h);
            } else {
              var myI = si++;
              var b = document.createElement("button"); b.type = "button";
              b.style.cssText = "display:block;width:100%;text-align:left;padding:6px 16px;cursor:pointer;border:none;background:" + (myI === selIdx ? "var(--primary-fixed,#d8e2ff)" : "transparent") + ";color:var(--on-surface,#1c1c18);font-size:14px;font-family:inherit;";
              b.textContent = entry.label;
              b.addEventListener("mousedown", function (ev) { ev.preventDefault(); command(entry); });
              popup.appendChild(b);
            }
          });
        }
        return {
          onStart: function (p) { currentProps = p; selectedIndex = 0; redraw(p.items, p.clientRect, selectedIndex, p.command); },
          onUpdate: function (p) { currentProps = p; selectedIndex = 0; redraw(p.items, p.clientRect, selectedIndex, p.command); },
          onKeyDown: function (o) {
            if (!currentProps) return false;
            var total = currentProps.items.length;
            if (o.event.key === "Escape") { if (popup) { popup.remove(); popup = null; } return true; }
            if (!total) return false;
            if (o.event.key === "ArrowUp") { selectedIndex = (selectedIndex - 1 + total) % total; redraw(currentProps.items, null, selectedIndex, currentProps.command); return true; }
            if (o.event.key === "ArrowDown") { selectedIndex = (selectedIndex + 1) % total; redraw(currentProps.items, null, selectedIndex, currentProps.command); return true; }
            if (o.event.key === "Enter") { if (currentProps.items[selectedIndex]) currentProps.command(currentProps.items[selectedIndex]); return true; }
            return false;
          },
          onExit: function () { if (popup) { popup.remove(); popup = null; } currentProps = null; },
        };
      },
    };
  }

  // ── `/` slash picker: type / → Person Note → search person → insert panel ───
  function createInlinePickerPlugin() {
    var T = window._TipTap;
    var Extension = T.Extension, Plugin = T.Plugin, PluginKey = T.PluginKey;
    var pickerKey = new PluginKey("inlinePicker");
    var ps = null, popup = null, edView = null;
    var COMMANDS = [{ id: "person", title: "Person Note", description: "Insert a linked Shepherding Note", icon: "user-round-plus" }];

    function getQuery() {
      if (!ps || !edView) return "";
      var cur = edView.state.selection.from, from = ps.phaseStart;
      if (cur <= from) return "";
      try { return edView.state.doc.textBetween(from, Math.min(cur, edView.state.doc.content.size)); } catch (e) { return ""; }
    }
    function getItems() {
      if (!ps) return [];
      var q = getQuery().toLowerCase().trim();
      if (ps.phase === "command") return COMMANDS.filter(function (c) { return c.title.toLowerCase().indexOf(q) !== -1 || c.id.indexOf(q) !== -1; });
      if (ps.phase === "person") return _peopleList.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 8).map(function (p) { return { id: p.id, title: p.name }; });
      return [];
    }
    function reset() { ps = null; if (popup) { popup.remove(); popup = null; } }
    function draw() {
      if (!ps || !edView) { if (popup) { popup.remove(); popup = null; } return; }
      var items = getItems();
      if (!popup) {
        popup = document.createElement("div");
        popup.style.cssText = 'position:fixed;z-index:9999;background:var(--surface-container-lowest,#fff);color:var(--on-surface,#1c1c18);border:1px solid var(--outline-variant,#c5c6d0);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.14);min-width:240px;padding:4px 0;font-family:var(--font-sans);font-size:14px;';
        document.body.appendChild(popup);
      }
      try { var coords = edView.coordsAtPos(edView.state.selection.from); popup.style.left = Math.min(coords.left, window.innerWidth - 260) + "px"; popup.style.top = (coords.bottom + 6) + "px"; } catch (e) {}
      popup.innerHTML = "";
      var labels = { command: "Insert", person: "Select person" };
      var hdr = document.createElement("div");
      hdr.style.cssText = "padding:4px 16px 2px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--on-surface-variant,#75777f);";
      hdr.textContent = labels[ps.phase] || "Insert"; popup.appendChild(hdr);
      if (!items.length) { var el = document.createElement("div"); el.style.cssText = "padding:8px 16px;color:var(--on-surface-variant,#75777f);font-style:italic;"; el.textContent = ps.phase === "person" ? "No people found" : "No matches"; popup.appendChild(el); return; }
      items.forEach(function (item, i) {
        var sel = i === ps.selectedIndex;
        var btn = document.createElement("button"); btn.type = "button";
        btn.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 16px;cursor:pointer;border:none;background:" + (sel ? "var(--primary-fixed,#d8e2ff)" : "transparent") + ";";
        var txt = document.createElement("div");
        var ttl = document.createElement("div"); ttl.style.cssText = "font-weight:600;color:var(--on-surface,#1c1c18);font-size:14px;font-family:inherit;"; ttl.textContent = item.title; txt.appendChild(ttl);
        if (item.description) { var dsc = document.createElement("div"); dsc.style.cssText = "font-size:12px;color:var(--on-surface-variant,#75777f);font-family:inherit;"; dsc.textContent = item.description; txt.appendChild(dsc); }
        btn.appendChild(txt);
        btn.addEventListener("mousedown", function (e) { e.preventDefault(); pick(item); });
        popup.appendChild(btn);
      });
    }
    function pick(item) {
      if (!ps || !edView) return;
      if (ps.phase === "command") { ps.phase = "person"; ps.phaseStart = edView.state.selection.from; ps.selectedIndex = 0; draw(); return; }
      if (ps.phase === "person") {
        var person = { id: item.id, name: item.title };
        var triggerFrom = ps.triggerFrom, view = edView;
        reset();
        data.addPanelNote(person.id, { type: "Elder Meeting", sourceDocumentId: _currentDocId }, _user).then(function (noteId) {
          var state = view.state;
          var maxPos = state.doc.content.size;
          var from = Math.min(Math.max(0, triggerFrom), maxPos);
          var to = Math.min(Math.max(from, view.state.selection.from), maxPos);
          var panelNode = state.schema.nodes.personPanel.create({ personId: person.id, noteId: noteId, personName: person.name, noteType: "Elder Meeting" });
          view.dispatch(state.tr.replaceWith(from, to, panelNode));
        }).catch(function (e) { console.error("Error inserting panel:", e); });
      }
    }
    return Extension.create({
      name: "inlinePicker",
      addProseMirrorPlugins: function () {
        return [new Plugin({
          key: pickerKey,
          view: function (v) {
            edView = v;
            return {
              update: function (v2) {
                if (!ps) { if (popup) { popup.remove(); popup = null; } return; }
                var cur = v2.state.selection.from;
                if (cur <= ps.triggerFrom) { reset(); return; }
                var sz = v2.state.doc.content.size;
                if (ps.triggerFrom >= sz) { reset(); return; }
                var ch = v2.state.doc.textBetween(ps.triggerFrom, Math.min(ps.triggerFrom + 1, sz));
                if (ch !== "/") { reset(); return; }
                draw();
              },
              destroy: function () { reset(); edView = null; },
            };
          },
          props: {
            handleKeyDown: function (v, e) {
              if (!ps) return false;
              var items = getItems();
              if (e.key === "Escape") { reset(); return true; }
              if (e.key === "ArrowUp") { if (items.length) { ps.selectedIndex = (ps.selectedIndex - 1 + items.length) % items.length; draw(); } return true; }
              if (e.key === "ArrowDown") { if (items.length) { ps.selectedIndex = (ps.selectedIndex + 1) % items.length; draw(); } return true; }
              if (e.key === "Enter") { if (items[ps.selectedIndex]) pick(items[ps.selectedIndex]); return true; }
              if (e.key === " " && ps.phase === "command") { if (items[ps.selectedIndex]) { pick(items[ps.selectedIndex]); return true; } reset(); return false; }
              if (e.key === "Backspace" && getQuery().length === 0) { reset(); return false; }
              return false;
            },
            handleTextInput: function (v, from, to, text) {
              if (!ps && text === "/") {
                var preceding = from > 0 ? v.state.doc.textBetween(Math.max(0, from - 1), from) : "";
                if (!preceding || preceding === " ") {
                  setTimeout(function () {
                    if (!edView) return;
                    var cur = edView.state.selection.from;
                    ps = { phase: "command", triggerFrom: cur - 1, phaseStart: cur, selectedIndex: 0 };
                    draw();
                  }, 0);
                }
              }
              return false;
            },
          },
        })];
      },
    });
  }

  // ── Person Panel NodeView (nested editor bound to a shepherding_note) ───────
  function makePersonPanelNodeView(nvProps) {
    var node = nvProps.node, getPos = nvProps.getPos, editor = nvProps.editor;
    var currentAttrs = Object.assign({}, node.attrs);
    var Core = window.ShepherdingCore;
    var UL = Core.URGENCY_LEVELS, IL = Core.IMPORTANCE_LEVELS;
    var ULbl = Core.URGENCY_LABEL_SHORT, ILbl = Core.IMPORTANCE_LABEL_SHORT;

    var dom = document.createElement("div"); dom.className = "person-panel"; dom.contentEditable = "false";
    var header = document.createElement("div"); header.className = "person-panel-header";

    var nameBtn = document.createElement("button"); nameBtn.type = "button"; nameBtn.className = "person-panel-name";
    nameBtn.textContent = node.attrs.personName || "Unknown Person"; nameBtn.title = "Change person";
    nameBtn.addEventListener("mousedown", function (e) {
      e.preventDefault(); e.stopPropagation();
      document.dispatchEvent(new CustomEvent("open-person-picker", { detail: { mode: "reattach", pos: getPos(), currentPersonId: currentAttrs.personId, currentNoteId: currentAttrs.noteId } }));
    });

    var typeSelect = document.createElement("select"); typeSelect.className = "person-panel-type";
    function fillTypes() {
      typeSelect.innerHTML = "";
      NOTE_TYPES_ALL.forEach(function (t) { var opt = document.createElement("option"); opt.value = t; opt.textContent = t; if (t === (currentAttrs.noteType || "Elder Meeting")) opt.selected = true; typeSelect.appendChild(opt); });
    }
    fillTypes();
    typeSelect.addEventListener("change", function (e) {
      e.stopPropagation();
      var newType = typeSelect.value;
      if (newType === "Create New Note Type") {
        var prompted = window.prompt("Enter new note type:");
        if (prompted && prompted.trim()) { newType = prompted.trim(); if (NOTE_TYPES_ALL.indexOf(newType) === -1) { var base = NOTE_TYPES_ALL.filter(function (t) { return t !== "Create New Note Type"; }); NOTE_TYPES_ALL = base.concat([newType, "Create New Note Type"]); } }
        else { typeSelect.value = currentAttrs.noteType || "Elder Meeting"; return; }
      }
      if (typeof getPos === "function") editor.view.dispatch(editor.view.state.tr.setNodeMarkup(getPos(), null, Object.assign({}, currentAttrs, { noteType: newType })));
      data.updatePanelNoteType(currentAttrs.personId, currentAttrs.noteId, newType, _user).catch(function (err) { console.error("Error updating note type:", err); });
    });

    var panelCurrentStatus = null, panelPersonTags = [], statusMatrixPopup = null;
    var statusBtn = document.createElement("button"); statusBtn.type = "button"; statusBtn.className = "person-panel-status"; statusBtn.title = "Set pastoral status";
    function updatePanelStatusDisplay() {
      if (panelCurrentStatus) { statusBtn.textContent = (ULbl[panelCurrentStatus.urgency] || "") + " · " + (ILbl[panelCurrentStatus.importance] || ""); statusBtn.style.color = "var(--secondary)"; }
      else { statusBtn.textContent = "Set status"; statusBtn.style.color = "var(--on-surface-variant)"; }
    }
    function loadPanelPersonData(personId) {
      return data.getPerson(personId).then(function (p) { if (p) { panelCurrentStatus = p.shepherdingStatus || null; panelPersonTags = p.tags || []; } updatePanelStatusDisplay(); }).catch(function (e) { console.error(e); });
    }
    function destroyStatusPopup() { if (statusMatrixPopup) { statusMatrixPopup.remove(); statusMatrixPopup = null; } }
    function handlePanelStatusSet(urg, imp) {
      var clearing = panelCurrentStatus && panelCurrentStatus.urgency === urg && panelCurrentStatus.importance === imp;
      var previousStatus = panelCurrentStatus, newStatus = clearing ? null : { urgency: urg, importance: imp };
      destroyStatusPopup();
      return data.setShepherdingStatus(currentAttrs.personId, newStatus, previousStatus, _user, "document", _currentDocId)
        .then(function (activityId) { panelCurrentStatus = newStatus; updatePanelStatusDisplay(); return activityId; })
        .catch(function (e) { console.error("Error setting panel status:", e); });
    }
    function handlePanelStatusClear() {
      if (!panelCurrentStatus) return Promise.resolve();
      var previousStatus = panelCurrentStatus; destroyStatusPopup();
      return data.setShepherdingStatus(currentAttrs.personId, null, previousStatus, _user, "document", _currentDocId)
        .then(function (activityId) { panelCurrentStatus = null; updatePanelStatusDisplay(); return activityId; })
        .catch(function (e) { console.error("Error clearing panel status:", e); });
    }
    function handlePanelStatusUndo(activityId, prevU, prevI) {
      var prev = (prevU && prevI) ? { urgency: prevU, importance: prevI } : null;
      return data.revertShepherdingStatus(currentAttrs.personId, prev, activityId).then(function () { panelCurrentStatus = prev; updatePanelStatusDisplay(); }).catch(function (e) { console.error(e); });
    }
    function showStatusMatrixPopup(e) {
      e.preventDefault(); e.stopPropagation();
      if (statusMatrixPopup) { destroyStatusPopup(); return; }
      statusMatrixPopup = document.createElement("div");
      statusMatrixPopup.style.cssText = 'position:fixed;z-index:9999;background:var(--surface-container-lowest,#fff);border:1px solid var(--outline-variant,#c5c6d0);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:10px;font-family:var(--font-sans);font-size:12px;';
      var headerRow = document.createElement("div"); headerRow.style.cssText = "display:grid;grid-template-columns:44px 44px 44px 44px;gap:3px;margin-bottom:3px;";
      headerRow.appendChild(document.createElement("div"));
      UL.forEach(function (u) { var h = document.createElement("div"); h.style.cssText = "text-align:center;font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--on-surface-variant,#75777f);padding-bottom:2px;"; h.textContent = ULbl[u].slice(0, 3); headerRow.appendChild(h); });
      statusMatrixPopup.appendChild(headerRow);
      IL.forEach(function (imp) {
        var row = document.createElement("div"); row.style.cssText = "display:grid;grid-template-columns:44px 44px 44px 44px;gap:3px;margin-bottom:3px;";
        var rowLabel = document.createElement("div"); rowLabel.style.cssText = "display:flex;align-items:center;justify-content:flex-end;padding-right:4px;font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--on-surface-variant,#75777f);line-height:1.2;text-align:right;"; rowLabel.textContent = ILbl[imp].slice(0, 3); row.appendChild(rowLabel);
        UL.forEach(function (urg) {
          var isActive = panelCurrentStatus && panelCurrentStatus.urgency === urg && panelCurrentStatus.importance === imp;
          var cell = document.createElement("button"); cell.type = "button";
          cell.style.cssText = "width:44px;height:44px;border-radius:6px;border:2px solid " + (isActive ? "#182F57" : "var(--outline-variant,#c5c6d0)") + ";background:" + (isActive ? "#182F57" : "transparent") + ";cursor:pointer;display:flex;align-items:center;justify-content:center;";
          if (isActive) { var dot = document.createElement("span"); dot.style.cssText = "width:8px;height:8px;border-radius:50%;background:#fff;display:block;"; cell.appendChild(dot); }
          cell.addEventListener("mousedown", function (e2) { e2.preventDefault(); e2.stopPropagation(); handlePanelStatusSet(urg, imp); });
          row.appendChild(cell);
        });
        statusMatrixPopup.appendChild(row);
      });
      if (panelCurrentStatus) {
        var clearBtn = document.createElement("button"); clearBtn.type = "button";
        clearBtn.style.cssText = "width:100%;margin-top:6px;padding:4px 8px;font-size:11px;font-family:inherit;color:var(--on-surface-variant,#75777f);background:transparent;border:none;cursor:pointer;text-align:center;";
        clearBtn.textContent = "Clear status";
        clearBtn.addEventListener("mousedown", function (e2) { e2.preventDefault(); e2.stopPropagation(); handlePanelStatusSet(panelCurrentStatus.urgency, panelCurrentStatus.importance); });
        statusMatrixPopup.appendChild(clearBtn);
      }
      var rect = statusBtn.getBoundingClientRect();
      statusMatrixPopup.style.top = (rect.bottom + 4) + "px"; statusMatrixPopup.style.left = Math.min(rect.left, window.innerWidth - 210) + "px";
      document.body.appendChild(statusMatrixPopup);
      var closeOnOutside = function (ev) { if (statusMatrixPopup && !statusMatrixPopup.contains(ev.target) && ev.target !== statusBtn) { destroyStatusPopup(); document.removeEventListener("mousedown", closeOnOutside); } };
      setTimeout(function () { document.addEventListener("mousedown", closeOnOutside); }, 0);
    }
    statusBtn.addEventListener("mousedown", showStatusMatrixPopup);
    updatePanelStatusDisplay(); loadPanelPersonData(node.attrs.personId);

    var viewLink = document.createElement("span"); viewLink.className = "person-panel-view-link"; viewLink.textContent = "View profile →";
    viewLink.addEventListener("mousedown", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (_nav) _nav("shepherdProfile", { id: currentAttrs.personId, from: "document" });
    });

    var deleteBtn = document.createElement("button"); deleteBtn.type = "button"; deleteBtn.className = "person-panel-delete"; deleteBtn.title = "Remove panel";
    deleteBtn.innerHTML = "&#10005;";
    deleteBtn.addEventListener("mousedown", function (e) {
      e.preventDefault(); e.stopPropagation();
      document.dispatchEvent(new CustomEvent("panel-delete-request", { detail: { pos: getPos(), personId: currentAttrs.personId, noteId: currentAttrs.noteId, personName: currentAttrs.personName } }));
    });

    header.appendChild(nameBtn); header.appendChild(typeSelect); header.appendChild(statusBtn); header.appendChild(viewLink); header.appendChild(deleteBtn);
    var bodyMount = document.createElement("div"); bodyMount.className = "person-panel-body";
    dom.appendChild(header); dom.appendChild(bodyMount);

    var bodyEditor = null, bodyTimer = null;
    function initBodyEditor(attrs) {
      if (bodyEditor) { bodyEditor.destroy(); bodyEditor = null; }
      clearTimeout(bodyTimer);
      if (!window._TipTap) return;
      data.getPanelNote(attrs.personId, attrs.noteId).then(function (note) {
        if (!note) {
          // Note deleted — replace panel with header + any saved body snapshot.
          setTimeout(function () {
            if (typeof getPos !== "function") return;
            try {
              var pos = getPos(); if (pos === undefined || pos === null) return;
              var headerText = attrs.personName + " — " + attrs.noteType;
              var replacement = [{ type: "paragraph", content: [{ type: "text", text: headerText, marks: [{ type: "bold" }] }] }];
              if (attrs.bodySnapshot) { try { var s2 = JSON.parse(attrs.bodySnapshot); if (s2 && s2.content && s2.content.length) replacement = replacement.concat(s2.content); } catch (e) {} }
              editor.chain().insertContentAt({ from: pos, to: pos + 1 }, replacement).run();
            } catch (e) { console.error("Error replacing orphaned panel:", e); }
          }, 0);
          return;
        }
        var content = note.contentJson || "";
        var T = window._TipTap;
        var trigExt = window.createInlineTriggersExtension({
          personId: attrs.personId,
          getAllTags: function () { return _allTagsList; },
          getPersonTags: function () { return panelPersonTags; },
          getCurrentStatus: function () { return panelCurrentStatus; },
          createTag: function (name) {
            var trimmed = name.trim();
            var existing = _allTagsList.filter(function (t) { return t.name.toLowerCase() === trimmed.toLowerCase(); })[0];
            if (existing) return Promise.resolve(existing);
            return data.createShepherdingTag(trimmed).then(function (tag) { if (!_allTagsList.filter(function (t) { return t.id === tag.id; })[0]) _allTagsList.push(tag); return tag; });
          },
          onTagAdd: function (tagId, tagName) {
            var newTags = panelPersonTags.indexOf(tagId) === -1 ? panelPersonTags.concat([tagId]) : panelPersonTags;
            return data.toggleShepherdingTag(attrs.personId, tagId, tagName, true, computeHidden(newTags), _user, "document", _currentDocId)
              .then(function () { panelPersonTags = newTags; });
          },
          onTagRemove: function (tagId, tagName) {
            var newTags = panelPersonTags.filter(function (t) { return t !== tagId; });
            return data.toggleShepherdingTag(attrs.personId, tagId, tagName, false, computeHidden(newTags), _user, "document", _currentDocId)
              .then(function () { panelPersonTags = newTags; });
          },
          onStatusChange: function (urg, imp) { if (!urg) return handlePanelStatusClear(); return handlePanelStatusSet(urg, imp); },
          onStatusUndo: function (activityId, urg, imp) { return handlePanelStatusUndo(activityId, urg, imp); },
        });
        bodyEditor = new T.Editor({
          element: bodyMount,
          extensions: [T.StarterKit, T.Underline, T.TextStyle, T.FontFamily, T.FontSize, T.Highlight.configure({ multicolor: true }), trigExt],
          content: content,
          onUpdate: function () { clearTimeout(bodyTimer); bodyTimer = setTimeout(function () { saveBody(attrs); }, 1500); },
        });
      }).catch(function (err) { console.error("Error loading panel body:", err); });
    }
    function saveBody(attrs) {
      if (!bodyEditor) return;
      var bodyJson = bodyEditor.getJSON();
      data.savePanelNote(attrs.personId, attrs.noteId, { contentJson: bodyJson, content: bodyEditor.getText().trim() }, _user, _currentDocId).then(function () {
        if (typeof getPos === "function") { var pos = getPos(); if (pos !== undefined) editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, currentAttrs, { bodySnapshot: JSON.stringify(bodyJson) }))); }
      }).catch(function (err) { console.error("Error saving panel body:", err); });
    }
    initBodyEditor(node.attrs);

    return {
      dom: dom, contentDOM: null,
      update: function (updatedNode) {
        if (updatedNode.type.name !== "personPanel") return false;
        nameBtn.textContent = updatedNode.attrs.personName || "Unknown Person";
        typeSelect.value = updatedNode.attrs.noteType || "Elder Meeting";
        if (updatedNode.attrs.personId !== currentAttrs.personId || updatedNode.attrs.noteId !== currentAttrs.noteId) {
          clearTimeout(bodyTimer); currentAttrs = Object.assign({}, updatedNode.attrs); initBodyEditor(currentAttrs); loadPanelPersonData(currentAttrs.personId);
        } else { currentAttrs = Object.assign({}, updatedNode.attrs); }
        return true;
      },
      destroy: function () { clearTimeout(bodyTimer); if (bodyEditor) { bodyEditor.destroy(); bodyEditor = null; } destroyStatusPopup(); },
      stopEvent: function (event) {
        if (typeSelect.contains(event.target)) return true;
        if (statusBtn.contains(event.target)) return true;
        if (statusMatrixPopup && statusMatrixPopup.contains(event.target)) return true;
        if (header.contains(event.target)) return false;
        return bodyMount.contains(event.target);
      },
      ignoreMutation: function () { return true; },
    };
  }

  function createPersonPanelNode() {
    var Node = window._TipTap.Node;
    return Node.create({
      name: "personPanel", group: "block", atom: true, selectable: true, draggable: true,
      addAttributes: function () { return { personId: { default: "" }, noteId: { default: "" }, personName: { default: "" }, noteType: { default: "Elder Meeting" }, bodySnapshot: { default: null } }; },
      parseHTML: function () { return [{ tag: "div[data-person-panel]" }]; },
      renderHTML: function () { return ["div", { "data-person-panel": "" }]; },
      addNodeView: function () { return function (props) { return makePersonPanelNodeView(props); }; },
    });
  }

  // ── Toolbar styles ──────────────────────────────────────────
  function toolBtn(active) { return { width: 36, height: 36, flexShrink: 0, border: "none", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: active ? "var(--primary)" : "transparent", color: active ? "var(--on-primary)" : "var(--on-surface-variant)" }; }
  var docSelect = { flexShrink: 0, border: "1px solid var(--outline-variant)", borderRadius: 6, padding: "6px 8px", fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--on-surface-variant)", background: "var(--surface-container-lowest)", cursor: "pointer" };
  var docDivider = { width: 1, height: 20, background: "var(--outline-variant)", margin: "0 3px", flexShrink: 0 };
  var pill = function (variant) { return { padding: "9px 16px", borderRadius: "var(--radius-full)", border: "none", background: variant === "ghost" ? "transparent" : "var(--primary)", color: variant === "ghost" ? "var(--on-surface-variant)" : "var(--on-primary)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, cursor: "pointer" }; };
  var inputStyle = { width: "100%", boxSizing: "border-box", padding: "10px 12px", background: "var(--surface-container-low)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", outline: "none", fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--on-surface)" };

  // ── Document Editor screen ──────────────────────────────────
  function DocumentEditorScreen(props) {
    var docId = (props.params && props.params.id) || null;
    var loadingS = useState(true), errS = useState(false), readyS = useState(false), mountedS = useState(false);
    var titleS = useState(""), saveStatusS = useState("saved"), toastS = useState(null);
    var peopleS = useState([]);
    var titleRef = useRef(""), saveTimerRef = useRef(null);
    // Person picker
    var pickerS = useState(null); // { mode, pos, curPersonId, curNoteId, step, search, selected, noteMode, existing, selectedNoteId }
    // Panel delete dialog
    var delS = useState(null); // { pos, personId, noteId, personName }

    var pk = pickerS[0], del = delS[0];
    function showToast(m, t) { toastS[1]({ message: m, type: t || "success" }); setTimeout(function () { toastS[1](null); }, 2600); }

    // ── Load doc + mention data + TipTap bundle ──
    useEffect(function () {
      var alive = true;
      injectStyles();
      _user = props.user; _nav = props.nav;
      if (!docId) { errS[1](true); loadingS[1](false); return; }
      M.ensureTipTap().then(function () { if (alive) readyS[1](true); }).catch(function () { if (alive) { errS[1](true); loadingS[1](false); } });
      Promise.all([data.getElderDocument(docId), data.getDocMentionData()]).then(function (r) {
        if (!alive) return;
        var doc = r[0];
        if (!doc) { errS[1](true); loadingS[1](false); return; }
        _currentDocId = docId; _currentDocTitle = doc.title || "";
        titleS[1](doc.title || ""); titleRef.current = doc.title || "";
        _docLoaded.doc = doc;
        var md = r[1];
        _mentionPeople = md.people; _mentionNotes = md.notes; _mentionDocs = md.docs; _mentionFolders = md.folders;
        _peopleList = md.peopleList; _docTypeById = md.docTypeById; _allTagsList = md.tags;
        peopleS[1](md.peopleList);
        loadingS[1](false);
      }).catch(function () { if (alive) { errS[1](true); loadingS[1](false); } });
      return function () {
        alive = false;
        if (_docEditor) { try { _docEditor.destroy(); } catch (e) {} _docEditor = null; }
        _currentDocId = null; _currentDocTitle = "";
      };
    }, [docId]);

    // ── NodeView event bridge (open picker / delete panel) ──
    useEffect(function () {
      function onOpen(e) {
        var d = e.detail || {};
        pickerS[1]({ mode: d.mode || "insert", pos: (d.pos != null ? d.pos : null), curPersonId: d.currentPersonId || null, curNoteId: d.currentNoteId || null, step: "person", search: "", selected: null, noteMode: "new", existing: [], selectedNoteId: null });
      }
      function onDel(e) { var d = e.detail || {}; delS[1]({ pos: d.pos, personId: d.personId, noteId: d.noteId, personName: d.personName || "this person" }); }
      document.addEventListener("open-person-picker", onOpen);
      document.addEventListener("panel-delete-request", onDel);
      return function () { document.removeEventListener("open-person-picker", onOpen); document.removeEventListener("panel-delete-request", onDel); };
    }, []);

    // ── Cross-tab sync: react when a profile tab deletes a linked note ──
    useEffect(function () {
      if (typeof BroadcastChannel === "undefined") return;
      var bc = new BroadcastChannel("mosaic-shepherding");
      bc.onmessage = function (e) {
        if (e.data && e.data.type === "note-deleted" && e.data.sourceDocumentId === docId) replaceOrphanedPanel(e.data.noteId, e.data.personName, e.data.noteType, e.data.bodySnapshot);
      };
      return function () { try { bc.close(); } catch (e) {} };
    }, [docId]);

    // ── Mount the TipTap editor once bundle + doc are ready ──
    useEffect(function () {
      if (!readyS[0] || loadingS[0] || errS[0] || mountedS[0]) return;
      var el = document.getElementById("tiptap-doc-editor");
      if (!el) return;
      var T = window._TipTap;
      if (_docEditor) { try { _docEditor.destroy(); } catch (e) {} _docEditor = null; }
      var PersonPanelNode = createPersonPanelNode();
      var InlinePicker = createInlinePickerPlugin();
      _docEditor = new T.Editor({
        element: el,
        extensions: [
          T.StarterKit, T.Underline, T.TextStyle, T.FontFamily, T.FontSize,
          T.Highlight.configure({ multicolor: true }),
          T.Table.configure({ resizable: false }), T.TableRow, T.TableHeader, T.TableCell,
          PersonPanelNode, InlinePicker,
          T.Mention.configure({ HTMLAttributes: { class: "mention-chip" }, suggestion: createDocMentionSuggestion() }),
        ],
        content: (_docLoaded.doc && _docLoaded.doc.contentJson) || "",
        editorProps: {
          handleClick: function (view, pos, event) {
            var target = event.target.closest && event.target.closest(".mention-chip");
            if (!target) return false;
            var actualPos = view.posAtDOM(target, 0);
            var mnode = view.state.doc.nodeAt(actualPos);
            if (mnode && mnode.type.name === "mention") {
              var parsed = null; try { parsed = JSON.parse(mnode.attrs && mnode.attrs.id || ""); } catch (e) {}
              if (!parsed) return false;
              if (parsed.kind === "person") _nav("shepherdProfile", { id: parsed.id, from: "document" });
              else if (parsed.kind === "note" && parsed.personId) _nav("shepherdProfile", { id: parsed.personId, from: "document" });
              else if (parsed.kind === "elder_document") { _docTypeById[parsed.id] === "care-list" ? _nav("careList", { id: parsed.id }) : _nav("documentEditor", { id: parsed.id }); }
              else if (parsed.kind === "elder_folder") _nav("documents");
              return true;
            }
            return false;
          },
        },
        onTransaction: function () { scheduleSave(); },
      });
      mountedS[1](true);
    });

    // ── Auto-save (title + timer in refs so the editor's onTransaction closure
    // — captured once at mount — always saves the latest title on a stable timer) ──
    function scheduleSave() { saveStatusS[1]("unsaved"); clearTimeout(saveTimerRef.current); saveTimerRef.current = setTimeout(save, 1500); }
    function save() {
      if (!_docEditor || !docId) return;
      saveStatusS[1]("saving");
      _currentDocTitle = titleRef.current;
      data.saveElderDocument(docId, { title: titleRef.current, contentJson: _docEditor.getJSON() }, _user)
        .then(function () { saveStatusS[1]("saved"); })
        .catch(function () { saveStatusS[1]("unsaved"); showToast("Error saving document", "error"); });
    }

    // ── Toolbar commands (target the main doc editor) ──
    function cmd(name) { if (_docEditor) _docEditor.chain().focus()[name]().run(); }
    function setFont(v) { if (!_docEditor) return; v ? _docEditor.chain().focus().setFontFamily(v).run() : _docEditor.chain().focus().unsetFontFamily().run(); }
    function setSize(v) { if (!_docEditor) return; v ? _docEditor.chain().focus().setFontSize(v).run() : _docEditor.chain().focus().unsetFontSize().run(); }
    function setHi(c) { if (!_docEditor) return; c ? _docEditor.chain().focus().setHighlight({ color: c }).run() : _docEditor.chain().focus().unsetHighlight().run(); }
    function insertTable() { if (_docEditor) _docEditor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }
    function insertMention() { if (_docEditor) _docEditor.chain().focus().insertContent("@").run(); }
    function openInsertPanel() { document.dispatchEvent(new CustomEvent("open-person-picker", { detail: { mode: "insert" } })); }

    // ── Person picker actions ──
    function selectPerson(person) {
      var next = Object.assign({}, pickerS[0], { selected: person, step: "note-mode" });
      pickerS[1](next);
      data.getPersonNotes(person.id).then(function (notes) { var cur = pickerS[0]; if (cur && cur.selected && cur.selected.id === person.id) pickerS[1](Object.assign({}, cur, { existing: notes })); }).catch(function () {});
    }
    function confirmPicker() {
      var p = pickerS[0]; if (!p || !p.selected) return;
      var person = p.selected, isNew = p.noteMode === "new", existId = p.selectedNoteId;
      if (!isNew && !existId) return;
      pickerS[1](null);
      var getNoteId = isNew
        ? data.addPanelNote(person.id, { type: "Elder Meeting", sourceDocumentId: _currentDocId }, _user)
        : data.setNoteSourceDoc(person.id, existId, _currentDocId).then(function () { return existId; });
      getNoteId.then(function (noteId) {
        if (p.mode === "insert") {
          if (_docEditor) _docEditor.chain().focus().insertContent({ type: "personPanel", attrs: { personId: person.id, noteId: noteId, personName: person.name, noteType: "Elder Meeting" } }).run();
        } else {
          moveNote(p.curPersonId, p.curNoteId, person.id, noteId, person.name, p.pos, isNew);
        }
      }).catch(function (e) { console.error(e); showToast("Error creating note", "error"); });
    }
    function moveNote(oldPersonId, oldNoteId, newPersonId, newNoteId, newName, pos, isNew) {
      var chain = Promise.resolve();
      if (isNew && oldNoteId) {
        chain = data.copyNoteContent(oldPersonId, oldNoteId, newPersonId, newNoteId).then(function () { return data.deletePanelNote(oldPersonId, oldNoteId); }).catch(function (e) { console.error("Error moving note:", e); });
      }
      chain.then(function () {
        if (_docEditor && typeof pos === "number") {
          var state = _docEditor.state, node = state.doc.nodeAt(pos);
          if (node && node.type.name === "personPanel") _docEditor.view.dispatch(state.tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { personId: newPersonId, noteId: newNoteId, personName: newName })));
        }
      });
    }

    // ── Panel delete / unlink ──
    function executePanelDelete(deleteNote) {
      var d = delS[0]; delS[1](null); if (!d) return;
      if (_docEditor && typeof d.pos === "number") {
        var state = _docEditor.state, node = state.doc.nodeAt(d.pos);
        if (node) _docEditor.view.dispatch(state.tr.delete(d.pos, d.pos + node.nodeSize));
      }
      var op = deleteNote ? data.deletePanelNote(d.personId, d.noteId) : data.unlinkPanelNote(d.personId, d.noteId);
      op.catch(function (e) { console.error(e); showToast(deleteNote ? "Error deleting note" : "Error unlinking note", "error"); });
    }

    function replaceOrphanedPanel(noteId, personName, noteType, bodySnapshot) {
      if (!_docEditor) return;
      var state = _docEditor.view.state, targetPos = null, targetAttrs = null;
      state.doc.descendants(function (node, pos) { if (node.type.name === "personPanel" && node.attrs.noteId === noteId) { targetPos = pos; targetAttrs = node.attrs; return false; } });
      if (targetPos === null) return;
      var name = personName || targetAttrs.personName || "", type = noteType || targetAttrs.noteType || "";
      var headerText = [name, type].filter(Boolean).join(" — ");
      var replacement = [{ type: "paragraph", content: [{ type: "text", text: headerText, marks: [{ type: "bold" }] }] }];
      var snapStr = bodySnapshot || targetAttrs.bodySnapshot;
      if (snapStr) { try { var s = JSON.parse(snapStr); if (s && s.content && s.content.length) replacement = replacement.concat(s.content); } catch (e) {} }
      _docEditor.chain().insertContentAt({ from: targetPos, to: targetPos + 1 }, replacement).run();
    }

    var userKnown = props.user !== undefined;
    var isElder = userKnown && !!props.user && (props.user.permissionLevel === "elder" || props.user.permissionLevel === "super_admin");
    var saveStatus = saveStatusS[0];
    var saveLabel = saveStatus === "saving" ? "Saving…" : saveStatus === "unsaved" ? "Unsaved" : "Saved";
    var savedRight = html`<span style=${{ display: "flex", alignItems: "center", gap: 5, paddingRight: 8, fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500, color: saveStatus === "saved" ? "var(--secondary)" : "var(--on-surface-variant)" }}>
      ${saveStatus === "saving" ? html`<span style=${{ display: "flex", animation: "mspin 0.7s linear infinite" }}>${Ic("loader-circle", 13)}</span>` : saveStatus === "saved" ? Ic("check", 14) : null} ${saveLabel}
    </span>`;

    if (!userKnown || loadingS[0]) {
      return html`<${Screen}><${TopBar} title="Document" onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "16px" }}><div style=${{ display: "flex", justifyContent: "center", padding: "48px 20px", color: "var(--on-surface-variant)" }}><span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 26)}</span></div></${Body}></${Screen}>`;
    }
    if (!isElder) {
      return html`<${Screen}><${TopBar} title="Document" onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "60px 24px", textAlign: "center" }}><div style=${{ display: "inline-flex", opacity: 0.5, color: "var(--on-surface-variant)" }}>${Ic("shield-alert", 40)}</div><p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, marginTop: 12, color: "var(--on-surface-variant)" }}>Elder-only tools.</p></${Body}></${Screen}>`;
    }
    if (errS[0]) {
      return html`<${Screen}><${TopBar} title="Document" onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "60px 24px", textAlign: "center" }}><p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, color: "var(--on-surface-variant)" }}>Couldn't load this document.</p></${Body}></${Screen}>`;
    }

    return html`
      <${Screen}>
        <${TopBar} title="Document" onBack=${props.back} serif=${false} right=${savedRight} />

        <!-- Title band: part of the header, visually separated from the body. -->
        <div style=${{ flexShrink: 0, padding: "12px 16px 12px", borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container-lowest)" }}>
          <input value=${titleS[0]} onInput=${function (e) { titleS[1](e.target.value); titleRef.current = e.target.value; scheduleSave(); }} placeholder="Untitled Document"
            style=${{ width: "100%", boxSizing: "border-box", border: "none", outline: "none", background: "transparent", fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 600, color: "var(--on-surface)", padding: 0 }} />
        </div>

        <div style=${{ flexShrink: 0, display: "flex", alignItems: "center", gap: 3, padding: "8px 10px", borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container)", overflowX: "auto" }}>
          <select onChange=${function (e) { setFont(e.target.value); e.target.selectedIndex = 0; }} style=${docSelect}>
            <option value="">Font</option><option value="var(--font-sans)">Sans</option><option value="var(--font-serif)">Serif</option><option value="monospace">Mono</option>
          </select>
          <select onChange=${function (e) { setSize(e.target.value); e.target.selectedIndex = 0; }} style=${docSelect}>
            <option value="">Size</option><option value="12px">12</option><option value="14px">14</option><option value="16px">16</option><option value="18px">18</option><option value="20px">20</option><option value="24px">24</option>
          </select>
          <span style=${docDivider}></span>
          <button onMouseDown=${function (e) { e.preventDefault(); cmd("toggleBold"); }} style=${toolBtn(false)} title="Bold"><b style=${{ fontSize: 15 }}>B</b></button>
          <button onMouseDown=${function (e) { e.preventDefault(); cmd("toggleItalic"); }} style=${toolBtn(false)} title="Italic"><i style=${{ fontSize: 15 }}>I</i></button>
          <button onMouseDown=${function (e) { e.preventDefault(); cmd("toggleUnderline"); }} style=${toolBtn(false)} title="Underline"><u style=${{ fontSize: 15 }}>U</u></button>
          <span style=${docDivider}></span>
          <button onMouseDown=${function (e) { e.preventDefault(); cmd("toggleBulletList"); }} style=${toolBtn(false)} title="Bullet list">${Ic("list", 17)}</button>
          <button onMouseDown=${function (e) { e.preventDefault(); cmd("toggleOrderedList"); }} style=${toolBtn(false)} title="Numbered list">${Ic("list-ordered", 17)}</button>
          <button onMouseDown=${function (e) { e.preventDefault(); cmd("toggleBlockquote"); }} style=${toolBtn(false)} title="Quote">${Ic("quote", 17)}</button>
          <button onMouseDown=${function (e) { e.preventDefault(); insertTable(); }} style=${toolBtn(false)} title="Table">${Ic("table", 17)}</button>
          <span style=${docDivider}></span>
          ${["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca"].map(function (c) { return html`<button key=${c} onMouseDown=${function (e) { e.preventDefault(); setHi(c); }} title="Highlight" style=${{ width: 26, height: 26, flexShrink: 0, borderRadius: 6, border: "1px solid var(--outline-variant)", background: c, cursor: "pointer" }}></button>`; })}
          <button onMouseDown=${function (e) { e.preventDefault(); setHi(null); }} title="Clear highlight" style=${Object.assign({}, toolBtn(false), { width: 26, height: 26 })}>${Ic("ban", 15)}</button>
          <span style=${docDivider}></span>
          <button onMouseDown=${function (e) { e.preventDefault(); insertMention(); }} style=${toolBtn(false)} title="Mention">${Ic("at-sign", 17)}</button>
          <button onMouseDown=${function (e) { e.preventDefault(); openInsertPanel(); }} style=${toolBtn(false)} title="Insert Person Note">${Ic("user-round-plus", 17)}</button>
        </div>

        <${Body} style=${{ padding: 0 }}>
          <div class="doc-pm" style=${{ padding: "16px 18px calc(48px + env(safe-area-inset-bottom, 0px))" }}>
            <div id="tiptap-doc-editor" style=${{ minHeight: 240 }}></div>
          </div>
        </${Body}>

        ${pk ? html`<${Fragment}>
          <div onClick=${function () { pickerS[1](null); }} style=${{ position: "absolute", inset: 0, zIndex: 55, background: "rgba(14,28,54,0.42)", backdropFilter: "blur(1.5px)" }}></div>
          <div style=${{ position: "absolute", left: 16, right: 16, top: "50%", transform: "translateY(-50%)", zIndex: 56, maxHeight: "84%", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: 18, boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style=${{ padding: "16px 18px 12px", borderBottom: "1px solid var(--outline-variant)", flexShrink: 0 }}>
              <h2 style=${{ margin: 0, fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 600, color: "var(--primary)" }}>${pk.mode === "reattach" ? "Reattach to person" : "Insert Person Note"}</h2>
            </div>
            <div style=${{ padding: 16, overflowY: "auto", flex: 1 }}>
              ${pk.step === "person" ? html`<${Fragment}>
                <input value=${pk.search} autoFocus=${true} onInput=${function (e) { pickerS[1](Object.assign({}, pk, { search: e.target.value })); }} placeholder="Search people…" style=${Object.assign({}, inputStyle, { marginBottom: 12 })} />
                <div style=${{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 300, overflowY: "auto" }}>
                  ${peopleS[0].filter(function (p) { return p.name.toLowerCase().indexOf(pk.search.toLowerCase()) !== -1; }).slice(0, 50).map(function (p) {
                    return html`<button key=${p.id} onClick=${function () { selectPerson(p); }} style=${{ width: "100%", textAlign: "left", padding: "11px 12px", border: "none", borderRadius: "var(--radius)", background: "transparent", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 14.5, color: "var(--on-surface)" }}>${p.name}</button>`;
                  })}
                </div>
              </${Fragment}>` : html`<${Fragment}>
                <div style=${{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--on-surface-variant)", marginBottom: 12 }}>${pk.selected && pk.selected.name}</div>
                <div style=${{ display: "flex", gap: 16, marginBottom: 12 }}>
                  ${[["new", "New note"], ["existing", "Link existing"]].map(function (o) {
                    var on = pk.noteMode === o[0];
                    return html`<label key=${o[0]} onClick=${function () { pickerS[1](Object.assign({}, pk, { noteMode: o[0] })); }} style=${{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--on-surface)" }}>
                      <span style=${{ width: 18, height: 18, borderRadius: "50%", border: "2px solid " + (on ? "var(--primary)" : "var(--outline-variant)"), display: "inline-flex", alignItems: "center", justifyContent: "center" }}>${on ? html`<span style=${{ width: 9, height: 9, borderRadius: "50%", background: "var(--primary)" }}></span>` : null}</span>${o[1]}
                    </label>`;
                  })}
                </div>
                ${pk.noteMode === "existing" ? html`<div style=${{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
                  ${pk.existing.length === 0 ? html`<div style=${{ fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)" }}>No existing notes for this person.</div>`
                    : pk.existing.map(function (n) {
                      var on = pk.selectedNoteId === n.id;
                      var label = n.subject || n.type || "Note";
                      return html`<button key=${n.id} onClick=${function () { pickerS[1](Object.assign({}, pk, { selectedNoteId: n.id })); }} style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderRadius: "var(--radius)", cursor: "pointer", border: on ? "2px solid var(--primary)" : "1px solid var(--outline-variant)", background: "var(--surface-container-lowest)", textAlign: "left" }}>
                        <span style=${{ fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--on-surface)" }}>${label}</span>
                        ${on ? html`<span style=${{ color: "var(--primary)", display: "inline-flex" }}>${Ic("check", 15)}</span>` : null}
                      </button>`;
                    })}
                </div>` : null}
              </${Fragment}>`}
            </div>
            <div style=${{ padding: "12px 18px", borderTop: "1px solid var(--outline-variant)", display: "flex", justifyContent: "space-between", gap: 10, flexShrink: 0 }}>
              <button onClick=${function () { if (pk.step === "note-mode") pickerS[1](Object.assign({}, pk, { step: "person", selected: null })); else pickerS[1](null); }} style=${pill("ghost")}>${pk.step === "note-mode" ? "Back" : "Cancel"}</button>
              ${pk.step === "note-mode" ? html`<button onClick=${confirmPicker} disabled=${pk.noteMode === "existing" && !pk.selectedNoteId} style=${Object.assign({}, pill(), { opacity: (pk.noteMode === "existing" && !pk.selectedNoteId) ? 0.5 : 1 })}>${pk.mode === "reattach" ? "Reattach" : "Insert"}</button>` : html`<span></span>`}
            </div>
          </div>
        </${Fragment}>` : null}

        ${del ? html`<${Fragment}>
          <div onClick=${function () { delS[1](null); }} style=${{ position: "absolute", inset: 0, zIndex: 55, background: "rgba(14,28,54,0.42)", backdropFilter: "blur(1.5px)" }}></div>
          <div style=${{ position: "absolute", left: 16, right: 16, top: "50%", transform: "translateY(-50%)", zIndex: 56, background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: 18, boxShadow: "var(--shadow-lg)", padding: 20 }}>
            <h2 style=${{ margin: "0 0 8px", fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 600, color: "var(--primary)" }}>Remove this panel?</h2>
            <p style=${{ margin: "0 0 16px", fontFamily: "var(--font-sans)", fontSize: 13.5, lineHeight: 1.5, color: "var(--on-surface-variant)" }}>Delete the linked note for <strong style=${{ color: "var(--on-surface)" }}>${del.personName}</strong>, or unlink it (keep it as a standalone note on their profile)?</p>
            <div style=${{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button onClick=${function () { executePanelDelete(false); }} style=${Object.assign({}, pill("ghost"), { border: "1px solid var(--outline-variant)", width: "100%" })}>Unlink (keep note)</button>
              <button onClick=${function () { executePanelDelete(true); }} style=${Object.assign({}, pill(), { background: "var(--error)", width: "100%" })}>Delete note</button>
              <button onClick=${function () { delS[1](null); }} style=${Object.assign({}, pill("ghost"), { width: "100%" })}>Cancel</button>
            </div>
          </div>
        </${Fragment}>` : null}

        ${toastS[0] ? html`<div style=${{ position: "absolute", bottom: "calc(28px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", zIndex: 70, padding: "11px 18px", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)", background: toastS[0].type === "error" ? "var(--error)" : "var(--primary)", color: "#fff", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", maxWidth: "90%" }}>${toastS[0].message}</div>` : null}
      </${Screen}>`;
  }

  M.SCREENS = Object.assign(M.SCREENS || {}, { documentEditor: DocumentEditorScreen });
})();
