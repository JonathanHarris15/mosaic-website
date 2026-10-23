// Migrate legacy irregular Sunday fields into liturgyLeftovers, then delete (MS-796).
(function (global) {
    'use strict';

    /**
     * @param {any} el legacy irregular element
     * @param {number} index
     * @return {object|null}
     */
    function irregularElementToLeftover(el, index) {
        if (!el || typeof el !== 'object') return null;
        const name = el.key || 'Irregular element';
        const kind = el.type || 'text';
        const raw = el.value;
        let value = raw;
        let valueText = '';
        if (raw && typeof raw === 'object') {
            valueText = String(raw.name || '').trim();
        } else if (raw != null) {
            valueText = String(raw).trim();
            value = valueText;
        }
        return {
            sourceId: 'legacy-irregular:' + index,
            name: name,
            kind: kind,
            value: value == null ? null : value,
            valueText: valueText,
        };
    }

    /**
     * @param {any} doc services/{date} document
     * @return {{
     *   migrate: boolean,
     *   irregular: boolean,
     *   leftoversAdded: number,
     *   liturgyLeftovers?: object[],
     * }}
     */
    function planIrregularSundayMigration(doc) {
        const data = doc || {};
        const irregular = data.isIrregular === true;
        const elements = Array.isArray(data.irregularElements) ? data.irregularElements : [];
        const hasFlag = Object.prototype.hasOwnProperty.call(data, 'isIrregular');
        const hasElementsField = Object.prototype.hasOwnProperty.call(data, 'irregularElements');
        if (!irregular && !elements.length && !hasFlag && !hasElementsField) {
            return { migrate: false, irregular: false, leftoversAdded: 0 };
        }

        const existing = Array.isArray(data.liturgyLeftovers) ? data.liturgyLeftovers.slice() : [];
        const existingSourceIds = new Set(
            existing.map((row) => row && row.sourceId).filter(Boolean),
        );
        const additions = [];
        for (let index = 0; index < elements.length; index++) {
            const sourceId = 'legacy-irregular:' + index;
            if (existingSourceIds.has(sourceId)) continue;
            const leftover = irregularElementToLeftover(elements[index], index);
            if (leftover) additions.push(leftover);
        }
        return {
            migrate: true,
            irregular: irregular || elements.length > 0,
            leftoversAdded: additions.length,
            liturgyLeftovers: existing.concat(additions),
        };
    }

    const DeleteLegacyIrregularSundayCore = {
        irregularElementToLeftover,
        planIrregularSundayMigration,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DeleteLegacyIrregularSundayCore;
    }
    if (global) {
        global.DeleteLegacyIrregularSundayCore = DeleteLegacyIrregularSundayCore;
    }
})(typeof window !== 'undefined' ? window : null);
