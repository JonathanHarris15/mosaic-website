// Printable Store — reading and writing Printables and the folders they are
// filed in (MS-392).
//
// Everything here runs as somebody signed in at editor or above, which is
// what `firestore.rules` grants on `printables` and `printable_folders`. A
// member reading a Printable linked to an event they may see comes later
// (MS-400) and through a narrower rule, not a wider store.
//
// ⚠ Every filing write here touches ONE record (ADR-0054). Two editors filing
// two different things at the same moment write two different documents, so
// neither loses the other's change. A helper that gathered the folders into
// one document to save "the tree" would put the collision back.

(function (global) {
    'use strict';

    const isNode = (typeof require === 'function' && typeof module !== 'undefined' && module.exports);
    const Core = isNode ? require('./printable-core.js') : global.PrintableCore;
    const Filing = isNode ? require('./filing-core.js') : global.FilingCore;

    const PRINTABLES = 'printables';
    const FOLDERS = 'printable_folders';
    const TEMPLATES = 'printable_templates';

    function who(user) {
        return (user && user.displayName) || (user && user.email) || 'Somebody';
    }

    function stamp(fb, user) {
        return {
            updatedAt: fb.firestore.FieldValue.serverTimestamp(),
            updatedByName: who(user),
        };
    }

    // ── Reading ──────────────────────────────────────────────────────────────

    async function listPrintables(db) {
        const snap = await db.collection(PRINTABLES).orderBy('updatedAt', 'desc').get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }

    async function loadPrintable(db, id) {
        const doc = await db.collection(PRINTABLES).doc(id).get();
        return doc.exists ? Object.assign({ id: doc.id }, doc.data()) : null;
    }

    async function listFolders(db) {
        const snap = await db.collection(FOLDERS).get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }

    // ── Writing a Printable ──────────────────────────────────────────────────

    async function createPrintable(db, fb, user, spec) {
        const record = Core.buildPrintable(spec || {});
        const ref = await db.collection(PRINTABLES).add(Object.assign(record, {
            createdAt: fb.firestore.FieldValue.serverTimestamp(),
            createdBy: (user && user.uid) || null,
            createdByName: who(user),
        }, stamp(fb, user)));
        return ref.id;
    }

    // Saving rebuilds the record through PrintableCore rather than merging a
    // patch, so a saved project can never hold a shape the model would refuse
    // to open. Who made it survives; who last touched it is restamped.
    async function savePrintable(db, fb, user, id, printable) {
        const record = Core.buildPrintable(printable);
        await db.collection(PRINTABLES).doc(id).set(Object.assign(record, {
            createdAt: printable.createdAt || null,
            createdBy: printable.createdBy || null,
            createdByName: printable.createdByName || null,
        }, stamp(fb, user)), { merge: true });
    }

    async function renamePrintable(db, fb, user, id, name) {
        await db.collection(PRINTABLES).doc(id)
            .set(Object.assign({ name: Core.normaliseName(name) }, stamp(fb, user)), { merge: true });
    }

    async function movePrintable(db, fb, user, id, folderId) {
        await db.collection(PRINTABLES).doc(id)
            .set(Object.assign({ folderId: folderId || null }, stamp(fb, user)), { merge: true });
    }

    // The copy is a fresh record beside the original: same paper, same pages,
    // same bindings, a new name. Reads the original from Firestore rather than
    // trusting the row the library holds, because the library lists projects
    // without their pages.
    async function duplicatePrintable(db, fb, user, id, takenNames) {
        const original = await loadPrintable(db, id);
        if (!original) throw new Error('That printable no longer exists.');
        const copy = Core.duplicatePrintable(original, takenNames);
        return createPrintable(db, fb, user, copy);
    }

    async function deletePrintable(db, id) {
        await db.collection(PRINTABLES).doc(id).delete();
    }

    // ── Folders ──────────────────────────────────────────────────────────────

    async function createFolder(db, fb, user, spec) {
        const record = Filing.buildFolder(spec || {});
        const ref = await db.collection(FOLDERS).add(Object.assign(record, {
            createdAt: fb.firestore.FieldValue.serverTimestamp(),
            createdByName: who(user),
        }));
        return ref.id;
    }

    async function renameFolder(db, folderId, name) {
        await db.collection(FOLDERS).doc(folderId)
            .set({ name: Filing.normaliseFolderName(name) }, { merge: true });
    }

    // The caller checks canMoveFolder first. This does not re-check, because a
    // move refused deep in the store is a move whose reason never reaches the
    // person who tried it.
    async function moveFolder(db, folderId, parentId) {
        await db.collection(FOLDERS).doc(folderId)
            .set({ parentId: parentId || null }, { merge: true });
    }

    // Deleting a folder takes everything under it, at any depth. The page asks
    // first and names the count of projects. Projects go one at a time so a
    // failure part-way leaves a smaller library rather than a folder that is
    // gone with its projects still in it — an orphaned project comes back to
    // the top level and can be found again, which a lost one cannot.
    async function deleteFolderTree(db, folders, printables, folderId) {
        const doomedFolders = [folderId].concat(Filing.descendantFolderIds(folders, folderId));
        const doomed = Filing.itemsUnder(folders, printables, folderId);

        for (const p of doomed) {
            await deletePrintable(db, p.id);
        }
        const batch = db.batch();
        doomedFolders.forEach(id => batch.delete(db.collection(FOLDERS).doc(id)));
        await batch.commit();
        return doomed.length;
    }

    // ── Custom page templates (MS-393) ───────────────────────────────────────
    //
    // A page somebody built, kept to start the next project from. Offered in
    // the picker beside the papers, for every editor.

    async function listTemplates(db) {
        const snap = await db.collection(TEMPLATES).orderBy('name').get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }

    async function saveTemplate(db, fb, user, spec) {
        const record = Core.buildCustomTemplate(spec || {});
        const ref = await db.collection(TEMPLATES).add(Object.assign(record, {
            createdAt: fb.firestore.FieldValue.serverTimestamp(),
            createdByName: who(user),
        }));
        return ref.id;
    }

    async function deleteTemplate(db, id) {
        await db.collection(TEMPLATES).doc(id).delete();
    }

    const PrintableStore = {
        PRINTABLES,
        FOLDERS,
        TEMPLATES,
        listTemplates,
        saveTemplate,
        deleteTemplate,
        listPrintables,
        loadPrintable,
        createPrintable,
        savePrintable,
        renamePrintable,
        movePrintable,
        duplicatePrintable,
        deletePrintable,
        listFolders,
        createFolder,
        renameFolder,
        moveFolder,
        deleteFolderTree,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableStore;
    }
    if (global) {
        global.PrintableStore = PrintableStore;
    }
})(typeof window !== 'undefined' ? window : globalThis);
