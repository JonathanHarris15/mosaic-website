/**
 * When to ask for notification permission, and when to stop asking.
 *
 * The explainer is the only door to the operating-system prompt. It appears
 * after a person is signed in and linked to a Person — never on first launch,
 * never while signed out. Dismissing it waits 14 days, and three dismissals
 * end it. A denied permission is a settings row, not another explainer.
 *
 * The 14-day gap and the count of three are a judgment (MS-258): often enough
 * that a changed mind is still offered, rare enough that the home screen
 * stays a home screen.
 */
(function (global) {
    'use strict';

    var MAX_DISMISSALS = 3;
    var DISMISS_GAP_MS = 14 * 24 * 60 * 60 * 1000;
    var DISMISSALS_KEY = 'mosaicPushExplainerDismissals';
    var DISMISSED_AT_KEY = 'mosaicPushExplainerDismissedAt';

    function readDismissals(storage) {
        var count = parseInt(storage.getItem(DISMISSALS_KEY) || '0', 10);
        var at = parseInt(storage.getItem(DISMISSED_AT_KEY) || '0', 10);
        return {
            dismissals: isFinite(count) && count > 0 ? count : 0,
            lastDismissedAt: isFinite(at) && at > 0 ? at : 0,
        };
    }

    function recordDismissal(storage, now) {
        var current = readDismissals(storage);
        var next = current.dismissals + 1;
        storage.setItem(DISMISSALS_KEY, String(next));
        storage.setItem(DISMISSED_AT_KEY, String(now));
        return {dismissals: next, lastDismissedAt: now};
    }

    /**
     * @param {Object} state signedIn, linked, permission, dismissals,
     *   lastDismissedAt, now
     * @return {boolean}
     */
    function shouldShowExplainer(state) {
        if (!state || !state.signedIn || !state.linked) return false;
        var permission = state.permission || 'prompt';
        if (permission === 'granted' || permission === 'denied') return false;
        var dismissals = state.dismissals || 0;
        if (dismissals >= MAX_DISMISSALS) return false;
        if (dismissals > 0 && state.lastDismissedAt && state.now != null) {
            if ((state.now - state.lastDismissedAt) < DISMISS_GAP_MS) return false;
        }
        return true;
    }

    function shouldOfferSettings(permission) {
        return permission === 'denied';
    }

    var api = {
        MAX_DISMISSALS: MAX_DISMISSALS,
        DISMISS_GAP_MS: DISMISS_GAP_MS,
        readDismissals: readDismissals,
        recordDismissal: recordDismissal,
        shouldShowExplainer: shouldShowExplainer,
        shouldOfferSettings: shouldOfferSettings,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) global.MosaicNotificationPermission = api;
})(typeof window !== 'undefined' ? window : null);
