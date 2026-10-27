const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    PRAYER_SMS_CONFIG_PATH,
    REPLY_WEBHOOK_FLAG_PATCH,
    describeReplyWebhookFlag,
    formatReplyWebhookFlagPlan,
    webhookFlagWriteHeld,
    executeSetReplyWebhookFlag,
} = require('../scripts/set-prayer-sms-reply-webhook-lib');

test('the webhook patch turns on replies and nothing else', () => {
    assert.equal(PRAYER_SMS_CONFIG_PATH, 'app_config/prayer_request_sms');
    assert.deepEqual(REPLY_WEBHOOK_FLAG_PATCH, {includeReplyWebhookInSms: true});
    assert.equal(Object.hasOwn(REPLY_WEBHOOK_FLAG_PATCH, 'includeAnswerLinkInSms'), false);
});

test('describe keeps the answer-link field out of the patch', () => {
    const described = describeReplyWebhookFlag({
        includeAnswerLinkInSms: true,
        includeReplyWebhookInSms: false,
        initial: 'Hi {name}',
        autoSendEnabled: true,
    });
    assert.equal(described.includeReplyWebhookInSms, false);
    assert.equal(described.includeAnswerLinkInSms, 'true');
    assert.equal(described.preservedFieldCount, 3);
    assert.deepEqual(described.patch, {includeReplyWebhookInSms: true});
    assert.match(formatReplyWebhookFlagPlan(described), /includeAnswerLinkInSms: true \(unchanged\)/);
    assert.match(formatReplyWebhookFlagPlan(described), /merge=true/);
});

test('an absent answer-link flag stays absent in the description', () => {
    const described = describeReplyWebhookFlag({initial: 'Hi'});
    assert.equal(described.includeAnswerLinkInSms, 'absent');
    assert.equal(described.includeReplyWebhookInSms, false);
    assert.equal(described.preservedFieldCount, 1);
});

test('webhookFlagWriteHeld rejects an answer-link or template change', () => {
    const before = {
        includeAnswerLinkInSms: true,
        includeReplyWebhookInSms: false,
        initial: 'Hi {name}',
    };
    assert.equal(webhookFlagWriteHeld(before, {
        includeAnswerLinkInSms: true,
        includeReplyWebhookInSms: true,
        initial: 'Hi {name}',
    }), null);
    assert.match(webhookFlagWriteHeld(before, {
        includeAnswerLinkInSms: false,
        includeReplyWebhookInSms: true,
        initial: 'Hi {name}',
    }) || '', /includeAnswerLinkInSms/);
    assert.match(webhookFlagWriteHeld(before, {
        includeAnswerLinkInSms: true,
        includeReplyWebhookInSms: true,
        initial: 'replaced',
    }) || '', /initial/);
    assert.match(webhookFlagWriteHeld({}, {includeReplyWebhookInSms: false}) || '', /not true/);
});

/**
 * @param {Record<string, *>|null|undefined} initial
 */
function memoryConfig(initial) {
    /** @type {{data: Record<string, *>|null, sets: Array<{patch: *, opts: *}>}} */
    const store = {
        data: initial === undefined ? null : initial,
        sets: [],
    };
    return {
        store,
        /**
         * @param {string} docPath
         */
        doc(docPath) {
            assert.equal(docPath, 'app_config/prayer_request_sms');
            return {
                async get() {
                    return {
                        exists: store.data != null,
                        data() {
                            return store.data;
                        },
                    };
                },
                /**
                 * @param {*} patch
                 * @param {*} opts
                 */
                async set(patch, opts) {
                    store.sets.push({patch, opts});
                    const prev = store.data || {};
                    store.data = Object.assign({}, prev, patch);
                },
            };
        },
    };
}

test('dry-run prints the plan and does not write', async () => {
    const db = memoryConfig({
        includeAnswerLinkInSms: true,
        initial: 'Hi {name}',
    });
    /** @type {string[]} */
    const lines = [];
    const result = await executeSetReplyWebhookFlag({
        commit: false,
        db,
        log: (line) => lines.push(line),
    });
    assert.equal(result.wrote, false);
    assert.equal(db.store.sets.length, 0);
    assert.equal(Object.hasOwn(db.store.data || {}, 'includeReplyWebhookInSms'), false);
    assert.match(lines.join('\n'), /DRY RUN/);
    assert.match(lines.join('\n'), /includeAnswerLinkInSms: true \(unchanged\)/);
});

test('commit merges the webhook flag and leaves the answer link', async () => {
    const db = memoryConfig({
        includeAnswerLinkInSms: true,
        initial: 'Hi {name}',
        autoSendEnabled: true,
    });
    /** @type {string[]} */
    const lines = [];
    const result = await executeSetReplyWebhookFlag({
        commit: true,
        db,
        log: (line) => lines.push(line),
    });
    assert.equal(result.wrote, true);
    assert.deepEqual(db.store.sets[0].opts, {merge: true});
    assert.deepEqual(db.store.data, {
        includeAnswerLinkInSms: true,
        includeReplyWebhookInSms: true,
        initial: 'Hi {name}',
        autoSendEnabled: true,
    });
    assert.match(lines.join('\n'), /APPLY/);
    assert.match(lines.join('\n'), /includeAnswerLinkInSms unchanged/);
});

test('the prod script is a merge through service-account.js', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'set-prayer-sms-reply-webhook.js'),
        'utf8');
    assert.match(src, /executeSetReplyWebhookFlag/);
    assert.match(src, /service-account/);
    assert.doesNotMatch(src, /includeAnswerLinkInSms\s*:/);
});
