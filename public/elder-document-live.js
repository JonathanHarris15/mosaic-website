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
            // Wrapping or lifting keeps the content between but gives it a new
            // parent — every block moved that way is changed too.
            if (typeof step.gapFrom === 'number') ranges.push([step.from, step.to]);
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
                    // A list item or cell whose own opening or closing is in
                    // the range is itself changed — lifting, indenting or
                    // unwrapping it touches only those tokens, never the text
                    // inside. One merely around the range is not.
                    if (BOX_TYPES[node.type.name]) {
                        var end = pos + node.nodeSize;
                        if ((pos >= from && pos < to) || (end > from && end <= to)) add(blockBox(node, docId));
                    }
                    return true;
                });
            });
        });
        return Object.keys(found).map(function (k) { return found[k]; });
    }

    // ── Putting another version on screen ─────────────────────────────────────

    // Change `oldFrag` (at `start` in the transaction's document) into
    // `newFrag` with as little replaced as possible: blocks matched by id,
    // unchanged ones untouched, a changed container patched inside rather
    // than replaced, and everything done from the bottom up so earlier
    // positions stay true. The paragraph somebody is typing in is never
    // replaced because something above and below it changed, so their cursor
    // and undo history stay where they are.
    function patchFragment(tr, oldFrag, newFrag, start) {
        var olds = [], news = [];
        oldFrag.forEach(function (n) { olds.push(n); });
        newFrag.forEach(function (n) { news.push(n); });
        var idOf = function (n) { return n.attrs && n.attrs.blockId; };

        // Longest common run of ids.
        var L = [];
        for (var i = 0; i <= olds.length; i++) { L.push(new Array(news.length + 1).fill(0)); }
        for (var a = olds.length - 1; a >= 0; a--) {
            for (var b = news.length - 1; b >= 0; b--) {
                L[a][b] = (idOf(olds[a]) && idOf(olds[a]) === idOf(news[b]))
                    ? L[a + 1][b + 1] + 1 : Math.max(L[a + 1][b], L[a][b + 1]);
            }
        }
        var pairs = [];
        a = 0; b = 0;
        while (a < olds.length && b < news.length) {
            if (idOf(olds[a]) && idOf(olds[a]) === idOf(news[b])) { pairs.push([a, b]); a++; b++; }
            else if (L[a + 1][b] >= L[a][b + 1]) a++;
            else b++;
        }

        var pos = [start];
        olds.forEach(function (n, k) { pos.push(pos[k] + n.nodeSize); });

        // Segments: gaps between matched pairs, and the pairs themselves.
        var segments = [];
        var ai = 0, bi = 0;
        pairs.forEach(function (pr) {
            segments.push({ gap: true, a0: ai, a1: pr[0], b0: bi, b1: pr[1] });
            segments.push({ gap: false, a: pr[0], b: pr[1] });
            ai = pr[0] + 1; bi = pr[1] + 1;
        });
        segments.push({ gap: true, a0: ai, a1: olds.length, b0: bi, b1: news.length });

        for (var s = segments.length - 1; s >= 0; s--) {
            var seg = segments[s];
            if (seg.gap) {
                if (seg.a0 === seg.a1 && seg.b0 === seg.b1) continue;
                var added = news.slice(seg.b0, seg.b1);
                if (added.length) tr.replaceWith(pos[seg.a0], pos[seg.a1], added);
                else tr.delete(pos[seg.a0], pos[seg.a1]);
                continue;
            }
            var was = olds[seg.a], now = news[seg.b];
            if (was.eq(now)) continue;
            var at = pos[seg.a];
            if (was.type === now.type && was.content.eq(now.content)) {
                tr.setNodeMarkup(at, null, now.attrs, now.marks);
            } else if (was.type === now.type && !was.isTextblock && !was.isAtom && was.content.size && now.content.size) {
                if (!was.sameMarkup(now)) tr.setNodeMarkup(at, null, now.attrs, now.marks);
                patchFragment(tr, was.content, now.content, at + 1);
            } else {
                tr.replaceWith(at, at + was.nodeSize, now);
            }
        }
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
        var lastData = null;      // the latest version of the record that arrived

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
            lastData = snap.data();
            adopt(lastData);
        }

        // Is this page still holding the box it last claimed? A quiet hold
        // lets go after a minute (ADR-0062) without this layer being told.
        function stillHolding() {
            if (!held) return false;
            var p = presence();
            return !p || !p.isHolding || p.isHolding(held.scopeKey, held.boxKey);
        }

        // Somebody else's version of the document.
        function adopt(data) {
            if (!editor || !session || editor.isDestroyed) return;
            var incoming = core().hasBlocks(data) ? data.blocks : null;
            if (incoming) {
                var out = session.adopt(incoming, currentBlocks(), {
                    // Only a box still held is protected: one that went quiet
                    // may have been written by somebody else since.
                    holding: stillHolding() ? held.blockId : null,
                    draw: function (blocks) {
                        try {
                            applyBlocks(blocks);
                            return true;
                        } catch (e) {
                            console.error('Could not show another elder\u2019s change to this document:', e);
                            return false;
                        }
                    },
                });
                if (out.set.length || out.remove.length) session.adopted(currentBlocks(), out);
            }
            var theirTitle = core().normaliseTitle(data.title);
            latestTitle = theirTitle;
            if (!titleDirty && !inTitle && theirTitle !== saved.title) {
                saved.title = theirTitle;
                if (o.onTitle) o.onTitle(theirTitle);
            }
        }

        // Put Blocks on screen, marked remote: not undoable, not an edit of
        // ours, not refused by the locks. Throws if the editor cannot hold
        // them (nothing is dispatched then).
        function applyBlocks(blocks) {
            var next = editor.schema.nodeFromJSON(core().bodyOfBlocks(blocks));
            next.check();
            var tr = editor.state.tr;
            patchFragment(tr, editor.state.doc.content, next.content, 0);
            if (!tr.docChanged) return;
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
                    // A Person Panel's copy of its note, written after the note
                    // saved: the note's own box was already checked.
                    if (tr.getMeta('panelSnapshot')) return true;
                    var p = presence();
                    if (!p) return true;
                    // The box this page held went quiet. Its block may have
                    // been written by somebody else since, so the keystroke is
                    // dropped and the latest copy put on screen; the next one
                    // claims it afresh.
                    if (held && !stillHolding()) {
                        held = null;
                        if (lastData) {
                            var data = lastData;
                            Promise.resolve().then(function () { adopt(data); });
                        }
                        return false;
                    }
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

        // Who holds what, drawn into `layer`: a zero-size, absolutely
        // positioned element at the top left of the editor's content, inside
        // the same scrolling container, so marks scroll with the text. Each
        // held box gets a bar down its left edge and the holder's face at its
        // right. `faceFor(holder)` makes the face element.
        function drawFaces(layer, faceFor) {
            if (!layer || !editor || editor.isDestroyed) return;
            layer.innerHTML = '';
            var base = layer.getBoundingClientRect();
            var edge = editor.view.dom.getBoundingClientRect();
            heldBlocks().forEach(function (h) {
                var dom = editor.view.nodeDOM(h.pos);
                if (!dom || !dom.getBoundingClientRect) return;
                var r = dom.getBoundingClientRect();
                var bar = root.document.createElement('div');
                bar.className = 'doc-held-bar';
                bar.style.cssText = 'position:absolute;width:3px;border-radius:2px;pointer-events:none;';
                bar.style.top = (r.top - base.top) + 'px';
                bar.style.left = Math.max(0, r.left - base.left - 8) + 'px';
                bar.style.height = r.height + 'px';
                layer.appendChild(bar);
                var badge = faceFor(h.holder);
                badge.style.position = 'absolute';
                badge.style.top = (r.top - base.top) + 'px';
                badge.style.right = (base.left - edge.right + 4) + 'px';
                badge.style.left = 'auto';
                layer.appendChild(badge);
            });
        }

        // A Person Panel's note: who holds it, if anybody else.
        function panelHolder(personId, noteId) {
            var p = presence();
            if (!p) return null;
            return holderOf(p.box.note(personId, noteId));
        }

        // Typing in a Person Panel's note body: hold the note's box (the same
        // box the profile's note editor claims). True means carry on. Goes
        // through here, not straight to presence, so this layer always knows
        // which box the page holds — a store holds one box at a time.
        function holdPanel(personId, noteId) {
            var p = presence();
            if (!p) return true;
            var box = panelBox({ attrs: { personId: personId, noteId: noteId } });
            if (!box) return true;
            if (sameBox(held, box)) {
                if (p.touch()) return true;
                held = null;
                if (o.onRefused) o.onRefused(holderOf(box), 'Person Panel');
                return false;
            }
            if (!p.claimBox(box)) {
                if (o.onRefused) o.onRefused(holderOf(box), 'Person Panel');
                return false;
            }
            held = box;
            inTitle = false;
            return true;
        }

        // Out of a Person Panel's note body, once its own save is done.
        function leavePanel(personId, noteId) {
            var p = presence();
            if (!p) return;
            var box = panelBox({ attrs: { personId: personId, noteId: noteId } });
            if (!box || !sameBox(held, box)) return;
            held = null;
            if (!inTitle) p.release();
        }

        // A Person Panel whose note has gone, replaced by its text. Through
        // detachPanel, in a transaction: if the profile already replaced it
        // with the note's real words, the panel is no longer there and this
        // writes nothing.
        function replaceOrphanPanel(noteId) {
            if (!noteId || readOnly) return Promise.resolve();
            return detachPanel(o.db, o.fs, o.docId, noteId, null)
                .catch(function (e) { console.error('Could not replace a Person Panel:', e); });
        }

        // Presence has just started: record the box this page already holds.
        function reclaim() {
            var p = presence();
            if (!p) return;
            if (held && !p.claimBox(held)) {
                if (o.onRefused) o.onRefused(holderOf(held), 'paragraph');
                held = null;
            } else if (!held && inTitle && !p.claimBox(titleBox())) {
                if (o.onRefused) o.onRefused(titleHolder(), 'title');
            }
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
            holdPanel: holdPanel,
            reclaim: reclaim,
            leavePanel: leavePanel,
            replaceOrphanPanel: replaceOrphanPanel,
            adopt: adopt,
            stop: stop,
            get readOnly() { return readOnly; },
        };
    }

    // ── A note deleted from a profile ─────────────────────────────────────────

    // The Person Panel for `noteId` in document `docId`, replaced by a bold
    // header and the note's words (`noteBody`, a Note Body, or null to use the
    // panel's own last copy). Written as Blocks, so an open document takes the
    // change in live — no message between tabs, and it reaches other devices.
    // A legacy document is converted in the same transaction; one that cannot
    // be converted without changing it is left alone.
    function detachPanel(db, fs, docId, noteId, noteBody) {
        var ref = db.collection('elder_documents').doc(docId);
        return db.runTransaction(function (tx) {
            return tx.get(ref).then(function (snap) {
                if (!snap.exists) return false;
                var data = snap.data();
                var blocks = null;
                var converting = false;
                if (core().hasBlocks(data)) {
                    blocks = data.blocks;
                } else {
                    var converted = core().convertLegacy(data);
                    if (!converted.ok) return false;
                    blocks = converted.blocks;
                    converting = true;
                }
                var panelId = Object.keys(blocks).filter(function (id) {
                    var b = blocks[id];
                    return b.type === 'personPanel' && b.attrs && b.attrs.noteId === noteId;
                })[0];
                if (!panelId) return false;
                var change = core().orphanPanelReplacement(blocks, panelId, noteBody || null);
                if (converting) {
                    var next = Object.assign({}, blocks, change.write);
                    change.remove.forEach(function (id) { delete next[id]; });
                    tx.update(ref, { blocks: next, contentJson: fs.FieldValue.delete(), updatedAt: fs.FieldValue.serverTimestamp() });
                } else {
                    var pairs = core().blockUpdatePairs(fs, change);
                    pairs.push('updatedAt', fs.FieldValue.serverTimestamp());
                    tx.update.apply(tx, [ref].concat(pairs));
                }
                return true;
            });
        });
    }

    return { create: create, boxAt: boxAt, boxesTouched: boxesTouched, detachPanel: detachPanel, AUTOSAVE_MS: AUTOSAVE_MS };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ElderDocumentLive: ElderDocumentLive };
}
