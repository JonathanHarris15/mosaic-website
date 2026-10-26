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
 * @typedef {Object} FlagDescription
 * @property {string} path
 * @property {{includeAnswerLinkInSms: boolean}} patch
 * @property {boolean} merge
 * @property {boolean} includeAnswerLinkInSms
 * @property {'absent'|'true'|'false'} includeReplyWebhookInSms
 * @property {number} preservedFieldCount
 */

/**
 * @callback FlagSnapData
 * @return {Record<string, *>|null|undefined}
 */

/**
 * @typedef {Object} FlagSnap
 * @property {boolean} exists
 * @property {FlagSnapData} data
 */

/**
 * @callback FlagGet
 * @return {Promise<FlagSnap>}
 */

/**
 * @callback FlagSet
 * @param {{includeAnswerLinkInSms: boolean}} patch
 * @param {{merge: boolean}} opts
 * @return {Promise<void>}
 */

/**
 * @typedef {Object} FlagRef
 * @property {FlagGet} get
 * @property {FlagSet} set
 */

/**
 * @callback FlagDocFn
 * @param {string} path
 * @return {FlagRef}
 */

/**
 * @typedef {Object} FlagDb
 * @property {FlagDocFn} doc
 */

/**
 * @callback LogLine
 * @param {string} line
 * @return {void}
 */

/**
 * @typedef {Object} SetFlagArgs
 * @property {boolean} [commit]
 * @property {FlagDb} db
 * @property {LogLine} [log]
 */

/**
 * @param {Record<string, *>|null|undefined} before
 * @return {FlagDescription}
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
 * @param {Record<string, *>} data
 * @return {'absent'|'true'|'false'}
 */
function webhookState(data) {
    if (!Object.prototype.hasOwnProperty.call(data, 'includeReplyWebhookInSms')) {
        return 'absent';
    }
    return data.includeReplyWebhookInSms === true ? 'true' : 'false';
}

/**
 * @param {FlagDescription} described
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
 * @param {Record<string, *>|null|undefined} before
 * @param {Record<string, *>|null|undefined} after
 * @return {string|null} problem, or null when the write held
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
 * @param {SetFlagArgs} args
 * @return {Promise<{wrote: boolean}>}
 */
async function executeSetAnswerLinkFlag(args) {
    const commit = !!(args && args.commit);
    const db = args && args.db;
    /** @type {LogLine} */
    const log = args && args.log ? args.log : function(line) {
        console.log(line);
    };
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
