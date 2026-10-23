// Plan removal of legacy per-date role lists on event occurrences (MS-794).
//
// Roles for every date of a series live on events.roleSlugs. occurrenceRoleSlugs
// was an older per-date list that is no longer written.
(function (global) {
    'use strict';

    /**
     * @param {any} data occurrence document
     * @return {{deleteField: boolean}}
     */
    function planOccurrenceRoleSlugDeletion(data) {
        const doc = data || {};
        if (!Object.prototype.hasOwnProperty.call(doc, 'occurrenceRoleSlugs')) {
            return { deleteField: false };
        }
        return { deleteField: true };
    }

    const DeleteOccurrenceRoleSlugsCore = {
        planOccurrenceRoleSlugDeletion,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DeleteOccurrenceRoleSlugsCore;
    }
    if (global) {
        global.DeleteOccurrenceRoleSlugsCore = DeleteOccurrenceRoleSlugsCore;
    }
})(typeof window !== 'undefined' ? window : null);
