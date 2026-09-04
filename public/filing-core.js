// Filing Core — where a thing is filed, and every question a library page
// asks about that.
//
// A **folder** is a record carrying a name and the folder it sits in. An
// **item** (a Form Template, a Printable) carries the folder IT sits in. Both
// are flat: neither knows its children. So "what is in here", "where am I",
// "how much goes if I delete this" and "may I drop this there" are all walks
// over two plain lists, and those walks live here — once, for every library
// that files things this way.
//
// ⚠ THIS IS DELIBERATELY NOT HOW THE DOCUMENT LIBRARY STORES FOLDERS, and the
// difference is load-bearing rather than an oversight — see ADR-0054.
// `shepherding-documents-core.js` keeps one nested tree in a single record and
// rewrites it whole on every change. That is right for elders, who are few.
// It is wrong for a library open to editors, who are many: two of them filing
// at the same time means the second whole-record write silently discards the
// first. Here every filing move writes ONE record, and an item whose folder
// has gone comes back to the top level rather than vanishing.
//
// Began life as `form-folders-core.js` (MS-375). When the Printables library
// (MS-392) needed the same walks, the engine moved here and that module became
// a thin wrapper keeping its Forms-flavoured names, so nothing that already
// read it had to change.
//
// Self-contained like every other *-core module: requires nothing, mutates
// nothing, returns new objects, knows nothing about Firestore. Loaded as a
// classic <script> (window.FilingCore) and exported for Node.

(function (global) {
    'use strict';

    // The top level is the absence of a parent. It gets a name here only so the
    // "Move to…" dialog has something to key a row on — it is never stored.
    const TOP_LEVEL = '__top__';

    // ── The name ─────────────────────────────────────────────────────────────
    //
    // 60 characters, shorter than an item's own name. A folder name is read in
    // a breadcrumb rather than on a line of its own, and three of them plus the
    // chevrons have to survive a phone. Capped in the model rather than by a
    // maxlength attribute, because a name arrives from the rename box, from a
    // paste, and from whatever a future import does.
    const MAX_FOLDER_NAME_LENGTH = 60;
    const DEFAULT_FOLDER_NAME = 'Untitled folder';

    function normaliseFolderName(name) {
        const trimmed = String(name == null ? '' : name).trim();
        if (!trimmed) return DEFAULT_FOLDER_NAME;
        return trimmed.slice(0, MAX_FOLDER_NAME_LENGTH);
    }

    // ── The record ───────────────────────────────────────────────────────────

    function buildFolder(spec) {
        const s = spec || {};
        return {
            name: normaliseFolderName(s.name),
            // Stored as an explicit null rather than left off, so "at the top
            // level" and "this record predates folders" cannot be told apart by
            // accident later.
            parentId: s.parentId || null,
        };
    }

    // ── Reading the graph ────────────────────────────────────────────────────

    function byId(folders) {
        const map = {};
        (folders || []).forEach(f => { if (f && f.id) map[f.id] = f; });
        return map;
    }

    // Everything here walks parent links, and a walk over data somebody else
    // wrote has to be able to stop. Two things can go wrong and both are
    // handled rather than assumed away: a parent that has gone (the walk ends
    // early — the folder is still real and still holds items), and a pair of
    // folders that claim each other (the walk would never end). `seen` is what
    // makes the second one terminate.
    function ancestryOf(folders, folderId) {
        const map = byId(folders);
        const chain = [];
        const seen = {};
        let current = folderId ? map[folderId] : null;
        while (current && !seen[current.id]) {
            seen[current.id] = true;
            chain.push(current);
            current = current.parentId ? map[current.parentId] : null;
        }
        return chain;
    }

    // Top level down to the folder you are in. Empty at the top level — the
    // page draws its own name for the root, so this returns only what is
    // below it.
    function breadcrumbFor(folders, folderId) {
        return ancestryOf(folders, folderId)
            .reverse()
            .map(f => ({ id: f.id, name: f.name }));
    }

    function sameFolder(a, b) {
        return (a || null) === (b || null);
    }

    // Folders directly inside this one, by name, so the library's order does not
    // depend on what Firestore happened to return.
    function childFolders(folders, folderId) {
        return (folders || [])
            .filter(f => f && sameFolder(f.parentId, folderId))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    // Items directly in this folder.
    //
    // `folders` is optional and only matters at the top level: pass it, and an
    // item filed into a folder that has since gone comes back to the top rather
    // than becoming invisible. That is the promise the whole storage choice
    // exists to keep — an item is always somewhere in the library.
    function itemsIn(items, folderId, folders) {
        const known = folders ? byId(folders) : null;
        return (items || []).filter(item => {
            if (!item) return false;
            const filed = item.folderId || null;
            if (sameFolder(filed, folderId)) return true;
            if (folderId || !known || !filed) return false;
            return !known[filed];
        });
    }

    // Every folder beneath this one, at any depth.
    function descendantFolderIds(folders, folderId) {
        const out = [];
        let frontier = childFolders(folders, folderId).map(f => f.id);
        const seen = {};
        while (frontier.length) {
            const next = [];
            frontier.forEach(id => {
                if (!id || seen[id]) return;
                seen[id] = true;
                out.push(id);
                childFolders(folders, id).forEach(child => next.push(child.id));
            });
            frontier = next;
        }
        return out;
    }

    // Every item at any depth beneath this folder, including the ones directly
    // in it. This is the number the delete confirmation names, and it has to
    // reach the bottom: a folder that looks empty because its items are one
    // level down is exactly the one somebody deletes by accident.
    function itemsUnder(folders, items, folderId) {
        const inScope = {};
        if (folderId) inScope[folderId] = true;
        descendantFolderIds(folders, folderId).forEach(id => { inScope[id] = true; });
        return (items || []).filter(f => f && f.folderId && inScope[f.folderId]);
    }

    function isDescendant(folders, candidateId, ancestorId) {
        if (!candidateId || !ancestorId || candidateId === ancestorId) return false;
        return descendantFolderIds(folders, ancestorId).indexOf(candidateId) !== -1;
    }

    // ── Moving ───────────────────────────────────────────────────────────────

    // Returns a reason rather than a bare false. A move refused without a
    // sentence is a greyed box, which is the complaint MS-360 already answered
    // for the rung settings.
    function canMoveFolder(folders, folderId, targetParentId) {
        if (!folderId) return { ok: false, why: 'Nothing to move.' };
        const map = byId(folders);
        if (!map[folderId]) return { ok: false, why: 'That folder no longer exists.' };

        const target = targetParentId || null;
        if (target === null) return { ok: true, why: '' };
        if (!map[target]) return { ok: false, why: 'That folder no longer exists.' };
        if (target === folderId) {
            return { ok: false, why: 'A folder cannot go inside itself.' };
        }
        if (isDescendant(folders, target, folderId)) {
            return { ok: false, why: 'A folder cannot go inside something it already contains.' };
        }
        return { ok: true, why: '' };
    }

    // Every place a thing may be moved to, flattened for the "Move to…" dialog
    // and carrying the depth each row is drawn at. The top level is always
    // offered and comes first, under the name the page gives its root.
    // `excludeFolderId` is the folder being moved: it and its whole subtree are
    // left out, so the dialog cannot offer a move canMoveFolder would then
    // refuse.
    function moveTargets(folders, excludeFolderId, topLevelName) {
        const out = [{ id: TOP_LEVEL, name: topLevelName || 'Top level', depth: 0 }];
        const barred = {};
        if (excludeFolderId) {
            barred[excludeFolderId] = true;
            descendantFolderIds(folders, excludeFolderId).forEach(id => { barred[id] = true; });
        }
        const walk = (parentId, depth) => {
            childFolders(folders, parentId).forEach(folder => {
                if (barred[folder.id]) return;
                out.push({ id: folder.id, name: folder.name, depth: depth });
                walk(folder.id, depth + 1);
            });
        };
        walk(null, 1);
        return out;
    }

    const FilingCore = {
        TOP_LEVEL,
        MAX_FOLDER_NAME_LENGTH,
        DEFAULT_FOLDER_NAME,
        normaliseFolderName,
        buildFolder,
        breadcrumbFor,
        childFolders,
        itemsIn,
        descendantFolderIds,
        itemsUnder,
        isDescendant,
        canMoveFolder,
        moveTargets,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FilingCore;
    }
    if (global) {
        global.FilingCore = FilingCore;
    }
})(typeof window !== 'undefined' ? window : null);
