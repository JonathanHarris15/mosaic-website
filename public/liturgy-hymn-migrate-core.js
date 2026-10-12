// Liturgy hymn migrate — copy filled legacy Standard hymn slots onto the
// live Standard Liturgy Order ids after the order was re-composed.
//
// Pure. The live order uses hymn2 / hymn6 / hymn7 / hymn / hymn3 / hymn4 /
// hymn5. Sundays still hold values under preparatoryHymn / hymn1 / hymn2 /
// hymnMid* / hymnEnd*. hymn2 collides (live = Preparatory; legacy = Hymn 2),
// so a positional copy from the seed sequence is required. Legacy keys stay.
//
// Loaded as a classic <script> when needed, and required under node:test /
// the backfill script.
(function (global) {
    'use strict';

    // Seed Standard hymn sequence → live Standard hymn sequence (by place
    // in the service). Labels are for ops logs only.
    const LEGACY_TO_LIVE = Object.freeze([
        Object.freeze({ from: 'preparatoryHymn', to: 'hymn2', label: 'Preparatory Hymn' }),
        Object.freeze({ from: 'hymn1', to: 'hymn6', label: 'Hymn 1' }),
        Object.freeze({ from: 'hymn2', to: 'hymn7', label: 'Hymn 2' }),
        Object.freeze({ from: 'hymnMid1', to: 'hymn', label: 'Hymn 3' }),
        Object.freeze({ from: 'hymnMid2', to: 'hymn3', label: 'Hymn 4' }),
        Object.freeze({ from: 'hymnEnd1', to: 'hymn4', label: 'Hymn 5' }),
        Object.freeze({ from: 'hymnEnd2', to: 'hymn5', label: 'Hymn 6' }),
    ]);

    function clone(value) {
        if (value == null) return value;
        return JSON.parse(JSON.stringify(value));
    }

    function hymnFilled(slot) {
        if (!slot || typeof slot !== 'object') return false;
        if (slot.id) return true;
        return !!(String(slot.name || '').trim());
    }

    function sameHymn(a, b) {
        if (!hymnFilled(a) && !hymnFilled(b)) return true;
        if (!hymnFilled(a) || !hymnFilled(b)) return false;
        const aId = a.id || null;
        const bId = b.id || null;
        if (aId || bId) return aId === bId;
        return String(a.name || '').trim() === String(b.name || '').trim();
    }

    function sameStamp(a, b) {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;
        return JSON.stringify(a) === JSON.stringify(b);
    }

    function sameNote(a, b) {
        const left = a == null ? '' : String(a);
        const right = b == null ? '' : String(b);
        return left === right;
    }

    // After preparatoryHymn is copied onto live hymn2, liturgy.hymn2 no
    // longer holds Hymn 2. A second pass must not treat that field as the
    // legacy hymn2 source for hymn7.
    function hymn2IsLivePreparatory(liturgy) {
        const prep = liturgy.preparatoryHymn;
        const live = liturgy.hymn2;
        return hymnFilled(prep) && sameHymn(prep, live);
    }

    /**
     * Plan the field updates that put legacy hymns onto live Standard ids.
     * Does not delete legacy fields. Idempotent when already migrated.
     *
     * @param {object} doc a services/{date} document (or plain liturgy bag)
     * @return {{changes: Array, update: object}}
     */
    function planServiceHymnMigration(doc) {
        const liturgy = (doc && doc.liturgy) || {};
        const decidedBy = (doc && doc.decidedBy) || {};
        const notes = (doc && doc.notes) || {};
        const changes = [];
        const update = {};
        const hymn2Resolved = hymn2IsLivePreparatory(liturgy);

        LEGACY_TO_LIVE.forEach(function (row) {
            // hymn2 → hymn7 only while liturgy.hymn2 still holds Hymn 2.
            if (row.from === 'hymn2' && hymn2Resolved) return;

            const source = liturgy[row.from];
            if (!hymnFilled(source)) return;

            const target = liturgy[row.to];
            if (!sameHymn(source, target)) {
                update['liturgy.' + row.to] = clone(source);
                changes.push({
                    field: 'liturgy.' + row.to,
                    from: row.from,
                    label: row.label,
                    before: hymnFilled(target) ? clone(target) : null,
                    after: clone(source),
                });
            }

            if (Object.prototype.hasOwnProperty.call(decidedBy, row.from)) {
                const stamp = decidedBy[row.from];
                if (!sameStamp(stamp, decidedBy[row.to])) {
                    update['decidedBy.' + row.to] = clone(stamp);
                    changes.push({
                        field: 'decidedBy.' + row.to,
                        from: row.from,
                        label: row.label,
                        before: decidedBy[row.to] == null ? null : clone(decidedBy[row.to]),
                        after: clone(stamp),
                    });
                }
            }

            if (Object.prototype.hasOwnProperty.call(notes, row.from)) {
                const note = notes[row.from];
                if (!sameNote(note, notes[row.to])) {
                    update['notes.' + row.to] = note == null ? null : String(note);
                    changes.push({
                        field: 'notes.' + row.to,
                        from: row.from,
                        label: row.label,
                        before: notes[row.to] == null ? null : notes[row.to],
                        after: note == null ? null : String(note),
                    });
                }
            }
        });

        return { changes: changes, update: update };
    }

    const api = {
        LEGACY_TO_LIVE: LEGACY_TO_LIVE,
        hymnFilled: hymnFilled,
        sameHymn: sameHymn,
        planServiceHymnMigration: planServiceHymnMigration,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    global.LiturgyHymnMigrateCore = api;
}(typeof window !== 'undefined' ? window : globalThis));
