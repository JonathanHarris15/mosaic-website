/**
 * @fileoverview Helpers for the Jonathan Harris Textbelt smoke (prod ops).
 *
 * --with-url uses the same Answer-link mint args as dispatchPrayerAsk and the
 * same initial-SMS wording as the send path. Dry-run does not mint or send.
 *
 * When no Sunday in the Answer-link window names him, the smoke uses
 * services/2099-06-08. That date is not a congregational Sunday. Commit
 * creates it only when the document is absent, naming only him on the
 * requesting Pastoral Prayer. It does not edit a live Sunday's subjects.
 */

const pr = require('../functions/prayer-request');
const nc = require('../functions/notification-core');
const al = require('../functions/answer-link');
const LiturgyOrders = require('../functions/shared/liturgy-order-core');
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

/** Body for the Jonathan-only send that attaches replyWebhookUrl. */
const WEBHOOK_SMOKE_MESSAGE =
    'Mosaic Church Textbelt smoke test (reply webhook on).';

/**
 * Church smsInbound. --with-reply-webhook refuses any other URL so a
 * ghost project cannot be handed this church's replies, or the reverse.
 */
const CHURCH_SMS_REPLY_WEBHOOK_URL =
    'https://us-central1-mosaic-hymn-database.cloudfunctions.net/smsInbound';

/**
 * Answer links die 21 days after minting (answer-link.js). A congregational
 * Sunday past that horizon is not used. The ops date below is later than the
 * cap on purpose: the token still dies 21 days after mint, and the hourly
 * prayer sender skips a service that far out.
 */
const ANSWER_LINK_HORIZON_DAYS = al.MAX_LINK_AGE_MS / (24 * 60 * 60 * 1000);

/**
 * Monday 2099-06-08. Not a Sunday, and absent from prod as of 2026-10-26.
 * services/2099-06-01 already exists and is left alone.
 */
const OPS_ANSWER_LINK_SERVICE_DATE = '2099-06-08';

/** Marker so a later run can reuse this doc and will not edit any other. */
const OPS_SMOKE_MARKER = 'jonathan-harris-answer-link';

const PASTORAL_PRAYER_ELEMENT_NAME = 'Pastoral Prayer';

/**
 * mayAnswerPrayerRequest, Answer-link path. The door loads subjectIds from
 * services/{serviceDate}. viaAnswerLink does not also require the notice window.
 */
const MAY_ANSWER_RULE =
    'mayAnswerPrayerRequest accepts an Answer link when the person is in ' +
    'subjectIds (named on a requesting prayer) and church-local today is not ' +
    'after the service date. The signed-in notice window does not apply.';

/** Shown in a dry-run body. Not a token; commit mints a real one. */
const DRY_RUN_ANSWER_URL = `${al.SITE_ORIGIN}/a/<token>`;

/**
 * @typedef {Object} PersonContact
 * @property {string} [phone]
 */

/**
 * @typedef {Object} PersonDoc
 * @property {string} [name]
 * @property {PersonContact} [contact]
 */

/**
 * @typedef {Object} Recipient
 * @property {string} id
 * @property {string} name
 * @property {string} phone
 */

/**
 * @typedef {Object} TextbeltPayload
 * @property {string} phone
 * @property {string} message
 * @property {string} key
 * @property {string} [replyWebhookUrl]
 */

/**
 * @typedef {Object} SundayRow
 * @property {string} date
 * @property {string[]} subjectIds
 * @property {string} [message]
 */

/**
 * @typedef {Object} ServiceDateChoice
 * @property {string} serviceDate
 * @property {string} message
 * @property {string} reason
 * @property {string[]} subjectIds
 * @property {boolean} opsSmoke
 */

/**
 * @typedef {Object} PrayerRequestDoc
 * @property {string} [prayerRequest]
 * @property {string} [prayerRequestSource]
 * @property {string} [initialSentDate]
 */

/**
 * @typedef {Object} SmsConfig
 * @property {boolean} [includeAnswerLinkInSms]
 * @property {boolean} [includeReplyWebhookInSms]
 * @property {string} [initial]
 * @property {string} [reminder]
 */

/**
 * @typedef {Object} CommitDecision
 * @property {boolean} ok
 * @property {string} reason
 */

/**
 * @typedef {Object} AnswerPlan
 * @property {string} personId
 * @property {string} to
 * @property {string} serviceDate
 * @property {string} serviceDateReason
 * @property {string[]} subjectIds
 * @property {string} body
 * @property {string} answerUrl
 * @property {boolean} includeAnswerLinkInSms
 * @property {boolean} includeReplyWebhookInSms
 * @property {string} [replyWebhookUrl] set on the send, not read from config
 * @property {string|null} existingPrayerRequest
 * @property {CommitDecision} commitDecision
 * @property {boolean} opsSmoke
 * @property {string} mayAnswerRule
 * @property {'absent'|'present'|'n/a'} opsService
 */

/**
 * @typedef {Object} NamedPerson
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {Object} PastoralElement
 * @property {string} id
 * @property {string} name
 * @property {string} kind
 * @property {*} requests
 * @property {string} [message]
 */

/**
 * @typedef {Object} OpsServiceData
 * @property {boolean} isIrregular
 * @property {string} liturgyOrderId
 * @property {string} theme
 * @property {string} prayerSmsSmoke
 * @property {Record<string, NamedPerson[]>} liturgy
 */

/**
 * @typedef {Object} SubjectCheck
 * @property {string[]} subjectIds
 * @property {string} message
 * @property {number} noticeDays
 */

/**
 * @typedef {Object} OpsPrepared
 * @property {OpsServiceData|Record<string, *>} service
 * @property {boolean} created
 * @property {boolean} absent
 * @property {SubjectCheck} check
 */

/**
 * @callback SnapData
 * @return {*}
 */

/**
 * @typedef {Object} DocSnap
 * @property {boolean} exists
 * @property {string} [id]
 * @property {SnapData} data
 */

/**
 * @callback GetDoc
 * @return {Promise<DocSnap>}
 */

/**
 * @callback SetDoc
 * @param {*} data
 * @param {{merge?: boolean}=} opts
 * @return {Promise<void>}
 */

/**
 * @typedef {Object} DocRef
 * @property {GetDoc} get
 * @property {SetDoc} [set]
 * @property {CollectionFn} [collection]
 */

/**
 * @callback DocById
 * @param {string} id
 * @return {DocRef}
 */

/**
 * @typedef {Object} QuerySnap
 * @property {number} size
 * @property {Array<{id: string, data: SnapData}>} docs
 */

/**
 * @callback GetQuery
 * @return {Promise<QuerySnap>}
 */

/**
 * @typedef {Object} LimitedQuery
 * @property {GetQuery} get
 */

/**
 * @callback LimitQuery
 * @param {number} n
 * @return {LimitedQuery}
 */

/**
 * @typedef {Object} WhereQuery
 * @property {LimitQuery} limit
 */

/**
 * @callback WhereFn
 * @param {string} field
 * @param {string} op
 * @param {string} value
 * @return {WhereQuery}
 */

/**
 * @typedef {Object} CollectionRef
 * @property {DocById} doc
 * @property {WhereFn} [where]
 */

/**
 * @callback CollectionFn
 * @param {string} name
 * @return {CollectionRef}
 */

/**
 * @callback RootDoc
 * @param {string} path
 * @return {DocRef}
 */

/**
 * @typedef {Object} FirestoreLike
 * @property {RootDoc} doc
 * @property {CollectionFn} collection
 */

/**
 * @callback LogLine
 * @param {string} line
 * @return {void}
 */

/**
 * @callback ListServiceDocs
 * @param {string} todayDate
 * @param {string} horizon
 * @return {Promise<Array<{id: string, data: *}>>}
 */

/**
 * @callback LoadCatalog
 * @return {Promise<*>}
 */

/**
 * @callback ResolveKey
 * @return {Promise<{key: string, source: string}>}
 */

/**
 * @callback PostText
 * @param {TextbeltPayload} payload
 * @return {Promise<*>}
 */

/**
 * @typedef {Object} MintArgs
 * @property {string} purpose
 * @property {string} personId
 * @property {string} thing
 * @property {Date} now
 */

/**
 * @typedef {Object} MintedLink
 * @property {string} [token]
 * @property {string} [url]
 */

/**
 * @callback MintAnswerLink
 * @param {MintArgs} mintArgs
 * @return {Promise<MintedLink>}
 */

/**
 * @callback NowFn
 * @return {Date}
 */

/**
 * @typedef {Object} ExecuteArgs
 * @property {boolean} [commit]
 * @property {boolean} [withUrl]
 * @property {boolean} [withReplyWebhook]
 * @property {string} [replyWebhookUrl]
 * @property {FirestoreLike} db
 * @property {LogLine} [log]
 * @property {NowFn} [now]
 * @property {ListServiceDocs} [listServiceDocs]
 * @property {LoadCatalog} [loadCatalog]
 * @property {MintAnswerLink} [mintAnswerLink]
 * @property {ResolveKey} [resolveKey]
 * @property {PostText} [postText]
 */

/**
 * @typedef {Object} SendResult
 * @property {boolean} sent
 * @property {string} body
 * @property {boolean} [minted]
 * @property {string|null} [answerUrl]
 * @property {string} [serviceDate]
 * @property {string} [tokenPath]
 * @property {CommitDecision} [commitDecision]
 * @property {string|null} [textId]
 */

/**
 * @typedef {Object} PlanArgs
 * @property {string} todayDate
 * @property {Recipient} person
 * @property {SundayRow[]} [sundays]
 * @property {ServiceDateChoice} [choice]
 * @property {SmsConfig|null} [config]
 * @property {string} answerUrl
 * @property {PrayerRequestDoc|null} [existingRequest]
 * @property {'absent'|'present'|'n/a'} [opsService]
 */

/**
 * @typedef {Object} ResolvedPerson
 * @property {string} id
 * @property {PersonDoc} data
 * @property {string} to
 */

/**
 * @param {PersonDoc|null|undefined} person Firestore people doc data
 * @return {string} E.164 phone
 */
function phoneFromPerson(person) {
    const raw = person && person.contact && person.contact.phone;
    const to = toE164US(typeof raw === 'string' ? raw : '');
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
 * Textbelt payload. replyWebhookUrl is included only when the caller
 * passes the church smsInbound URL (--with-reply-webhook).
 * @param {string} to E.164
 * @param {string} body
 * @param {string} key
 * @param {string} [replyWebhookUrl]
 * @return {TextbeltPayload}
 */
function textbeltPayload(to, body, key, replyWebhookUrl) {
    /** @type {TextbeltPayload} */
    const payload = {phone: to, message: body, key};
    const url = typeof replyWebhookUrl === 'string' ? replyWebhookUrl.trim() : '';
    if (url) payload.replyWebhookUrl = url;
    return payload;
}

/**
 * @param {boolean} withReplyWebhook
 * @param {string|undefined} replyWebhookUrl
 * @return {string} church smsInbound URL, or empty when the flag is off
 */
function resolveSmokeReplyWebhook(withReplyWebhook, replyWebhookUrl) {
    if (!withReplyWebhook) return '';
    const url = typeof replyWebhookUrl === 'string' ? replyWebhookUrl.trim() : '';
    if (url !== CHURCH_SMS_REPLY_WEBHOOK_URL) {
        throw new Error(
            '--with-reply-webhook requires the church smsInbound URL ' +
            `(${CHURCH_SMS_REPLY_WEBHOOK_URL}).`);
    }
    return url;
}

/**
 * Hard lock: document id, exact name, and the known phone.
 * @param {Recipient|null|undefined} recipient
 * @return {void}
 */
function assertJonathanHarrisRecipient(recipient) {
    const row = recipient || /** @type {Recipient} */ ({id: '', name: '', phone: ''});
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
 * @param {MintedLink|null|undefined} minted
 * @return {string} url
 */
function assertMintedLink(minted) {
    const token = minted && minted.token;
    const url = minted && minted.url;
    if (typeof token !== 'string' || typeof url !== 'string') {
        throw new Error('mintAnswerLink did not return a real Answer URL.');
    }
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
 * @return {void}
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
 * @return {MintArgs}
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
 * @param {SmsConfig|null} [args.config] app_config/prayer_request_sms
 * @param {string} [args.customMessage] liturgy-order prose
 * @param {string} [args.firstName]
 * @param {string} [args.answerUrl]
 * @return {string}
 */
function initialPastoralSmsBody(args) {
    const includeLink = true;
    const config = args && args.config ? args.config : null;
    const prepared = /** @type {{initial: string}} */ (
        pr.preparePrayerSmsTextTemplates(
            pr.resolveTemplates(config), includeLink));
    const fallback = /** @type {{initial: string}} */ (
        pr.preparePrayerSmsTextTemplates(
            pr.DEFAULT_PRAYER_MESSAGES, includeLink));
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
 * The one requesting prayer named Pastoral Prayer on the standard order.
 * @param {*} catalog
 * @return {PastoralElement}
 */
function requestingPastoralElement(catalog) {
    const order = LiturgyOrders.orderFor({liturgyOrderId: 'standard'}, catalog);
    const elements = /** @type {PastoralElement[]} */ (order.elements || []);
    const pastoral = elements.filter((el) =>
        el && el.kind === 'prayer' && el.requests &&
        String(el.name || '').trim() === PASTORAL_PRAYER_ELEMENT_NAME);
    if (pastoral.length !== 1 || !pastoral[0] || !pastoral[0].id) {
        throw new Error(
            `The standard order must name exactly one requesting prayer ` +
            `"${PASTORAL_PRAYER_ELEMENT_NAME}". Found ${pastoral.length}.`);
    }
    return pastoral[0];
}

/**
 * A service document that names only this person on Pastoral Prayer.
 * Other liturgy slots stay empty, so nobody else is a subject.
 * @param {NamedPerson} person
 * @param {PastoralElement} element
 * @return {OpsServiceData}
 */
function opsSmokeServiceData(person, element) {
    /** @type {Record<string, NamedPerson[]>} */
    const liturgy = {};
    liturgy[element.id] = [{id: person.id, name: person.name}];
    return {
        isIrregular: true,
        liturgyOrderId: 'standard',
        theme: 'Prayer SMS Answer-link smoke — ops only, not a congregational Sunday',
        prayerSmsSmoke: OPS_SMOKE_MARKER,
        liturgy,
    };
}

/**
 * @param {*} service
 * @param {*} catalog
 * @param {string} personId
 * @return {SubjectCheck|null}
 */
function subjectsIfOnlyPerson(service, catalog, personId) {
    const plan = preview.prayerPlanForService(service, catalog);
    const subjects = /** @type {Array<{id: string, message?: string, noticeDays?: number}>} */ (
        plan.subjects || []);
    const ids = subjects.map((subject) => subject.id);
    if (ids.length !== 1 || ids[0] !== personId) return null;
    const mine = subjects[0];
    const noticeDays = subjects.reduce(
        (max, subject) => Math.max(max, subject.noticeDays || 0), 0);
    return {
        subjectIds: ids,
        message: mine && mine.message ? mine.message : '',
        noticeDays,
    };
}

/**
 * The hourly sender texts subjects only inside their notice window, and only
 * people the service names. The ops date has to sit past both.
 * @param {string} todayDate
 * @param {number} noticeDays
 * @return {void}
 */
function assertOpsDateOutsideNotice(todayDate, noticeDays) {
    const days = pr.daysUntil(OPS_ANSWER_LINK_SERVICE_DATE, todayDate);
    const notice = Number(noticeDays) || 0;
    if (!(days > notice) || !(days > 30)) {
        throw new Error(
            `${OPS_ANSWER_LINK_SERVICE_DATE} is ${days} days out, inside a ` +
            `${notice}-day notice window. Refusing so the prayer scheduler ` +
            'does not text this ops service.');
    }
}

/**
 * @param {FirestoreLike} db
 * @param {string} date
 * @return {Promise<Record<string, *>|null>}
 */
async function readServiceDoc(db, date) {
    const snap = await db.collection('services').doc(date).get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data || typeof data !== 'object') return {};
    return /** @type {Record<string, *>} */ (data);
}

/**
 * Read the ops service, or on commit create it when it is absent.
 * An existing document that is not this smoke is left untouched.
 * @param {Object} args
 * @param {FirestoreLike} args.db
 * @param {*} args.catalog
 * @param {NamedPerson} args.person
 * @param {boolean} args.commit
 * @return {Promise<OpsPrepared>}
 */
async function prepareOpsSmokeService(args) {
    const date = OPS_ANSWER_LINK_SERVICE_DATE;
    const element = requestingPastoralElement(args.catalog);
    const intended = opsSmokeServiceData(args.person, element);
    const existing = await readServiceDoc(args.db, date);
    if (!existing) {
        const check = subjectsIfOnlyPerson(intended, args.catalog, args.person.id);
        if (!check) {
            throw new Error(
                `Ops service for ${date} would not name only people/${args.person.id}.`);
        }
        if (!args.commit) {
            return {service: intended, created: false, absent: true, check};
        }
        const ref = args.db.collection('services').doc(date);
        if (typeof ref.set !== 'function') {
            throw new Error(`services/${date} cannot be written.`);
        }
        await ref.set(intended);
        const written = await readServiceDoc(args.db, date);
        const confirmed = written &&
            subjectsIfOnlyPerson(written, args.catalog, args.person.id);
        if (!confirmed) {
            throw new Error(
                `services/${date} did not store only people/${args.person.id} ` +
                'as a pastoral-prayer subject.');
        }
        return {service: written, created: true, absent: false, check: confirmed};
    }
    if (existing.prayerSmsSmoke !== OPS_SMOKE_MARKER) {
        throw new Error(
            `services/${date} already exists and is not the prayer-SMS smoke. ` +
            'Refusing to edit its pastoral-prayer subjects.');
    }
    const check = subjectsIfOnlyPerson(existing, args.catalog, args.person.id);
    if (!check) {
        throw new Error(
            `services/${date} is a smoke doc but does not name only ` +
            `people/${args.person.id}. Refusing to edit its pastoral-prayer subjects.`);
    }
    return {service: existing, created: false, absent: false, check};
}

/**
 * Prefer the next Sunday when this person is a pastoral-prayer subject.
 * Otherwise the next such Sunday inside the Answer-link lifetime.
 * When none exists, use the ops date. Live rosters are not edited.
 * @param {Object} args
 * @param {string} args.todayDate
 * @param {string} args.personId
 * @param {SundayRow[]} args.sundays
 * @return {ServiceDateChoice}
 */
function chooseAnswerLinkServiceDate(args) {
    const todayDate = args.todayDate;
    const personId = args.personId;
    const horizon = addCalendarDays(todayDate, ANSWER_LINK_HORIZON_DAYS);
    const preferred = nextSundayAfter(todayDate);
    const rows = (args.sundays || []).filter((row) =>
        row && isSunday(row.date) && row.date > todayDate && row.date <= horizon);
    /** @type {Map<string, SundayRow>} */
    const byDate = new Map(rows.map((row) => [row.date, row]));
    /**
     * @param {SundayRow|undefined} row
     * @return {boolean}
     */
    const isSubject = (row) => !!(row && Array.isArray(row.subjectIds) &&
        row.subjectIds.includes(personId));

    const preferredRow = byDate.get(preferred);
    if (preferredRow && isSubject(preferredRow)) {
        return {
            serviceDate: preferred,
            message: preferredRow.message || '',
            reason: `next Sunday after ${todayDate}; ${personId} is a pastoral-prayer subject`,
            subjectIds: preferredRow.subjectIds.slice(),
            opsSmoke: false,
        };
    }

    const why = !preferredRow ?
        `services/${preferred} is missing or is not a Sunday in range` :
        `${personId} is not a pastoral-prayer subject on ${preferred}`;
    const later = rows
        .filter((row) => row.date > preferred && isSubject(row))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!later.length) {
        return {
            serviceDate: OPS_ANSWER_LINK_SERVICE_DATE,
            message: '',
            reason: `No Sunday after ${todayDate} through ${horizon} where ` +
                `people/${personId} is a pastoral-prayer subject. ` +
                `Preferred ${preferred}: ${why}. ` +
                `Using services/${OPS_ANSWER_LINK_SERVICE_DATE}, which is not a ` +
                'congregational Sunday. Live Sunday rosters are not edited.',
            subjectIds: [personId],
            opsSmoke: true,
        };
    }
    const picked = later[0];
    return {
        serviceDate: picked.date,
        message: picked.message || '',
        reason: `${why}; using ${picked.date} where that person is a ` +
            `pastoral-prayer subject (within ${ANSWER_LINK_HORIZON_DAYS} days, ` +
            'the Answer link lifetime)',
        subjectIds: picked.subjectIds.slice(),
        opsSmoke: false,
    };
}

/**
 * @param {string} date
 * @param {*} service
 * @param {*} catalog
 * @param {string} personId
 * @return {SundayRow}
 */
function sundaySubjectRow(date, service, catalog, personId) {
    const plan = preview.prayerPlanForService(service, catalog);
    const subjects = /** @type {Array<{id: string, message?: string}>} */ (
        plan.subjects || []);
    const mine = subjects.find((subject) => subject.id === personId);
    return {
        date,
        subjectIds: subjects.map((subject) => subject.id),
        message: mine && mine.message ? mine.message : '',
    };
}

/**
 * A stored request text blocks a fresh form fill (elder text, or an
 * existing reply/form answer the door will not replace cleanly).
 * @param {PrayerRequestDoc|null|undefined} req
 * @return {string|null} source label, or null when a submit can land
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
 * @param {string} [args.personId]
 * @param {string} [args.serviceDate]
 * @param {boolean} [args.includeAnswerLinkInSms]
 * @param {string|null} [args.existingSource]
 * @return {CommitDecision}
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
 * @param {PlanArgs} args
 * @return {AnswerPlan}
 */
function planJonathanAnswerLinkSms(args) {
    const person = args.person;
    assertJonathanHarrisRecipient(person);
    const choice = args.choice || chooseAnswerLinkServiceDate({
        todayDate: args.todayDate,
        personId: person.id,
        sundays: args.sundays || [],
    });
    const open = pr.mayAnswerPrayerRequest({
        personId: person.id,
        serviceDate: choice.serviceDate,
        todayDate: args.todayDate,
        liturgy: null,
        subjectIds: choice.subjectIds,
        viaAnswerLink: true,
        initialSentDate: null,
    });
    if (!open) {
        throw new Error(
            `Answer form would be closed for people/${person.id} ` +
            `on ${choice.serviceDate}.`);
    }
    const existingSource = existingRequestBlocksSubmit(args.existingRequest);
    const config = args.config || null;
    const includeAnswerLinkInSms = pr.prayerSmsIncludeAnswerLink(config);
    const body = initialPastoralSmsBody({
        config,
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
        includeReplyWebhookInSms: pr.prayerSmsIncludeReplyWebhook(config),
        existingPrayerRequest: existingSource,
        commitDecision: withUrlCommitDecision({
            includeAnswerLinkInSms,
            existingSource,
            personId: person.id,
            serviceDate: choice.serviceDate,
        }),
        opsSmoke: !!choice.opsSmoke,
        mayAnswerRule: MAY_ANSWER_RULE,
        opsService: choice.opsSmoke ? (args.opsService || 'absent') : 'n/a',
    };
}

/**
 * @param {AnswerPlan} plan
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
            '(config unchanged)',
        `existingPrayerRequest: ${plan.existingPrayerRequest || '(none)'}`,
        `mayAnswer: ${plan.mayAnswerRule}`,
        minted ? `answerUrl: ${plan.answerUrl}` : 'answerUrl: (not minted)',
        minted ?
            `tokenPath: /a/${String(plan.answerUrl).split('/a/')[1]}` :
            'tokenPath: (minted on --commit)',
        'body:',
        plan.body,
        plan.replyWebhookUrl ?
            `replyWebhookUrl: ${plan.replyWebhookUrl}` :
            'replyWebhookUrl: (omitted)',
    ];
    if (plan.opsSmoke) {
        lines.push(`opsService: ${plan.opsService}`);
        lines.push(
            'linkExpiry: 21 days after mint. The ops date is later, so the ' +
            'token cap in answer-link.js applies. Open the link before then.');
        lines.push('liveSundayRosters: not edited');
    }
    if (!plan.commitDecision.ok) {
        lines.push(`commit: refused — ${plan.commitDecision.reason}`);
    }
    return lines.join('\n');
}

/**
 * @param {FirestoreLike} db
 * @return {Promise<ResolvedPerson>}
 */
async function resolveJonathanPerson(db) {
    const byId = await db.collection('people').doc(JONATHAN_HARRIS_PERSON_ID).get();
    if (!byId.exists) {
        throw new Error(`people/${JONATHAN_HARRIS_PERSON_ID} does not exist.`);
    }
    const data = /** @type {PersonDoc} */ (byId.data() || {});
    const people = db.collection('people');
    if (typeof people.where !== 'function') {
        throw new Error('people query is unavailable.');
    }
    const snap = await people
        .where('name', '==', JONATHAN_HARRIS_NAME)
        .limit(2)
        .get();
    const first = snap.docs[0];
    if (snap.size !== 1 || !first || first.id !== JONATHAN_HARRIS_PERSON_ID) {
        throw new Error(
            `Expected the only people doc named ${JSON.stringify(JONATHAN_HARRIS_NAME)} ` +
            `to be people/${JONATHAN_HARRIS_PERSON_ID}; found ${snap.size}.`);
    }
    const to = phoneFromPerson(data);
    const name = typeof data.name === 'string' ? data.name : '';
    assertJonathanHarrisRecipient({id: byId.id || JONATHAN_HARRIS_PERSON_ID, name, phone: to});
    return {id: byId.id || JONATHAN_HARRIS_PERSON_ID, data, to};
}

/**
 * @param {ListServiceDocs} listServiceDocs
 * @param {*} catalog
 * @param {string} todayDate
 * @param {string} personId
 * @return {Promise<SundayRow[]>}
 */
async function loadSundayRows(listServiceDocs, catalog, todayDate, personId) {
    const horizon = addCalendarDays(todayDate, ANSWER_LINK_HORIZON_DAYS);
    const docs = await listServiceDocs(todayDate, horizon);
    /** @type {SundayRow[]} */
    const rows = [];
    for (const doc of docs) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.id) || !isSunday(doc.id)) continue;
        if (doc.id <= todayDate || doc.id > horizon) continue;
        rows.push(sundaySubjectRow(doc.id, doc.data || {}, catalog, personId));
    }
    return rows;
}

/**
 * @param {ExecuteArgs} args injected IO. commit mints and sends; dry-run does neither.
 * @return {Promise<SendResult>}
 */
async function executeTextbeltTestSend(args) {
    const commit = !!(args && args.commit);
    const withUrl = !!(args && args.withUrl);
    const webhookUrl = resolveSmokeReplyWebhook(
        !!(args && args.withReplyWebhook),
        args && args.replyWebhookUrl);
    const db = args.db;
    /** @type {LogLine} */
    const log = args.log || function(line) {
        console.log(line);
    };
    const now = args.now ? args.now() : new Date();
    const resolved = await resolveJonathanPerson(db);
    const id = resolved.id;
    const data = resolved.data;
    const to = resolved.to;

    if (!withUrl) {
        const body = webhookUrl ? WEBHOOK_SMOKE_MESSAGE : DEFAULT_MESSAGE;
        log(`${commit ? 'SEND' : 'DRY RUN'} — people/${id} (${JONATHAN_HARRIS_NAME})`);
        log(`to: ${to}`);
        log(`body: ${body}`);
        log(webhookUrl ?
            `replyWebhookUrl: ${webhookUrl}` :
            'replyWebhookUrl: (omitted)');
        if (!commit) return {sent: false, body};
        const key = await loadTextbeltKey(args.resolveKey, log);
        const payload = textbeltPayload(to, body, key, webhookUrl);
        return finishSend(args.postText, payload, log, {body});
    }

    if (typeof args.loadCatalog !== 'function' ||
            typeof args.listServiceDocs !== 'function') {
        throw new Error('--with-url requires loadCatalog and listServiceDocs.');
    }
    const todayDate = pr.churchDateParts(now).date;
    const cfgSnap = await db.doc(PRAYER_SMS_CONFIG_PATH).get();
    const rawConfig = cfgSnap.exists ? cfgSnap.data() : null;
    const config = rawConfig && typeof rawConfig === 'object' ?
        /** @type {SmsConfig} */ (rawConfig) : /** @type {SmsConfig} */ ({});
    const catalog = await args.loadCatalog();
    const sundays = await loadSundayRows(
        args.listServiceDocs, catalog, todayDate, id);
    let choice = chooseAnswerLinkServiceDate({
        todayDate, personId: id, sundays,
    });
    /** @type {'absent'|'present'|'n/a'} */
    let opsService = 'n/a';
    const personName = typeof data.name === 'string' ? data.name : '';
    if (choice.opsSmoke) {
        const prepared = await prepareOpsSmokeService({
            db,
            catalog,
            person: {id, name: personName},
            commit: false,
        });
        assertOpsDateOutsideNotice(todayDate, prepared.check.noticeDays);
        opsService = prepared.absent ? 'absent' : 'present';
        const absentNote = prepared.absent ?
            ` services/${OPS_ANSWER_LINK_SERVICE_DATE} is absent; commit creates it ` +
            'and names only this person. It does not edit a live Sunday.' :
            ` services/${OPS_ANSWER_LINK_SERVICE_DATE} already names only this person.`;
        choice = {
            serviceDate: OPS_ANSWER_LINK_SERVICE_DATE,
            message: prepared.check.message,
            reason: choice.reason + absentNote,
            subjectIds: prepared.check.subjectIds.slice(),
            opsSmoke: true,
        };
    }
    const personRef = db.collection('people').doc(id);
    if (typeof personRef.collection !== 'function') {
        throw new Error('people doc has no prayer_requests.');
    }
    const reqSnap = await personRef.collection('prayer_requests')
        .doc(choice.serviceDate).get();
    const existingRaw = reqSnap.exists ? reqSnap.data() : null;
    const existingRequest = existingRaw && typeof existingRaw === 'object' ?
        /** @type {PrayerRequestDoc} */ (existingRaw) : null;
    /** @type {Recipient} */
    const person = {id, name: personName, phone: to};

    /**
     * @param {string} answerUrl
     * @return {AnswerPlan}
     */
    const buildPlan = (answerUrl) => planJonathanAnswerLinkSms({
        todayDate,
        person,
        sundays,
        choice,
        config,
        answerUrl,
        existingRequest,
        opsService,
    });

    if (!commit) {
        const plan = buildPlan(DRY_RUN_ANSWER_URL);
        plan.replyWebhookUrl = webhookUrl;
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

    const gate = buildPlan(DRY_RUN_ANSWER_URL);
    gate.replyWebhookUrl = webhookUrl;
    if (!gate.commitDecision.ok) {
        log(formatWithUrlPlan(gate, 'REFUSED', false));
        throw new Error(gate.commitDecision.reason);
    }

    if (gate.opsSmoke) {
        const prepared = await prepareOpsSmokeService({
            db,
            catalog,
            person: {id, name: personName},
            commit: true,
        });
        assertOpsDateOutsideNotice(todayDate, prepared.check.noticeDays);
        choice = {
            serviceDate: OPS_ANSWER_LINK_SERVICE_DATE,
            message: prepared.check.message,
            reason: choice.reason,
            subjectIds: prepared.check.subjectIds.slice(),
            opsSmoke: true,
        };
        opsService = 'present';
    }

    const key = await loadTextbeltKey(args.resolveKey, log);
    if (typeof args.mintAnswerLink !== 'function') {
        throw new Error('--with-url commit requires mintAnswerLink.');
    }
    const minted = await args.mintAnswerLink(
        answerLinkMintArgs(id, choice.serviceDate, now));
    const answerUrl = assertMintedLink(minted);
    const plan = buildPlan(answerUrl);
    plan.replyWebhookUrl = webhookUrl;
    assertBodyCarriesAnswerUrl(plan.body, answerUrl);
    log(formatWithUrlPlan(plan, 'SEND', true));
    const payload = textbeltPayload(to, plan.body, key, webhookUrl);
    if (webhookUrl) {
        if (payload.replyWebhookUrl !== webhookUrl) {
            throw new Error('replyWebhookUrl missing from the Textbelt payload.');
        }
    } else if (Object.prototype.hasOwnProperty.call(payload, 'replyWebhookUrl')) {
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
 * @param {ResolveKey|undefined} resolveKey
 * @param {LogLine} log
 * @return {Promise<string>}
 */
async function loadTextbeltKey(resolveKey, log) {
    if (typeof resolveKey !== 'function') {
        throw new Error('Could not load TEXTBELT_KEY from env or Secret Manager.');
    }
    let resolved;
    try {
        resolved = await resolveKey();
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
            'Could not load TEXTBELT_KEY from env or Secret Manager. ' + detail,
            {cause: err});
    }
    log(`textbelt key source: ${resolved.source}`);
    return resolved.key;
}

/**
 * @param {PostText|undefined} postText
 * @param {TextbeltPayload} payload
 * @param {LogLine} log
 * @param {Object} extra
 * @return {Promise<SendResult>}
 */
async function finishSend(postText, payload, log, extra) {
    if (typeof postText !== 'function') {
        throw new Error('Textbelt send requires postText.');
    }
    const json = await postText(payload);
    log('Textbelt response:');
    log(JSON.stringify(json, null, 2));
    const shaped = /** @type {{success: boolean, textId: string|null, error: string|null}} */ (
        interpretSend(json));
    if (!shaped.success) {
        throw new Error(shaped.error || 'Textbelt send failed.');
    }
    return Object.assign({
        sent: true,
        body: payload.message,
        textId: shaped.textId || null,
    }, extra);
}

module.exports = {
    JONATHAN_HARRIS_NAME,
    JONATHAN_HARRIS_PERSON_ID,
    JONATHAN_HARRIS_PHONE_E164,
    DEFAULT_MESSAGE,
    CHURCH_SMS_REPLY_WEBHOOK_URL,
    ANSWER_LINK_HORIZON_DAYS,
    OPS_ANSWER_LINK_SERVICE_DATE,
    OPS_SMOKE_MARKER,
    MAY_ANSWER_RULE,
    DRY_RUN_ANSWER_URL,
    phoneFromPerson,
    isJonathanHarris,
    textbeltPayload,
    resolveSmokeReplyWebhook,
    assertJonathanHarrisRecipient,
    addCalendarDays,
    isSunday,
    nextSundayAfter,
    isMintedAnswerUrl,
    assertMintedLink,
    answerLinkMintArgs,
    initialPastoralSmsBody,
    requestingPastoralElement,
    opsSmokeServiceData,
    chooseAnswerLinkServiceDate,
    sundaySubjectRow,
    planJonathanAnswerLinkSms,
    executeTextbeltTestSend,
};
