// Shepherding Documents — pure tree engine.
//
// The Document Library and the per-person Documents tab (MS-98) share one folder
// model: an in-memory tree `{ children: [...] }` whose nodes are either
//   { type: 'folder',   id, name, children: [...] }   or
//   { type: 'document', id }
// A `document` node holds no content — it references an `elder_documents` record
// by id, so the SAME document can be referenced from more than one tree (that is
// how "opt a profile document into the Library" surfaces one file in two places,
// no copy). This module is the pure, Firestore-free logic over such a tree; the
// page components own persistence (which structure doc to load/save) and Firebase.
//
// Extracted verbatim from the original documentLibrary component so behaviour is
// identical, plus `treeDocIds` for the shared-surface filtering MS-98 needs.
(function (global) {
    'use strict';

    function newId() {
        return typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2) + Date.now().toString(36);
    }

    // The folder node with this id, searched depth-first from `root`, or null.
    function getFolderById(root, id) {
        for (const child of (root.children || [])) {
            if (child.type === 'folder') {
                if (child.id === id) return child;
                const found = getFolderById(child, id);
                if (found) return found;
            }
        }
        return null;
    }

    // The node (folder or root) that directly contains `targetId`, or null.
    function findParent(root, targetId) {
        for (const child of (root.children || [])) {
            if (child.id === targetId) return root;
            if (child.type === 'folder') {
                const found = findParent(child, targetId);
                if (found) return found;
            }
        }
        return null;
    }

    // Any node (folder or document) with this id, or null.
    function findItemById(root, id) {
        for (const child of (root.children || [])) {
            if (child.id === id) return child;
            if (child.type === 'folder') {
                const found = findItemById(child, id);
                if (found) return found;
            }
        }
        return null;
    }

    // The folder-id path from the root down to `targetId`, or null if not found.
    function findPathToFolder(root, targetId, path = []) {
        for (const child of (root.children || [])) {
            if (child.type === 'folder') {
                if (child.id === targetId) return [...path, child.id];
                const found = findPathToFolder(child, targetId, [...path, child.id]);
                if (found) return found;
            }
        }
        return null;
    }

    // Every document id anywhere in the subtree (depth-first).
    function getAllDocIds(node) {
        const ids = [];
        for (const child of (node.children || [])) {
            if (child.type === 'document') ids.push(child.id);
            else if (child.type === 'folder') ids.push(...getAllDocIds(child));
        }
        return ids;
    }

    // Every document id referenced anywhere in the whole tree. The canonical
    // membership test for "is this document in this library/profile."
    function treeDocIds(root) {
        return getAllDocIds(root);
    }

    // True if the document id appears anywhere in the tree.
    function containsDoc(root, docId) {
        return getAllDocIds(root).includes(docId);
    }

    // Remove the node with `targetId` from wherever it sits (mutates). Returns
    // whether anything was removed.
    function removeFromTree(root, targetId) {
        const idx = (root.children || []).findIndex(c => c.id === targetId);
        if (idx !== -1) { root.children.splice(idx, 1); return true; }
        for (const child of (root.children || [])) {
            if (child.type === 'folder' && removeFromTree(child, targetId)) return true;
        }
        return false;
    }

    // True if `potentialDescendantId` sits inside the folder `ancestorId`.
    function isDescendant(root, potentialDescendantId, ancestorId) {
        const ancestor = getFolderById(root, ancestorId);
        if (!ancestor) return false;
        return getFolderById(ancestor, potentialDescendantId) !== null;
    }

    // Flattened list of folders as move targets: [{ id, name, depth }], skipping
    // `excludeId` and its subtree is the caller's job (pass excludeId to omit the
    // folder itself; descendant guarding is done at move time via isDescendant).
    function getFolderOptions(root, excludeId = null, node = null, depth = 0) {
        const from = node || root;
        const options = [];
        for (const child of (from.children || [])) {
            if (child.type === 'folder' && child.id !== excludeId) {
                options.push({ id: child.id, name: child.name, depth });
                options.push(...getFolderOptions(root, excludeId, child, depth + 1));
            }
        }
        return options;
    }

    const ROOT = '__root__';

    // Move `item` (a {type,id[,...]} descriptor) to `targetFolderId` (ROOT for the
    // top level), preserving a moved folder's own subtree. Mutates `root`. Returns
    // true on success, false if the target no longer exists.
    function moveNode(root, item, targetFolderId) {
        const existing = item.type === 'folder' ? getFolderById(root, item.id) : findItemById(root, item.id);
        const snapshot = item.type === 'folder' ? (existing || item) : { type: 'document', id: item.id };

        removeFromTree(root, item.id);

        const target = targetFolderId === ROOT ? root : getFolderById(root, targetFolderId);
        if (!target) return false;
        if (!target.children) target.children = [];
        target.children.push(snapshot);
        return true;
    }

    const ShepherdingDocsCore = {
        ROOT,
        newId,
        getFolderById,
        findParent,
        findItemById,
        findPathToFolder,
        getAllDocIds,
        treeDocIds,
        containsDoc,
        removeFromTree,
        isDescendant,
        getFolderOptions,
        moveNode,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ShepherdingDocsCore;
    }
    if (global) {
        global.ShepherdingDocsCore = ShepherdingDocsCore;
    }
})(typeof window !== 'undefined' ? window : null);
