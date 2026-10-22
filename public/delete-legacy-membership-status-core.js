// Plan removal of legacy `membership.status` (MS-786).
//
// The Membership Track stores stage and inactive. This plans backfill of
// `inactive` from `status === 'inactive'`, then deletes `membership.status`.
// A non-inactive status that disagrees with the stored stage blocks the run.
(function (global) {
    'use strict';

    const Core = (typeof require !== 'undefined')
        ? require('./shepherding-core.js')
        : (global && global.ShepherdingCore);

    const ALL_STAGES = new Set(Core.MEMBERSHIP_STAGES);

    /**
     * @param {string|undefined|null} status
     * @return {string|null}
     */
    function statusToStage(status) {
        if (!status) return null;
        if (ALL_STAGES.has(status)) return status;
        return Core.membershipFromLegacyStatus(status).stage;
    }

    /**
     * @param {any} data Person document.
     * @return {{setInactive: boolean, deleteStatus: boolean, blocked: boolean, blockReasons: string[]}}
     */
    function planMembershipStatusRemoval(data) {
        const doc = data || {};
        const membership = doc.membership;
        /** @type {string[]} */
        const blockReasons = [];
        if (!membership || typeof membership !== 'object' || Array.isArray(membership)) {
            return { setInactive: false, deleteStatus: false, blocked: false, blockReasons };
        }
        if (!Object.prototype.hasOwnProperty.call(membership, 'status')) {
            return { setInactive: false, deleteStatus: false, blocked: false, blockReasons };
        }
        const status = membership.status;
        const stage = membership.stage || null;
        let setInactive = false;
        if (status === 'inactive') {
            if (!membership.inactive) setInactive = true;
        } else if (status != null && status !== '') {
            const statusStage = statusToStage(status);
            if (statusStage && stage && statusStage !== stage) {
                blockReasons.push(
                    'status-stage-conflict:' + String(status) + '→' + statusStage + ' vs stage ' + stage);
            }
        }
        return {
            setInactive,
            deleteStatus: blockReasons.length === 0,
            blocked: blockReasons.length > 0,
            blockReasons,
        };
    }

    const DeleteLegacyMembershipStatusCore = {
        planMembershipStatusRemoval,
        statusToStage,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DeleteLegacyMembershipStatusCore;
    }
    if (global) {
        global.DeleteLegacyMembershipStatusCore = DeleteLegacyMembershipStatusCore;
    }
}(typeof window !== 'undefined' ? window : null));
