const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    PRAYER_SMS_CONFIG_PATH,
    ANSWER_LINK_FLAG_PATCH,
    describeAnswerLinkFlag,
    formatAnswerLinkFlagPlan,
    flagWriteHeld,
    executeSetAnswerLinkFlag,
} = require('../scripts/set-prayer-sms-answer-link-lib');

test('the flag patch turns on Answer links and nothing else', () => {
    assert.equal(PRAYER_SMS_CONFIG_PATH, 'app_config/prayer_request_sms');
    assert.deepEqual(ANSWER_LINK_FLAG_PATCH, {includeAnswerLinkInSms: true});
    assert.equal(Object.hasOwn(ANSWER_LINK_FLAG_PATCH, 'includeReplyWebhookInSms'), false);
});

test('describe keeps the webhook field out of the patch', () => {
    const described = describeAnswerLinkFlag({
        includeAnswerLinkInSms: false,
        includeReplyWebhookInSms: false,
        initial: 'Hi {name}',
        autoSendEnabled: true,
    });
    assert.equal(described.includeAnswerLinkInSms, false);
    assert.equal(described.includeReplyWebhookInSms, 'false');
    assert.equal(described.preservedFieldCount, 3);
    assert.deepEqual(described.patch, {includeAnswerLinkInSms: true});
    assert.match(formatAnswerLinkFlagPlan(described), /includeReplyWebhookInSms: false \(unchanged\)/);
    assert.match(formatAnswerLinkFlagPlan(described), /merge=true/);
});

test('an absent webhook stays absent in the description', () => {
    const described = describeAnswerLinkFlag({initial: 'Hi'});
    assert.equal(described.includeReplyWebhookInSms, 'absent');
    assert.equal(described.preservedFieldCount, 1);
});

test('flagWriteHeld rejects a webhook or template change', () => {
    const before = {
        includeAnswerLinkInSms: false,
        includeReplyWebhookInSms: false,
        initial: 'Hi {name}',
    };
    assert.equal(flagWriteHeld(before, {
        includeAnswerLinkInSms: true,
        includeReplyWebhookInSms: false,
        initial: 'Hi {name}',
    }), null);
    assert.match(flagWriteHeld(before, {
        includeAnswerLinkInSms: true,
        includeReplyWebhookInSms: true,
        initial: 'Hi {name}',
    }) || '', /includeReplyWebhookInSms/);
    assert.match(flagWriteHeld(before, {
        includeAnswerLinkInSms: true,
        includeReplyWebhookInSms: false,
        initial: 'replaced',
    }) || '', /initial/);
    assert.match(flagWriteHeld({}, {includeAnswerLinkInSms: false}) || '', /not true/);
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
                        data: () => store.data || {},
                    };
                },
                /**
                 * @param {{includeAnswerLinkInSms: boolean}} patch
                 * @param {{merge?: boolean}} opts
                 */
                async set(patch, opts) {
                    store.sets.push({patch, opts});
                    if (!opts || opts.merge !== true) {
                        throw new Error('merge required');
                    }
                    store.data = Object.assign({}, store.data || {}, patch);
                },
            };
        },
    };
}

test('dry-run prints the merge and does not write', async () => {
    const db = memoryConfig({
        includeAnswerLinkInSms: false,
        includeReplyWebhookInSms: false,
        initial: 'Hi {name}',
    });
    /** @type {string[]} */
    const lines = [];
    const result = await executeSetAnswerLinkFlag({
        commit: false,
        db,
        log: (line) => {
            lines.push(line);
        },
    });
    assert.equal(result.wrote, false);
    assert.equal(db.store.sets.length, 0);
    const dryStored = db.store.data || {};
    assert.equal(dryStored.includeAnswerLinkInSms, false);
    assert.match(lines.join('\n'), /DRY RUN/);
    assert.match(lines.join('\n'), /includeAnswerLinkInSms: false → true/);
});

test('commit merges the flag and leaves the rest of the doc', async () => {
    const db = memoryConfig({
        includeAnswerLinkInSms: false,
        includeReplyWebhookInSms: false,
        initial: 'Hi {name}',
        autoSendEnabled: true,
    });
    /** @type {string[]} */
    const lines = [];
    const result = await executeSetAnswerLinkFlag({
        commit: true,
        db,
        log: (line) => {
            lines.push(line);
        },
    });
    assert.equal(result.wrote, true);
    assert.equal(db.store.sets.length, 1);
    assert.deepEqual(db.store.sets[0], {
        patch: {includeAnswerLinkInSms: true},
        opts: {merge: true},
    });
    assert.deepEqual(db.store.data || {}, {
        includeAnswerLinkInSms: true,
        includeReplyWebhookInSms: false,
        initial: 'Hi {name}',
        autoSendEnabled: true,
    });
    assert.match(lines.join('\n'), /APPLY/);
    assert.match(lines.join('\n'), /includeReplyWebhookInSms unchanged/);
});

test('commit can create the flag on a missing doc without inventing a webhook', async () => {
    const db = memoryConfig(null);
    await executeSetAnswerLinkFlag({commit: true, db, log: () => {}});
    const created = db.store.data || {};
    assert.deepEqual(created, {includeAnswerLinkInSms: true});
    assert.equal(Object.hasOwn(created, 'includeReplyWebhookInSms'), false);
});

test('the prod script is a merge through service-account.js', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'set-prayer-sms-answer-link.js'),
        'utf8');
    assert.match(src, /executeSetAnswerLinkFlag/);
    assert.match(src, /service-account/);
    assert.doesNotMatch(src, /includeReplyWebhookInSms\s*:/);
});
