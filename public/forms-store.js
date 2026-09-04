// Forms Store — reading and writing Form Templates and their Responses, for
// an editor (MS-360).
//
// ⚠ THIS IS THE EDITOR'S PATH ONLY. Everything here runs as somebody signed in
// at editor or above, and `firestore.rules` grants nothing below that. The
// person ANSWERING a form never comes through this module and never touches
// Firestore at all — they go through the `publicForm` Cloud Function, which is
// ADR-0051 and the whole reason a public form is not a hole in the rules.
//
// ⚠ AND IT NEVER READS THE LEDGER. `form_ledger` says who has answered and is
// closed to every client, including this one. "How many people answered" comes
// from counting answers. A query here that reached for it would be the join
// ADR-0052 forbids, dressed up as a count.

(function (global) {
    'use strict';

    const Core = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
        ? require('./forms-core.js')
        : global.FormsCore;

    const FORMS = 'forms';
    const RESPONSES = 'form_responses';
    const FOLDERS = 'form_folders';

    const Folders = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
        ? require('./form-folders-core.js')
        : global.FormFoldersCore;

    // ── The id ───────────────────────────────────────────────────────────────
    //
    // Minted here rather than by Firestore's auto-id, because a form's id is
    // its public address: /f/<id> goes in a text message to the whole church.
    // 128 bits from the browser's CSPRNG, base58, and never anything derived
    // from the title (ADR-0051).
    function newFormId() {
        const bytes = new Uint8Array(Core.ID_BYTES);
        (global.crypto || global.msCrypto).getRandomValues(bytes);
        return Core.formIdFromBytes(bytes);
    }

    // ── Reading ──────────────────────────────────────────────────────────────
    //
    // ⚠ EVERY QUERY HERE HAS TO SAY WHETHER THE READER IS AN ELDER (MS-404).
    // A form an elder has shut to elders is closed in `firestore.rules`, and a
    // rule that narrows per document does NOT narrow a query — Firestore
    // refuses the whole query unless it can see that every row it could return
    // is allowed. So a reader below elder has to ask for `elderOnly == false`
    // by name; asking for everything would not return "the ones they may see",
    // it would return a permission error and an empty library.
    //
    // That is also why buildFormTemplate writes the flag on every save, false
    // included, and why a backfill stamped the forms that pre-date it: this
    // query cannot match a document where the field is simply absent.
    function formsFor(db, asElder) {
        const forms = db.collection(FORMS);
        return asElder ? forms : forms.where('elderOnly', '==', false);
    }

    function answersFor(db, formId, asElder) {
        const answers = db.collection(RESPONSES).where('formId', '==', formId);
        return asElder ? answers : answers.where('elderOnly', '==', false);
    }

    async function listForms(db, asElder) {
        const snap = await formsFor(db, asElder).orderBy('updatedAt', 'desc').get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }

    async function loadForm(db, formId) {
        const doc = await db.collection(FORMS).doc(formId).get();
        return doc.exists ? Object.assign({ id: doc.id }, doc.data()) : null;
    }

    async function loadResponses(db, formId, asElder) {
        // No orderBy. On an anonymous form the read order IS the disclosure —
        // FormsCore.anonymousReadOrder shuffles what comes back, and sorting by
        // arrival here would defeat it before the page ever saw the rows.
        const snap = await answersFor(db, formId, asElder).get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }

    async function countResponses(db, formId, asElder) {
        const snap = await answersFor(db, formId, asElder).get();
        return snap.size;
    }

    // ── Writing ──────────────────────────────────────────────────────────────

    function stamp(fb, user) {
        return {
            updatedAt: fb.firestore.FieldValue.serverTimestamp(),
            updatedByName: (user && user.displayName) || (user && user.email) || 'Somebody',
        };
    }

    async function createForm(db, fb, user, spec) {
        const formId = newFormId();
        const record = Core.buildFormTemplate(spec || {});
        await db.collection(FORMS).doc(formId).set(Object.assign(record, {
            createdAt: fb.firestore.FieldValue.serverTimestamp(),
            createdBy: (user && user.uid) || null,
            createdByName: (user && user.displayName) || (user && user.email) || 'Somebody',
        }, stamp(fb, user)));
        return formId;
    }

    // Saving rebuilds the whole record through FormsCore rather than merging a
    // patch. That is what keeps a form from ever holding settings its own rung
    // forbids — a `public` form carrying attribution:true would be a record
    // contradicting itself, and something downstream would believe it.
    async function saveForm(db, fb, user, formId, form) {
        const record = Core.buildFormTemplate(form);
        await db.collection(FORMS).doc(formId).set(Object.assign(record, {
            createdAt: form.createdAt || null,
            createdBy: form.createdBy || null,
            createdByName: form.createdByName || null,
        }, stamp(fb, user)), { merge: true });
    }

    async function setClosed(db, fb, user, formId, closed) {
        await db.collection(FORMS).doc(formId)
            .set(Object.assign({ closed: closed === true }, stamp(fb, user)), { merge: true });
    }

    async function publishForm(db, fb, user, formId) {
        await db.collection(FORMS).doc(formId)
            .set(Object.assign({ published: true }, stamp(fb, user)), { merge: true });
    }

    // Deleting a form takes its answers with it. The page asks first and names
    // the count — the same shape the Document Library uses for a folder, and
    // for the same reason: the number is what makes the question answerable.
    //
    // The ledger is NOT cleaned up here, because no client may touch it. A
    // stale ledger row is harmless — it says somebody answered a form that no
    // longer exists, joins to nothing, and is unreadable by anybody anyway.
    // ⚠ THROUGH A FUNCTION, BECAUSE A BROWSER CANNOT DELETE AN ANSWER (MS-406).
    // `form_responses` is `allow write: if false` for every client — answers are
    // written server-side because validation cannot live in a browser we do not
    // control — and delete is a write. So this used to ask, be answered "yes,
    // delete it", and then fail: a form that had ever been answered could not be
    // deleted at all, and the page could only say "that did not delete".
    //
    // The function also clears the ballot ledger, which no client may even read.
    // The old comment here was right that a stale ledger row is harmless; a door
    // that can tidy it is simply better than one that cannot.
    async function deleteForm(db, formId, fns) {
        const app = global.firebase && global.firebase.app && global.firebase.app();
        if (!fns && !(app && typeof app.functions === 'function')) {
            // The page did not load firebase-functions-compat.js. Said as a
            // sentence rather than as "functions is not a function", which is
            // what a person pressing Delete actually saw.
            throw new Error('This page cannot reach the server. Refresh and try again.');
        }
        const call = (fns || app.functions('us-central1'))
            .httpsCallable('deleteFormTemplate');
        const res = await call({ formId: formId });
        const data = (res && res.data) || {};
        if (!data.ok) throw new Error(data.message || 'That did not delete.');
        return data.answers || 0;
    }

    // ── Folders (MS-376) ─────────────────────────────────────────────────────
    //
    // ⚠ Every write here touches ONE record. That is the whole point of
    // ADR-0054: two editors filing two different things at the same moment
    // write two different documents, so neither loses the other's change. A
    // helper that gathered the folders into one document to save "the tree"
    // would put the collision back.

    async function listFolders(db) {
        const snap = await db.collection(FOLDERS).get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }

    async function createFolder(db, fb, user, spec) {
        const record = Folders.buildFolder(spec || {});
        const ref = await db.collection(FOLDERS).add(Object.assign(record, {
            createdAt: fb.firestore.FieldValue.serverTimestamp(),
            createdByName: (user && user.displayName) || (user && user.email) || 'Somebody',
        }));
        return ref.id;
    }

    async function renameFolder(db, folderId, name) {
        await db.collection(FOLDERS).doc(folderId)
            .set({ name: Folders.normaliseFolderName(name) }, { merge: true });
    }

    // The caller checks canMoveFolder first. This does not re-check, because a
    // move refused deep in the store is a move whose reason never reaches the
    // person who tried it.
    async function moveFolder(db, folderId, parentId) {
        await db.collection(FOLDERS).doc(folderId)
            .set({ parentId: parentId || null }, { merge: true });
    }

    async function moveForm(db, fb, user, formId, folderId) {
        await db.collection(FORMS).doc(formId)
            .set(Object.assign({ folderId: folderId || null }, stamp(fb, user)), { merge: true });
    }

    async function renameFormTitle(db, fb, user, formId, title) {
        await db.collection(FORMS).doc(formId)
            .set(Object.assign({ title: Core.normaliseTitle(title) }, stamp(fb, user)), { merge: true });
    }

    // Deleting a folder takes everything under it, at any depth: the forms, the
    // answers those forms gathered, and the folders in between. The page asks
    // first and names the count of forms, because the number is what makes the
    // question answerable.
    //
    // Forms go one at a time through deleteForm rather than in one batch, so
    // that a failure part-way leaves a smaller library rather than a folder
    // that is gone with its forms still in it — an orphaned form comes back to
    // the top level and can be found again, which a lost one cannot.
    async function deleteFolderTree(db, folders, forms, folderId) {
        const doomedFolders = [folderId].concat(Folders.descendantFolderIds(folders, folderId));
        const doomedForms = Folders.formsUnder(folders, forms, folderId);

        for (const form of doomedForms) {
            await deleteForm(db, form.id);
        }
        // Every form is gone before a single folder is, so a failure part-way
        // leaves forms filed where they were rather than orphaned at the top.
        const batch = db.batch();
        doomedFolders.forEach(id => batch.delete(db.collection(FOLDERS).doc(id)));
        await batch.commit();
        return doomedForms.length;
    }

    const FormsStore = {
        newFormId,
        listFolders,
        createFolder,
        renameFolder,
        moveFolder,
        moveForm,
        renameFormTitle,
        deleteFolderTree,
        listForms,
        loadForm,
        loadResponses,
        countResponses,
        createForm,
        saveForm,
        setClosed,
        publishForm,
        deleteForm,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FormsStore;
    }
    if (global) {
        global.FormsStore = FormsStore;
    }
})(typeof window !== 'undefined' ? window : globalThis);
