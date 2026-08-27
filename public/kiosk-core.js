// Kiosk Core — the pure model for a Kiosk account, its one allowed page, the
// Event list it shows, and the Attendance writes it makes (MS-318, ADR-0041,
// ADR-0042).
//
// A Kiosk is a permissionLevel, not a rank on the existing ladder. It can mark
// people present and nothing else. The search it offers is over Households
// (see household-core.js), not Families — Family stays the kinship tree.
//
// Loaded as a classic <script> (window.KioskCore) and exported for Node tests.

(function (global) {
    'use strict';

    function isKiosk(permissionLevel) {
        return permissionLevel === 'kiosk';
    }

    function isKioskAccount(data) {
        return isKiosk(data && (data.permissionLevel || data.role));
    }

    function pageName(pathname) {
        const noQuery = String(pathname || '').split('?')[0].split('#')[0];
        const parts = noQuery.split(/[/\\]/);
        return parts[parts.length - 1] || '';
    }

    // Where this account should be sent, or null if it may stay. Login is
    // allowed so a kiosk can sign in; every other existing page refuses it.
    // The inverse — a non-kiosk on the kiosk page — goes home.
    function kioskGateDestination(data, pathname) {
        if (!data) return null;
        const page = pageName(pathname);
        if (isKioskAccount(data)) {
            if (page === 'kiosk.html' || page === 'login.html') return null;
            return 'kiosk.html';
        }
        if (page === 'kiosk.html') return 'index.html';
        return null;
    }

    function landingPageFor(data) {
        return isKioskAccount(data) ? 'kiosk.html' : 'index.html';
    }

    // Past and today, newest first; future dates after that, soonest first.
    function sortOccurrencesForKiosk(occurrences, today) {
        const list = (occurrences || []).slice();
        const past = list.filter(o => o && o.date && o.date <= today)
            .sort((a, b) => b.date.localeCompare(a.date));
        const future = list.filter(o => o && o.date && o.date > today)
            .sort((a, b) => a.date.localeCompare(b.date));
        return past.concat(future);
    }

    // The document id IS the Person id, so a second mark overwrites the first
    // rather than minting a duplicate (ADR-0042).
    function attendanceDocId(personId) {
        return personId || null;
    }

    function attendancePayload(markedAt) {
        return { markedAt: markedAt };
    }

    function markPresentWrites(occurrenceId, personIds, markedAt) {
        const ids = [];
        const seen = {};
        (personIds || []).forEach(function (id) {
            if (!id || seen[id]) return;
            seen[id] = true;
            ids.push(id);
        });
        return ids.map(function (personId) {
            return {
                occurrenceId: occurrenceId,
                personId: personId,
                payload: attendancePayload(markedAt),
            };
        });
    }

    function presentCountLabel(n) {
        const count = n || 0;
        return 'Mark ' + count + ' present';
    }

    const KioskCore = {
        isKiosk,
        isKioskAccount,
        pageName,
        kioskGateDestination,
        landingPageFor,
        sortOccurrencesForKiosk,
        attendanceDocId,
        attendancePayload,
        markPresentWrites,
        presentCountLabel,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = KioskCore;
    }
    if (global) {
        global.KioskCore = KioskCore;
    }
})(typeof window !== 'undefined' ? window : null);
