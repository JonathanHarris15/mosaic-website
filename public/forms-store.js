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

    async function listForms(db) {
        const snap = await db.collection(FORMS).orderBy('updatedAt', 'desc').get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }

    async function loadForm(db, formId) {
        const doc = await db.collection(FORMS).doc(formId).get();
        return doc.exists ? Object.assign({ id: doc.id }, doc.data()) : null;
    }

    async function loadResponses(db, formId) {
        // No orderBy. On an anonymous form the read order IS the disclosure —
        // FormsCore.anonymousReadOrder shuffles what comes back, and sorting by
        // arrival here would defeat it before the page ever saw the rows.
        const snap = await db.collection(RESPONSES).where('formId', '==', formId).get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }

    async function countResponses(db, formId) {
        const snap = await db.collection(RESPONSES).where('formId', '==', formId).get();
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
    async function deleteForm(db, formId) {
        const answers = await db.collection(RESPONSES).where('formId', '==', formId).get();
        const batch = db.batch();
        answers.forEach(doc => batch.delete(doc.ref));
        batch.delete(db.collection(FORMS).doc(formId));
        await batch.commit();
        return answers.size;
    }

    const FormsStore = {
        newFormId,
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
