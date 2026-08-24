// Liturgy Save Core — which fields an outside writer (MS-262's oos_update_liturgy
// MCP tool) is allowed to touch on a `services/{date}` document, and the
// Firestore dot-paths those fields actually live at.
//
// Pure logic only, so it can be copied into functions/shared (functions/
// deploys as its own bundle and cannot require across into public/ — see
// scripts/sync-shared-to-functions.js) and driven by a test with no mocks.
//
// The allowlist and path shape mirror the two liturgy-field writers that
// already exist: service-builder.js's CANONICAL_MAPPING (`liturgy: true`
// entries) and service-calendar.js's writeLiturgyField(), which both store
// hymn and scripture/text slots nested under `liturgy.{slot}` rather than as
// top-level fields. theme/keyVerse are the two liturgy-adjacent fields that
// ARE top-level.
(function (global) {
    'use strict';

    const TOP_LEVEL_FIELDS = Object.freeze(['theme', 'keyVerse']);

    // The `type: 'hymn'` liturgy slots in service-builder.js's CANONICAL_MAPPING.
    // Each stores `{ id, name }` — id is null for a freehand name never matched
    // to a hymn registry doc.
    const HYMN_FIELDS = Object.freeze([
        'preparatoryHymn', 'hymn1', 'hymn2',
        'hymnMid1', 'hymnMid2', 'hymnEnd1', 'hymnEnd2',
    ]);

    // The liturgy slots edited as free text (service-calendar.js's
    // LITURGY_VERSE_FIELDS).
    const TEXT_FIELDS = Object.freeze([
        'callToWorship', 'callToConfession', 'assuranceOfPardon',
        'scriptureReading', 'sermon', 'benediction',
    ]);

    const LITURGY_FIELDS = Object.freeze(HYMN_FIELDS.concat(TEXT_FIELDS));
    const ALLOWED_FIELDS = Object.freeze(TOP_LEVEL_FIELDS.concat(LITURGY_FIELDS));

    function isHymnField(field) {
        return HYMN_FIELDS.indexOf(field) !== -1;
    }

    function isLiturgyField(field) {
        return LITURGY_FIELDS.indexOf(field) !== -1;
    }

    // A hymn slot's value is either a clear (null, or an empty freehand name)
    // or an { id, name } pair — `id` may itself be null for a freehand name.
    function validHymnValue(value) {
        if (value === null) return true;
        if (typeof value !== 'object' || Array.isArray(value)) return false;
        return typeof value.name === 'string' &&
            (value.id === null || typeof value.id === 'string');
    }

    // A text slot's value is either a clear (null or '') or a plain string.
    function validTextValue(value) {
        return value === null || typeof value === 'string';
    }

    function validValue(field, value) {
        if (isHymnField(field)) return validHymnValue(value);
        return validTextValue(value);
    }

    // Checks a proposed partial update against the allowlist and each field's
    // own shape. Returns { rejectedFields, invalidFields }, both empty when
    // the update is safe to turn into Firestore paths with toUpdatePaths().
    // rejectedFields: not a liturgy field this tool may touch at all (e.g.
    // `preacher` — a person-assignment field, explicitly out of scope).
    // invalidFields: an allowed field given a value of the wrong shape.
    function validateLiturgyUpdate(fields) {
        const rejectedFields = [];
        const invalidFields = [];

        for (const [field, value] of Object.entries(fields || {})) {
            if (ALLOWED_FIELDS.indexOf(field) === -1) {
                rejectedFields.push(field);
                continue;
            }
            if (!validValue(field, value)) {
                invalidFields.push(field);
            }
        }

        return { rejectedFields, invalidFields };
    }

    // The given fields, as Firestore dot-paths: liturgy slots nest under
    // `liturgy.`, matching what service-calendar.js's writeLiturgyField() and
    // service-builder.js's save() both write; theme/keyVerse stay top-level.
    // Assumes the input already passed validateLiturgyUpdate() clean.
    function toUpdatePaths(fields) {
        const paths = {};
        for (const [field, value] of Object.entries(fields || {})) {
            if (ALLOWED_FIELDS.indexOf(field) === -1) continue;
            const path = isLiturgyField(field) ? `liturgy.${field}` : field;
            paths[path] = value;
        }
        return paths;
    }

    // The given fields as a nested document, `{ theme, liturgy: { hymn1, … } }`
    // — the shape `.update()` cannot use because the document does not exist
    // yet (there is nothing to update), so it has to be laid down with
    // `.set(doc, { merge: true })` instead. Mirrors writeLiturgyField()'s own
    // not-found fallback, generalised to more than one field at a time.
    function toNestedDoc(fields) {
        const doc = {};
        for (const [field, value] of Object.entries(fields || {})) {
            if (ALLOWED_FIELDS.indexOf(field) === -1) continue;
            if (isLiturgyField(field)) {
                if (!doc.liturgy) doc.liturgy = {};
                doc.liturgy[field] = value;
            } else {
                doc[field] = value;
            }
        }
        return doc;
    }

    const LiturgySaveCore = {
        TOP_LEVEL_FIELDS,
        HYMN_FIELDS,
        TEXT_FIELDS,
        LITURGY_FIELDS,
        ALLOWED_FIELDS,
        isHymnField,
        isLiturgyField,
        validHymnValue,
        validTextValue,
        validateLiturgyUpdate,
        toUpdatePaths,
        toNestedDoc,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LiturgySaveCore;
    }
    if (global) {
        global.LiturgySaveCore = LiturgySaveCore;
    }
})(typeof window !== 'undefined' ? window : null);
