/**
 * @fileoverview Merge app_config/prayer_request_sms.includeReplyWebhookInSms
 * to true. Other fields, including includeAnswerLinkInSms, stay as they are.
 *
 * Run only after a Jonathan-only Textbelt send with --with-reply-webhook
 * is accepted. See docs/ops/ms-prayer-sms-reply-webhook-flag.md.
 */

const PRAYER_SMS_CONFIG_PATH = 'app_config/prayer_request_sms';

/** The only field this ops script writes. */
const REPLY_WEBHOOK_FLAG_PATCH = Object.freeze({
    includeReplyWebhookInSms: true,
});

/**
 * @typedef {Object} WebhookFlagDescription
 * @property {string} path
 * @property {{includeReplyWebhookInSms: boolean}} patch
 * @property {boolean} merge
 * @property {'absent'|'true'|'false'} includeAnswerLinkInSms
 * @property {boolean} includeReplyWebhookInSms
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
 * @param {{includeReplyWebhookInSms: boolean}} patch
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
 * @typedef {Object} SetWebhookFlagArgs
 * @property {boolean} [commit]
 * @property {FlagDb} db
 * @property {LogLine} [log]
 */

/**
 * @param {Record<string, *>} data
 * @return {'absent'|'true'|'false'}
 */
function answerLinkState(data) {
    if (!Object.prototype.hasOwnProperty.call(data, 'includeAnswerLinkInSms')) {
        return 'absent';
    }
    return data.includeAnswerLinkInSms === true ? 'true' : 'false';
}

/**
 * @param {Record<string, *>|null|undefined} before
 * @return {WebhookFlagDescription}
 */
function describeReplyWebhookFlag(before) {
    const data = before && typeof before === 'object' ? before : {};
    const preservedFieldCount = Object.keys(data)
        .filter((key) => key !== 'includeReplyWebhookInSms').length;
    return {
        path: PRAYER_SMS_CONFIG_PATH,
        patch: REPLY_WEBHOOK_FLAG_PATCH,
        merge: true,
        includeAnswerLinkInSms: answerLinkState(data),
        includeReplyWebhookInSms: data.includeReplyWebhookInSms === true,
        preservedFieldCount,
    };
}

/**
 * @param {WebhookFlagDescription} described
 * @return {string}
 */
function formatReplyWebhookFlagPlan(described) {
    return [
        described.path,
        `includeReplyWebhookInSms: ${described.includeReplyWebhookInSms} → true`,
        `includeAnswerLinkInSms: ${described.includeAnswerLinkInSms} (unchanged)`,
        `patch: ${JSON.stringify(described.patch)} merge=true`,
        `other fields preserved: ${described.preservedFieldCount}`,
    ].join('\n');
}

/**
 * After a merge write, the webhook flag is true and every other stored field matches.
 * @param {Record<string, *>|null|undefined} before
 * @param {Record<string, *>|null|undefined} after
 * @return {string|null} problem, or null when the write held
 */
function webhookFlagWriteHeld(before, after) {
    const prior = before && typeof before === 'object' ? before : {};
    const next = after && typeof after === 'object' ? after : {};
    if (next.includeReplyWebhookInSms !== true) {
        return 'includeReplyWebhookInSms is not true after the merge.';
    }
    if (answerLinkState(prior) !== answerLinkState(next)) {
        return 'includeAnswerLinkInSms changed.';
    }
    for (const key of Object.keys(prior)) {
        if (key === 'includeReplyWebhookInSms') continue;
        const value = prior[key];
        if (typeof value === 'string' || typeof value === 'boolean' ||
                typeof value === 'number') {
            if (next[key] !== value) return `field ${key} changed.`;
        }
    }
    return null;
}

/**
 * @param {SetWebhookFlagArgs} args
 * @return {Promise<{wrote: boolean}>}
 */
async function executeSetReplyWebhookFlag(args) {
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
    const described = describeReplyWebhookFlag(before);
    log(`${commit ? 'APPLY' : 'DRY RUN'} — ${formatReplyWebhookFlagPlan(described)}`);
    if (!commit) return {wrote: false};

    await ref.set(REPLY_WEBHOOK_FLAG_PATCH, {merge: true});
    const afterSnap = await ref.get();
    const after = afterSnap.exists ? (afterSnap.data() || {}) : {};
    const problem = webhookFlagWriteHeld(before, after);
    if (problem) throw new Error(problem);
    log('includeReplyWebhookInSms is true. includeAnswerLinkInSms unchanged.');
    return {wrote: true};
}

module.exports = {
    PRAYER_SMS_CONFIG_PATH,
    REPLY_WEBHOOK_FLAG_PATCH,
    describeReplyWebhookFlag,
    formatReplyWebhookFlagPlan,
    webhookFlagWriteHeld,
    executeSetReplyWebhookFlag,
};
