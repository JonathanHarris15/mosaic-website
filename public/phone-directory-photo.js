// Phone Directory Photo — what the phone Membership Directory offers for a
// Directory Photo, and what a change writes (MS-617).
//
// The photo policy stays the deep module: which files are allowed, who may
// change a photo, and that a new upload is centred. This plan only answers
// what the person page should not invent. It does not resize, upload, or
// open the computer directory.
//
// Loaded as a classic script (window.PhoneDirectoryPhoto) and exported for Node.

(function (global) {
    'use strict';

    const ADD_PHOTO = 'Add a photo';
    const REPLACE_PHOTO = 'Replace photo';
    const REMOVE = 'Remove';
    const UPLOAD_FAILED = 'That upload did not work';
    const REMOVE_FAILED = 'Could not remove that photo';

    function photo() {
        return global && global.PersonPhotoCore;
    }

    function edit() {
        return global && global.PhoneDirectoryEdit;
    }

    function access() {
        return global && global.AccessCore;
    }

    // The same people who may turn Edit Mode on, and only while it is on.
    // A member is not offered it, including on their own page. A Pastoral
    // Assistant is not offered it. The grant does not add a directory write.
    function offerControls(user, editModeOn) {
        return !!(editModeOn && edit() && edit().mayOfferEditMode(user));
    }

    function hasPhoto(person) {
        return !!(person && person.photoUrl);
    }

    function controls(person) {
        if (!hasPhoto(person)) {
            return { add: ADD_PHOTO, replace: null, remove: null };
        }
        return { add: null, replace: REPLACE_PHOTO, remove: REMOVE };
    }

    function removalQuestion(person) {
        const name = person && person.name ? String(person.name) : '';
        return 'Remove the photo for ' + name + '?';
    }

    // The existing photo policy, asked again at the write. This plan does
    // not add a rule of its own.
    function mayWrite(user, person) {
        const policy = photo();
        const personId = person && person.id;
        if (!policy || !personId) return false;
        const gate = access();
        if (!gate) return false;
        const myPersonId = user && user.personId;
        return policy.canManagePhoto(gate.permissionLevelOf(user), myPersonId, personId);
    }

    function refused(error) {
        return { ok: false, write: false, error: error || null, framing: null };
    }

    // A chosen file. A refusal is the photo check's own words, and nothing
    // is written. A file that passes is stored recentred by the existing
    // upload; this plan only names that framing.
    function planChosenFile(user, person, editModeOn, file) {
        if (!offerControls(user, editModeOn) || !mayWrite(user, person)) {
            return refused(null);
        }
        const check = photo().validatePhotoFile(file);
        if (!check.ok) return refused(check.error);
        return {
            ok: true,
            write: true,
            error: null,
            framing: framingForNewPhoto(),
        };
    }

    // Remove asks the computer's question. Cancelling writes nothing.
    // Confirming is a clear through the existing photo clear.
    function planRemoval(user, person, editModeOn, confirmed) {
        const question = removalQuestion(person);
        if (!offerControls(user, editModeOn) || !mayWrite(user, person)) {
            return { ok: false, write: false, question: question };
        }
        if (!confirmed) return { ok: true, write: false, question: question };
        return { ok: true, write: true, question: question };
    }

    // A new picture does not inherit the previous framing. The upload
    // already writes this centred default; naming it here is how the page
    // shows the same circle the computer card will show.
    function framingForNewPhoto() {
        return Object.assign({}, photo().DEFAULT_CROP);
    }

    function photoAfterUpload(person, saved) {
        return Object.assign({}, person, {
            photoUrl: (saved && saved.url) || null,
            photoCrop: framingForNewPhoto(),
        });
    }

    function photoAfterClear(person) {
        return Object.assign({}, person, {
            photoUrl: null,
            photoCrop: null,
        });
    }

    function uploadFailureMessage(error) {
        const message = error && typeof error.message === 'string'
            ? error.message.trim() : '';
        return message || UPLOAD_FAILED;
    }

    // One save at a time. A second tap while the first is in progress
    // starts nothing.
    function claimSave(session) {
        if (!session || session.saving) return false;
        session.saving = true;
        return true;
    }

    function releaseSave(session) {
        if (session) session.saving = false;
    }

    const PhoneDirectoryPhoto = {
        ADD_PHOTO,
        REPLACE_PHOTO,
        REMOVE,
        UPLOAD_FAILED,
        REMOVE_FAILED,
        ACCEPT: photo().ACCEPTED_TYPES.join(','),
        offerControls,
        controls,
        removalQuestion,
        planChosenFile,
        planRemoval,
        framingForNewPhoto,
        photoAfterUpload,
        photoAfterClear,
        uploadFailureMessage,
        claimSave,
        releaseSave,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PhoneDirectoryPhoto;
    }
    if (global) {
        global.PhoneDirectoryPhoto = PhoneDirectoryPhoto;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
