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

    // ── The Elder Document record (MS-283) ───────────────────────────────────
    //
    // Assembling the record used to happen inline in the create handler, which is
    // why nothing could test it and why two identity faults hid there for months.
    // ADR-0015 put the tree logic in this module for the same reason; the record
    // is the same kind of thing — pure, and worth being able to test.

    const MISSING_AUTHOR = 'missing-author';

    // The message is for the console and for a developer reading a stack; the
    // component turns the code into something an Elder should read (MS-283).
    function refuseUnauthored(what) {
        const err = new Error(
            'An Elder Document cannot be created without an ' + what + '.');
        err.code = MISSING_AUTHOR;
        throw err;
    }

    function requiredText(value, what) {
        const text = typeof value === 'string' ? value.trim() : '';
        if (!text) refuseUnauthored(what);
        return text;
    }

    // Who is writing, from what the host page currently knows plus the live auth
    // session as a last resort — the same defensive resolve the mobile port does.
    //
    // Both halves fall back together, deliberately. Rescuing the uid on its own
    // buys nothing, because `buildElderDocument` refuses a document with no author
    // name just as firmly as one with no uid.
    function resolveAuthor(hostIdentity, session) {
        const known = hostIdentity || {};
        const signedIn = known.user || session || null;
        const email = (signedIn && signedIn.email) || '';
        return {
            uid: (signedIn && signedIn.uid) || '',
            name: known.name || email.split('@')[0],
        };
    }

    // The record written to `elder_documents` when an Elder creates a document.
    // Pure: the caller supplies the server-timestamp sentinel, so this is testable
    // without Firebase.
    //
    //   title          what the document is called
    //   docType        'note' (blank Word-style document), 'care-list', or
    //                  'form' (a Form Document, MS-384)
    //   author         { uid, name } of the Elder writing it — both required
    //   timestamp      the value to stamp created/updated with
    //   ownerPersonId  the Person this belongs to, in profile scope; null in the Library
    //   filterId       care-list only: the preset Shepherding View it reads
    //   filterConfig   care-list only: a bespoke filter, used when there is no preset
    //   templateId     form only: which Form Template it was started from
    //   questions      form only: a COPY of that template's questions
    //
    // Refuses an unauthored document rather than emitting one. An Elder Document
    // with a missing author is worse than a create that failed: the record exists,
    // it stands in the Pastoral Record, and nothing surfaces the problem.
    function buildElderDocument({
        title, docType, author, timestamp,
        ownerPersonId = null, filterId = null, filterConfig = null,
        templateId = null, questions = null,
        // A personal shepherding document (MS-405): an interview ABOUT
        // somebody, which lives in the Library AND on that person's own
        // Shepherding Profile. `answers` lets it start already answered —
        // started from somebody's profile, the first question is them.
        shepherdingDoc = false, answers = null, inLibrary = null,
    } = {}) {
        const authorUid = requiredText(author && author.uid, 'author id');
        const authorName = requiredText(author && author.name, 'author name');

        const record = {
            title: title,
            docType: docType,
            authorName: authorName,
            authorUid: authorUid,
            createdAt: timestamp,
            updatedAt: timestamp,
            updatedByName: authorName,
        };

        // A profile document belongs to its Person and is hidden from shared
        // surfaces until explicitly opted into the Library (ADR-0015).
        if (ownerPersonId) {
            record.ownerPersonId = ownerPersonId;
            record.inLibrary = false;
        }
        // ⚠ A shepherding document is in BOTH places by construction, so it is
        // never waiting to be opted in. Set after the block above, which would
        // otherwise say false for one started from a profile.
        if (inLibrary !== null) record.inLibrary = inLibrary === true;

        if (docType === 'care-list') {
            if (filterConfig) record.filterConfig = { ...filterConfig };
            else record.filterId = filterId;
            record.careListData = {}; // Person id -> TipTap JSON
        } else if (docType === 'form') {
            // A Form Document (MS-384). It holds its questions and answers
            // where a note holds prose — the same move `care-list` above
            // already makes, so this is a third docType rather than a new
            // shape of record.
            //
            // ⚠ THE QUESTIONS ARE COPIED, NOT REFERENCED, AND THAT IS THE
            // WHOLE POINT. A record has to keep the question it was actually
            // asked, so editing the template afterwards must never reach back
            // into interviews already filled in. Deep-copied because a
            // question carries its own options and scale, and a shallow copy
            // would leave those shared with the template.
            record.templateId = templateId || null;
            record.questions = JSON.parse(JSON.stringify(
                Array.isArray(questions) ? questions : [],
            ));
            // Empty rather than absent: an answers field that might not be
            // there is one every reader has to guard against.
            record.answers = answers ? JSON.parse(JSON.stringify(answers)) : {};
            // ⚠ STAMPED ON THE DOCUMENT, not looked up. A document keeps a copy
            // of its questions and never reads its template again (ADR-0055),
            // so the page that files it on somebody's profile has to be able to
            // tell what kind of document it is holding without asking anybody.
            if (shepherdingDoc) record.shepherdingDoc = true;
        } else {
            record.contentJson = null;
        }

        return record;
    }

    // Put a document at the top of a structure, unless it is already somewhere
    // in it. Returns whether anything changed, so a caller can skip the write.
    function fileInRoot(root, docId) {
        if (!root || containsDoc(root, docId)) return false;
        if (!root.children) root.children = [];
        root.children.push({ type: 'document', id: docId });
        return true;
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
        MISSING_AUTHOR,
        buildElderDocument,
        fileInRoot,
        resolveAuthor,
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
