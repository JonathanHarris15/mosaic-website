// Plan deletion of phantom Person fields the directory does not store (MS-775).
//
// A Person's membership is `membership.stage` / `membership.inactive`, and the
// tags they carry are `tags`. Form pickers used to read `isMember`,
// `membershipStage`, and `tagIds`. Those three are not written by the
// directory. This plans their removal. It does not copy them onto the real
// fields: a value that is not already there blocks the delete, so a dry-run
// can show the disagreement before anything is removed.
(function (global) {
    'use strict';

    const PHANTOM_FIELDS = ['isMember', 'membershipStage', 'tagIds'];

    /**
     * @param {any} doc
     * @param {string} field
     * @return {boolean}
     */
    function hasOwn(doc, field) {
        return Object.prototype.hasOwnProperty.call(doc || {}, field);
    }

    /**
     * @param {any} doc
     * @return {{field: string, reason: string}|null}
     */
    function stageBlock(doc) {
        if (!hasOwn(doc, 'membershipStage')) return null;
        const phantom = doc.membershipStage;
        if (phantom == null || phantom === '') return null;
        const membership = doc.membership;
        const stage = membership && typeof membership === 'object' && !Array.isArray(membership)
            ? (membership.stage || null)
            : null;
        if (phantom === stage) return null;
        return {field: 'membershipStage', reason: 'differs-from-membership-stage'};
    }

    /**
     * @param {any} doc
     * @return {{field: string, reason: string}|null}
     */
    function tagBlock(doc) {
        if (!hasOwn(doc, 'tagIds')) return null;
        if (!Array.isArray(doc.tagIds)) return {field: 'tagIds', reason: 'not-an-array'};
        const tags = Array.isArray(doc.tags) ? doc.tags : [];
        /** @type {string[]} */
        const tagIds = doc.tagIds;
        const missing = tagIds.filter((id) => tags.indexOf(id) === -1);
        if (missing.length) return {field: 'tagIds', reason: 'not-in-tags'};
        return null;
    }

    /**
     * @param {any} data A Person document.
     * @return {{deleteFields: string[], blocked: boolean, blockReasons: Array<{field: string, reason: string}>}}
     */
    function planLegacyPersonFieldDeletion(data) {
        const doc = data || {};
        const present = PHANTOM_FIELDS.filter((field) => hasOwn(doc, field));
        /** @type {Array<{field: string, reason: string}>} */
        const blockReasons = [];
        const stageReason = stageBlock(doc);
        const tagReason = tagBlock(doc);
        if (stageReason) blockReasons.push(stageReason);
        if (tagReason) blockReasons.push(tagReason);
        return {
            deleteFields: blockReasons.length ? [] : present,
            blocked: blockReasons.length > 0,
            blockReasons,
        };
    }

    const DeleteLegacyPersonPickerFieldsCore = {
        PHANTOM_FIELDS,
        planLegacyPersonFieldDeletion,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DeleteLegacyPersonPickerFieldsCore;
    }
    if (global) {
        global.DeleteLegacyPersonPickerFieldsCore = DeleteLegacyPersonPickerFieldsCore;
    }
}(typeof window !== 'undefined' ? window : null));
