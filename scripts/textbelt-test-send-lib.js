/**
 * @fileoverview Pure helpers for textbelt-test-send.js (prod ops).
 */

const {toE164US} = require('../functions/sms');

/** Only this Person may receive the prod Textbelt smoke text. */
const JONATHAN_HARRIS_NAME = 'Jonathan Harris';

const DEFAULT_MESSAGE =
    'Mosaic Church Textbelt smoke test (no reply webhook).';

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
 * Textbelt payload without replyWebhookUrl (unverified keys).
 * @param {string} to E.164
 * @param {string} body
 * @param {string} key
 * @return {object}
 */
function textbeltPayload(to, body, key) {
    return {phone: to, message: body, key};
}

module.exports = {
    JONATHAN_HARRIS_NAME,
    DEFAULT_MESSAGE,
    phoneFromPerson,
    isJonathanHarris,
    textbeltPayload,
};
