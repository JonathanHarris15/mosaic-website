const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const al = require('../functions/answer-link');
const pr = require('../functions/prayer-request');
const Liturgy = require('../public/liturgy-order-core.js');
const {toE164US} = require('../functions/sms');
const {
    phoneFromPerson,
    isJonathanHarris,
    textbeltPayload,
    JONATHAN_HARRIS_NAME,
    JONATHAN_HARRIS_PERSON_ID,
    JONATHAN_HARRIS_PHONE_E164,
    ANSWER_LINK_HORIZON_DAYS,
    DRY_RUN_ANSWER_URL,
    assertJonathanHarrisRecipient,
    addCalendarDays,
    isSunday,
    nextSundayAfter,
    isMintedAnswerUrl,
    assertMintedLink,
    answerLinkMintArgs,
    initialPastoralSmsBody,
    chooseAnswerLinkServiceDate,
    sundaySubjectRow,
    planJonathanAnswerLinkSms,
    executeTextbeltTestSend,
} = require('../scripts/textbelt-test-send-lib');

const JONATHAN_ID = 'CErA3v4J4hVm0iLfdG9Y';
const NOW = new Date('2026-10-26T15:00:00.000Z');
const ANSWER_URL = 'https://mosaic-hymn-database.web.app/a/EXAMPLETOKEN1234';

test('isJonathanHarris is an exact full-name match', () => {
    assert.strictEqual(isJonathanHarris(JONATHAN_HARRIS_NAME), true);
    assert.strictEqual(isJonathanHarris('Jonathan Harris Jr.'), false);
    assert.strictEqual(isJonathanHarris(''), false);
});

test('phoneFromPerson normalizes contact.phone', () => {
    assert.strictEqual(
        phoneFromPerson({contact: {phone: '5551234567'}}),
        '+15551234567');
    assert.throws(() => phoneFromPerson({contact: {}}), /no usable US phone/);
});

test('textbeltPayload omits replyWebhookUrl', () => {
    const payload = textbeltPayload('+15551234567', 'hi', 'key-1');
    assert.deepStrictEqual(payload, {
        phone: '+15551234567',
        message: 'hi',
        key: 'key-1',
    });
    assert.ok(!('replyWebhookUrl' in payload));
});

test('recipient lock is Jonathan Harris at the known person and phone', () => {
    assert.equal(toE164US('(580) 504-3816'), '+15805043816');
    assert.equal(JONATHAN_HARRIS_PERSON_ID, JONATHAN_ID);
    assert.equal(JONATHAN_HARRIS_PHONE_E164, '+15805043816');
    assert.equal(ANSWER_LINK_HORIZON_DAYS, 21);
    assert.doesNotThrow(() => assertJonathanHarrisRecipient({
        id: JONATHAN_ID,
        name: 'Jonathan Harris',
        phone: '+15805043816',
    }));
    assert.throws(() => assertJonathanHarrisRecipient({
        id: 'someone-else',
        name: 'Jonathan Harris',
        phone: '+15805043816',
    }), /CErA3v4J4hVm0iLfdG9Y/);
    assert.throws(() => assertJonathanHarrisRecipient({
        id: JONATHAN_ID,
        name: 'Jonathan Harris Jr.',
        phone: '+15805043816',
    }), /Jonathan Harris Jr/);
    assert.throws(() => assertJonathanHarrisRecipient({
        id: JONATHAN_ID,
        name: 'Jonathan Harris',
        phone: '+15555550123',
    }), /580/);
});

test('next Sunday after 2026-10-26 is 2026-11-01', () => {
    assert.equal(pr.churchDateParts(NOW).date, '2026-10-26');
    assert.equal(nextSundayAfter('2026-10-26'), '2026-11-01');
    assert.equal(nextSundayAfter('2026-11-01'), '2026-11-08');
    assert.equal(addCalendarDays('2026-10-26', 21), '2026-11-16');
    assert.equal(isSunday('2026-11-01'), true);
    assert.equal(isSunday('2026-10-28'), false);
    assert.equal(isSunday('2026-11-15'), true);
});

test('service date is the next Sunday when Jonathan is a pastoral-prayer subject', () => {
    const choice = chooseAnswerLinkServiceDate({
        todayDate: '2026-10-26',
        personId: JONATHAN_ID,
        sundays: [
            {
                date: '2026-10-28',
                subjectIds: [JONATHAN_ID],
                message: 'Wednesday',
            },
            {
                date: '2026-11-01',
                subjectIds: [JONATHAN_ID],
                message: 'Sunday ask',
            },
            {
                date: '2099-06-01',
                subjectIds: [JONATHAN_ID],
                message: 'fixture',
            },
        ],
    });
    assert.equal(choice.serviceDate, '2026-11-01');
    assert.equal(choice.message, 'Sunday ask');
    assert.match(choice.reason, /next Sunday after 2026-10-26/);
});

test('service date moves forward when he is not on the next Sunday', () => {
    const choice = chooseAnswerLinkServiceDate({
        todayDate: '2026-10-26',
        personId: JONATHAN_ID,
        sundays: [
            {date: '2026-11-01', subjectIds: ['someone-else'], message: ''},
            {date: '2026-11-08', subjectIds: [JONATHAN_ID], message: 'Later'},
        ],
    });
    assert.equal(choice.serviceDate, '2026-11-08');
    assert.equal(choice.message, 'Later');
    assert.match(choice.reason, /not a pastoral-prayer subject on 2026-11-01/);
    assert.match(choice.reason, /using 2026-11-08/);
});

test('a Sunday past the Answer-link lifetime is not a service date', () => {
    assert.throws(() => chooseAnswerLinkServiceDate({
        todayDate: '2026-10-26',
        personId: JONATHAN_ID,
        sundays: [{date: '2099-06-01', subjectIds: [JONATHAN_ID], message: ''}],
    }), /No Sunday after 2026-10-26 through 2026-11-16/);
    const edge = chooseAnswerLinkServiceDate({
        todayDate: '2026-10-26',
        personId: JONATHAN_ID,
        sundays: [{date: '2026-11-15', subjectIds: [JONATHAN_ID], message: 'edge'}],
    });
    assert.equal(edge.serviceDate, '2026-11-15');
});

test('initial SMS uses the pastoral-prayer template and the Answer URL', () => {
    const body = initialPastoralSmsBody({
        config: {},
        customMessage: '',
        firstName: 'Jonathan',
        answerUrl: ANSWER_URL,
    });
    assert.equal(body,
        'Hi Jonathan, this is Mosaic Church. You\'re in our pastoral prayer ' +
        'this Sunday. What would you like us to pray about? (This information ' +
        'will be private and only shared with Elders) Just reply to this ' +
        'message, or answer here: ' + ANSWER_URL);
    assert.equal(textbeltPayload('+15805043816', body, 'k').replyWebhookUrl, undefined);
});

test('a saved template without {link} still carries the URL on its own line', () => {
    const body = initialPastoralSmsBody({
        config: {initial: 'Hi {name}, reply to this message.'},
        customMessage: '',
        firstName: 'Jonathan',
        answerUrl: ANSWER_URL,
    });
    assert.equal(body, 'Hi Jonathan, reply to this message.\n' + ANSWER_URL);
});

test('liturgy prose replaces the template and still includes the URL', () => {
    const appended = initialPastoralSmsBody({
        config: {},
        customMessage: 'Hi {name}, please pray.',
        firstName: 'Jonathan',
        answerUrl: ANSWER_URL,
    });
    assert.equal(appended, 'Hi Jonathan, please pray.\n' + ANSWER_URL);
    const slotted = initialPastoralSmsBody({
        config: {},
        customMessage: 'Hi {name}, answer here: {link}',
        firstName: 'Jonathan',
        answerUrl: ANSWER_URL,
    });
    assert.equal(slotted, 'Hi Jonathan, answer here: ' + ANSWER_URL);
});

test('sunday row reads pastoral-prayer subjects the way the Answer form does', () => {
    const catalog = Liturgy.catalogFrom({
        orders: [{
            id: 'standard',
            name: 'Standard',
            elements: [{
                id: 'pastoral',
                kind: 'prayer',
                name: 'Pastoral Prayer',
                requests: {count: 1, who: 'either'},
                message: 'Custom ask {name}',
            }],
        }],
    });
    const row = sundaySubjectRow('2026-11-01', {
        liturgy: {pastoral: [{id: JONATHAN_ID, name: 'Jonathan Harris'}]},
    }, catalog, JONATHAN_ID);
    assert.deepEqual(row.subjectIds, [JONATHAN_ID]);
    assert.equal(row.message, 'Custom ask {name}');
});

test('dry-run URL is not a minted token', () => {
    assert.equal(isMintedAnswerUrl(DRY_RUN_ANSWER_URL), false);
    const token = al.mintAnswerToken(Buffer.alloc(16, 7));
    const url = al.buildAnswerUrl(token);
    assert.match(url, /^https:\/\/mosaic-hymn-database\.web\.app\/a\/[1-9A-HJ-NP-Za-km-z]{16,24}$/);
    assert.equal(assertMintedLink({token, url}), url);
    assert.throws(() => assertMintedLink({token: '<token>', url: DRY_RUN_ANSWER_URL}),
        /real Answer URL/);
});

test('mint args match the live prayer ask', () => {
    assert.deepEqual(answerLinkMintArgs(JONATHAN_ID, '2026-11-01', NOW), {
        purpose: 'prayer_request',
        personId: JONATHAN_ID,
        thing: '2026-11-01',
        now: NOW,
    });
});

function jonathanDb(options = {}) {
    const person = options.person || {
        name: 'Jonathan Harris',
        contact: {phone: '(580) 504-3816'},
    };
    const config = options.config || {
        includeAnswerLinkInSms: true,
        includeReplyWebhookInSms: false,
    };
    const request = options.request || null;
    const nameCount = options.nameCount == null ? 1 : options.nameCount;
    const reads = [];
    return {
        reads,
        doc(docPath) {
            return {
                async get() {
                    if (docPath === 'app_config/prayer_request_sms') {
                        return {exists: true, data: () => config};
                    }
                    throw new Error('unexpected doc ' + docPath);
                },
            };
        },
        collection(name) {
            if (name !== 'people') throw new Error('unexpected collection ' + name);
            return {
                doc(id) {
                    return {
                        async get() {
                            if (id !== JONATHAN_ID) {
                                return {exists: false, id, data: () => ({})};
                            }
                            return {exists: true, id, data: () => person};
                        },
                        collection(sub) {
                            if (sub !== 'prayer_requests') throw new Error(sub);
                            return {
                                doc(date) {
                                    return {
                                        async get() {
                                            reads.push(date);
                                            if (request && date === '2026-11-01') {
                                                return {exists: true, data: () => request};
                                            }
                                            return {exists: false, data: () => ({})};
                                        },
                                    };
                                },
                            };
                        },
                    };
                },
                where() {
                    return {
                        limit() {
                            return {
                                async get() {
                                    const docs = [];
                                    for (let i = 0; i < nameCount; i++) {
                                        docs.push({
                                            id: i === 0 ? JONATHAN_ID : 'other-' + i,
                                            data: () => person,
                                        });
                                    }
                                    return {size: docs.length, docs};
                                },
                            };
                        },
                    };
                },
            };
        },
    };
}

function pastoralCatalog(message) {
    return Liturgy.catalogFrom({
        orders: [{
            id: 'standard',
            name: 'Standard',
            elements: [{
                id: 'pastoral',
                kind: 'prayer',
                name: 'Pastoral Prayer',
                requests: {count: 1, who: 'either'},
                message: message || '',
            }],
        }],
    });
}

function serviceNamingJonathan() {
    return {
        liturgy: {pastoral: [{id: JONATHAN_ID, name: 'Jonathan Harris'}]},
    };
}

function withUrlDeps(overrides = {}) {
    const db = overrides.db || jonathanDb(overrides);
    const mints = [];
    const posts = [];
    const lines = [];
    const token = al.mintAnswerToken(Buffer.alloc(16, 7));
    const url = al.buildAnswerUrl(token);
    let keyLoads = 0;
    const deps = {
        commit: !!overrides.commit,
        withUrl: overrides.withUrl !== false,
        db,
        now: () => NOW,
        listServiceDocs: async () => (overrides.services || [
            {id: '2026-10-28', data: serviceNamingJonathan()},
            {id: '2026-11-01', data: serviceNamingJonathan()},
            {id: '2099-06-01', data: serviceNamingJonathan()},
        ]),
        loadCatalog: async () => pastoralCatalog(overrides.message),
        mintAnswerLink: async (mintArgs) => {
            mints.push(mintArgs);
            return {token, url, id: 'hash'};
        },
        resolveKey: async () => {
            keyLoads += 1;
            if (overrides.keyError) throw new Error(overrides.keyError);
            return {key: 'super-secret-key-value', source: 'env'};
        },
        postText: async (payload) => {
            posts.push(payload);
            return {success: true, textId: 'tb_1', quotaRemaining: 9};
        },
        log: (line) => lines.push(String(line)),
    };
    return {deps, mints, posts, lines, token, url, keyLoads: () => keyLoads, db};
}

test('--with-url dry-run prints serviceDate and body and does not mint or send', async () => {
    const harness = withUrlDeps({commit: false, config: {
        includeAnswerLinkInSms: false,
        includeReplyWebhookInSms: false,
    }});
    harness.deps.db = jonathanDb({
        config: {includeAnswerLinkInSms: false, includeReplyWebhookInSms: false},
    });
    const result = await executeTextbeltTestSend(harness.deps);
    assert.equal(result.sent, false);
    assert.equal(result.minted, false);
    assert.equal(result.answerUrl, null);
    assert.equal(result.serviceDate, '2026-11-01');
    assert.match(result.body, /pastoral prayer/);
    assert.match(result.body, /https:\/\/mosaic-hymn-database\.web\.app\/a\/<token>/);
    assert.equal(harness.mints.length, 0);
    assert.equal(harness.posts.length, 0);
    assert.equal(harness.keyLoads(), 0);
    const log = harness.lines.join('\n');
    assert.match(log, /DRY RUN/);
    assert.match(log, /serviceDate: 2026-11-01/);
    assert.match(log, /answerUrl: \(not minted\)/);
    assert.match(log, /replyWebhookUrl: \(omitted\)/);
    assert.match(log, /commit: refused — includeAnswerLinkInSms is not true/);
    assert.equal(harness.deps.db.reads.includes('2026-11-01'), true);
});

test('--with-url commit mints a real token and sends one SMS without a webhook', async () => {
    const harness = withUrlDeps({
        commit: true,
        config: {
            includeAnswerLinkInSms: true,
            includeReplyWebhookInSms: true,
        },
    });
    harness.deps.db = jonathanDb({
        config: {
            includeAnswerLinkInSms: true,
            includeReplyWebhookInSms: true,
        },
    });
    const result = await executeTextbeltTestSend(harness.deps);
    assert.equal(result.sent, true);
    assert.equal(result.serviceDate, '2026-11-01');
    assert.equal(result.answerUrl, harness.url);
    assert.equal(result.tokenPath, '/a/' + harness.token);
    assert.equal(harness.mints.length, 1);
    assert.deepEqual(harness.mints[0], {
        purpose: 'prayer_request',
        personId: JONATHAN_ID,
        thing: '2026-11-01',
        now: NOW,
    });
    assert.equal(harness.posts.length, 1);
    const payload = harness.posts[0];
    assert.equal(payload.phone, '+15805043816');
    assert.equal(payload.key, 'super-secret-key-value');
    assert.equal('replyWebhookUrl' in payload, false);
    assert.match(payload.message, /or answer here: https:\/\/mosaic-hymn-database\.web\.app\/a\//);
    assert.equal(payload.message.includes(harness.url), true);
    assert.equal(harness.lines.join('\n').includes('super-secret-key-value'), false);
    assert.match(harness.lines.join('\n'), /tokenPath: \/a\//);
});

test('--with-url commit refuses before minting when the flag is off or the box is full', async () => {
    const off = withUrlDeps({commit: true});
    off.deps.db = jonathanDb({
        config: {includeAnswerLinkInSms: false},
    });
    await assert.rejects(() => executeTextbeltTestSend(off.deps), /includeAnswerLinkInSms is not true/);
    assert.equal(off.mints.length, 0);
    assert.equal(off.posts.length, 0);
    assert.equal(off.keyLoads(), 0);

    const filled = withUrlDeps({commit: true});
    filled.deps.db = jonathanDb({
        config: {includeAnswerLinkInSms: true},
        request: {prayerRequest: 'Already asked', prayerRequestSource: 'elder'},
    });
    await assert.rejects(() => executeTextbeltTestSend(filled.deps), /elder request/);
    assert.equal(filled.mints.length, 0);
    assert.equal(filled.posts.length, 0);
});

test('a second person named Jonathan Harris blocks the send', async () => {
    const harness = withUrlDeps({commit: true});
    harness.deps.db = jonathanDb({nameCount: 2});
    await assert.rejects(
        () => executeTextbeltTestSend(harness.deps),
        /found 2/);
    assert.equal(harness.mints.length, 0);
    assert.equal(harness.posts.length, 0);
});

test('--with-url refuses a phone that is not Jonathan Harris', async () => {
    const harness = withUrlDeps({commit: true});
    harness.deps.db = jonathanDb({
        person: {name: 'Jonathan Harris', contact: {phone: '5551234567'}},
    });
    await assert.rejects(() => executeTextbeltTestSend(harness.deps), /580/);
    assert.equal(harness.mints.length, 0);
    assert.equal(harness.posts.length, 0);
});

test('a missing Textbelt key does not mint an Answer link', async () => {
    const harness = withUrlDeps({commit: true, keyError: 'secret missing'});
    await assert.rejects(() => executeTextbeltTestSend(harness.deps), /TEXTBELT_KEY/);
    assert.equal(harness.mints.length, 0);
    assert.equal(harness.posts.length, 0);
});

test('plain smoke still omits the webhook and does not mint', async () => {
    const harness = withUrlDeps({commit: false, withUrl: false});
    const result = await executeTextbeltTestSend(harness.deps);
    assert.equal(result.sent, false);
    assert.match(result.body, /no reply webhook/);
    assert.equal(harness.mints.length, 0);
    assert.equal(harness.posts.length, 0);
});

test('the prod script mints through answer-link-door and never sets a webhook', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'textbelt-test-send.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(src, /answer-link-door/);
    assert.match(code, /answerDoor\.mintAnswerLink\(db,\s*args\)/);
    assert.match(code, /--with-url/);
    assert.doesNotMatch(code, /replyWebhookUrl/);
    assert.doesNotMatch(src, /textbelt-url-smoke/);
});

test('plan stays open for a form submit on the chosen Sunday', () => {
    const plan = planJonathanAnswerLinkSms({
        todayDate: '2026-10-26',
        person: {
            id: JONATHAN_ID,
            name: 'Jonathan Harris',
            phone: '+15805043816',
        },
        sundays: [{
            date: '2026-11-01',
            subjectIds: [JONATHAN_ID],
            message: '',
        }],
        config: {includeAnswerLinkInSms: true},
        answerUrl: ANSWER_URL,
        existingRequest: {initialSentDate: '2026-10-26'},
    });
    assert.equal(plan.serviceDate, '2026-11-01');
    assert.equal(plan.existingPrayerRequest, null);
    assert.equal(plan.commitDecision.ok, true);
    assert.equal(pr.mayAnswerPrayerRequest({
        personId: JONATHAN_ID,
        serviceDate: plan.serviceDate,
        todayDate: '2026-10-26',
        subjectIds: plan.subjectIds,
        viaAnswerLink: true,
    }), true);
});
