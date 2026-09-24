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
          if (!popup) { popup = document.createElement("div"); popup.style.cssText = "position:fixed;z-index:9999;background:var(--surface-container-lowest);border:1px solid var(--outline-variant);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:200px;max-height:260px;overflow-y:auto;padding:4px 0;font-family:var(--font-sans);font-size:14px;"; document.body.appendChild(popup); }
          if (rect) { var r = typeof rect === "function" ? rect() : rect; if (r) { popup.style.left = Math.min(r.left, window.innerWidth - 220) + "px"; popup.style.top = (r.bottom + 4) + "px"; } }
          popup.innerHTML = "";
          if (!items.length) { var e = document.createElement("div"); e.style.cssText = "padding:8px 16px;color:var(--on-surface-variant);font-style:italic;"; e.textContent = "No matches"; popup.appendChild(e); return; }
          items.forEach(function (it, i) {
            var b = document.createElement("button"); b.type = "button";
            b.style.cssText = "display:block;width:100%;text-align:left;padding:7px 16px;cursor:pointer;border:none;background:" + (i === sel ? "var(--primary-fixed)" : "transparent") + ";color:var(--on-surface);font-size:14px;font-family:inherit;";
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
    var list = people.filter(function (p) { return !window.ShepherdingCore.isInactiveMembership(p.membership); });
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
    var CL = window.CareListCore;
    var SP = window.ShepherdingPresence;

    var loadingS = useState(true), errS = useState(false), readyS = useState(false);
    var titleS = useState("");
    var columnsS = useState([]);
    var peopleS = useState([]), tagsS = useState([]), viewS = useState(null), filterTitleS = useState("…");
    var activeColS = useState(null);
    var colPickerS = useState(false), editingColS = useState(null), editingColNameS = useState("");
    var saveStatusS = useState("saved");
    var toastS = useState(null);
    var activeCellS = useState(null); // { personId, colId } — for toolbar enable + highlight
    var rowsTickS = useState(0);      // redraw the rows once a kept row may go
    // Presence (MS-445): everybody's claims, and a tick so a quiet hold, or one
    // whose page died, stops showing as held without anybody writing anything.
    var presenceS = useState([]), presenceTickS = useState(0);

    // Imperative state (read by TipTap callbacks — kept in refs to dodge stale closures).
    var editorsRef = useRef({});      // personId -> { colId -> Editor }
    var cellElsRef = useRef({});      // "pid|cid" -> DOM el
    var refCbRef = useRef({});        // "pid|cid" -> stable ref callback
    var sessionRef = useRef(null);    // CareListCore session: the stored copy + what is unsaved
    var focusRef = useRef(null);      // { personId, columnId } while the cursor is in a cell
    var inTitleRef = useRef(false);
    var titleRef = useRef("");
    var peopleRef = useRef([]);       // current people (for trigger callbacks)
    var tagsRef = useRef([]);
    var presenceRef = useRef([]);
    var userRef = useRef(user);
    var saveTimerRef = useRef(null);
    var savingRef = useRef(null);     // the save on its way, if one is
    var viewIdRef = useRef(null);     // the Filtered View this list reads, if any
    var activeEditorRef = useRef(null);

    peopleRef.current = peopleS[0]; tagsRef.current = tagsS[0]; userRef.current = user;
    presenceRef.current = presenceS[0]; titleRef.current = titleS[0];
    var myUid = props.user && props.user.uid;

    function showToast(m, t) { toastS[1]({ message: m, type: t || "success" }); setTimeout(function () { toastS[1](null); }, 2600); }

    // ── Load, then follow: the list, who is on it, and its Filtered View ──
    // Somebody else's cell goes into its editor without counting as an edit,
    // so it is never saved back; a cell typed into and not yet saved is left
    // alone (CareListCore). A cell in a column not on screen goes into the
    // stored copy, and is what its editor opens with later.
    useEffect(function () {
      var alive = true;
      var watches = [];
      injectStyles();
      if (!docId) { errS[1](true); loadingS[1](false); return; }
      ensureTipTap().then(function () { if (alive) readyS[1](true); }).catch(function () { if (alive) { errS[1](true); loadingS[1](false); } });
      Promise.all([data.getCareList(docId), data.getShepherdingPeople(), data.getShepherdingTags()])
        .then(function (r) {
          if (!alive) return;
          var doc = r[0];
          if (!doc) { errS[1](true); loadingS[1](false); return; }
          // An old-shaped list reads as one Notes column here, and is only
          // WRITTEN in the column shape by the first save — opening writes nothing.
          var session = CL.createSession(doc);
          sessionRef.current = session;
          titleS[1](session.title());
          var cols = session.columns();
          columnsS[1](cols);
          activeColS[1](cols[0] ? cols[0].id : null);
          peopleS[1](r[1]); tagsS[1](r[2]);

          watches.push(data.watchCareList(docId, function (remote) { if (alive) adoptRemote(remote); }));
          watches.push(data.watchShepherdingPeople(function (people) { if (alive) peopleS[1](people); }));

          var viewId = doc.filterId || null;
          viewIdRef.current = viewId;
          if (viewId) {
            var first = true;
            watches.push(data.watchShepherdingView(viewId, function (v) {
              if (!alive) return;
              viewS[1](v); filterTitleS[1]((v && v.title) || "Untitled Filter");
              if (first) { first = false; loadingS[1](false); }
            }));
          } else {
            viewS[1](doc.filterConfig || null); filterTitleS[1](doc.filterConfig ? "Custom Filter" : "All members"); loadingS[1](false);
          }
        })
        .catch(function () { if (alive) { errS[1](true); loadingS[1](false); } });
      return function () {
        alive = false;
        watches.forEach(function (stop) { try { stop(); } catch (e) {} });
        // Anything typed and not yet saved goes before the editors do.
        doSave();
        var es = editorsRef.current;
        Object.keys(es).forEach(function (pid) { Object.keys(es[pid]).forEach(function (cid) { try { es[pid][cid].destroy(); } catch (e) {} }); });
        editorsRef.current = {};
      };
    }, [docId]);

    function adoptRemote(remote) {
      var session = sessionRef.current;
      if (!session) return;
      if (!remote) { showToast("This care list was deleted", "error"); return; }
      // A list with its own filter, rather than a Filtered View, carries it.
      if (!viewIdRef.current && remote.filterConfig) {
        viewS[1](function (cur) { return CL.sameContent(cur, remote.filterConfig) ? cur : remote.filterConfig; });
      }
      var out = session.adopt(remote, { inCell: focusRef.current, inTitle: inTitleRef.current });
      if (out.title !== null) titleS[1](out.title);
      out.cells.forEach(function (c) { putCell(c.personId, c.columnId, c.value); });
      if (out.columns) showColumns(out.columns);
    }

    function showColumns(cols) {
      columnsS[1](cols);
      activeColS[1](function (cur) {
        return cols.some(function (c) { return c.id === cur; }) ? cur : (cols[0] ? cols[0].id : null);
      });
    }

    // Somebody else's value into a mounted editor, without it counting as an
    // edit: setContent's second argument keeps onUpdate quiet.
    function putCell(pid, cid, value) {
      var ed = editorsRef.current[pid] && editorsRef.current[pid][cid];
      if (ed) { try { ed.commands.setContent(value || "", false); } catch (e) {} }
    }

    // ── Presence (MS-445) ── the same store and box names as the web, so a
    // cell held on a laptop is held here. Presence may remove a lock, never an
    // editor: it cannot throw, and while it is not running every cell opens.
    useEffect(function () {
      if (!docId || !props.user || !SP) return;
      var unsubscribe = function () {};
      var ticker = null;
      try {
        unsubscribe = SP.subscribe(presenceS[1]);
        SP.start({
          db: data.db,
          uid: props.user.uid,
          identity: { id: props.user.personId || null, name: props.user.name || "", photoUrl: props.user.photoUrl || null, photoCrop: props.user.photoCrop || null },
          // The web Care List page says the same, so both count as one list.
          surface: "shepherding-care-list",
          pageKey: docId,
          stamp: function () { return firebase.firestore.FieldValue.serverTimestamp(); },
        });
        ticker = setInterval(function () { presenceTickS[1](function (n) { return n + 1; }); }, window.PresenceCore.HEARTBEAT_MS);
      } catch (e) {
        console.warn("Presence could not start on this care list; carrying on without it:", e);
      }
      // leave(), not release(): gone means gone, not freshly here.
      return function () { unsubscribe(); if (ticker) clearInterval(ticker); SP.leave(); SP.stop(); };
    }, [docId, myUid]);

    function holderOf(box) {
      return SP ? SP.holderIn(presenceRef.current, myUid, box, Date.now()) : null;
    }
    function cellHolder(pid, cid) { return holderOf(CL.box.cell(docId, pid, cid)); }
    function titleHolder() { return holderOf(CL.box.title(docId)); }
    function othersHere() {
      if (!myUid || !window.PresenceCore) return [];
      return window.PresenceCore.peopleHere(presenceS[0], myUid, "shepherding-care-list", docId, Date.now(), { idleMs: window.PresenceCore.SHEPHERDING_IDLE_MS });
    }
    function claim(box) { return !SP || SP.claimBox(box); }
    function sayHeld(holder, what) { showToast((holder ? holder.name : "Somebody") + " is editing this " + what, "error"); }

    // A cell somebody else holds cannot be typed into. setEditable's second
    // argument keeps it from firing an update, which would read as an edit.
    useEffect(function () {
      var es = editorsRef.current;
      Object.keys(es).forEach(function (pid) {
        Object.keys(es[pid]).forEach(function (cid) {
          var open = !cellHolder(pid, cid);
          if (es[pid][cid].isEditable !== open) { try { es[pid][cid].setEditable(open, false); } catch (e) {} }
        });
      });
    });

    // ── Save (debounced) — only what was typed into, each to its own field ──
    function scheduleSave() {
      saveStatusS[1]("unsaved");
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(doSave, 1500);
    }
    function doSave() {
      var session = sessionRef.current;
      clearTimeout(saveTimerRef.current);
      if (!session) return Promise.resolve();
      var edits = session.takeSave(function (pid, cid) {
        var ed = editorsRef.current[pid] && editorsRef.current[pid][cid];
        try { return ed ? ed.getJSON() : session.cell(pid, cid); } catch (e) { return session.cell(pid, cid); }
      }, function () { return (titleRef.current || "").trim() || "Untitled Care List"; });
      if (!edits.cells.length && edits.title === null) {
        if (!session.hasUnsaved()) saveStatusS[1]("saved");
        return Promise.resolve();
      }
      saveStatusS[1]("saving");
      var saving = data.saveCareListEdits(docId, Object.assign({}, edits, { oldShape: session.oldShape() }), userRef.current)
        .then(function () { session.markNormalised(); saveStatusS[1](session.hasUnsaved() ? "unsaved" : "saved"); },
          function () { session.saveFailed(edits); saveStatusS[1]("unsaved"); showToast("Error saving care list", "error"); })
        .then(function () { if (savingRef.current === saving) savingRef.current = null; });
      savingRef.current = saving;
      return saving;
    }

    // ── Boxes: a cell, and the title ──
    // Every keystroke and trigger pick in a held box. False means somebody
    // took it after you went quiet: what you just typed goes back to what is
    // stored, and is not saved over theirs.
    function touchCell() {
      var f = focusRef.current;
      if (!f || !SP || SP.touch()) return true;
      putCell(f.personId, f.columnId, sessionRef.current.discard(f.personId, f.columnId));
      var ed = editorsRef.current[f.personId] && editorsRef.current[f.personId][f.columnId];
      if (ed) { try { ed.commands.blur(); } catch (e) {} }
      showToast((cellHolder(f.personId, f.columnId) || { name: "Somebody" }).name + " is editing this cell now", "error");
      return false;
    }
    function enterCell(pid, cid, ed) {
      if (!claim(CL.box.cell(docId, pid, cid))) {
        try { ed.commands.blur(); } catch (e) {}
        sayHeld(cellHolder(pid, cid), "cell");
        return;
      }
      focusRef.current = { personId: pid, columnId: cid };
      activeEditorRef.current = ed;
      activeCellS[1]({ personId: pid, colId: cid });
      // Somebody else's save may have arrived while they held it: start from
      // that, not from the older copy on screen.
      var arrived = sessionRef.current && sessionRef.current.catchUpCell(pid, cid);
      if (arrived) putCell(pid, cid, arrived.value);
    }
    // The hold goes only once this cell's pending save has, so letting go never
    // strands unsaved text. Then whatever arrived meanwhile goes in, and a row
    // that left the filter while you were in it can go.
    function leaveCell(pid, cid) {
      var f = focusRef.current;
      if (!f || f.personId !== pid || f.columnId !== cid) return;
      focusRef.current = null;
      var session = sessionRef.current;
      // This cell's save — the one still to start, or the one on its way.
      var pending = session && session.isDirty(pid, cid) ? doSave() : (savingRef.current || Promise.resolve());
      pending.then(function () {
        var arrived = session && session.catchUpCell(pid, cid);
        if (arrived) putCell(pid, cid, arrived.value);
        if (!focusRef.current && !inTitleRef.current && SP) SP.release();
        rowsTickS[1](function (n) { return n + 1; });
      });
    }
    function enterTitle(e) {
      if (!claim(CL.box.title(docId))) { e.target.blur(); sayHeld(titleHolder(), "title"); return; }
      inTitleRef.current = true;
      var arrived = sessionRef.current && sessionRef.current.catchUpTitle();
      if (arrived !== null && arrived !== undefined) titleS[1](arrived);
    }
    function onTitleInput(e) {
      var session = sessionRef.current;
      if (!session) return;
      // Put straight onto the input: the state already holds this title, so
      // setting it again would not redraw, and the refused typing would stay.
      if (SP && !SP.touch()) { e.target.value = session.title(); sayHeld(titleHolder(), "title"); return; }
      titleRef.current = e.target.value;
      titleS[1](e.target.value);
      session.titleEdited();
      scheduleSave();
    }
    function leaveTitle() {
      if (!inTitleRef.current) return;
      inTitleRef.current = false;
      var session = sessionRef.current;
      var pending = session && session.hasUnsaved() ? doSave() : (savingRef.current || Promise.resolve());
      pending.then(function () {
        var arrived = session && session.catchUpTitle();
        if (arrived !== null && arrived !== undefined) titleS[1](arrived);
        if (!focusRef.current && !inTitleRef.current && SP) SP.release();
      });
    }

    // A row that leaves the filter while you are typing in it stays until you
    // leave the cell — it is never pulled out from under you (MS-448).
    var filtered = filterPeople(peopleS[0], viewS[0]);
    var kept = focusRef.current;
    if (kept && !filtered.some(function (p) { return p.id === kept.personId; })) {
      var keptPerson = peopleS[0].filter(function (p) { return p.id === kept.personId; })[0];
      if (keptPerson) filtered = filtered.concat([keptPerson]).sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || "")); });
    }
    var activeCol = columnsS[0].filter(function (c) { return c.id === activeColS[0]; })[0] || columnsS[0][0];

    // ── Trigger callbacks (wired to real dual-writes, source: 'document') ──
    function computeHidden(newTags) { var h = hiddenIds(tagsRef.current); return newTags.some(function (id) { return !!h[id]; }); }
    function patchPerson(pid, patch) { peopleS[1](peopleRef.current.map(function (p) { return p.id === pid ? Object.assign({}, p, patch) : p; })); }
    // A pick in a cell somebody took from you is not recorded.
    function onTagAdd(pid, tagId, tagName) {
      if (!touchCell()) return;
      var cur = (peopleRef.current.filter(function (p) { return p.id === pid; })[0] || {}).tags || [];
      if (cur.indexOf(tagId) !== -1) return;
      var newTags = cur.concat([tagId]);
      data.toggleShepherdingTag(pid, tagId, tagName, true, computeHidden(newTags), userRef.current, "document", docId)
        .then(function () { patchPerson(pid, { tags: newTags }); showToast("Tag #" + tagName + " added"); })
        .catch(function () { showToast("Error adding tag", "error"); });
    }
    function onTagRemove(pid, tagId, tagName) {
      if (!touchCell()) return;
      var cur = (peopleRef.current.filter(function (p) { return p.id === pid; })[0] || {}).tags || [];
      var newTags = cur.filter(function (t) { return t !== tagId; });
      data.toggleShepherdingTag(pid, tagId, tagName, false, computeHidden(newTags), userRef.current, "document", docId)
        .then(function () { patchPerson(pid, { tags: newTags }); showToast("Tag #" + tagName + " removed"); })
        .catch(function () { showToast("Error removing tag", "error"); });
    }
    function onStatusChange(pid, urg, imp) {
      if (!touchCell()) return Promise.resolve(null);
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
      if (!el || !window._TipTap || !sessionRef.current) return;
      if (editorsRef.current[pid] && editorsRef.current[pid][cid]) return;
      var T = window._TipTap;
      var content = sessionRef.current.cell(pid, cid) || "";
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
        editable: !cellHolder(pid, cid),
        onUpdate: function () {
          var session = sessionRef.current;
          if (!session) return;
          session.edited(pid, cid);
          if (!touchCell()) return;
          scheduleSave();
        },
        onFocus: function () { enterCell(pid, cid, ed); },
        onBlur: function () { leaveCell(pid, cid); },
      });
      if (!editorsRef.current[pid]) editorsRef.current[pid] = {};
      editorsRef.current[pid][cid] = ed;
    }
    function destroyEditor(pid, cid) {
      var ed = editorsRef.current[pid] && editorsRef.current[pid][cid];
      if (!ed) return;
      // Unsaved typing is read out of the editor (takeSave is synchronous)
      // before it goes — switching column must not lose it.
      if (sessionRef.current && sessionRef.current.isDirty(pid, cid)) doSave();
      // Its column removed under the cursor: TipTap reports no blur on
      // destroy, so let go of the cell here.
      var f = focusRef.current;
      if (f && f.personId === pid && f.columnId === cid) {
        focusRef.current = null;
        if (!inTitleRef.current && SP) SP.release();
      }
      try { ed.destroy(); } catch (e) {}
      delete editorsRef.current[pid][cid];
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
    function withActive(fn) { var ed = activeEditorRef.current; if (!ed || !ed.isEditable) return; ed.chain().focus(); fn(ed); }
    function exec(cmd) { withActive(function (ed) { ed.chain().focus()[cmd]().run(); }); }
    function setFont(v) { withActive(function (ed) { v ? ed.chain().focus().setFontFamily(v).run() : ed.chain().focus().unsetFontFamily().run(); }); }
    function setSize(v) { withActive(function (ed) { v ? ed.chain().focus().setFontSize(v).run() : ed.chain().focus().unsetFontSize().run(); }); }

    // ── Column management ── each ONE change against the latest stored list,
    // in a transaction, so two elders' column changes both stand (ADR-0039).
    function changeColumn(change) {
      return data.changeCareListColumn(docId, change, userRef.current)
        .then(function (out) {
          if (sessionRef.current) sessionRef.current.columnsChanged(out.columns);
          showColumns(out.columns);
          return out;
        })
        .catch(function (e) {
          // A rename shown before it was written goes back.
          if (sessionRef.current) columnsS[1](sessionRef.current.columns());
          showToast(e && /last column/.test(e.message || "") ? "Cannot delete the last column" : "Error changing column", "error");
          return null;
        });
    }
    function addColumn() {
      colPickerS[1](false);
      changeColumn({ kind: "add", name: "Column " + (columnsS[0].length + 1) }).then(function (out) {
        if (!out || !out.column) return;
        activeColS[1](out.column.id);
        editingColS[1](out.column.id); editingColNameS[1](out.column.name);
      });
    }
    function saveColName(id) {
      if (editingColS[0] !== id) return;
      var name = editingColNameS[0].trim() || "Untitled";
      columnsS[1](columnsS[0].map(function (c) { return c.id === id ? Object.assign({}, c, { name: name }) : c; }));
      editingColS[1](null);
      changeColumn({ kind: "rename", columnId: id, name: name });
    }
    function deleteColumn(id) {
      if (columnsS[0].length <= 1) { showToast("Cannot delete the last column", "error"); return; }
      // Removing a column deletes every cell in it — not while somebody is
      // writing in one.
      if (refuseWhileWritten(id)) return;
      if (!window.confirm("Delete this column? Its content will be permanently lost.")) return;
      // Asked again: somebody may have stepped into a cell while the question was open.
      if (refuseWhileWritten(id)) return;
      changeColumn({ kind: "remove", columnId: id });
    }
    function refuseWhileWritten(id) {
      var claims = (myUid && window.PresenceCore) ? window.PresenceCore.claimsByBox(presenceRef.current, myUid, Date.now(), { idleMs: window.PresenceCore.SHEPHERDING_IDLE_MS }) : {};
      var holder = CL.columnHolder(claims, docId, id);
      if (!holder) return false;
      showToast(holder.name + " is writing in this column — it can't be deleted now", "error");
      return true;
    }

    // A face, a first name and a lock: "you can't open this" answered before
    // it is asked.
    function heldBadge(holder) {
      return html`<span title=${window.PresenceCore.holderTitle(holder)} style=${{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, color: "var(--on-surface-variant)" }}>
        <${ui.Avatar} name=${holder.name} photoUrl=${holder.photoUrl} photoCrop=${holder.photoCrop} size=${22} />
        <span style=${{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>${window.PresenceCore.holderLabel(holder)}</span>
        ${Ic("lock", 13)}
      </span>`;
    }

    var userKnown = props.user !== undefined;
    var flags = userKnown && props.user && window.AccessCore ? AccessCore.pageFlags(props.user) : null;
    var canReadElder = !!(flags && flags.canReadElder);
    var canDecide = !!(flags && flags.canDecide);
    var canWriteRecord = !!(flags && flags.canWriteRecord);
    var isElder = canReadElder;
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
          <div style=${{ display: "flex", alignItems: "center", gap: 8 }}>
            <input value=${titleS[0]} onFocus=${enterTitle} onBlur=${leaveTitle} onInput=${onTitleInput} readOnly=${!!titleHolder()} placeholder="Care List title…"
              style=${{ flex: 1, minWidth: 0, boxSizing: "border-box", border: "none", background: "transparent", outline: "none", padding: "2px 0 6px", fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--primary)", letterSpacing: "0.02em" }} />
            ${titleHolder() ? heldBadge(titleHolder()) : null}
          </div>
          <div style=${{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <span style=${{ display: "inline-flex", color: "var(--secondary)" }}>${Ic("list-filter", 13)}</span>
            <span style=${{ fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600, color: "var(--secondary)" }}>Filter: ${filterTitleS[0]}</span>
          </div>
          ${othersHere().length ? html`<div style=${{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <span style=${{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--on-surface-variant)" }}>Also here</span>
            ${othersHere().map(function (p) { return html`<span key=${p.uid} title=${p.name}><${ui.Avatar} name=${p.name} photoUrl=${p.photoUrl} photoCrop=${p.photoCrop} size=${26} /></span>`; })}
          </div>` : null}
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
              var holder = cellHolder(p.id, activeCol.id);
              return html`<div key=${p.id} style=${{ display: "flex", borderBottom: "1px solid var(--outline-variant)", background: idx % 2 ? "var(--surface-container-low)" : "var(--surface-container-lowest)" }}>
                <div style=${{ width: CL_NAME_W, flexShrink: 0, padding: "12px 12px", borderRight: "1px solid var(--outline-variant)", display: "flex", flexDirection: "column", gap: 6 }}>
                  <button onClick=${function () { props.nav("shepherdProfile", { id: p.id, from: "carelist" }); }} style=${{ border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: 700, color: "var(--primary)", textDecoration: "underline", textDecorationColor: "rgba(24,47,87,0.25)" }}>${p.name || "(no name)"}</button>
                  <div style=${{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    ${(p.tags || []).map(function (t) { var tag = tagsS[0].filter(function (x) { return x.id === t; })[0]; return html`<span key=${t} style=${{ padding: "1px 7px", borderRadius: "var(--radius-full)", background: "var(--secondary-container)", color: "var(--on-secondary-container)", fontFamily: "var(--font-sans)", fontSize: 9.5, fontWeight: 600 }}>${tag ? tag.name : t}</span>`; })}
                  </div>
                  ${p.shepherdingStatus ? html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 500, color: "var(--secondary)" }}>${shortStatus(p.shepherdingStatus)}</span>` : null}
                </div>
                <div onClick=${function () { if (holder) sayHeld(holder, "cell"); }} style=${{ flex: 1, minWidth: 0, position: "relative", background: isActive ? "rgba(24,47,87,0.03)" : "transparent", opacity: holder ? 0.7 : 1 }}>
                  <div key=${activeCol.id} ref=${cellRef(p.id, activeCol.id)} class="cl-cell"></div>
                  ${holder ? html`<div style=${{ position: "absolute", top: 6, right: 8, background: "var(--surface-container-lowest)", borderRadius: "var(--radius-full)", padding: "2px 8px 2px 2px" }}>${heldBadge(holder)}</div>` : null}
                </div>
              </div>`;
            })}
          <div style=${{ height: "calc(24px + env(safe-area-inset-bottom, 0px))", flexShrink: 0, pointerEvents: "none" }} aria-hidden="true"></div>
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
            <div style=${{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}>
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

        ${toastS[0] ? html`<div style=${{ position: "absolute", bottom: "calc(28px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", zIndex: 70, padding: "11px 18px", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)", background: toastS[0].type === "error" ? "var(--error)" : "var(--primary)", color: toastS[0].type === "error" ? "var(--on-error)" : "var(--on-primary)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", maxWidth: "90%" }}>${toastS[0].message}</div>` : null}
      </${Screen}>`;
  }

  M.SCREENS = Object.assign(M.SCREENS || {}, { careList: CareListEditorScreen });
})();
