// An Elder Document open in an editor, live (MS-501 / MS-505 / MS-506).
//
// The one layer the web document page and the phone's document screen both
// sit on ("develop once, layout twice"): each draws its own editor and toolbar,
// and hands the editor to this.
//
//   OPEN   Read the record. A legacy one (a body value, no Blocks) is converted
//          once, in a transaction that writes only if it still has no Blocks —
//          two pages opening it together convert it once.
//   SAVE   Only the Blocks this editor changed, and the title if it changed,
//          each at its own field (ADR-0034). A save with nothing to write
//          writes nothing.
//   LIVE   The record is followed while the page is open. A block nobody here
//          has touched takes the new value; a block this editor changed and
//          has not saved, or one in the box it holds, is left alone. Adopted
//          blocks go into the editor as one small change around what actually
//          differs — not in undo history, not an edit of ours, and the cursor
//          maps through it.
//   BOXES  A heading, paragraph, list item, table cell, Person Panel or the
//          title is a box (ADR-0062). The first keystroke in one claims it;
//          leaving it lets it go once its save has gone. A change touching a
//          box somebody else holds is refused, with their name. A Person
//          Panel's box IS its Shepherding Note's box, so a panel held in a
//          document is held on the profile's note editor and the other way
//          round.
//
// ⚠ PRESENCE MAY REMOVE A LOCK, NEVER AN EDITOR (ADR-0035 §3). Everything here
// works with presence absent or failing; every box is then simply open.
//
// Loaded as a plain script after document-body-core.js (and presence-core.js,
// shepherding-presence.js and live-read.js where they are used).
var ElderDocumentLive = (function () {
    'use strict';

    var AUTOSAVE_MS = 1500;
    var BOX_TYPES = { listItem: true, tableCell: true, tableHeader: true, personPanel: true };
    var STRUCTURE = {
        bulletList: true, orderedList: true, table: true, tableRow: true,
        blockquote: true, image: true, horizontalRule: true,
    };

    var root = (typeof window !== 'undefined') ? window : globalThis;

    function core() { return root.DocumentBodyCore; }

    // ── Boxes in the editor's own document ────────────────────────────────────

    function scopeOf(docId) { return 'document:' + docId; }

    // The box a node at `pos` belongs to, as presence keys, or null for
    // structure. The same rule as DocumentBodyCore.boxOfBlock, read off the
    // editor's document: the nearest list item, cell or Person Panel around
    // (or at) the node, else the text block itself.
    function boxAt(doc, pos, node, docId) {
        var here = node || doc.nodeAt(pos);
        if (!here) return null;
        if (here.type.name === 'personPanel') return panelBox(here);
        if (STRUCTURE[here.type.name] && !here.isTextblock) {
            // A picture or rule inside a cell belongs to the cell.
            var $s = doc.resolve(pos);
            for (var d = $s.depth; d > 0; d--) {
                var around = $s.node(d);
                if (BOX_TYPES[around.type.name]) return blockBox(around, docId);
            }
            return null;
        }
        var $pos = doc.resolve(pos);
        for (var depth = $pos.depth; depth > 0; depth--) {
            var outer = $pos.node(depth);
            if (outer.type.name === 'personPanel') return panelBox(outer);
            if (BOX_TYPES[outer.type.name]) return blockBox(outer, docId);
        }
        if (here.isTextblock) return blockBox(here, docId);
        return null;
    }

    function blockBox(node, docId) {
        var id = node.attrs && node.attrs.blockId;
        return id ? { scopeKey: scopeOf(docId), boxKey: 'block:' + id, blockId: id } : null;
    }

    // A Person Panel's box is its note's box (MS-429), so the lock crosses to
    // the profile's note editor with no second key scheme.
    function panelBox(node) {
        var a = node.attrs || {};
        if (!a.personId || !a.noteId || !root.ShepherdingPresence) return null;
        var box = root.ShepherdingPresence.box.note(a.personId, a.noteId);
        return { scopeKey: box.scopeKey, boxKey: box.boxKey, blockId: a.blockId || null, panel: true };
    }

    function keyOf(box) { return box.scopeKey + '|' + box.boxKey; }

    // Every box a transaction's steps touch, in the document before them.
    function boxesTouched(tr, docId) {
        var found = {};
        var doc = tr.before;
        function add(box) { if (box) found[keyOf(box)] = box; }
        tr.steps.forEach(function (step, i) {
            var stepDoc = tr.docs[i] || doc;
            var ranges = [];
            step.getMap().forEach(function (oldStart, oldEnd) { ranges.push([oldStart, oldEnd]); });
            if (!ranges.length && typeof step.pos === 'number') ranges.push([step.pos, step.pos + 1]);
            if (!ranges.length && typeof step.from === 'number') ranges.push([step.from, step.to]);
            ranges.forEach(function (r) {
                var from = Math.max(0, Math.min(r[0], stepDoc.content.size));
                var to = Math.max(from, Math.min(r[1], stepDoc.content.size));
                if (from === to) {
                    var $p = stepDoc.resolve(from);
                    var tb = $p.parent;
                    if (tb && tb.isTextblock) add(boxAt(stepDoc, $p.before(), tb, docId));
                    else add(boxAt(stepDoc, from, null, docId));
                    return;
                }
                stepDoc.nodesBetween(from, to, function (node, pos) {
                    if (node.isTextblock || (node.isBlock && node.isAtom)) { add(boxAt(stepDoc, pos, node, docId)); return false; }
                    return true;
                });
            });
        });
        return Object.keys(found).map(function (k) { return found[k]; });
    }

    // ── One open document ─────────────────────────────────────────────────────

    // opts: {
    //   db, fs (FieldPath/FieldValue namespace), docId,
    //   byName()           who is saving, for updatedByName
    //   onStatus(state)    'saved' | 'unsaved' | 'saving' | 'error'
    //   onTitle(title)     somebody else's title arrived
    //   onHolds()          who holds what changed — redraw faces
    //   onRefused(holder, what)  a change was refused: somebody holds the box
    //   onDeleted()        the document was deleted
    // }
    function create(opts) {
        var o = opts || {};
        var ref = o.db.collection('elder_documents').doc(o.docId);
        var editor = null;
        var session = null;
        var saved = { title: '' };
        var latestTitle = '';
        var titleDirty = false;
        var inTitle = false;
        var held = null;          // the box this editor holds: { scopeKey, boxKey, ... }
        var saving = null;        // the save on its way
        var saveTimer = null;
        var stops = [];
        var readOnly = false;

        function status(s) { if (o.onStatus) o.onStatus(s); }
        function presence() { return root.ShepherdingPresence || null; }

        // ── Open ──

        function open() {
            return ref.get().then(function (snap) {
                if (!snap.exists) return null;
                var data = snap.data();
                if ((data.docType || 'note') !== 'note' || core().hasBlocks(data)) return data;
                // A legacy body, converted once for everybody.
                return o.db.runTransaction(function (tx) {
                    return tx.get(ref).then(function (now) {
                        var fresh = now.exists ? now.data() : data;
                        if (core().hasBlocks(fresh)) return fresh;
                        var converted = core().convertLegacy(fresh);
                        if (!converted.ok) { readOnly = true; return fresh; }
                        tx.update(ref, { blocks: converted.blocks, contentJson: o.fs.FieldValue.delete() });
                        var out = Object.assign({}, fresh, { blocks: converted.blocks });
                        delete out.contentJson;
                        return out;
                    });
                });
            }).then(function (record) {
                if (!record) return null;
                saved.title = core().normaliseTitle(record.title);
                latestTitle = saved.title;
                session = core().createBlocksSession(record.blocks || {});
                return { record: record, body: core().bodyOfRecord(record), readOnly: readOnly };
            });
        }

        // ── Attach an editor ──

        function currentBlocks() {
            return session.blocksOf(editor.getJSON());
        }

        function attach(ed) {
            editor = ed;
            session.mounted(currentBlocks());
            if (root.MosaicLiveRead) {
                stops.push(root.MosaicLiveRead.watch(ref, onSnapshot, {
                    fallbackEveryMs: root.MosaicLiveRead.PERSON_EVERY_MS,
                    onError: function (e) { console.warn('Lost the live connection to this document:', e); },
                }));
            } else {
                stops.push(ref.onSnapshot(onSnapshot, function () {}));
            }
            editor.on('selectionUpdate', onSelection);
            editor.on('blur', onSelection);
            var p = presence();
            if (p && p.subscribe) stops.push(p.subscribe(function () { if (o.onHolds) o.onHolds(); }));
        }

        function onSnapshot(snap) {
            if (!snap) return;
            if (!snap.exists) { if (o.onDeleted) o.onDeleted(); return; }
            if (snap.metadata && snap.metadata.hasPendingWrites) return;
            adopt(snap.data());
        }

        // Somebody else's version of the document.
        function adopt(data) {
            if (!editor || !session || editor.isDestroyed) return;
            var incoming = core().hasBlocks(data) ? data.blocks : null;
            if (incoming) {
                var out = session.adopt(incoming, currentBlocks(), { holding: held && held.blockId });
                if (out.set.length || out.remove.length) {
                    applyBlocks(out.blocks);
                    session.adopted(currentBlocks(), out);
                }
            }
            var theirTitle = core().normaliseTitle(data.title);
            latestTitle = theirTitle;
            if (!titleDirty && !inTitle && theirTitle !== saved.title) {
                saved.title = theirTitle;
                if (o.onTitle) o.onTitle(theirTitle);
            }
        }

        // Put Blocks on screen as one change around what differs, marked
        // remote: not undoable, not an edit of ours, not refused by the locks.
        function applyBlocks(blocks) {
            var json = core().bodyOfBlocks(blocks);
            var next = editor.schema.nodeFromJSON(json);
            var doc = editor.state.doc;
            var start = doc.content.findDiffStart(next.content);
            if (start === null || start === undefined) return;
            var end = doc.content.findDiffEnd(next.content);
            var endA = end.a, endB = end.b;
            var overlap = start - Math.min(endA, endB);
            if (overlap > 0) { endA += overlap; endB += overlap; }
            var tr = editor.state.tr.replace(start, endA, next.slice(start, endB));
            tr.setMeta('remote', true);
            tr.setMeta('addToHistory', false);
            editor.view.dispatch(tr);
        }

        // ── Saving ──

        // Call on every local change to the body.
        function edited() {
            if (readOnly) return;
            status('unsaved');
            clearTimeout(saveTimer);
            saveTimer = setTimeout(function () { save(); }, AUTOSAVE_MS);
        }

        function titleInput(title) {
            if (readOnly) return;
            var p = presence();
            if (p && !p.touch()) {
                if (o.onRefused) o.onRefused(titleHolder(), 'title');
                if (o.onTitle) o.onTitle(saved.title);
                return;
            }
            titleDirty = core().normaliseTitle(title) !== saved.title;
            status('unsaved');
            clearTimeout(saveTimer);
            saveTimer = setTimeout(function () { save(); }, AUTOSAVE_MS);
        }

        var readTitle = function () { return saved.title; };

        function save() {
            clearTimeout(saveTimer);
            if (!editor || !session || readOnly) return Promise.resolve();
            if (saving) return saving.then(save);
            var edits = session.takeSave(currentBlocks());
            var title = null;
            if (titleDirty) {
                title = core().normaliseTitle(readTitle());
                if (title === saved.title) title = null;
            }
            var hasBlocks = Object.keys(edits.write).length || edits.remove.length;
            if (!hasBlocks && title === null) { titleDirty = false; status('saved'); return Promise.resolve(); }
            var pairs = core().blockUpdatePairs(o.fs, edits);
            var titleBefore = saved.title;
            if (title !== null) { pairs.push('title', title); saved.title = title; titleDirty = false; }
            pairs.push('updatedAt', o.fs.FieldValue.serverTimestamp(), 'updatedByName', (o.byName && o.byName()) || '');
            status('saving');
            saving = ref.update.apply(ref, pairs).then(function () {
                session.saveLanded(edits);
                saving = null;
                status(titleDirty ? 'unsaved' : 'saved');
            }, function (e) {
                console.error('Error saving document:', e);
                session.saveFailed(edits);
                if (title !== null) { saved.title = titleBefore; titleDirty = true; }
                saving = null;
                status('error');
            });
            return saving;
        }

        // ── Boxes ──

        // Whoever else holds a box, as the presence store reads it (heartbeat
        // expiry and the one-minute idle rule included), or null.
        function holderOf(box) {
            var p = presence();
            if (!p || !box) return null;
            return p.holder(box.scopeKey, box.boxKey);
        }

        function titleBox() { return { scopeKey: scopeOf(o.docId), boxKey: 'title' }; }
        function titleHolder() { return holderOf(titleBox()); }

        function sameBox(a, b) { return !!(a && b && a.scopeKey === b.scopeKey && a.boxKey === b.boxKey); }

        // The lock, as a ProseMirror plugin: a local change touching a box
        // somebody else holds is dropped; one touching a single free box claims
        // it. `lib` holds Plugin and PluginKey.
        function lockPlugin(lib) {
            return new lib.Plugin({
                key: new lib.PluginKey('elderDocumentLocks'),
                filterTransaction: function (tr) {
                    if (!tr.docChanged || tr.getMeta('remote') || tr.getMeta('blockIds')) return true;
                    if (readOnly) return false;
                    var p = presence();
                    if (!p) return true;
                    var boxes = boxesTouched(tr, o.docId);
                    for (var i = 0; i < boxes.length; i++) {
                        var holder = holderOf(boxes[i]);
                        if (holder) {
                            if (o.onRefused) o.onRefused(holder, boxes[i].panel ? 'Person Panel' : 'paragraph');
                            return false;
                        }
                    }
                    if (boxes.length === 1 && !sameBox(held, boxes[0])) {
                        if (!p.claimBox(boxes[0])) {
                            if (o.onRefused) o.onRefused(holderOf(boxes[0]), 'paragraph');
                            return false;
                        }
                        held = boxes[0];
                        inTitle = false;
                    } else if (held && !p.touch()) {
                        if (o.onRefused) o.onRefused(holderOf(held), 'paragraph');
                        held = null;
                        return false;
                    }
                    return true;
                },
            });
        }

        // The box the cursor is in now, if any.
        function boxAtSelection() {
            if (!editor) return null;
            var sel = editor.state.selection;
            if (sel.node) return boxAt(editor.state.doc, sel.from, sel.node, o.docId);
            var $from = sel.$from;
            if (!$from.parent || !$from.parent.isTextblock) return null;
            return boxAt(editor.state.doc, $from.before(), $from.parent, o.docId);
        }

        // Out of the held box: let it go once its save has.
        function onSelection() {
            if (!held) return;
            var here = editor.isFocused ? boxAtSelection() : null;
            if (sameBox(here, held)) return;
            var leaving = held;
            Promise.resolve(saving || null).then(function () { return save(); }).then(function () {
                if (!sameBox(held, leaving)) return;
                var now = editor.isFocused ? boxAtSelection() : null;
                if (sameBox(now, leaving)) return;
                held = null;
                var p = presence();
                if (p && !inTitle) p.release();
            });
        }

        function enterTitle() {
            var p = presence();
            if (!p) { inTitle = true; return true; }
            if (!p.claimBox(titleBox())) {
                if (o.onRefused) o.onRefused(titleHolder(), 'title');
                return false;
            }
            held = null;
            inTitle = true;
            if (!titleDirty && latestTitle !== saved.title) {
                saved.title = latestTitle;
                if (o.onTitle) o.onTitle(latestTitle);
            }
            return true;
        }

        function leaveTitle() {
            if (!inTitle) return Promise.resolve();
            return save().then(function () {
                inTitle = false;
                if (!titleDirty && latestTitle !== saved.title) {
                    saved.title = latestTitle;
                    if (o.onTitle) o.onTitle(latestTitle);
                }
                var p = presence();
                if (p && !held) p.release();
            });
        }

        // Boxes somebody else holds in this document, each with the node's
        // position, for drawing faces: [{ pos, node, holder }].
        function heldBlocks() {
            var p = presence();
            if (!p || !editor || editor.isDestroyed) return [];
            var out = [];
            editor.state.doc.descendants(function (node, pos) {
                if (!(node.isBlock && node.attrs && 'blockId' in node.attrs)) return true;
                if (!(BOX_TYPES[node.type.name] || node.isTextblock)) return true;
                var box = boxAt(editor.state.doc, pos, node, o.docId);
                if (!box) return true;
                // A text block inside a list item or cell draws on its box,
                // not on itself.
                if (!box.panel && box.blockId !== node.attrs.blockId) return true;
                var holder = holderOf(box);
                if (holder) out.push({ pos: pos, node: node, holder: holder });
                return node.type.name !== 'personPanel';
            });
            return out;
        }

        // Faces beside held boxes, drawn into `layer` (absolutely positioned
        // inside the same scrolling container as the editor).
        function drawFaces(layer, faceFor) {
            if (!layer || !editor || editor.isDestroyed) return;
            layer.innerHTML = '';
            var base = layer.getBoundingClientRect();
            heldBlocks().forEach(function (h) {
                var dom = editor.view.nodeDOM(h.pos);
                if (!dom || !dom.getBoundingClientRect) return;
                var r = dom.getBoundingClientRect();
                var badge = faceFor(h.holder);
                badge.style.position = 'absolute';
                badge.style.top = (r.top - base.top) + 'px';
                badge.style.left = Math.max(0, (r.right - base.left) + 6) + 'px';
                layer.appendChild(badge);
            });
        }

        // A Person Panel's note: who holds it, if anybody else.
        function panelHolder(personId, noteId) {
            var p = presence();
            if (!p) return null;
            return holderOf(p.box.note(personId, noteId));
        }

        // An orphaned Person Panel, replaced by its text the same way on every
        // page, as block writes the live watch then brings to everybody.
        function replaceOrphanPanel(blockId, noteBody) {
            if (!session || !blockId) return Promise.resolve();
            var change = core().orphanPanelReplacement(currentBlocks(), blockId, noteBody || null);
            if (!change.remove.length) return Promise.resolve();
            var pairs = core().blockUpdatePairs(o.fs, change);
            pairs.push('updatedAt', o.fs.FieldValue.serverTimestamp(), 'updatedByName', (o.byName && o.byName()) || '');
            return ref.update.apply(ref, pairs).catch(function (e) { console.error('Could not replace a Person Panel:', e); });
        }

        function stop() {
            clearTimeout(saveTimer);
            stops.splice(0).forEach(function (s) { try { s(); } catch (e) {} });
        }

        return {
            open: open,
            attach: attach,
            edited: edited,
            titleInput: titleInput,
            setTitleReader: function (fn) { readTitle = fn; },
            save: save,
            enterTitle: enterTitle,
            leaveTitle: leaveTitle,
            titleHolder: titleHolder,
            lockPlugin: lockPlugin,
            heldBlocks: heldBlocks,
            drawFaces: drawFaces,
            panelHolder: panelHolder,
            replaceOrphanPanel: replaceOrphanPanel,
            adopt: adopt,
            stop: stop,
            get readOnly() { return readOnly; },
        };
    }

    return { create: create, boxAt: boxAt, boxesTouched: boxesTouched, AUTOSAVE_MS: AUTOSAVE_MS };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ElderDocumentLive: ElderDocumentLive };
}
