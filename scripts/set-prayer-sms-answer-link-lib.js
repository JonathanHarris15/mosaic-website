/**
 * @fileoverview Merge app_config/prayer_request_sms.includeAnswerLinkInSms
 * to true. Other fields, including includeReplyWebhookInSms, stay as they are.
 */

const PRAYER_SMS_CONFIG_PATH = 'app_config/prayer_request_sms';

/** The only field this ops script writes. */
const ANSWER_LINK_FLAG_PATCH = Object.freeze({
    includeAnswerLinkInSms: true,
});

/**
 * @param {?Object} before
 * @return {Object}
 */
function describeAnswerLinkFlag(before) {
    const data = before && typeof before === 'object' ? before : {};
    const preservedFieldCount = Object.keys(data)
        .filter((key) => key !== 'includeAnswerLinkInSms').length;
    return {
        path: PRAYER_SMS_CONFIG_PATH,
        patch: ANSWER_LINK_FLAG_PATCH,
        merge: true,
        includeAnswerLinkInSms: data.includeAnswerLinkInSms === true,
        includeReplyWebhookInSms: webhookState(data),
        preservedFieldCount,
    };
}

/**
 * @param {Object} data
 * @return {'absent'|'true'|'false'}
 */
function webhookState(data) {
    if (!Object.prototype.hasOwnProperty.call(data, 'includeReplyWebhookInSms')) {
        return 'absent';
    }
    return data.includeReplyWebhookInSms === true ? 'true' : 'false';
}

/**
 * @param {Object} described
 * @return {string}
 */
function formatAnswerLinkFlagPlan(described) {
    return [
        described.path,
        `includeAnswerLinkInSms: ${described.includeAnswerLinkInSms} → true`,
        `includeReplyWebhookInSms: ${described.includeReplyWebhookInSms} (unchanged)`,
        `patch: ${JSON.stringify(described.patch)} merge=true`,
        `other fields preserved: ${described.preservedFieldCount}`,
    ].join('\n');
}

/**
 * After a merge write, the flag is true and every other stored field matches.
 * @param {?Object} before
 * @param {?Object} after
 * @return {?string} problem, or null when the write held
 */
function flagWriteHeld(before, after) {
    const prior = before && typeof before === 'object' ? before : {};
    const next = after && typeof after === 'object' ? after : {};
    if (next.includeAnswerLinkInSms !== true) {
        return 'includeAnswerLinkInSms is not true after the merge.';
    }
    if (webhookState(prior) !== webhookState(next)) {
        return 'includeReplyWebhookInSms changed.';
    }
    for (const key of Object.keys(prior)) {
        if (key === 'includeAnswerLinkInSms') continue;
        const value = prior[key];
        if (typeof value === 'string' || typeof value === 'boolean' ||
                typeof value === 'number') {
            if (next[key] !== value) return `field ${key} changed.`;
        }
    }
    return null;
}

/**
 * @param {Object} args
 * @param {boolean} args.commit
 * @param {Object} args.db
 * @param {function(string): void} [args.log]
 * @return {Promise<{wrote: boolean}>}
 */
async function executeSetAnswerLinkFlag(args) {
    const commit = !!(args && args.commit);
    const db = args && args.db;
    const log = args && args.log ? args.log : console.log;
    if (!db || typeof db.doc !== 'function') {
        throw new Error('Firestore db is required.');
    }
    const ref = db.doc(PRAYER_SMS_CONFIG_PATH);
    const snap = await ref.get();
    const before = snap.exists ? (snap.data() || {}) : {};
    const described = describeAnswerLinkFlag(before);
    log(`${commit ? 'APPLY' : 'DRY RUN'} — ${formatAnswerLinkFlagPlan(described)}`);
    if (!commit) return {wrote: false};

    await ref.set(ANSWER_LINK_FLAG_PATCH, {merge: true});
    const afterSnap = await ref.get();
    const after = afterSnap.exists ? (afterSnap.data() || {}) : {};
    const problem = flagWriteHeld(before, after);
    if (problem) throw new Error(problem);
    log('includeAnswerLinkInSms is true. includeReplyWebhookInSms unchanged.');
    return {wrote: true};
}

module.exports = {
    PRAYER_SMS_CONFIG_PATH,
    ANSWER_LINK_FLAG_PATCH,
    describeAnswerLinkFlag,
    formatAnswerLinkFlagPlan,
    flagWriteHeld,
    executeSetAnswerLinkFlag,
};
