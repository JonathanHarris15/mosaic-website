// One-shot migration for legacy relationship_types (ADR-0014, MS-797).
//
// App reads assume `kind` is present after the prod backfill runs. This module
// is shared by the allowlisted script and its tests only.
(function (global) {
    'use strict';

    const KINDS = { PAIRWISE: 'pairwise', GROUP: 'group' };
    const KIND_VALUES = [KINDS.PAIRWISE, KINDS.GROUP];

    function needsMigration(doc) {
        return !!doc && typeof doc === 'object' && !KIND_VALUES.includes(doc.kind);
    }

    function migrateTypeDoc(oldDoc) {
        if (!oldDoc || typeof oldDoc !== 'object') return oldDoc;
        if (!needsMigration(oldDoc)) return { ...oldDoc };

        const { directional, ...rest } = oldDoc;
        const name = oldDoc.name || '';
        if (directional === true) {
            return {
                ...rest,
                kind: KINDS.PAIRWISE,
                priority: true,
                holderLabel: name,
                counterpartLabel: name,
            };
        }
        return { ...rest, kind: KINDS.PAIRWISE, priority: false, label: name };
    }

    const RelationshipTypeBackfillCore = {
        needsMigration,
        migrateTypeDoc,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RelationshipTypeBackfillCore;
    }
    if (global) {
        global.RelationshipTypeBackfillCore = RelationshipTypeBackfillCore;
    }
})(typeof window !== 'undefined' ? window : null);
