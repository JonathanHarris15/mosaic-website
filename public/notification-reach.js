/**
 * Whether an editor should be told that a Person cannot be reached.
 *
 * Derived on read. Never stored on the Person. A phone number is enough
 * (the send path treats any digits as a phone). A linked User with a live
 * device token is enough. Neither means the sentence. The caller passes the
 * set of user ids that have a token — never the token itself.
 */
(function (global) {
    'use strict';

    var SENTENCE = 'Cannot be reached: no phone and no app. Ask in person.';

    function phoneOf(person) {
        if (!person) return '';
        if (typeof person.phone === 'string' && person.phone) return person.phone;
        var contact = person.contact;
        if (contact && typeof contact.phone === 'string') return contact.phone;
        return '';
    }

    function hasPhone(person) {
        return /\d/.test(phoneOf(person));
    }

    function hasToken(userId, tokenUids) {
        if (!userId || tokenUids == null) return false;
        if (typeof tokenUids.has === 'function') return tokenUids.has(userId);
        if (Array.isArray(tokenUids)) return tokenUids.indexOf(userId) !== -1;
        return false;
    }

    /**
     * @param {Object} person
     * @param {Array<string>|Set<string>} tokenUids user ids with a live token
     * @return {boolean}
     */
    function isUnreachable(person, tokenUids) {
        if (!person || hasPhone(person)) return false;
        if (hasToken(person.userId, tokenUids)) return false;
        return true;
    }

    /**
     * Hide the sentence until the token list has loaded, and hide it the
     * moment a phone number is on the record.
     * @param {Object} person
     * @param {?Array<string>} tokenUids null while the read is in flight
     * @return {boolean}
     */
    function showUnreachable(person, tokenUids) {
        if (hasPhone(person)) return false;
        if (tokenUids == null) return false;
        return isUnreachable(person, tokenUids);
    }

    var api = {
        SENTENCE: SENTENCE,
        hasPhone: hasPhone,
        isUnreachable: isUnreachable,
        showUnreachable: showUnreachable,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) global.NotificationReach = api;
})(typeof window !== 'undefined' ? window : null);
