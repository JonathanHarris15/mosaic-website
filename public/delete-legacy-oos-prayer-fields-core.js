// Plan deletion of legacy top-level OOS prayer leader fields after migration
// to `carriedBy` (MS-771). Used only by `scripts/delete-legacy-oos-prayer-fields.js`.
(function (global) {
    'use strict';

    const Legacy = (typeof require !== 'undefined' &&
            typeof module !== 'undefined' && module.exports) ?
        require('./legacy-oos-migrate-core.js') :
        (global && global.LegacyOosMigrateCore);

    const DELETE_FIELDS = Object.freeze(
        Legacy.LEGACY_SPECS.reduce((acc, spec) => {
            acc.push(spec.idField, spec.nameField);
            return acc;
        }, [])
    );

    function hasLegacyFields(service) {
        const doc = service || {};
        return Legacy.LEGACY_SPECS.some((spec) => doc[spec.idField] || doc[spec.nameField]);
    }

    function legacyFieldsPresent(service) {
        const doc = service || {};
        const fields = [];
        Legacy.LEGACY_SPECS.forEach((spec) => {
            if (doc[spec.idField] !== undefined) fields.push(spec.idField);
            if (doc[spec.nameField] !== undefined) fields.push(spec.nameField);
        });
        return fields;
    }

    function carrierReady(service, catalog, spec) {
        const doc = service || {};
        const legacy = doc[spec.idField] || doc[spec.nameField];
        if (!legacy) return { applies: false, ready: true };
        const targetId = Legacy.resolveTargetElementId(doc, catalog, spec);
        if (!targetId) {
            return { applies: true, ready: false, reason: 'missing_target', targetId: null };
        }
        const carried = (doc.carriedBy || {})[targetId];
        const hasCarrier = carried && typeof carried === 'object' &&
            (carried.id || String(carried.name || '').trim());
        return {
            applies: true,
            ready: !!hasCarrier,
            reason: hasCarrier ? null : 'carried_by_empty',
            targetId,
            carriedBy: hasCarrier ? carried : null,
        };
    }

    /**
     * @param {object} service
     * @param {object} catalog
     * @return {{
     *   serviceId: ?string,
     *   wouldDelete: boolean,
     *   deleteFields: string[],
     *   blocked: boolean,
     *   blockReasons: Array<object>
     * }}
     */
    function planLegacyPrayerFieldDeletion(service, catalog, serviceId) {
        const doc = service || {};
        if (!hasLegacyFields(doc)) {
            return {
                serviceId: serviceId || null,
                wouldDelete: false,
                deleteFields: [],
                blocked: false,
                blockReasons: [],
            };
        }

        const blockReasons = [];
        Legacy.LEGACY_SPECS.forEach((spec) => {
            const check = carrierReady(doc, catalog, spec);
            if (check.applies && !check.ready) {
                blockReasons.push({
                    kind: spec.kind,
                    idField: spec.idField,
                    nameField: spec.nameField,
                    targetId: check.targetId,
                    reason: check.reason,
                    legacyId: doc[spec.idField] || null,
                    legacyName: doc[spec.nameField] || null,
                });
            }
        });

        const deleteFields = legacyFieldsPresent(doc);
        return {
            serviceId: serviceId || null,
            wouldDelete: deleteFields.length > 0,
            deleteFields,
            blocked: blockReasons.length > 0,
            blockReasons,
        };
    }

    const DeleteLegacyOosPrayerFieldsCore = {
        DELETE_FIELDS,
        hasLegacyFields,
        legacyFieldsPresent,
        carrierReady,
        planLegacyPrayerFieldDeletion,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DeleteLegacyOosPrayerFieldsCore;
    }
    if (global) {
        global.DeleteLegacyOosPrayerFieldsCore = DeleteLegacyOosPrayerFieldsCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
