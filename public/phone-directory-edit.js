// Phone Directory Edit — the phone Membership Directory's own Edit Mode (MS-614).
//
// The computer directory page is not opened inside the phone. Who may turn
// the switch on is who may already write a Person's identity. The four writes
// (add a person, save directory fields, delete a person, delete one
// Involvement) are the same documents the computer page already writes.
//
// Loaded as a classic script (window.PhoneDirectoryEdit) and exported for Node.

(function (global) {
    'use strict';

    const NAME_REQUIRED = 'A name is required.';
    const DELETE_PERSON_CONFIRM = 'Are you sure you want to delete this person? Involvement records will remain but will be unlinked.';
    const DELETE_INVOLVEMENT_CONFIRM = 'Remove this involvement record?';
    const SAVE_FAILED = "Couldn't save. It did not work.";
    const ADD_FAILED = "Couldn't add this person. It did not work.";
    const DELETE_PERSON_FAILED = "Couldn't delete this person. It did not work.";
    const DELETE_INVOLVEMENT_FAILED = "Couldn't remove that Involvement. It did not work.";

    // What Add person asks for. The Kid mark is not one of them.
    const ADD_PERSON_FIELDS = Object.freeze([
        Object.freeze({ key: 'name', label: 'Name', type: 'text' }),
        Object.freeze({ key: 'email', label: 'Email', type: 'email' }),
        Object.freeze({ key: 'phone', label: 'Phone', type: 'tel' }),
        Object.freeze({ key: 'address', label: 'Address', type: 'text' }),
        Object.freeze({ key: 'birthday', label: 'Birthday', type: 'date' }),
        Object.freeze({ key: 'sex', label: 'Sex', type: 'sex' }),
    ]);

    // One switch for a visit. Off when the directory is opened. Opening a
    // person does not clear it; the person page reads the same flag.
    let editMode = false;
    const listeners = [];

    function emit() {
        listeners.slice().forEach((fn) => fn(editMode));
    }

    function subscribe(fn) {
        listeners.push(fn);
        return function unsubscribe() {
            const at = listeners.indexOf(fn);
            if (at !== -1) listeners.splice(at, 1);
        };
    }

    function isOn() {
        return editMode;
    }

    function setOn(on) {
        editMode = !!on;
        emit();
    }

    function beginDirectoryVisit() {
        editMode = false;
        emit();
    }

    function mayOfferEditMode(user) {
        return !!(global && global.AccessCore && global.AccessCore.writesAsEditor(user));
    }

    function trim(value) {
        return String(value == null ? '' : value).trim();
    }

    // The computer's Add Person document: name, contact, birthday, sex,
    // no tags, and no involvement yet. A blank name is refused.
    function addPersonDocument(fields, timestamps) {
        const name = trim(fields && fields.name);
        if (!name) return { ok: false, error: NAME_REQUIRED };
        const now = timestamps && timestamps.now;
        return {
            ok: true,
            doc: {
                name: name,
                totalInvolvements: 0,
                contact: {
                    email: trim(fields.email),
                    phone: trim(fields.phone),
                    address: trim(fields.address),
                },
                birthday: fields.birthday || null,
                sex: fields.sex || null,
                lastPastoralPrayerDate: null,
                tags: [],
                createdAt: now,
                updatedAt: now,
            },
        };
    }

    // Contact fields always. Name, sex, and the Kid mark only while Edit Mode
    // is on — the same person fields the computer's Save Profile writes for
    // them, plus who saved it, which the phone already records.
    function savePayload(fields, opts) {
        const options = opts || {};
        const payload = {
            'contact.email': trim(fields && fields.email),
            'contact.phone': trim(fields && fields.phone),
            'contact.address': trim(fields && fields.address),
            birthday: (fields && fields.birthday) || null,
            updatedAt: options.now,
            updatedByName: options.updatedByName || '',
        };
        if (!options.editMode) return payload;
        payload.name = trim(fields && fields.name);
        payload.sex = (fields && fields.sex) || null;
        payload.kid = !!(fields && fields.kid);
        return payload;
    }

    // What the person page shows after a save. Dismissing the editor never
    // calls this, so the old values stay.
    function savedPersonView(person, fields, editModeOn) {
        const next = Object.assign({}, person, {
            email: trim(fields && fields.email),
            phone: trim(fields && fields.phone),
            address: trim(fields && fields.address),
            birthday: (fields && fields.birthday) || '',
        });
        if (editModeOn) {
            next.name = trim(fields && fields.name);
            next.sex = (fields && fields.sex) || null;
            next.kid = !!(fields && fields.kid);
        }
        return next;
    }

    // Deletes the person document and nothing else. A linked account stays linked.
    function personRemoval(personId) {
        if (!personId) return { ok: false };
        return {
            ok: true,
            personId: personId,
            collection: 'people',
            unlinkAccount: false,
        };
    }

    // One Involvement record gone, and the person's involvement count down by
    // one, in one write — the computer's delete.
    function involvementRemoval(personId, involvementId) {
        if (!personId || !involvementId) return { ok: false };
        return {
            ok: true,
            personId: personId,
            involvementId: involvementId,
            countField: 'totalInvolvements',
            countDelta: -1,
        };
    }

    const PhoneDirectoryEdit = {
        NAME_REQUIRED,
        DELETE_PERSON_CONFIRM,
        DELETE_INVOLVEMENT_CONFIRM,
        SAVE_FAILED,
        ADD_FAILED,
        DELETE_PERSON_FAILED,
        DELETE_INVOLVEMENT_FAILED,
        ADD_PERSON_FIELDS,
        subscribe,
        isOn,
        setOn,
        beginDirectoryVisit,
        mayOfferEditMode,
        addPersonDocument,
        savePayload,
        savedPersonView,
        personRemoval,
        involvementRemoval,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PhoneDirectoryEdit;
    }
    if (global) {
        global.PhoneDirectoryEdit = PhoneDirectoryEdit;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
