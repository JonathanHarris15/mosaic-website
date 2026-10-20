// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/legacy-oos-migrate-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// One-off migration: copy legacy top-level `prayerPraiseId` / `prayerConfessionId`
// (and names) into `carriedBy.<prayerElementId>`. Used only by
// `scripts/migrate-legacy-oos-prayer-carriers.js` — runtime code must not read
// legacy fields (MS-771).
(function (global) {
    'use strict';

    const Liturgy = (typeof require !== 'undefined' &&
            typeof module !== 'undefined' && module.exports) ?
        require('./liturgy-order-core.js') :
        (global && global.LiturgyOrderCore);

    const LEGACY_SPECS = Object.freeze([
        {
            kind: 'praise',
            idField: 'prayerPraiseId',
            nameField: 'prayerPraiseName',
            preferredElementIds: Object.freeze(['prayerOfPraise']),
            nameMatch: /praise/i,
        },
        {
            kind: 'confession',
            idField: 'prayerConfessionId',
            nameField: 'prayerConfessionName',
            preferredElementIds: Object.freeze(['prayerOfConfession']),
            nameMatch: /confession/i,
        },
    ]);

    function catalogFrom(catalog) {
        return Liturgy ? Liturgy.catalogFrom(catalog) : { elements: [], orders: [] };
    }

    function resolveTargetElementId(service, catalog, spec) {
        const doc = service || {};
        const cat = catalogFrom(catalog);
        const order = Liturgy.orderFor(doc, cat);
        const elements = Liturgy.elementsOf(order, cat);
        for (let i = 0; i < spec.preferredElementIds.length; i++) {
            const id = spec.preferredElementIds[i];
            const el = elements.find(e => e && e.id === id && e.kind === 'prayer');
            if (el) return el.id;
        }
        const prayed = elements.filter(e => e && e.kind === 'prayer' && e.prayedByOther);
        const byName = prayed.find(e => spec.nameMatch.test(String(e.name || '')));
        if (byName) return byName.id;
        return spec.preferredElementIds[0] || null;
    }

    function legacyValue(service, spec) {
        const doc = service || {};
        const id = doc[spec.idField] || null;
        const name = doc[spec.nameField] || '';
        if (!id && !String(name).trim()) return null;
        return { id: id || null, name: String(name || '').trim() };
    }

    function carrierAt(service, elementId) {
        const carried = (service && service.carriedBy) || {};
        const ref = carried[elementId];
        if (!ref || typeof ref !== 'object') return { id: null, name: '' };
        return { id: ref.id || null, name: String(ref.name || '').trim() };
    }

    function isCarrierEmpty(ref) {
        return !ref || (!ref.id && !String(ref.name || '').trim());
    }

    /**
     * @param {object} service Firestore-shaped service doc
     * @param {object} catalog liturgy catalog
     * @return {{ wouldWrite: boolean, patch: ?object, counts: object, skippedSlots: Array }}
     */
    function planLegacyPrayerMigration(service, catalog) {
        const counts = { praise: 0, confession: 0, skipped: 0, missingTarget: 0 };
        const skippedSlots = [];
        const doc = service || {};
        const patch = { carriedBy: Object.assign({}, doc.carriedBy || {}) };
        let wouldWrite = false;

        LEGACY_SPECS.forEach((spec) => {
            const legacy = legacyValue(doc, spec);
            if (!legacy) return;
            const targetId = resolveTargetElementId(doc, catalog, spec);
            if (!targetId) {
                counts.missingTarget += 1;
                return;
            }
            const current = carrierAt(doc, targetId);
            if (!isCarrierEmpty(current)) {
                counts.skipped += 1;
                skippedSlots.push({
                    kind: spec.kind,
                    targetId,
                    legacy,
                    existing: current,
                });
                return;
            }
            patch.carriedBy[targetId] = { id: legacy.id, name: legacy.name };
            wouldWrite = true;
            if (spec.kind === 'praise') counts.praise += 1;
            else counts.confession += 1;
        });

        return {
            wouldWrite,
            patch: wouldWrite ? { carriedBy: patch.carriedBy } : null,
            counts,
            skippedSlots,
        };
    }

    const LegacyOosMigrateCore = {
        LEGACY_SPECS,
        resolveTargetElementId,
        planLegacyPrayerMigration,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LegacyOosMigrateCore;
    }
    if (global) {
        global.LegacyOosMigrateCore = LegacyOosMigrateCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
