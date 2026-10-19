// Pure read-path outcomes for the public Answer page (ADR-0067). Maps
// answerLink refusals and callable errors to a screen state. No Firebase.

(function (root) {
    'use strict';

    /** Door codes that mean the token is not usable — same screen for each. */
    var INVALID_LINK_CODES = {
        'not-found': true,
        'failed-precondition': true,
    };

    /** Callable throw codes that mean the same as INVALID_LINK_CODES. */
    var INVALID_CALLABLE_CODES = {
        'functions/not-found': true,
        'functions/failed-precondition': true,
    };

    var BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    /**
     * Same shape gate as the door (forms-core / answer-link.js).
     * @param {*} token
     * @return {boolean}
     */
    function looksLikeAnswerToken(token) {
        var s = String(token == null ? '' : token);
        if (s.length < 16 || s.length > 24) return false;
        for (var i = 0; i < s.length; i++) {
            if (BASE58.indexOf(s[i]) === -1) return false;
        }
        return true;
    }

    /**
     * @param {?Object} data answerLink payload
     * @return {?string} state name, or null when data is not a refusal
     */
    function readRefusalState(data, defaultClosed) {
        if (!data || data.ok) return null;
        if (data.code === 'rate-limited') return 'limited';
        if (INVALID_LINK_CODES[data.code]) return 'invalid';
        if (data.code === 'closed') return 'closed';
        return defaultClosed ? 'closed' : null;
    }

    /**
     * @param {*} err httpsCallable rejection
     * @return {?string} 'invalid' when the failure is a bad link, else null
     */
    function readCallableErrorState(err) {
        var code = err && err.code;
        if (code && INVALID_CALLABLE_CODES[code]) return 'invalid';
        var details = err && err.details;
        if (details && typeof details === 'object' && INVALID_LINK_CODES[details.code]) {
            return 'invalid';
        }
        return null;
    }

    var api = {
        INVALID_LINK_CODES: INVALID_LINK_CODES,
        looksLikeAnswerToken: looksLikeAnswerToken,
        readRefusalState: readRefusalState,
        readCallableErrorState: readCallableErrorState,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.AnswerLinkPageCore = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this));
