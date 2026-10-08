// Liturgy Save Core — which fields an outside writer (MS-262's oos_update_liturgy
// MCP tool, and the oosUpdateLiturgy callable) may touch on a
// `services/{date}` document, and the Firestore dot-paths they live at.
//
// Pure logic only, so it can be copied into functions/shared (functions/
// deploys as its own bundle and cannot require across into public/ — see
// scripts/sync-shared-to-functions.js) and driven by a test with no mocks.
//
// ⚠ THE ALLOWLIST IS THE SUNDAY'S OWN LITURGY ORDER (MS-715). A congregation
// keeps many orders (ADR-0080) and composes its own elements, so a fixed list
// of ids cannot say what a Sunday has. `planOrderWrite()` takes the elements
// of the order THAT Sunday resolves to (LiturgyOrderCore.elementsFor) and
// allows exactly its hymn and scripture elements, plus theme and keyVerse.
// Prayer and person-event values are people, and stay out of reach of this
// door the same way Preacher does.
//
// ⚠ THE LIVE ORDER'S IDS WIN. The Standard seed's ids (`hymn1`, `hymnMid1`,
// …) are not aliases. A seed id the Sunday's order does not contain is
// REFUSED by name, with the ids it does contain — never stored where no page
// shows it. A seed id the live order happens to reuse (`hymn2`) means the
// live element of that id, and the result names it, so the writer can see
// which moment it landed on.
//
// The path shape mirrors the pages' writers (service-builder.js and
// service-calendar.js's writeLiturgyField()): every element nests under
// `liturgy.{elementId}`; theme/keyVerse are top-level.
//
// The SEED lists below (HYMN_FIELDS, TEXT_FIELDS, validateLiturgyUpdate,
// toUpdatePaths, toNestedDoc) are the Standard order's elements, kept for
// callers that have no catalog. A writer with a Sunday in hand uses
// planOrderWrite().
(function (global) {
    'use strict';

    const TOP_LEVEL_FIELDS = Object.freeze(['theme', 'keyVerse']);

    // The Standard seed's song elements. Each stores `{ id, name }` — id is
    // null for a freehand name never matched to a hymn registry doc.
    const HYMN_FIELDS = Object.freeze([
        'preparatoryHymn', 'hymn1', 'hymn2',
        'hymnMid1', 'hymnMid2', 'hymnEnd1', 'hymnEnd2',
    ]);

    // The Standard seed's scripture elements, stored as free text.
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


    // ── The Sunday's own order (MS-715) ──────────────────────────────────

    // The kinds whose Sunday value this door may set. A hymn is {id, name};
    // a scripture is a reference typed as text. Prayer and person events are
    // people, and `other` has no Sunday value at all.
    const WRITABLE_KINDS = Object.freeze(['hymn', 'scripture']);

    function kindOfElement(el) {
        if (!el) return null;
        if (el.kind) return el.kind;
        if (el.primitive === 'song') return 'hymn';
        if (el.primitive === 'scripture') return 'scripture';
        return null;
    }

    // Every field a writer may set on a Sunday whose order has these
    // elements, in service order: [{ field, name, kind }].
    function writableFieldsOf(elements) {
        return (elements || [])
            .filter(function (el) { return el && WRITABLE_KINDS.indexOf(kindOfElement(el)) !== -1; })
            .map(function (el) { return { field: el.id, name: el.name || el.id, kind: kindOfElement(el) }; });
    }

    // A hymn as the two facts that make it one: which registry hymn, and the
    // name shown. Empty in any spelling (null, '', {name:''}) is one value.
    function hymnKey(value) {
        if (value == null) return '';
        if (typeof value === 'string') return value.trim() ? JSON.stringify([null, value.trim()]) : '';
        if (typeof value !== 'object') return JSON.stringify([null, String(value)]);
        const name = typeof value.name === 'string' ? value.name.trim() : '';
        const id = typeof value.id === 'string' && value.id ? value.id : null;
        if (!name && !id) return '';
        return JSON.stringify([id, name]);
    }

    function textKey(value) {
        if (value == null) return '';
        if (typeof value === 'string') return value.trim();
        return JSON.stringify(value);
    }

    // Does writing `next` over `current` change anything a person would see?
    function sameValue(kind, current, next) {
        if (kind === 'hymn') return hymnKey(current) === hymnKey(next);
        return textKey(current) === textKey(next);
    }

    // A hymn sent without an id is a freehand name — the Order of Service has
    // always allowed one — so a missing id is stored as null rather than
    // refused.
    function normaliseHymn(value) {
        if (value === null) return null;
        return { id: typeof value.id === 'string' ? value.id : null, name: value.name };
    }

    // The whole decision for one proposed write, against the order that
    // Sunday actually follows and what it currently holds.
    //
    //   fields   — what the writer sent, keyed by element id (+ theme/keyVerse)
    //   elements — LiturgyOrderCore.elementsFor(service, catalog)
    //   current  — the Sunday's document as stored (normalised), or null
    //
    // Returns
    //   rejected  [{ field, reason: 'not-in-order' | 'not-writable', name?, kind? }]
    //   invalid   [{ field, kind, name }]           right element, wrong shape
    //   changes   { field: value }                  what actually differs
    //   unchanged [field]                           sent, but already so
    //   written   [{ field, name, kind }]           the changes, described
    //
    // Nothing is written unless rejected and invalid are both empty, and an
    // unchanged value is never written at all — no value, no updatedAt, no
    // authorship stamp — so repeating a write is a true no-op.
    function planOrderWrite(fields, elements, current) {
        const byId = new Map();
        (elements || []).forEach(function (el) { if (el && el.id) byId.set(el.id, el); });
        const doc = current || {};
        const stored = doc.liturgy || {};

        const rejected = [];
        const invalid = [];
        const changes = {};
        const unchanged = [];
        const written = [];

        Object.keys(fields || {}).forEach(function (field) {
            let value = fields[field];
            if (TOP_LEVEL_FIELDS.indexOf(field) !== -1) {
                if (!validTextValue(value)) {
                    invalid.push({ field: field, kind: 'text', name: field });
                    return;
                }
                if (sameValue('text', doc[field], value)) { unchanged.push(field); return; }
                changes[field] = value;
                written.push({ field: field, name: field === 'theme' ? 'Theme' : 'Key Verse', kind: 'text' });
                return;
            }

            const el = byId.get(field);
            if (!el) {
                rejected.push({ field: field, reason: 'not-in-order' });
                return;
            }
            const kind = kindOfElement(el);
            if (WRITABLE_KINDS.indexOf(kind) === -1) {
                rejected.push({ field: field, reason: 'not-writable', name: el.name || field, kind: kind });
                return;
            }
            if (kind === 'hymn') {
                const ok = value === null || (value && typeof value === 'object' && !Array.isArray(value) &&
                    typeof value.name === 'string' &&
                    (value.id === undefined || value.id === null || typeof value.id === 'string'));
                if (!ok) {
                    invalid.push({ field: field, kind: kind, name: el.name || field });
                    return;
                }
                value = normaliseHymn(value);
            } else if (!validTextValue(value)) {
                invalid.push({ field: field, kind: kind, name: el.name || field });
                return;
            }
            if (sameValue(kind, stored[field], value)) { unchanged.push(field); return; }
            changes[field] = value;
            written.push({ field: field, name: el.name || field, kind: kind });
        });

        return { rejected: rejected, invalid: invalid, changes: changes, unchanged: unchanged, written: written };
    }

    // The refusal an assistant reads, naming every field that was refused and
    // what this Sunday does accept. Returns '' when nothing was refused.
    function describeRefusal(plan, elements, order) {
        const parts = [];
        const notIn = plan.rejected.filter(function (r) { return r.reason === 'not-in-order'; });
        const people = plan.rejected.filter(function (r) { return r.reason === 'not-writable'; });
        const orderName = order && order.name ? '"' + order.name + '"' : 'this Sunday\'s';
        if (notIn.length) {
            parts.push('Not an element of ' + orderName + ' liturgy order: ' +
                notIn.map(function (r) { return r.field; }).join(', ') + '.');
        }
        if (people.length) {
            parts.push('Cannot be set here (prayer, person and other elements are people or have no value): ' +
                people.map(function (r) { return r.field + ' (' + r.name + ')'; }).join(', ') + '.');
        }
        plan.invalid.forEach(function (r) {
            const shape = r.kind === 'hymn'
                ? 'a hymn: send {"id": <registry id from oos_lookup_hymns, or null>, "name": "..."} or null'
                : 'text: send a string, or null to clear';
            parts.push(r.field + ' (' + r.name + ') is ' + shape + '.');
        });
        if (!parts.length) return '';
        const valid = writableFieldsOf(elements)
            .map(function (f) { return f.field + ' = ' + f.name + ' (' + f.kind + ')'; });
        parts.push('Nothing was written. This Sunday accepts: theme, keyVerse' +
            (valid.length ? ', ' + valid.join(', ') : '') +
            '. Use the `field` ids oos_get_service returns for this date.');
        return parts.join(' ');
    }

    // The planned changes as Firestore dot-paths. Unlike toUpdatePaths() this
    // does not consult the seed list: planOrderWrite() already decided.
    function changePaths(changes) {
        const paths = {};
        Object.keys(changes || {}).forEach(function (field) {
            const path = TOP_LEVEL_FIELDS.indexOf(field) !== -1 ? field : 'liturgy.' + field;
            paths[path] = changes[field];
        });
        return paths;
    }

    // The planned changes as a nested document, for the first save of a
    // Sunday that has no document yet.
    function changeDoc(changes) {
        const out = {};
        Object.keys(changes || {}).forEach(function (field) {
            if (TOP_LEVEL_FIELDS.indexOf(field) !== -1) {
                out[field] = changes[field];
            } else {
                if (!out.liturgy) out.liturgy = {};
                out.liturgy[field] = changes[field];
            }
        });
        return out;
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
        WRITABLE_KINDS,
        writableFieldsOf,
        sameValue,
        planOrderWrite,
        describeRefusal,
        changePaths,
        changeDoc,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LiturgySaveCore;
    }
    if (global) {
        global.LiturgySaveCore = LiturgySaveCore;
    }
})(typeof window !== 'undefined' ? window : null);
