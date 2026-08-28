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

    // Today first, then whatever is coming. A gathering that has been and gone
    // is not one people are arriving for, so it is not on the list at all —
    // showing it only gives a greeter a wrong button to press on a busy
    // morning. Attendance for a past Event is corrected on the Event itself.
    function sortOccurrencesForKiosk(occurrences, today) {
        return (occurrences || [])
            .filter(o => o && o.date && o.date >= today)
            .sort((a, b) => a.date.localeCompare(b.date));
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

    // ── Who is already here (MS-321) ─────────────────────────────────────────
    // Attendance is keyed by Person id, so a second mark overwrites the first
    // and the count never doubles. What it USED to lose was the tag: a greeter
    // reopening a Household to add a latecomer reprinted everybody. So the
    // Attendance rows already written for this Event are read back and indexed,
    // and an arrival is only somebody the index does not know.

    function attendanceIndex(rows) {
        const index = {};
        (rows || []).forEach(function (row) {
            if (!row || !row.personId) return;
            index[row.personId] = {
                markedAt: row.markedAt || null,
                pickupCode: row.pickupCode || '',
            };
        });
        return index;
    }

    function isPresent(index, personId) {
        return !!(index && personId && index[personId]);
    }

    // The members of a Household who are NOT yet present. These are the only
    // people a mark writes and the only ones a tag prints for; everybody else
    // already has theirs, and a duplicate tag is worse than no tag.
    function arrivals(members, index) {
        return (members || []).filter(function (m) {
            return m && m.personId && !isPresent(index, m.personId);
        });
    }

    // The pickup code a Kid was given when they were first marked present. A
    // reprint has to carry the SAME number or the stub on the parent's phone
    // stops matching the tag on the child.
    function pickupCodesFrom(index, members) {
        const out = {};
        (members || []).forEach(function (m) {
            if (!m || !m.personId) return;
            const row = index && index[m.personId];
            if (row && row.pickupCode) out[m.personId] = row.pickupCode;
        });
        return out;
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
        attendanceIndex,
        isPresent,
        arrivals,
        pickupCodesFrom,
        presentCountLabel,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = KioskCore;
    }
    if (global) {
        global.KioskCore = KioskCore;
    }
})(typeof window !== 'undefined' ? window : null);
