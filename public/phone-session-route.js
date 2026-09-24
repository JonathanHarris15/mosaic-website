// Where the phone app should be, given who we know you are.
//
// `undefined` is still loading — Firebase has not said yet. Redirecting on
// that value bounces a signed-in person off their own home while the session
// restores. `null` is signed out. An object is signed in.
//
// Signing in used to go to Home the instant Firebase accepted the password,
// while the profile was still null. The signed-out redirect then sent you
// back to login. Stay on login until the profile arrives; *that* is what
// leaves the screen.

(function (global) {
    'use strict';

    /**
     * @param {undefined|null|object} user
     * @param {string} route Current hash route, e.g. "home" or "login".
     * @param {boolean} guest True if they chose "Continue as guest".
     * @return {string} The route to show.
     */
    function next(user, route, guest) {
        if (user === undefined) return route;
        if (user) return route === 'login' ? 'home' : route;
        if (guest || route === 'login') return route;
        return 'login';
    }

    const PhoneSessionRoute = { next };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PhoneSessionRoute;
    }
    if (global) {
        global.PhoneSessionRoute = PhoneSessionRoute;
    }
})(typeof window !== 'undefined' ? window : null);
