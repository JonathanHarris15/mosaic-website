/**
 * @fileoverview Helpers for the Jonathan Harris Textbelt smoke (prod ops).
 *
 * --with-url uses the same Answer-link mint args as dispatchPrayerAsk and the
 * same initial-SMS wording as the send path. Dry-run does not mint or send.
 */

const pr = require('../functions/prayer-request');
const nc = require('../functions/notification-core');
const al = require('../functions/answer-link');
const preview = require('./prayer-request-send-preview-lib');
const {PRAYER_SMS_CONFIG_PATH} = require('./set-prayer-sms-answer-link-lib');
const {toE164US, interpretSend} = require('../functions/sms');

/** Only this Person may receive the prod Textbelt smoke text. */
const JONATHAN_HARRIS_NAME = 'Jonathan Harris';

/** people/CErA3v4J4hVm0iLfdG9Y — the only recipient. */
const JONATHAN_HARRIS_PERSON_ID = 'CErA3v4J4hVm0iLfdG9Y';

/** (580) 504-3816. The person doc must normalize to this before a send. */
const JONATHAN_HARRIS_PHONE_E164 = '+15805043816';

const DEFAULT_MESSAGE =
    'Mosaic Church Textbelt smoke test (no reply webhook).';

/**
 * Answer links die 21 days after minting (answer-link.js). A Sunday past
 * that horizon would close before the service day ends, so the smoke will
 * not pick one.
 */
const ANSWER_LINK_HORIZON_DAYS = al.MAX_LINK_AGE_MS / (24 * 60 * 60 * 1000);

/** Shown in a dry-run body. Not a token; commit mints a real one. */
const DRY_RUN_ANSWER_URL = `${al.SITE_ORIGIN}/a/<token>`;

/**
 * @param {object} person Firestore people doc data
 * @return {string} E.164 phone
 */
function phoneFromPerson(person) {
    const raw = person && person.contact && person.contact.phone;
    const to = toE164US(raw);
    if (!to) {
        throw new Error(
            `${JONATHAN_HARRIS_NAME} has no usable US phone on contact.phone.`);
    }
    return to;
}

/**
 * @param {string} name
 * @return {boolean}
 */
function isJonathanHarris(name) {
    return String(name || '').trim() === JONATHAN_HARRIS_NAME;
}

/**
 * Textbelt payload without replyWebhookUrl.
 * @param {string} to E.164
 * @param {string} body
 * @param {string} key
 * @return {object}
 */
function textbeltPayload(to, body, key) {
    return {phone: to, message: body, key};
}

/**
 * Hard lock: document id, exact name, and the known phone.
 * @param {{id: string, name: string, phone: string}} recipient
 */
function assertJonathanHarrisRecipient(recipient) {
    const row = recipient || {};
    if (row.id !== JONATHAN_HARRIS_PERSON_ID) {
        throw new Error(
            `Refusing to text people/${row.id}; ` +
            `only people/${JONATHAN_HARRIS_PERSON_ID}.`);
    }
    if (!isJonathanHarris(row.name)) {
        throw new Error(
            `Refusing to text ${JSON.stringify(row.name)}; ` +
            `only ${JSON.stringify(JONATHAN_HARRIS_NAME)}.`);
    }
    if (row.phone !== JONATHAN_HARRIS_PHONE_E164) {
        throw new Error(
            `Refusing to text ${row.phone}; only ${JONATHAN_HARRIS_PHONE_E164} ` +
            `(${JONATHAN_HARRIS_NAME}, (580) 504-3816).`);
    }
}

/**
 * @param {string} dateStr YYYY-MM-DD
 * @return {{y: number, m: number, d: number}}
 */
function parseIsoDate(dateStr) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!match) throw new Error(`Bad date ${dateStr}`);
    return {y: Number(match[1]), m: Number(match[2]), d: Number(match[3])};
}

/**
 * @param {string} dateStr
 * @param {number} days
 * @return {string}
 */
function addCalendarDays(dateStr, days) {
    const {y, m, d} = parseIsoDate(dateStr);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * @param {string} dateStr
 * @return {number} 0 = Sunday
 */
function weekdayUtc(dateStr) {
    const {y, m, d} = parseIsoDate(dateStr);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * @param {string} dateStr
 * @return {boolean}
 */
function isSunday(dateStr) {
    return weekdayUtc(dateStr) === 0;
}

/**
 * The next Sunday strictly after todayDate. A Sunday today waits a week.
 * @param {string} todayDate
 * @return {string}
 */
function nextSundayAfter(todayDate) {
    const day = weekdayUtc(todayDate);
    const add = day === 0 ? 7 : (7 - day);
    return addCalendarDays(todayDate, add);
}

/**
 * @param {string} url
 * @return {boolean}
 */
function isMintedAnswerUrl(url) {
    const prefix = `${al.SITE_ORIGIN}/a/`;
    if (typeof url !== 'string' || !url.startsWith(prefix)) return false;
    const token = url.slice(prefix.length);
    if (!token || token.includes('/')) return false;
    return al.looksLikeAnswerToken(token);
}

/**
 * @param {?{token?: string, url?: string}} minted
 * @return {string} url
 */
function assertMintedLink(minted) {
    const token = minted && minted.token;
    const url = minted && minted.url;
    if (!al.looksLikeAnswerToken(token) || url !== al.buildAnswerUrl(token)) {
        throw new Error('mintAnswerLink did not return a real Answer URL.');
    }
    if (!isMintedAnswerUrl(url)) {
        throw new Error(
            'Answer URL is not a minted https link on the church origin.');
    }
    return url;
}

/**
 * @param {string} body
 * @param {string} url
 */
function assertBodyCarriesAnswerUrl(body, url) {
    const text = String(body || '');
    if (!text.includes('https://') || !text.includes(url)) {
        throw new Error('SMS body does not contain the minted Answer URL.');
    }
}

/**
 * Mint args shared with dispatchPrayerAsk. thing is the service date.
 * @param {string} personId
 * @param {string} serviceDate
 * @param {Date} now
 * @return {{purpose: string, personId: string, thing: string, now: Date}}
 */
function answerLinkMintArgs(personId, serviceDate, now) {
    return {
        purpose: 'prayer_request',
        personId,
        thing: serviceDate,
        now,
    };
}

/**
 * Initial pastoral-prayer SMS the live send would build with the link on.
 * A prayer's own message wins, the same way tellPerson applies request.message.
 * @param {Object} args
 * @param {?Object} args.config app_config/prayer_request_sms
 * @param {?string} args.customMessage liturgy-order prose
 * @param {string} args.firstName
 * @param {string} args.answerUrl
 * @return {string}
 */
function initialPastoralSmsBody(args) {
    const includeLink = true;
    const prepared = pr.preparePrayerSmsTextTemplates(
        pr.resolveTemplates(args && args.config), includeLink);
    const fallback = pr.preparePrayerSmsTextTemplates(
        pr.DEFAULT_PRAYER_MESSAGES, includeLink);
    const custom = pr.messageWithLink(
        args && args.customMessage ? args.customMessage : '', includeLink);
    return nc.renderText({
        template: custom || prepared.initial,
        fallback: fallback.initial,
        firstName: args && args.firstName,
        link: args && args.answerUrl,
    });
}

/**
 * Prefer the next Sunday when this person is a pastoral-prayer subject.
 * Otherwise the next such Sunday inside the Answer-link lifetime.
 * @param {Object} args
 * @param {string} args.todayDate
 * @param {string} args.personId
 * @param {Array<{date: string, subjectIds: string[], message?: string}>} args.sundays
 * @return {{serviceDate: string, message: string, reason: string, subjectIds: string[]}}
 */
function chooseAnswerLinkServiceDate(args) {
    const todayDate = args && args.todayDate;
    const personId = args && args.personId;
    const horizon = addCalendarDays(todayDate, ANSWER_LINK_HORIZON_DAYS);
    const preferred = nextSundayAfter(todayDate);
    const rows = (args && args.sundays || []).filter((row) =>
        row && isSunday(row.date) && row.date > todayDate && row.date <= horizon);
    const byDate = new Map(rows.map((row) => [row.date, row]));
    const isSubject = (row) => !!(row && Array.isArray(row.subjectIds) &&
        row.subjectIds.includes(personId));

    const preferredRow = byDate.get(preferred);
    if (isSubject(preferredRow)) {
        return {
            serviceDate: preferred,
            message: preferredRow.message || '',
            reason: `next Sunday after ${todayDate}; ${personId} is a pastoral-prayer subject`,
            subjectIds: preferredRow.subjectIds.slice(),
        };
    }

    const why = !preferredRow ?
        `services/${preferred} is missing or is not a Sunday in range` :
        `${personId} is not a pastoral-prayer subject on ${preferred}`;
    const later = rows
        .filter((row) => row.date > preferred && isSubject(row))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!later.length) {
        throw new Error(
            `No Sunday after ${todayDate} through ${horizon} where ` +
            `people/${personId} is a pastoral-prayer subject. ` +
            `Preferred ${preferred}: ${why}. ` +
            'The Answer form saves only when that person is named on the Sunday.');
    }
    const picked = later[0];
    return {
        serviceDate: picked.date,
        message: picked.message || '',
        reason: `${why}; using ${picked.date} where that person is a ` +
            `pastoral-prayer subject (within ${ANSWER_LINK_HORIZON_DAYS} days, ` +
            'the Answer link lifetime)',
        subjectIds: picked.subjectIds.slice(),
    };
}

/**
 * @param {string} date
 * @param {Object} service
 * @param {Object} catalog
 * @param {string} personId
 * @return {{date: string, subjectIds: string[], message: string}}
 */
function sundaySubjectRow(date, service, catalog, personId) {
    const plan = preview.prayerPlanForService(service, catalog);
    const mine = plan.subjects.find((subject) => subject.id === personId);
    return {
        date,
        subjectIds: plan.subjects.map((subject) => subject.id),
        message: mine && mine.message ? mine.message : '',
    };
}

/**
 * A stored request text blocks a fresh form fill (elder text, or an
 * existing reply/form answer the door will not replace cleanly).
 * @param {?Object} req
 * @return {?string} source label, or null when a submit can land
 */
function existingRequestBlocksSubmit(req) {
    if (!req || typeof req !== 'object') return null;
    const text = String(req.prayerRequest || '').trim();
    if (!text) return null;
    const source = req.prayerRequestSource;
    if (typeof source === 'string' && source.trim()) return source.trim();
    return 'filled';
}

/**
 * @param {Object} args
 * @return {{ok: boolean, reason: string}}
 */
function withUrlCommitDecision(args) {
    const personId = args && args.personId;
    const serviceDate = args && args.serviceDate;
    if (args && args.includeAnswerLinkInSms !== true) {
        return {
            ok: false,
            reason: 'includeAnswerLinkInSms is not true. ' +
                'Run set-prayer-sms-answer-link.js with commit=true first.',
        };
    }
    if (args && args.existingSource) {
        return {
            ok: false,
            reason: `people/${personId}/prayer_requests/${serviceDate} already ` +
                `has a ${args.existingSource} request. A form submit would not ` +
                'land as a new fill.',
        };
    }
    return {ok: true, reason: ''};
}

/**
 * @param {Object} args
 * @return {Object}
 */
function planJonathanAnswerLinkSms(args) {
    const person = args && args.person;
    assertJonathanHarrisRecipient(person);
    const choice = chooseAnswerLinkServiceDate({
        todayDate: args.todayDate,
        personId: person.id,
        sundays: args.sundays,
    });
    const open = pr.mayAnswerPrayerRequest({
        personId: person.id,
        serviceDate: choice.serviceDate,
        todayDate: args.todayDate,
        subjectIds: choice.subjectIds,
        viaAnswerLink: true,
    });
    if (!open) {
        throw new Error(
            `Answer form would be closed for people/${person.id} ` +
            `on ${choice.serviceDate}.`);
    }
    const existingSource = existingRequestBlocksSubmit(args.existingRequest);
    const includeAnswerLinkInSms = pr.prayerSmsIncludeAnswerLink(args.config);
    const body = initialPastoralSmsBody({
        config: args.config,
        customMessage: choice.message,
        firstName: pr.firstNameOf(person.name),
        answerUrl: args.answerUrl,
    });
    return {
        personId: person.id,
        to: person.phone,
        serviceDate: choice.serviceDate,
        serviceDateReason: choice.reason,
        subjectIds: choice.subjectIds,
        body,
        answerUrl: args.answerUrl,
        includeAnswerLinkInSms,
        includeReplyWebhookInSms: pr.prayerSmsIncludeReplyWebhook(args.config),
        existingPrayerRequest: existingSource,
        commitDecision: withUrlCommitDecision({
            includeAnswerLinkInSms,
            existingSource,
            personId: person.id,
            serviceDate: choice.serviceDate,
        }),
    };
}

/**
 * @param {Object} plan
 * @param {string} mode
 * @param {boolean} minted
 * @return {string}
 */
function formatWithUrlPlan(plan, mode, minted) {
    const lines = [
        `${mode} — people/${plan.personId} (${JONATHAN_HARRIS_NAME})`,
        `to: ${plan.to}`,
        `serviceDate: ${plan.serviceDate}`,
        `serviceDateReason: ${plan.serviceDateReason}`,
        `includeAnswerLinkInSms: ${plan.includeAnswerLinkInSms}`,
        `includeReplyWebhookInSms: ${plan.includeReplyWebhookInSms} ` +
            '(unchanged; omitted from this send)',
        `existingPrayerRequest: ${plan.existingPrayerRequest || '(none)'}`,
        minted ? `answerUrl: ${plan.answerUrl}` : 'answerUrl: (not minted)',
        minted ?
            `tokenPath: /a/${String(plan.answerUrl).split('/a/')[1]}` :
            'tokenPath: (minted on --commit)',
        'body:',
        plan.body,
        'replyWebhookUrl: (omitted)',
    ];
    if (!plan.commitDecision.ok) {
        lines.push(`commit: refused — ${plan.commitDecision.reason}`);
    }
    return lines.join('\n');
}

/**
 * @param {Object} db
 * @return {Promise<{id: string, data: Object, to: string}>}
 */
async function resolveJonathanPerson(db) {
    const byId = await db.collection('people').doc(JONATHAN_HARRIS_PERSON_ID).get();
    if (!byId.exists) {
        throw new Error(`people/${JONATHAN_HARRIS_PERSON_ID} does not exist.`);
    }
    const data = byId.data() || {};
    const snap = await db.collection('people')
        .where('name', '==', JONATHAN_HARRIS_NAME)
        .limit(2)
        .get();
    if (snap.size !== 1 || snap.docs[0].id !== JONATHAN_HARRIS_PERSON_ID) {
        throw new Error(
            `Expected the only people doc named ${JSON.stringify(JONATHAN_HARRIS_NAME)} ` +
            `to be people/${JONATHAN_HARRIS_PERSON_ID}; found ${snap.size}.`);
    }
    const to = phoneFromPerson(data);
    assertJonathanHarrisRecipient({id: byId.id, name: data.name, phone: to});
    return {id: byId.id, data, to};
}

/**
 * @param {function(string, string): Promise<Array<{id: string, data: Object}>>} listServiceDocs
 * @param {function(): Promise<Object>} loadCatalog
 * @param {string} todayDate
 * @param {string} personId
 * @return {Promise<Array>}
 */
async function loadSundayRows(listServiceDocs, loadCatalog, todayDate, personId) {
    const horizon = addCalendarDays(todayDate, ANSWER_LINK_HORIZON_DAYS);
    const catalog = await loadCatalog();
    const docs = await listServiceDocs(todayDate, horizon);
    const rows = [];
    for (const doc of docs) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.id) || !isSunday(doc.id)) continue;
        if (doc.id <= todayDate || doc.id > horizon) continue;
        rows.push(sundaySubjectRow(doc.id, doc.data || {}, catalog, personId));
    }
    return rows;
}

/**
 * @param {Object} args injected IO. commit mints and sends; dry-run does neither.
 * @return {Promise<Object>}
 */
async function executeTextbeltTestSend(args) {
    const commit = !!(args && args.commit);
    const withUrl = !!(args && args.withUrl);
    const db = args.db;
    const log = args.log || console.log;
    const now = args.now ? args.now() : new Date();
    const {id, data, to} = await resolveJonathanPerson(db);

    if (!withUrl) {
        const body = DEFAULT_MESSAGE;
        log(`${commit ? 'SEND' : 'DRY RUN'} — people/${id} (${JONATHAN_HARRIS_NAME})`);
        log(`to: ${to}`);
        log(`body: ${body}`);
        log('replyWebhookUrl: (omitted)');
        if (!commit) return {sent: false, body};
        const key = await loadTextbeltKey(args.resolveKey, log);
        const payload = textbeltPayload(to, body, key);
        return finishSend(args.postText, payload, log, {body});
    }

    const todayDate = pr.churchDateParts(now).date;
    const cfgSnap = await db.doc(PRAYER_SMS_CONFIG_PATH).get();
    const config = cfgSnap.exists ? (cfgSnap.data() || {}) : {};
    const sundays = await loadSundayRows(
        args.listServiceDocs, args.loadCatalog, todayDate, id);
    const draftChoice = chooseAnswerLinkServiceDate({
        todayDate, personId: id, sundays,
    });
    const reqSnap = await db.collection('people').doc(id)
        .collection('prayer_requests').doc(draftChoice.serviceDate).get();
    const existingRequest = reqSnap.exists ? (reqSnap.data() || {}) : null;
    const person = {id, name: data.name, phone: to};

    if (!commit) {
        const plan = planJonathanAnswerLinkSms({
            todayDate,
            person,
            sundays,
            config,
            answerUrl: DRY_RUN_ANSWER_URL,
            existingRequest,
        });
        log(formatWithUrlPlan(plan, 'DRY RUN', false));
        return {
            sent: false,
            minted: false,
            serviceDate: plan.serviceDate,
            body: plan.body,
            answerUrl: null,
            commitDecision: plan.commitDecision,
        };
    }

    const gate = planJonathanAnswerLinkSms({
        todayDate,
        person,
        sundays,
        config,
        answerUrl: DRY_RUN_ANSWER_URL,
        existingRequest,
    });
    if (!gate.commitDecision.ok) {
        log(formatWithUrlPlan(gate, 'REFUSED', false));
        throw new Error(gate.commitDecision.reason);
    }

    const key = await loadTextbeltKey(args.resolveKey, log);
    const minted = await args.mintAnswerLink(
        answerLinkMintArgs(id, gate.serviceDate, now));
    const answerUrl = assertMintedLink(minted);
    const plan = planJonathanAnswerLinkSms({
        todayDate,
        person,
        sundays,
        config,
        answerUrl,
        existingRequest,
    });
    assertBodyCarriesAnswerUrl(plan.body, answerUrl);
    log(formatWithUrlPlan(plan, 'SEND', true));
    const payload = textbeltPayload(to, plan.body, key);
    if (Object.prototype.hasOwnProperty.call(payload, 'replyWebhookUrl')) {
        throw new Error('replyWebhookUrl must stay omitted.');
    }
    const sent = await finishSend(args.postText, payload, log, {
        body: plan.body,
        serviceDate: plan.serviceDate,
        answerUrl,
        tokenPath: `/a/${minted.token}`,
    });
    return Object.assign({minted: true}, sent);
}

/**
 * @param {function(): Promise<{key: string, source: string}>} resolveKey
 * @param {function(string): void} log
 * @return {Promise<string>}
 */
async function loadTextbeltKey(resolveKey, log) {
    let resolved;
    try {
        resolved = await resolveKey();
    } catch (err) {
        const detail = err && err.message ? err.message : String(err);
        throw new Error(
            'Could not load TEXTBELT_KEY from env or Secret Manager. ' + detail,
            {cause: err});
    }
    log(`textbelt key source: ${resolved.source}`);
    return resolved.key;
}

/**
 * @param {function(Object): Promise<Object>} postText
 * @param {Object} payload
 * @param {function(string): void} log
 * @param {Object} extra
 * @return {Promise<Object>}
 */
async function finishSend(postText, payload, log, extra) {
    const json = await postText(payload);
    log('Textbelt response:');
    log(JSON.stringify(json, null, 2));
    const shaped = interpretSend(json);
    if (!shaped.success) {
        throw new Error(shaped.error || 'Textbelt send failed.');
    }
    return Object.assign({
        sent: true,
        textId: shaped.textId || null,
    }, extra);
}

module.exports = {
    JONATHAN_HARRIS_NAME,
    JONATHAN_HARRIS_PERSON_ID,
    JONATHAN_HARRIS_PHONE_E164,
    DEFAULT_MESSAGE,
    ANSWER_LINK_HORIZON_DAYS,
    DRY_RUN_ANSWER_URL,
    phoneFromPerson,
    isJonathanHarris,
    textbeltPayload,
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
};
