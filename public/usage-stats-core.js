// Usage Stats Core — which hymn/scripture-reference/serving-role changed on a
// Service save, and what key a Person's cached serving stats live under.
//
// Pure logic only, so it can be COPIED into functions/shared (functions/
// deploys as its own bundle and cannot require across into public/ — see
// scripts/sync-shared-to-functions.js) and required directly from Node
// scripts (scripts/backfill-usage-stats.js) without pulling in Firestore or
// the DOM. The Cloud Function trigger and the backfill script both call
// `diffLiturgyUsage`, so a service's usage count can never come out
// differently depending on which one computed it.
//
// Reads the SAVED shape — `liturgy.hymn1`, `liturgy.scriptureReading` — the
// same nested shape service-builder.js's save() and service-calendar.js's
// writeLiturgyField() both write to.
//
// Irregular services move this content into `irregularElements` instead of
// these fields, so their hymns/scripture are not counted here — usage stats
// for irregular elements are future work, not this pass.
(function (global) {
    'use strict';

    // The `type: 'hymn'` fields in service-builder.js's CANONICAL_MAPPING.
    // Each stores `{ id, name }`.
    const HYMN_FIELDS = Object.freeze([
        'preparatoryHymn', 'hymn1', 'hymn2',
        'hymnMid1', 'hymnMid2', 'hymnEnd1', 'hymnEnd2',
    ]);

    // The fields service-calendar.js's LITURGY_VERSE_FIELDS edits with the
    // scripture picker. Each stores a free-text reference string.
    const SCRIPTURE_FIELDS = Object.freeze([
        'sermon', 'callToConfession', 'assuranceOfPardon',
        'scriptureReading', 'benediction',
    ]);

    // A hymn slot's registry id, or null for an empty slot or a freehand name
    // never matched to a hymn doc — there is nothing to attach a count to.
    function hymnIdOf(slot) {
        return (slot && typeof slot === 'object' && slot.id) ? slot.id : null;
    }

    // A scripture slot's reference, trimmed, or null if blank.
    function scriptureRefOf(slot) {
        const ref = typeof slot === 'string' ? slot.trim() : '';
        return ref || null;
    }

    // The +1/-1 usage deltas one `services/{date}` write produces, for every
    // hymn and scripture slot whose value actually changed. `date` is the
    // doc id (YYYY-MM-DD), carried along so the caller can advance a
    // "last used" cache.
    function diffLiturgyUsage(beforeDoc, afterDoc, date) {
        const before = (beforeDoc && beforeDoc.liturgy) || {};
        const after = (afterDoc && afterDoc.liturgy) || {};
        const hymnDeltas = [];
        const scriptureDeltas = [];

        HYMN_FIELDS.forEach(field => {
            const oldId = hymnIdOf(before[field]);
            const newId = hymnIdOf(after[field]);
            if (oldId === newId) return;
            if (oldId) hymnDeltas.push({ hymnId: oldId, countDelta: -1, date });
            if (newId) hymnDeltas.push({ hymnId: newId, countDelta: 1, date });
        });

        SCRIPTURE_FIELDS.forEach(field => {
            const oldRef = scriptureRefOf(before[field]);
            const newRef = scriptureRefOf(after[field]);
            if (oldRef === newRef) return;
            if (oldRef) scriptureDeltas.push({ reference: oldRef, countDelta: -1, date });
            if (newRef) scriptureDeltas.push({ reference: newRef, countDelta: 1, date });
        });

        return { hymnDeltas, scriptureDeltas };
    }

    // The key a serving record's stats are cached under, on
    // `people/{personId}.roleStats`. Mirrors service-involvement-core.js's
    // SERVING_FIELDS slugs — `prayer` needs `prayer_type` to tell "Prayer
    // (Praise)" and "Prayer (Confession)" apart, everything else doesn't.
    // Returns null for a record with no type (nothing to key it by).
    function roleStatKey(type, prayerType) {
        if (!type) return null;
        return prayerType ? `${type}_${prayerType}` : type;
    }

    const UsageStatsCore = {
        HYMN_FIELDS,
        SCRIPTURE_FIELDS,
        diffLiturgyUsage,
        roleStatKey,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = UsageStatsCore;
    }
    if (global) {
        global.UsageStatsCore = UsageStatsCore;
    }
})(typeof window !== 'undefined' ? window : null);
