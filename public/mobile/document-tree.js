/* ============================================================
   document-tree.js — a folder tree on the phone, live, changed one change at a
   time (MS-493 / MS-496). Shared by the Documents screen (the Library's tree)
   and a profile's Documents tab (that person's tree), which used to carry two
   copies of the same read-change-write code.

   ⚠ NOTHING HERE WRITES A TREE RECORD. A tree is one record, and both screens
   used to write back the whole tree they loaded — so two elders filing at the
   same moment lost one of the changes. A change is applied to the screen's own
   copy at once (ShepherdingDocsCore.applyTreeChange, the same function the
   server runs) and sent to the server as ONE change, which applies it to the
   latest tree inside a transaction.

   ⚠ A DELIVERY NEVER DISTURBS SOMEBODY MID-ACTION. The folder the elder is in
   survives a new tree arriving; if it has gone, they land in its nearest parent
   that is still there, and are told. A rename open on something that has gone
   closes, with a line saying why.
   ============================================================ */
(function () {
  "use strict";
  var data = M.data;
  var useState = M.hooks.useState, useEffect = M.hooks.useEffect, useRef = M.hooks.useRef;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // opts: { treeId, pathS, renameIdS, showToast }
  // Returns { structure, loaded, change(treeChange) }.
  function useDocumentTree(opts) {
    var DC = window.ShepherdingDocsCore;
    var structureS = useState({ children: [] });
    var loadedS = useState(false);
    var pendingRef = useRef([]);   // this screen's changes the server has not confirmed yet
    var optsRef = useRef(opts);
    optsRef.current = opts;

    function show(tree) {
      var mine = clone(tree || { children: [] });
      pendingRef.current.forEach(function (c) { try { DC.applyTreeChange(mine, c); } catch (e) {} });
      structureS[1](mine);
      keepPlace(mine);
    }

    function keepPlace(tree) {
      var o = optsRef.current;
      var path = o.pathS[0];
      var depth = 0;
      while (depth < path.length && DC.getFolderById(tree, path[depth])) depth += 1;
      if (depth < path.length) {
        o.pathS[1](path.slice(0, depth));
        o.showToast("That folder was deleted, so you are in the nearest one still here.", "error");
      }
      var renaming = o.renameIdS && o.renameIdS[0];
      if (renaming && !DC.findItemById(tree, renaming)) {
        o.renameIdS[1](null);
        o.showToast("What you were renaming was just removed by somebody else.", "error");
      }
    }

    useEffect(function () {
      var alive = true;
      pendingRef.current = [];
      var stop = data.watchDocumentStructure(opts.treeId, function (tree) {
        if (!alive) return;
        show(tree);
        loadedS[1](true);
      }, function () { if (alive) loadedS[1](true); });
      return function () { alive = false; stop(); };
    }, [opts.treeId]);

    function change(treeChange) {
      var next = clone(structureS[0]);
      var local = DC.applyTreeChange(next, treeChange);
      if (local.refused) { optsRef.current.showToast(local.refused, "error"); return Promise.resolve(false); }
      structureS[1](next);
      pendingRef.current = pendingRef.current.concat([treeChange]);
      function settled() {
        pendingRef.current = pendingRef.current.filter(function (c) { return c !== treeChange; });
      }
      return data.changeDocumentTree(opts.treeId, treeChange).then(function () {
        settled();
        return true;
      }, function (e) {
        settled();
        optsRef.current.showToast((e && e.message) || "That did not save", "error");
        // Put the screen back to the tree as it is; no delivery will, when
        // nothing changed on the server.
        return data.getDocumentStructure(opts.treeId).then(function (tree) { show(tree); return false; });
      });
    }

    return { structure: structureS[0], loaded: loadedS[0], change: change };
  }

  // Every Elder Document, live, as a map by id. `patch` changes one on screen
  // at once (a rename); the next delivery replaces it with the truth.
  function useElderDocuments() {
    var docsS = useState({});
    var loadedS = useState(false);
    useEffect(function () {
      var alive = true;
      var stop = data.watchElderDocuments(function (list) {
        if (!alive) return;
        var map = {};
        list.forEach(function (d) { map[d.id] = d; });
        docsS[1](map);
        loadedS[1](true);
      }, function () { if (alive) loadedS[1](true); });
      return function () { alive = false; stop(); };
    }, []);
    function patch(id, fields) {
      docsS[1](function (docs) {
        var o = Object.assign({}, docs);
        if (fields === null) delete o[id];
        else o[id] = Object.assign({}, docs[id], fields);
        return o;
      });
    }
    return { docs: docsS[0], loaded: loadedS[0], patch: patch };
  }

  M.documentTree = { useDocumentTree: useDocumentTree, useElderDocuments: useElderDocuments };
})();
