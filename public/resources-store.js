// Resources Store — reading and writing the church's shared library (MS-693).
//
// Every member reads; `resources.edit` writes. Both are enforced in
// `firestore.rules` and `storage.rules`, and this module does not re-check
// them: a refusal belongs to the rules, and a store that guessed at the
// answer would either lie to somebody who may write or hide a refusal the
// page needs to show.
//
// ⚠ EVERY WRITE HERE TOUCHES ONE RECORD (ADR-0054, ADR-0083). Filing a
// resource is one document. Dragging a pin is one document. A helper that
// gathered the shelf into a single "library" document — an order array, a
// folder tree — would put back the clobber both ADRs exist to avoid.

(function (global) {
    'use strict';

    const isNode = (typeof require === 'function' && typeof module !== 'undefined' && module.exports);
    const Core = isNode ? require('./resources-core.js') : global.ResourcesCore;
    const Filing = isNode ? require('./filing-core.js') : global.FilingCore;

    const RESOURCES = 'resources';
    const FOLDERS = 'resource_folders';

    function who(user) {
        return (user && user.displayName) || (user && user.email) || 'Somebody';
    }

    function stamp(fb, user) {
        return {
            updatedAt: fb.firestore.FieldValue.serverTimestamp(),
            updatedByName: who(user),
        };
    }

    function collectionOf(db, isFolder) {
        return db.collection(isFolder ? FOLDERS : RESOURCES);
    }

    // ── Reading ──────────────────────────────────────────────────────────────

    async function listResources(db) {
        const snap = await db.collection(RESOURCES).get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }

    async function listFolders(db) {
        const snap = await db.collection(FOLDERS).get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data(), { isFolder: true }));
    }

    // ── Putting something on the shelf ───────────────────────────────────────

    // Two steps in a deliberate order: the RECORD is reserved first so the
    // bytes have an id to live under, then the file is uploaded, then the
    // record is filled in. A browser that dies mid-upload leaves a record
    // marked `uploading` rather than a row pointing at a file that is not
    // there — and the page can say so.
    async function uploadFile(db, fb, user, spec) {
        const s = spec || {};
        const check = Core.validateUploadFile(s.file);
        if (!check.ok) throw new Error(check.error);

        const ref = db.collection(RESOURCES).doc();
        const storagePath = Core.storagePathFor(ref.id, s.file.name);

        await fb.storage().ref().child(storagePath).put(s.file, {
            // ⚠ NO getDownloadURL() HERE, AND NOWHERE ELSE ON THIS PATH. It
            // mints a token that serves the bytes to anyone holding the link,
            // signed out, forever, past every rule (ADR-0046). The record
            // keeps the PATH; openResource fetches as the signed-in reader.
            contentType: s.file.type || 'application/octet-stream',
        });

        const record = Core.buildFileResource({
            name: s.name || s.file.name,
            folderId: s.folderId || null,
            storagePath: storagePath,
            contentType: s.file.type || null,
            size: s.file.size,
        });
        await ref.set(Object.assign(record, {
            createdAt: fb.firestore.FieldValue.serverTimestamp(),
            createdByName: who(user),
        }, stamp(fb, user)));
        return ref.id;
    }

    async function addLink(db, fb, user, spec) {
        const s = spec || {};
        const check = Core.validateLinkUrl(s.url);
        if (!check.ok) throw new Error(check.error);
        const record = Core.buildLinkResource({
            name: s.name || check.url,
            folderId: s.folderId || null,
            url: check.url,
        });
        const ref = await db.collection(RESOURCES).add(Object.assign(record, {
            createdAt: fb.firestore.FieldValue.serverTimestamp(),
            createdByName: who(user),
        }, stamp(fb, user)));
        return ref.id;
    }

    async function createFolder(db, fb, user, spec) {
        const record = Core.buildFolder(spec || {});
        const ref = await db.collection(FOLDERS).add(Object.assign(record, {
            createdAt: fb.firestore.FieldValue.serverTimestamp(),
            createdByName: who(user),
        }));
        return ref.id;
    }

    // ── Changing one ─────────────────────────────────────────────────────────

    async function rename(db, fb, user, item, name) {
        const isFolder = !!(item && (item.isFolder || item.kind === 'folder'));
        const clean = isFolder ? Filing.normaliseFolderName(name) : Core.normaliseName(name);
        await collectionOf(db, isFolder).doc(item.id)
            .set(Object.assign({ name: clean }, isFolder ? {} : stamp(fb, user)), { merge: true });
        return clean;
    }

    // A resource remembers its folder; a folder remembers its parent. Two
    // fields, one write each, and the caller has already asked FilingCore
    // whether a folder move is allowed — re-checking here would surface the
    // refusal somewhere nobody is looking.
    async function move(db, fb, user, item, targetFolderId) {
        const isFolder = !!(item && (item.isFolder || item.kind === 'folder'));
        const target = (targetFolderId === Filing.TOP_LEVEL) ? null : (targetFolderId || null);
        const patch = isFolder ? { parentId: target } : Object.assign({ folderId: target }, stamp(fb, user));
        await collectionOf(db, isFolder).doc(item.id).set(patch, { merge: true });
    }

    // The RECORD goes first, then the bytes. A failure in between leaves a
    // file nothing points at — inert, unreachable from any screen — rather
    // than a row whose file has gone, which is the one a reader would meet.
    async function deleteResource(db, fb, resource) {
        await db.collection(RESOURCES).doc(resource.id).delete();
        if (resource.storagePath) {
            try {
                await fb.storage().ref().child(resource.storagePath).delete();
            } catch (e) {
                // Already gone, or never landed. The record is the truth.
            }
        }
    }

    // Deleting a folder takes everything beneath it, at any depth. Resources
    // go one at a time so a failure part-way leaves a smaller library rather
    // than a folder that is gone with its files still filed under it.
    async function deleteFolderTree(db, fb, folders, resources, folderId) {
        const doomedFolders = [folderId].concat(Filing.descendantFolderIds(folders, folderId));
        const doomed = Filing.itemsUnder(folders, resources, folderId);
        for (const r of doomed) {
            await deleteResource(db, fb, r);
        }
        const batch = db.batch();
        doomedFolders.forEach(id => batch.delete(db.collection(FOLDERS).doc(id)));
        await batch.commit();
        return doomed.length;
    }

    // ── Pins (ADR-0083) ──────────────────────────────────────────────────────

    // Pinning is writing a rank; unpinning is clearing it. There is no second
    // document to keep in step, so there is no state where a pin points at
    // something that has gone.
    async function pin(db, item, everything) {
        const isFolder = !!(item && (item.isFolder || item.kind === 'folder'));
        const rank = Core.nextPinRank(everything || []);
        await collectionOf(db, isFolder).doc(item.id).set({ pinRank: rank }, { merge: true });
        return rank;
    }

    async function unpin(db, item) {
        const isFolder = !!(item && (item.isFolder || item.kind === 'folder'));
        await collectionOf(db, isFolder).doc(item.id).set({ pinRank: null }, { merge: true });
    }

    // One drag is normally ONE write — the midpoint between its new
    // neighbours. ResourcesCore decides; this only carries out the plan, and
    // batches it because the renumbering case is the whole pinned list.
    async function applyPinWrites(db, writes) {
        const list = writes || [];
        if (!list.length) return 0;
        if (list.length === 1) {
            const w = list[0];
            await collectionOf(db, w.isFolder).doc(w.id).set({ pinRank: w.pinRank }, { merge: true });
            return 1;
        }
        const batch = db.batch();
        list.forEach(w => batch.set(collectionOf(db, w.isFolder).doc(w.id),
            { pinRank: w.pinRank }, { merge: true }));
        await batch.commit();
        return list.length;
    }

    // ── Opening a file ───────────────────────────────────────────────────────

    // ⚠ THIS IS THE OTHER HALF OF THE STORAGE RULE. The bytes are fetched with
    // the reader's own ID token, so `storage.rules` is consulted on every
    // request and a member who loses the rung loses the file. A download URL
    // would be checked once, at mint time, and then never again (ADR-0046).
    async function fetchResourceBlob(fb, resource) {
        const user = fb.auth().currentUser;
        if (!user) throw new Error('not signed in');
        const ref = fb.storage().ref().child(resource.storagePath);
        const token = await user.getIdToken();
        const endpoint = 'https://firebasestorage.googleapis.com/v0/b/' +
            ref.bucket + '/o/' + encodeURIComponent(ref.fullPath) + '?alt=media';
        const response = await fetch(endpoint, {
            headers: { Authorization: 'Firebase ' + token },
        });
        // 403 here is the rule doing its job, not a fault.
        if (!response.ok) throw new Error('storage responded ' + response.status);
        return await response.blob();
    }

    const ResourcesStore = {
        RESOURCES,
        FOLDERS,
        listResources,
        listFolders,
        uploadFile,
        addLink,
        createFolder,
        rename,
        move,
        deleteResource,
        deleteFolderTree,
        pin,
        unpin,
        applyPinWrites,
        fetchResourceBlob,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ResourcesStore;
    }
    if (global) {
        global.ResourcesStore = ResourcesStore;
    }
})(typeof window !== 'undefined' ? window : globalThis);
