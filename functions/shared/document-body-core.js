// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/document-body-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Document Body Core — the one shape every document written in Mosaic takes.
//
// A Shepherding Note, Meeting Minutes, an Elder Document and an Event Document
// are four different things to a person: different places, different readers,
// different reasons to exist. To the code they are one thing — a title and a
// Note Body (TipTap JSON) — and the only honest differences are WHERE the
// record hangs and WHO may read it. Those two live in the Firestore path and in
// `firestore.rules`, which is exactly where a visibility rule belongs.
//
// So this module owns the parts that must not differ:
//
//   1. The record shape, decided once, so a screen that knows about three
//      fields cannot write a lopsided document.
//   2. What a document with nothing in it looks like, so "new" means the same
//      thing everywhere.
//   3. Whether a body is empty, and what it says at a glance — the line a list
//      shows under a document's name.
//
// Deliberately self-contained, like every other *-core module here: requires
// nothing, mutates nothing, returns new objects.
//
// Loaded as a classic <script> (window.DocumentBodyCore) and exported for Node.

(function (global) {
    'use strict';

    // What an untitled document is called. One literal, because a list, a tab
    // title, a Word filename and a search result showing three different
    // fallbacks is how one document looks like three.
    const DEFAULT_TITLE = 'Untitled Document';

    // Long enough for a real sentence of a title, short enough that a row in a
    // list stays a row.
    const MAX_TITLE_LENGTH = 200;

    // ── A document with nothing in it yet ─────────────────────────────────────
    //
    // Not `null`, and not `{}`. TipTap will refuse a document that is not a
    // `doc` node with content, and an editor handed one silently renders
    // nothing — which reads as "the page is broken", not as "this is empty".
    function emptyBody() {
        return { type: 'doc', content: [{ type: 'paragraph' }] };
    }

    // ── The record shape, decided in one place ────────────────────────────────
    //
    // `contentJson` is the Note Body. The two timestamps are written by the
    // caller (a server timestamp, which this module has no way to make), so
    // they are passed in rather than invented here.
    const RECORD_FIELDS = [
        'title', 'contentJson',
        'createdAt', 'createdBy', 'createdByName',
        'updatedAt', 'updatedByName',
    ];

    function buildDocumentRecord(spec) {
        const s = spec || {};
        const record = {};
        RECORD_FIELDS.forEach(field => {
            record[field] = field in s ? s[field] : null;
        });
        // The two fields nothing downstream can cope with being absent: a
        // document with no body cannot be opened, and one with no title cannot
        // be listed.
        if (record.contentJson == null) record.contentJson = emptyBody();
        record.title = normaliseTitle(record.title);
        return record;
    }

    // ── The title ─────────────────────────────────────────────────────────────

    function normaliseTitle(title) {
        const trimmed = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
        if (!trimmed) return DEFAULT_TITLE;
        return trimmed.slice(0, MAX_TITLE_LENGTH);
    }

    // Whether what somebody typed is a title they chose, or the fallback still
    // sitting there. A list uses this to know when to grey the name.
    function isUntitled(title) {
        return normaliseTitle(title) === DEFAULT_TITLE;
    }

    // ── Reading a body without rendering it ───────────────────────────────────
    //
    // The same walk `tiptap-render.js` and `document-docx-core.js` do, stripped
    // to the one question a LIST asks: what does this say? Block-level nodes are
    // separated by a space so two paragraphs do not run together into a word
    // that was never written.
    const BLOCK_TYPES = {
        paragraph: true, heading: true, listItem: true, blockquote: true,
        codeBlock: true, tableRow: true, tableCell: true, tableHeader: true,
    };

    function collectText(node, out) {
        if (!node) return out;
        if (node.type === 'text' && node.text) { out.push(String(node.text)); return out; }
        if (node.type === 'mention') {
            out.push('@' + String((node.attrs && node.attrs.label) || ''));
            return out;
        }
        if (node.type === 'hardBreak') { out.push(' '); return out; }
        (node.content || []).forEach(child => collectText(child, out));
        if (BLOCK_TYPES[node.type]) out.push(' ');
        return out;
    }

    function plainText(contentJson) {
        if (!contentJson) return '';
        return collectText(contentJson, []).join('').replace(/\s+/g, ' ').trim();
    }

    // ── Empty, and what "empty" honestly means ────────────────────────────────
    //
    // Not simply "no text". A document holding one empty table, or a horizontal
    // rule, or a Person Panel, has something in it that a person put there and
    // would be surprised to see described as blank.
    const CONTENT_WITHOUT_TEXT = {
        table: true, horizontalRule: true, image: true, personPanel: true,
    };

    function hasNodeOfType(node, types) {
        if (!node) return false;
        if (types[node.type]) return true;
        return (node.content || []).some(child => hasNodeOfType(child, types));
    }

    function isEmptyBody(contentJson) {
        if (!contentJson) return true;
        if (plainText(contentJson)) return false;
        return !hasNodeOfType(contentJson, CONTENT_WITHOUT_TEXT);
    }

    // The line under a document's name in a list. Long enough to tell two
    // documents apart, short enough not to become the row.
    const PREVIEW_LENGTH = 120;

    function bodyPreview(contentJson, maxLength) {
        const limit = Number(maxLength) > 0 ? Number(maxLength) : PREVIEW_LENGTH;
        const text = plainText(contentJson);
        if (!text) return '';
        if (text.length <= limit) return text;
        // Cut at a word rather than mid-syllable, unless the first word is
        // itself longer than the whole allowance.
        const cut = text.slice(0, limit);
        const lastSpace = cut.lastIndexOf(' ');
        return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
    }

    // ══ Blocks — how an Elder Document's body is stored (MS-499) ══════════════
    //
    // ⚠ ONE BODY VALUE WAS ONE BOX FOR THE WHOLE DOCUMENT. An Elder Document's
    // Note Body used to be stored whole in `contentJson` and written back whole
    // on every autosave, so two elders in two different paragraphs overwrote
    // each other, and an open page wrote over what the assistant appended.
    //
    // So every block-level node — a heading, a paragraph, a list item, a table
    // cell's paragraph, a picture, a Person Panel — is its own **Block**, kept in
    // the record's `blocks` map under a lasting id (ADR-0065):
    //
    //   { type, attrs?, parent, order, content? }
    //
    // `parent` is the containing Block's id (null at the top), `order` a
    // fractional key among its siblings, and `content` the inline content of a
    // text block (paragraph, heading, code block). A save writes only the Blocks
    // that changed, each at its own path, so two elders in two paragraphs write
    // disjoint fields (ADR-0034).
    //
    // ⚠ ORDER LIVES ON THE CHILD, NEVER AS A LIST ON THE PARENT. A list of child
    // ids is the field two editors would both rewrite (ADR-0039). Inserting
    // between two blocks mints a key between theirs; moving a block rewrites
    // that block alone.
    //
    // ⚠ REBUILDING NEVER DROPS A WORD. A Block whose parent has gone, or that
    // sits somewhere its type cannot, is put at the end of the document, wrapped
    // so the document stays valid. Two blocks with one key are ordered by id.
    //
    // Every reader of an Elder Document body goes through bodyOfRecord, and a
    // legacy record (contentJson, no blocks) still reads as it always did.

    const TEXT_BLOCKS = { paragraph: true, heading: true, codeBlock: true };
    // What each container may hold directly. Anything else placed under it is
    // an orphan, rebuilt at the end of the document.
    const LIST_TYPES = { bulletList: true, orderedList: true };
    const CELL_TYPES = { tableCell: true, tableHeader: true };
    const NEEDS_WRAPPING = { listItem: true, tableRow: true, tableCell: true, tableHeader: true };
    // The boxes a block belongs to (ADR-0062). A list item's box is its own
    // text; lists, tables, rows, quotes, pictures and rules are structure.
    const BOX_TYPES = { listItem: true, tableCell: true, tableHeader: true, personPanel: true };
    const STRUCTURE = {
        bulletList: true, orderedList: true, table: true, tableRow: true,
        blockquote: true, image: true, horizontalRule: true,
    };
    // A container left empty still has to be a valid node.
    const FILLED_WITH_PARAGRAPH = { listItem: true, blockquote: true, tableCell: true, tableHeader: true };
    const DROPPED_WHEN_EMPTY = { bulletList: true, orderedList: true, table: true, tableRow: true };

    function isContainerType(type) {
        return !!(LIST_TYPES[type] || CELL_TYPES[type] || type === 'listItem' || type === 'blockquote' ||
            type === 'table' || type === 'tableRow');
    }

    function mayHold(parentType, childType) {
        if (LIST_TYPES[parentType]) return childType === 'listItem';
        if (parentType === 'table') return childType === 'tableRow';
        if (parentType === 'tableRow') return !!CELL_TYPES[childType];
        if (parentType === 'listItem' || parentType === 'blockquote' || CELL_TYPES[parentType]) {
            return !NEEDS_WRAPPING[childType];
        }
        return false;
    }

    // ── Ids and order keys ────────────────────────────────────────────────────

    const ID_LETTERS = 'abcdefghijklmnopqrstuvwxyz';
    const ID_CHARS = ID_LETTERS + '0123456789';

    // A letter, then letters and digits: safe as a field path segment.
    function newBlockId() {
        let id = ID_LETTERS[Math.floor(Math.random() * ID_LETTERS.length)];
        for (let i = 0; i < 9; i++) id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
        return id;
    }

    const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
    const BASE = DIGITS.length;

    // A key that sorts strictly between `a` and `b` (either may be null for
    // "the start" / "the end"). Never ends in '0', so a key can always be put
    // before any other.
    function orderKeyBetween(a, b) {
        const low = a || '';
        let high = b;
        let out = '';
        for (let i = 0; ; i++) {
            const lo = i < low.length ? DIGITS.indexOf(low[i]) : 0;
            const hi = (high !== null && high !== undefined && i < high.length) ? DIGITS.indexOf(high[i]) : BASE;
            if (lo === hi) { out += DIGITS[lo]; continue; }
            const mid = Math.floor((lo + hi) / 2);
            if (mid > lo) return out + DIGITS[mid];
            // Adjacent digits: keep the low one and look past it, where nothing
            // above can be in the way.
            out += DIGITS[lo];
            high = null;
        }
    }

    // `count` keys, evenly spread and short, for a whole list of siblings.
    function orderKeys(count) {
        let width = 1;
        while (Math.pow(BASE, width) < (count + 1) * 2) width += 1;
        const span = Math.pow(BASE, width);
        const keys = [];
        for (let i = 0; i < count; i++) {
            let n = Math.floor(((i + 1) * span) / (count + 1));
            if (n % BASE === 0) n += 1;
            let key = n.toString(BASE);
            while (key.length < width) key = '0' + key;
            keys.push(key);
        }
        return keys;
    }

    // ── Comparing ─────────────────────────────────────────────────────────────

    function stable(value) {
        if (value === undefined) return 'null';
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
        return '{' + Object.keys(value).sort()
            .filter(k => value[k] !== undefined)
            .map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
    }

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    // A body with every blockId taken off, and an attrs object left empty by
    // that removed — what "the same document" means, ids aside.
    function stripBlockIds(node) {
        if (!node || typeof node !== 'object') return node;
        const out = {};
        Object.keys(node).forEach(key => {
            if (key === 'attrs') {
                const attrs = Object.assign({}, node.attrs);
                delete attrs.blockId;
                if (Object.keys(attrs).length) out.attrs = attrs;
            } else if (key === 'content' && Array.isArray(node.content)) {
                out.content = node.content.map(stripBlockIds);
            } else {
                out[key] = node[key];
            }
        });
        return out;
    }

    function sameBodyIgnoringIds(a, b) {
        return stable(stripBlockIds(a)) === stable(stripBlockIds(b));
    }

    // ── A Note Body as Blocks ─────────────────────────────────────────────────

    // Keys for one list of siblings. Where `previous` already placed a child
    // under the same parent, its key is kept whenever the order allows (the
    // longest run of kept keys that still increases), so a save after an edit,
    // an insert or a move rewrites only the blocks that actually moved.
    function siblingKeys(ids, parentId, previous) {
        const prevKey = ids.map(id => {
            const before = previous && previous[id];
            return (before && (before.parent || null) === parentId && before.order) ? before.order : null;
        });
        // Longest increasing run of previous keys (patience sort).
        const tails = [];
        const tailAt = [];
        const back = new Array(ids.length).fill(-1);
        prevKey.forEach((key, i) => {
            if (key === null) return;
            let lo = 0, hi = tails.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (tails[mid] < key) lo = mid + 1; else hi = mid;
            }
            back[i] = lo > 0 ? tailAt[lo - 1] : -1;
            tails[lo] = key;
            tailAt[lo] = i;
        });
        const keep = new Set();
        let at = tailAt.length ? tailAt[tailAt.length - 1] : -1;
        while (at !== -1) { keep.add(at); at = back[at]; }

        if (!keep.size) return orderKeys(ids.length);
        const keys = new Array(ids.length);
        let left = null;
        for (let i = 0; i < ids.length; i++) {
            if (keep.has(i)) { keys[i] = prevKey[i]; left = keys[i]; continue; }
            let right = null;
            for (let j = i + 1; j < ids.length; j++) { if (keep.has(j)) { right = prevKey[j]; break; } }
            keys[i] = orderKeyBetween(left, right);
            left = keys[i];
        }
        return keys;
    }

    // The Blocks of a Note Body. Ids already on nodes are kept (the first node
    // holding an id keeps it; a later duplicate gets a fresh one from `mint`).
    // `previous`, when given, is the Blocks this body was last saved as, and
    // its order keys are kept where they still fit.
    function blocksOfBody(body, mint, previous) {
        const minter = mint || newBlockId;
        const blocks = {};
        const taken = new Set();

        function idFor(node) {
            const wanted = node.attrs && node.attrs.blockId;
            if (wanted && !taken.has(wanted)) { taken.add(wanted); return wanted; }
            let id = minter();
            while (taken.has(id)) id = minter();
            taken.add(id);
            return id;
        }

        function walk(children, parentId) {
            const nodes = (children || []).filter(n => n && n.type && n.type !== 'text');
            const ids = nodes.map(idFor);
            const keys = siblingKeys(ids, parentId, previous);
            nodes.forEach((node, i) => {
                const id = ids[i];
                const block = { type: node.type, parent: parentId, order: keys[i] };
                const attrs = Object.assign({}, node.attrs || {});
                delete attrs.blockId;
                if (Object.keys(attrs).length) block.attrs = clone(attrs);
                blocks[id] = block;
                if (TEXT_BLOCKS[node.type]) {
                    if (node.content && node.content.length) block.content = clone(node.content);
                } else if (isContainerType(node.type)) {
                    walk(node.content, id);
                }
            });
        }

        walk(body && body.content, null);
        return blocks;
    }

    // ── Blocks as a Note Body ─────────────────────────────────────────────────

    function bySiblingOrder(blocks) {
        return (a, b) => {
            const ka = blocks[a].order || '', kb = blocks[b].order || '';
            if (ka !== kb) return ka < kb ? -1 : 1;
            return a < b ? -1 : (a > b ? 1 : 0);
        };
    }

    function bodyOfBlocks(blocks) {
        const all = blocks || {};
        const ids = Object.keys(all);
        const children = {};
        const orphans = [];

        // A block is placed under its parent only if the parent exists, can
        // hold it, and no loop leads back to the block itself.
        function placed(id) {
            const seen = new Set([id]);
            let at = all[id];
            while (at && at.parent) {
                if (seen.has(at.parent)) return false;
                const parent = all[at.parent];
                if (!parent) return false;
                seen.add(at.parent);
                at = parent;
            }
            return true;
        }

        ids.forEach(id => {
            const block = all[id];
            const parentId = block.parent || null;
            if (parentId === null) {
                if (NEEDS_WRAPPING[block.type]) orphans.push(id);
                else (children.__root__ = children.__root__ || []).push(id);
                return;
            }
            const parent = all[parentId];
            if (!parent || !placed(id) || !mayHold(parent.type, block.type)) {
                orphans.push(id);
                return;
            }
            (children[parentId] = children[parentId] || []).push(id);
        });
        Object.keys(children).forEach(key => children[key].sort(bySiblingOrder(all)));
        orphans.sort(bySiblingOrder(all));

        function nodeOf(id, visiting) {
            if (visiting.has(id)) return null;
            visiting.add(id);
            const block = all[id];
            const node = { type: block.type, attrs: Object.assign({}, clone(block.attrs) || {}, { blockId: id }) };
            if (TEXT_BLOCKS[block.type]) {
                if (block.content && block.content.length) node.content = clone(block.content);
            } else if (isContainerType(block.type)) {
                const kids = (children[id] || []).map(child => nodeOf(child, visiting)).filter(Boolean);
                if (kids.length) node.content = kids;
                else if (FILLED_WITH_PARAGRAPH[block.type]) node.content = [{ type: 'paragraph' }];
                else if (DROPPED_WHEN_EMPTY[block.type]) { visiting.delete(id); return null; }
            }
            visiting.delete(id);
            return node;
        }

        const content = (children.__root__ || []).map(id => nodeOf(id, new Set())).filter(Boolean);

        // Orphans, at the end, wrapped so they are valid where they land.
        orphans.forEach(id => {
            const block = all[id];
            const node = nodeOf(id, new Set());
            if (!node) return;
            if (block.type === 'listItem') content.push({ type: 'bulletList', content: [node] });
            else if (block.type === 'tableRow') content.push({ type: 'table', content: [node] });
            else if (CELL_TYPES[block.type]) (node.content || []).forEach(inner => content.push(inner));
            else content.push(node);
        });

        return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
    }

    // ── A stored document ─────────────────────────────────────────────────────

    function hasBlocks(record) {
        return !!(record && record.blocks && typeof record.blocks === 'object');
    }

    // The Note Body of an Elder Document, whichever way it is stored.
    function bodyOfRecord(record) {
        if (hasBlocks(record)) return bodyOfBlocks(record.blocks);
        return (record && record.contentJson) || emptyBody();
    }

    // A legacy body as Blocks, and whether rebuilding them gives it back.
    function convertLegacy(record, mint) {
        const body = (record && record.contentJson) || emptyBody();
        const blocks = blocksOfBody(body, mint);
        return { blocks, ok: sameBodyIgnoringIds(bodyOfBlocks(blocks), body) };
    }

    // ── What to write ─────────────────────────────────────────────────────────

    // The Blocks to write, and the ids to delete, to move `saved` to `current`.
    function changedBlocks(saved, current) {
        const before = saved || {};
        const now = current || {};
        const write = {};
        Object.keys(now).forEach(id => {
            if (stable(before[id]) !== stable(now[id])) write[id] = now[id];
        });
        const remove = Object.keys(before).filter(id => !(id in now));
        return { write, remove };
    }

    // ── The box a block belongs to ────────────────────────────────────────────

    function boxOfBlock(blocks, id) {
        const all = blocks || {};
        const block = all[id];
        if (!block || STRUCTURE[block.type]) return null;
        const seen = new Set();
        let at = id;
        while (at && all[at] && !seen.has(at)) {
            if (BOX_TYPES[all[at].type]) return at;
            seen.add(at);
            at = all[at].parent;
        }
        return TEXT_BLOCKS[block.type] ? id : null;
    }

    // ── Adding at the end ─────────────────────────────────────────────────────

    function rootIds(blocks) {
        return Object.keys(blocks).filter(id => !blocks[id].parent).sort(bySiblingOrder(blocks));
    }

    // New content after the last top-level block — new Blocks only, so it can
    // never write over a block somebody has open. A document that is nothing
    // but one empty paragraph loses that paragraph.
    function appendBlocks(blocks, fragment, mint) {
        const existing = blocks || {};
        const roots = rootIds(existing);
        const ids = Object.keys(existing);
        const lone = ids.length === 1 && roots.length === 1 &&
            existing[roots[0]].type === 'paragraph' && !(existing[roots[0]].content || []).length;
        const remove = lone ? [roots[0]] : [];
        let last = (!lone && roots.length) ? existing[roots[roots.length - 1]].order : null;

        const minter = mint || newBlockId;
        const guarded = () => { let id = minter(); while (id in existing) id = minter(); return id; };
        const added = blocksOfBody(fragment, guarded);
        Object.keys(added).forEach(id => {
            if (added[id].parent === null) {
                // Re-keyed after the existing ones, in their own order.
                added[id]._root = true;
            }
        });
        rootIds(added).forEach(id => {
            last = orderKeyBetween(last, null);
            added[id].order = last;
        });
        Object.keys(added).forEach(id => { delete added[id]._root; });
        return { write: added, remove };
    }

    // ── A Person Panel whose note was deleted ─────────────────────────────────

    // Replaced by its text — a bold "Name — Note Type" line, then the note's
    // body — with ids made from the panel's own id, so two pages doing it at
    // the same moment write identical records. `noteBody` is the note's body
    // when it could still be read; otherwise the panel's snapshot is used.
    function orphanPanelReplacement(blocks, panelId, noteBody) {
        const all = blocks || {};
        const panel = all[panelId];
        if (!panel) return { write: {}, remove: [] };
        const attrs = panel.attrs || {};
        const header = [attrs.personName, attrs.noteType].filter(Boolean).join(' — ');
        let body = noteBody;
        if (!body && attrs.bodySnapshot) {
            try {
                body = typeof attrs.bodySnapshot === 'string' ? JSON.parse(attrs.bodySnapshot) : attrs.bodySnapshot;
            } catch (e) { body = null; }
        }
        const nodes = [{ type: 'paragraph', content: header ? [{ type: 'text', text: header, marks: [{ type: 'bold' }] }] : [] }]
            .concat((body && body.content) || []);

        let n = 0;
        const replacement = blocksOfBody({ type: 'doc', content: nodes }, () => panelId + 'r' + (n++));

        // Between the panel's place and the next sibling's.
        const parentId = panel.parent || null;
        const siblings = Object.keys(all)
            .filter(id => (all[id].parent || null) === parentId)
            .sort(bySiblingOrder(all));
        const at = siblings.indexOf(panelId);
        const next = at >= 0 && at + 1 < siblings.length ? all[siblings[at + 1]].order : null;
        let left = panel.order;
        rootIds(replacement).forEach(id => {
            left = orderKeyBetween(left, next);
            replacement[id].order = left;
            replacement[id].parent = parentId;
        });
        return { write: replacement, remove: [panelId] };
    }

    // ── One page's copy of the Blocks ─────────────────────────────────────────

    // What one open document editor knows. `stored` is the Blocks as the
    // database has them; `onScreen` the Blocks as this page's editor last
    // produced them for that same version — the editor normalises what it is
    // given, so the two are compared apart and a block is never mistaken for
    // an edit because the editor tidied it.
    function createBlocksSession(stored) {
        const saved = clone(stored || {});
        let onScreen = clone(stored || {});
        const before = new Map();

        function localChanges(current) {
            const c = changedBlocks(onScreen, current);
            return new Set(Object.keys(c.write).concat(c.remove));
        }

        return {
            // The editor has drawn the stored Blocks; this is what it made.
            mounted(current) { onScreen = clone(current || {}); },

            // Blocks for a Note Body from this editor, keeping the order keys
            // it last knew.
            blocksOf(body, mint) { return blocksOfBody(body, mint, onScreen); },

            takeSave(current) {
                const c = changedBlocks(onScreen, current);
                Object.keys(c.write).concat(c.remove).forEach(id => {
                    if (!before.has(id)) before.set(id, { saved: saved[id], onScreen: onScreen[id] });
                    if (id in c.write) { saved[id] = clone(c.write[id]); onScreen[id] = clone(c.write[id]); }
                    else { delete saved[id]; delete onScreen[id]; }
                });
                return c;
            },

            saveLanded(save) {
                Object.keys((save && save.write) || {}).concat((save && save.remove) || []).forEach(id => before.delete(id));
            },

            saveFailed(save) {
                Object.keys((save && save.write) || {}).concat((save && save.remove) || []).forEach(id => {
                    const was = before.get(id);
                    if (!was) return;
                    if (was.saved === undefined) delete saved[id]; else saved[id] = was.saved;
                    if (was.onScreen === undefined) delete onScreen[id]; else onScreen[id] = was.onScreen;
                    before.delete(id);
                });
            },

            // Somebody else's Blocks. A block this page has changed and not
            // saved is never taken over, nor is any block in the box this page
            // holds (`holding`). Returns { set, remove, blocks } — the ids to
            // put on screen and to take off, and the Blocks to draw.
            adopt(incoming, current, where) {
                const theirs = incoming || {};
                const now = current || {};
                const mine = localChanges(now);
                const holding = where && where.holding;
                if (holding) Object.keys(now).forEach(id => { if (id === holding || boxOfBlock(now, id) === holding) mine.add(id); });

                const set = [];
                const remove = [];
                const ids = new Set(Object.keys(saved).concat(Object.keys(theirs)));
                ids.forEach(id => {
                    if (mine.has(id)) return;
                    if (stable(saved[id]) === stable(theirs[id])) return;
                    if (theirs[id] === undefined) {
                        remove.push(id);
                        delete saved[id];
                        delete onScreen[id];
                    } else {
                        set.push(id);
                        saved[id] = clone(theirs[id]);
                        onScreen[id] = clone(theirs[id]);
                    }
                });
                const blocks = Object.assign({}, now);
                set.forEach(id => { blocks[id] = clone(theirs[id]); });
                remove.forEach(id => { delete blocks[id]; });
                return { set: set.sort(), remove: remove.sort(), blocks };
            },

            // The editor has drawn an adoption; this is what it made of it.
            adopted(current, out) {
                ((out && out.set) || []).forEach(id => {
                    if (current && id in current) onScreen[id] = clone(current[id]);
                });
            },
        };
    }

    const DocumentBodyCore = {
        DEFAULT_TITLE,
        MAX_TITLE_LENGTH,
        PREVIEW_LENGTH,
        emptyBody,
        buildDocumentRecord,
        normaliseTitle,
        isUntitled,
        plainText,
        isEmptyBody,
        bodyPreview,
        // Blocks (MS-499)
        newBlockId,
        orderKeyBetween,
        orderKeys,
        stripBlockIds,
        sameBodyIgnoringIds,
        blocksOfBody,
        bodyOfBlocks,
        hasBlocks,
        bodyOfRecord,
        convertLegacy,
        changedBlocks,
        boxOfBlock,
        appendBlocks,
        orphanPanelReplacement,
        createBlocksSession,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DocumentBodyCore;
    }
    if (global) {
        global.DocumentBodyCore = DocumentBodyCore;
    }
})(typeof window !== 'undefined' ? window : null);
