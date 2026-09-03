// Where somebody goes after signing in, when the page they came from asked to
// have them back (MS-371).
//
// A form link is the one address in this app that a stranger follows from a
// text message. If it is members-only they are sent to sign in, and the whole
// point is that they arrive back at the form rather than on the church's home
// page wondering what happened to the thing they were asked to fill in.
//
// ⚠ `?next=` IS A VALUE ANYBODY CAN PUT IN A LINK. That is what makes this a
// security decision rather than a convenience: a link to our own sign-in page
// carrying `?next=https://not-the-church.example/sign-in` would take a member
// who has just typed their password and hand them straight to a copy of the
// page they think they are already on. The people most likely to follow a link
// they were sent are exactly the people that works on.
//
// So the rule is one line and deliberately dull: a return address is a PATH ON
// THIS SITE, or it is nothing. Anything else falls back to wherever that
// account normally lands.

(function (global) {
    'use strict';

    /**
     * The path to return to after signing in, or '' if there isn't a safe one.
     *
     * @param {?string} raw The `next` value out of the query string.
     * @return {string} A path beginning with a single '/', or ''.
     */
    function safeReturn(raw) {
        // ⚠ STRIP THE INVISIBLES FIRST. Browsers throw away tabs, newlines and
        // spaces before following a URL, so "/<tab>/elsewhere.example" is a
        // protocol-relative address wearing a disguise: it fails the checks
        // below as written, and passes them as the browser reads it. Done by
        // code point rather than a character class so there is no escaping to
        // get subtly wrong in a file that decides where passwords get typed.
        const src = String(raw == null ? '' : raw);
        let want = '';
        for (let i = 0; i < src.length; i++) {
            const code = src.charCodeAt(i);
            if (code > 32 && code !== 127) want += src.charAt(i);
        }
        if (!want) return '';

        // One leading slash means a path on this site. It is also what rules
        // out every scheme — "https://..." and "javascript:..." alike —
        // because neither of them starts with one.
        if (want.charAt(0) !== '/') return '';

        // "//host" is protocol-relative and leaves the site, and so does
        // "/\host" in the browsers that read a backslash as a slash.
        // 47 is a slash and 92 is a backslash. Written as numbers because a
        // lone backslash in a string literal is exactly the character most
        // likely to be eaten on its way into this file.
        const second = want.charCodeAt(1);
        if (second === 47 || second === 92) return '';

        return want;
    }

    const SignInReturn = {
        safeReturn,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SignInReturn;
    }
    if (global) {
        global.SignInReturn = SignInReturn;
    }
})(typeof window !== 'undefined' ? window : null);
