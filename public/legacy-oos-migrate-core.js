// Legacy Order-of-Service prayer leaders lived on top-level
// `prayerPraiseId` / `prayerConfessionId` (and names) and were drawn under
// scripture rows via `legacyPrayerHomes`. The liturgy-order model keeps those
// people on `carriedBy.<prayerElementId>` for elements with `prayedByOther`.
//
// Pure: migration planning, read-time hydration, and involvement derivation.
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
        // Canonical storage slot even when this Sunday's order has not placed the
        // prayer element yet — legacy top-level fields still migrate here.
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
     * @return {{ praise: number, confession: number, skipped: number, missingTarget: number }}
     */
    function planLegacyPrayerMigration(service, catalog) {
        const counts = { praise: 0, confession: 0, skipped: 0, missingTarget: 0 };
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
        };
    }

    /** In-memory only: show legacy leaders on carriedBy until prod migration runs. */
    function hydrateCarriedByFromLegacy(service, catalog) {
        const doc = service || {};
        if (!doc.carriedBy || typeof doc.carriedBy !== 'object') doc.carriedBy = {};
        LEGACY_SPECS.forEach((spec) => {
            const legacy = legacyValue(doc, spec);
            if (!legacy) return;
            const targetId = resolveTargetElementId(doc, catalog, spec);
            if (!targetId) return;
            if (!isCarrierEmpty(carrierAt(doc, targetId))) return;
            doc.carriedBy[targetId] = { id: legacy.id, name: legacy.name };
        });
        return doc;
    }

    function prayerTypeForElement(el) {
        if (!el || el.kind !== 'prayer') return null;
        const id = String(el.id || '');
        const name = String(el.name || '').toLowerCase();
        if (id === 'prayerOfConfession' || name.includes('confession')) return 'confession';
        if (id === 'prayerOfPraise' || name.includes('praise')) return 'praise';
        return null;
    }

    function prayerInvolvementFromCarriedBy(service, catalog) {
        const doc = service || {};
        const records = [];
        const pushCarrier = (elementId, prayerType) => {
            const carrier = carrierAt(doc, elementId);
            if (!carrier.id) return;
            records.push({
                personId: carrier.id,
                type: 'prayer',
                metadata: { prayer_type: prayerType },
            });
        };
        if (Liturgy) {
            const cat = catalogFrom(catalog);
            const order = Liturgy.orderFor(doc, cat);
            Liturgy.elementsOf(order, cat).forEach((el) => {
                if (!el || el.kind !== 'prayer' || !el.prayedByOther) return;
                const prayerType = prayerTypeForElement(el);
                if (!prayerType) return;
                pushCarrier(el.id, prayerType);
            });
        }
        LEGACY_SPECS.forEach((spec) => {
            const targetId = resolveTargetElementId(doc, catalog, spec);
            if (!targetId) return;
            pushCarrier(targetId, spec.kind);
        });
        const seen = new Set();
        return records.filter((rec) => {
            const key = rec.metadata.prayer_type + ':' + rec.personId;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function legacyPrayerInvolvement(service) {
        const doc = service || {};
        const records = [];
        LEGACY_SPECS.forEach((spec) => {
            const id = doc[spec.idField];
            if (!id) return;
            records.push({
                personId: id,
                type: 'prayer',
                metadata: { prayer_type: spec.kind },
            });
        });
        return records;
    }

    function mergePrayerInvolvement(service, catalog) {
        const seen = new Set();
        const out = [];
        const push = (rec) => {
            const key = rec.type + ':' + (rec.metadata && rec.metadata.prayer_type || '') + ':' + rec.personId;
            if (seen.has(key)) return;
            seen.add(key);
            out.push(rec);
        };
        prayerInvolvementFromCarriedBy(service, catalog).forEach(push);
        legacyPrayerInvolvement(service).forEach(push);
        return out;
    }

    const LegacyOosMigrateCore = {
        LEGACY_SPECS,
        resolveTargetElementId,
        planLegacyPrayerMigration,
        hydrateCarriedByFromLegacy,
        prayerTypeForElement,
        prayerInvolvementFromCarriedBy,
        legacyPrayerInvolvement,
        mergePrayerInvolvement,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LegacyOosMigrateCore;
    }
    if (global) {
        global.LegacyOosMigrateCore = LegacyOosMigrateCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
