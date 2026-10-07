// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/service-read-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Service Read Core — one Sunday's `services/{date}` document, turned into
// something readable in the order the service actually runs.
//
// The order is the Sunday's Liturgy Order (ADR-0080): the one its
// `liturgyOrderId` names, or Standard when it names none or names one that
// has since been deleted. A value whose element is not in that order is not
// read back — it is still on the document, only hidden, as on every page.
//
// Pure logic only, so it can be COPIED into functions/shared (see
// scripts/sync-shared-to-functions.js) for the MCP server's oos_get_service
// tool (MS-262) without dragging in Firestore or the DOM.
//
// ⚠ THE DOTTED-KEY NORMALISATION IS NOT COSMETIC. Older saves used
// set(merge) with paths like 'liturgy.sermon', which Firestore stored as a
// top-level field NAME containing a dot rather than as a nested value. A
// reader that does not fold those back in will report an empty slot on an
// older Sunday that plainly has one filled — and, being a read, will do it
// silently and confidently. See ADR-0034 and the comment above
// writeLiturgyField() in service-calendar.js.
//
// ⚠ KNOWN DUPLICATION. The same fold already exists twice in the browser —
// `normalizeDottedKeys` in service-builder.js and `normalizeServiceDoc` in
// service-calendar.js — and this is a third copy rather than a replacement,
// because the two browser files are loaded as plain scripts and pointing
// them here means touching the pages that load them. Worth consolidating;
// deliberately not done in the same change that introduced the read tool.
(function (global) {
    'use strict';

    // The note helpers. Loaded the same way the other shared modules are:
    // a global in the browser, a require under Node and in functions/.
    const noteCore = (typeof require !== 'undefined' &&
            typeof module !== 'undefined' && module.exports) ?
        require('./service-note-core.js') :
        (global && global.ServiceNoteCore);

    // The congregation's Liturgy Elements and Orders. The sequence is the
    // meaning — an Order of Service read back alphabetically is not an order
    // of service — so the rows walk the order rather than object key order.
    const Liturgy = (typeof require !== 'undefined' &&
            typeof module !== 'undefined' && module.exports) ?
        require('./liturgy-order-core.js') :
        (global && global.LiturgyOrderCore);

    // The two people prayed for in the pastoral prayer. They are stored under
    // `liturgy` but are people on the Sunday, not Liturgy Elements, so they
    // read back beside the order rather than as rows of it.
    const PRAYED_FOR_FIELDS = Object.freeze([
        ['prayerMale', 'Male Being Prayed For'],
        ['prayerFemale', 'Female Being Prayed For'],
    ]);

    // The people fields, as document-field -> readable name. Read-only here:
    // this tool can SAY who is preaching, and oos_update_liturgy still
    // cannot change it (that needs a find-this-person tool nothing builds
    // yet). Reading a name and assigning one are different acts.
    const PEOPLE_FIELDS = Object.freeze([
        ['preacher', 'Preacher'],
        ['serviceLeader', 'Service Leader'],
        ['musicLeader', 'Music Leader'],
        ['prayerPraiseName', 'Prayer (Praise)'],
        ['prayerConfessionName', 'Prayer (Confession)'],
        ['elementsName', 'Elements of the Service'],
        ['otherName', 'Other Involvement'],
    ]);

    // Folds legacy dotted field names back into nested values. An already
    // nested value wins over a dotted one for the same leaf — the dotted key
    // is the older fallback, not the newer truth.
    function normalizeServiceDoc(raw) {
        const data = {};
        for (const [key, val] of Object.entries(raw || {})) {
            if (!key.includes('.')) data[key] = val;
        }
        for (const [key, val] of Object.entries(raw || {})) {
            if (!key.includes('.')) continue;
            const parts = key.split('.');
            let obj = data;
            for (let i = 0; i < parts.length - 1; i++) {
                if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) {
                    obj[parts[i]] = {};
                }
                obj = obj[parts[i]];
            }
            const leaf = parts[parts.length - 1];
            if (!obj[leaf]) obj[leaf] = val;
        }
        return data;
    }

    // Is this slot empty? Blank all the way down — a song is {id, name}, a
    // scripture or text is a string, a people element is a list.
    function isBlank(value) {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string') return value.trim() === '';
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'object') {
            return Object.keys(value).every((k) => isBlank(value[k]));
        }
        return false;
    }

    // One liturgy slot, rendered for reading rather than for writing.
    function slotValue(value) {
        if (isBlank(value)) return null;
        if (Array.isArray(value)) {
            const named = value.filter((p) => !isBlank(p));
            return named.length ? named : null;
        }
        if (value && typeof value === 'object') {
            // A hymn slot. The name is what a person says; the id is what a
            // write needs, so both come back.
            if ('name' in value || 'id' in value) {
                return {name: value.name || '', id: value.id || null};
            }
        }
        return value;
    }

    /**
     * One Sunday, readable.
     *
     * `exists: false` is an ANSWER, not an error — most dates simply have no
     * document yet, and an assistant asked about one should be able to say
     * "nothing is planned for that Sunday" rather than report a failure.
     *
     * `liturgyCatalog` is the congregation's {elements, orders}. Without one
     * the Sunday reads in the Standard seed, which is what an empty catalog
     * means everywhere else.
     */
    function readableService(dateKey, raw, liturgyCatalog) {
        if (!raw) {
            return {date: dateKey, exists: false, liturgy: [], people: {}};
        }
        const doc = normalizeServiceDoc(raw);
        const liturgy = doc.liturgy || {};
        const decidedBy = doc.decidedBy || {};
        const catalog = Liturgy.catalogFrom(liturgyCatalog);
        const order = Liturgy.orderFor(doc, catalog);

        const notes = doc.notes || {};
        const rows = Liturgy.elementsOf(order, catalog).map((el) => {
            const value = slotValue(liturgy[el.id]);
            const who = decidedBy[el.id];
            // The note comes back as TEXT, not as the markup it is stored as.
            // An assistant reading `<p>Bill is away</p>` would sooner or
            // later echo the tags back into something, and it has no use for
            // them either way.
            const noteHtml = el.hasNote ? notes[el.id] : '';
            const noteText = noteHtml ? noteCore.noteHtmlToText(noteHtml) : '';
            const carrier = el.hasRole ? Liturgy.carrierOf(doc, el) : null;
            return {
                field: el.id,
                label: el.name,
                primitive: el.primitive,
                value,
                filled: value !== null,
                decidedBy: (who && who.name) || null,
                note: noteText || null,
                carriedBy: (carrier && carrier.name) || null,
            };
        });

        const prayedFor = {};
        PRAYED_FOR_FIELDS.forEach(([field, label]) => {
            const value = slotValue(liturgy[field]);
            if (value && value.name) prayedFor[label] = value;
        });

        const people = {};
        PEOPLE_FIELDS.forEach(([field, label]) => {
            const name = doc[field];
            if (name && String(name).trim()) people[label] = String(name).trim();
        });
        const helpers = Array.isArray(doc.musicHelpers) ? doc.musicHelpers : [];
        const helperNames = helpers
            .map((h) => (h && h.name ? String(h.name).trim() : ''))
            .filter(Boolean);
        if (helperNames.length) people['Music Helpers'] = helperNames;

        return {
            date: dateKey,
            exists: true,
            theme: doc.theme || null,
            keyVerse: doc.keyVerse || null,
            liturgyOrder: {id: order.id, name: order.name},
            liturgy: rows,
            people,
            prayedFor,
            hasBaptism: !!doc.hasBaptism,
            isIrregular: !!doc.isIrregular,
            // An irregular Sunday keeps its content somewhere else entirely,
            // so saying the liturgy is empty without saying this would be a
            // half-truth.
            irregularElements: doc.isIrregular ?
                (doc.irregularElements || null) : null,
        };
    }

    const ServiceReadCore = {
        PEOPLE_FIELDS,
        PRAYED_FOR_FIELDS,
        normalizeServiceDoc,
        readableService,
        isBlank,
        slotValue,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ServiceReadCore;
    }
    if (global) {
        global.ServiceReadCore = ServiceReadCore;
    }
})(typeof window !== 'undefined' ? window : null);
