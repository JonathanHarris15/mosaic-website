// Pastoral-prayer suggestion ranking — shared by the Order of Service Builder
// and the Service Calendar, which both surface "who to pray for next".
//
// The ranking was copied verbatim into service-builder.js and service-calendar.js
// (the getTop3 closure). It is pure: given the already-fetched member list, the
// subject's sex, and today's service-date key, it picks the least-recently-prayed
// candidates. The Firestore read stays at each call site; only the choice is here.
//
// Loaded as a classic <script> before the two page scripts; IIFE exposes only
// window.PrayerSuggestions. Also module.exports for Node tests.
(function (global) {
    'use strict';

    // Candidates of the given sex who have NOT been prayed for today or later,
    // least-recently-prayed first (a member never prayed for is most overdue),
    // capped at `limit` (default 3). Dates are 'YYYY-MM-DD' strings, compared
    // lexicographically — valid because the format sorts chronologically.
    function topPrayerCandidates(members, sex, todayStr, limit) {
        const n = (limit == null) ? 3 : limit;
        return (members || [])
            .filter(m => m.sex === sex)
            .filter(m => !m.lastPastoralPrayerDate || m.lastPastoralPrayerDate < todayStr)
            .sort((a, b) => {
                const dateA = a.lastPastoralPrayerDate || '0000-00-00';
                const dateB = b.lastPastoralPrayerDate || '0000-00-00';
                return dateA.localeCompare(dateB);
            })
            .slice(0, n);
    }

    const PrayerSuggestions = { topPrayerCandidates };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrayerSuggestions;
    }
    if (global) {
        global.PrayerSuggestions = PrayerSuggestions;
    }
})(typeof window !== 'undefined' ? window : null);
