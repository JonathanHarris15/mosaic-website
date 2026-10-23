// Plan removal of legacy irregular Sunday fields (MS-796, ADR-0080).
(function (global) {
    'use strict';

    /**
     * @param {any} doc services/{date} document
     * @return {{deleteFields: boolean, irregular: boolean}}
     */
    function planIrregularFieldDeletion(doc) {
        const data = doc || {};
        const irregular = data.isIrregular === true;
        const hasElements = Array.isArray(data.irregularElements) && data.irregularElements.length > 0;
        if (!irregular && !hasElements && !Object.prototype.hasOwnProperty.call(data, 'isIrregular')) {
            return { deleteFields: false, irregular: false };
        }
        return { deleteFields: irregular || hasElements || Object.prototype.hasOwnProperty.call(data, 'isIrregular'), irregular };
    }

    const DeleteLegacyIrregularSundayCore = { planIrregularFieldDeletion };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DeleteLegacyIrregularSundayCore;
    }
    if (global) {
        global.DeleteLegacyIrregularSundayCore = DeleteLegacyIrregularSundayCore;
    }
})(typeof window !== 'undefined' ? window : null);
