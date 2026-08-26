/**
 * What we say when somebody is trying to get into, or change, their own account.
 *
 * MS-241. Until this existed, the only way back into a locked-out account was an
 * admin reading the member's password off the Password Visibility panel — which
 * is why the password was being stored in plain text at all. Removing the stored
 * copy without building this would have left people with no route back in.
 *
 * The Firebase calls themselves are one line each and live on the pages. What
 * lives here is the part with a decision in it: which sentence a given outcome
 * earns. One of those sentences is a security property rather than a nicety —
 * see resetOutcome.
 */
(function (global) {
    'use strict';

    // An address is worth sending to if it could plausibly be one. Deliberately
    // the same shallow check the login form has always applied: a stricter
    // pattern rejects real addresses, and Firebase is the actual authority.
    function validateEmail(email) {
        if (typeof email !== 'string') return false;
        return email.includes('@') && email.includes('.');
    }

    // The one answer we give whether or not the address belongs to anybody.
    const RESET_SENT = 'If that address has an account, a reset link is on its way. Check your email.';

    /**
     * What to tell somebody who asked for a password-reset link.
     *
     * ⚠ A REGISTERED AND AN UNREGISTERED ADDRESS MUST ANSWER IDENTICALLY.
     *
     * The login page is open to the whole internet. A distinct "no account with
     * that address" turns it into an oracle: type addresses at it, and you learn
     * which ones belong to this congregation. For a church that is a list of who
     * attends, handed to anybody who asks.
     *
     * So `auth/user-not-found` returns the success answer, deliberately, and
     * account-recovery-core.test.js pins the two together. If a future change
     * wants to be more helpful to somebody who mistyped, the honest place is the
     * email itself — not the page.
     *
     * Malformed input and rate limiting are different, and may be reported: they
     * describe what the REQUEST did, and reveal nothing about who has an account.
     */
    function resetOutcome(errorCode) {
        if (!errorCode) return { ok: true, message: RESET_SENT };

        switch (errorCode) {
            case 'auth/user-not-found':
                return { ok: true, message: RESET_SENT };
            case 'auth/invalid-email':
                return { ok: false, message: 'That does not look like an email address.' };
            case 'auth/too-many-requests':
                return { ok: false, message: 'Too many attempts just now. Please wait a few minutes and try again.' };
            case 'auth/network-request-failed':
                return { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
            default:
                return { ok: false, message: 'Could not send a reset link just now. Please try again.' };
        }
    }

    /**
     * What to tell somebody who changed their own password.
     *
     * The current password is now proved to Firebase Auth by re-authentication,
     * not by comparing against a stored copy — so these codes come from Firebase
     * rather than from a string comparison we ran ourselves.
     *
     * Firebase reports a wrong password two ways depending on whether email
     * enumeration protection is on, so both fold to one answer. There is no
     * enumeration concern here: you are already signed in as yourself.
     */
    function passwordChangeOutcome(errorCode) {
        if (!errorCode) return { ok: true, message: 'Password updated.' };

        switch (errorCode) {
            case 'auth/wrong-password':
            case 'auth/invalid-credential':
                return { ok: false, message: 'That current password is not correct.' };
            case 'auth/weak-password':
                return { ok: false, message: 'That new password is too short. Use at least 6 characters.' };
            case 'auth/requires-recent-login':
                return { ok: false, message: 'For your security, please sign in again before changing your password.' };
            case 'auth/too-many-requests':
                return { ok: false, message: 'Too many attempts just now. Please wait a few minutes and try again.' };
            case 'auth/network-request-failed':
                return { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
            default:
                return { ok: false, message: 'Could not update your password just now. Please try again.' };
        }
    }

    const AccountRecoveryCore = {
        RESET_SENT,
        validateEmail,
        resetOutcome,
        passwordChangeOutcome,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AccountRecoveryCore;
    }
    if (global) {
        global.AccountRecoveryCore = AccountRecoveryCore;
    }
})(typeof window !== 'undefined' ? window : null);
