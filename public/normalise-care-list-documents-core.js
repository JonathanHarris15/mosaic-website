// Plan batch normalisation of care-list elder_documents (MS-787).
//
// A list from before columns stored a bare TipTap doc per person. The column
// shape is careListColumns + careListData.{person}.{column}. This plans a
// one-shot rewrite using the same rules as CareListCore.normalise.
(function (global) {
    'use strict';

    const CareList = (typeof require !== 'undefined')
        ? require('./care-list-core.js')
        : (global && global.CareListCore);

    /**
     * @param {any} data elder_documents payload.
     * @return {{needsNormalise: boolean, patch: {careListColumns: unknown[], careListData: Record<string, unknown>}|null}}
     */
    function planCareListNormalise(data) {
        if (!data || data.docType !== 'care-list') {
            return { needsNormalise: false, patch: null };
        }
        if (!CareList.isOldShape(data)) {
            return { needsNormalise: false, patch: null };
        }
        const patch = CareList.normalise(data);
        return { needsNormalise: true, patch };
    }

    const NormaliseCareListDocumentsCore = {
        planCareListNormalise,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = NormaliseCareListDocumentsCore;
    }
    if (global) {
        global.NormaliseCareListDocumentsCore = NormaliseCareListDocumentsCore;
    }
}(typeof window !== 'undefined' ? window : null));
