// Pure helpers for rebuilding `lastPastoralPrayerDate` from pastoral prayer
// history (MS-790). Used by `scripts/sync-pastoral-prayer-dates.js` and tests.
(function (global) {
    'use strict';

    const PrayerCore = (typeof require === 'function')
        ? require('./pastoral-prayer-core.js')
        : null;

    function latestDate(dates) {
        return PrayerCore ? PrayerCore.latestDate(dates) : null;
    }

    function normalizeDate(value) {
        return PrayerCore ? PrayerCore.normalizeDate(value) : value;
    }

    /**
     * Whether a Person's cached date already matches history.
     * @param {string|null|undefined} stored
     * @param {string|null} expectedFromHistory
     */
    function cacheMatchesHistory(stored, expectedFromHistory) {
        return stored === expectedFromHistory
            || (expectedFromHistory === null && stored === undefined);
    }

    /**
     * @param {string|null|undefined} stored
     * @param {string[]} historyDates
     */
    function needsCacheCorrection(stored, historyDates) {
        const expected = latestDate(historyDates);
        return !cacheMatchesHistory(stored, expected);
    }

    /**
     * @param {Array<{serviceDate?: string, docId?: string}>} historyRecords
     * @return {string[]}
     */
    function historyDatesFromRecords(historyRecords) {
        return (historyRecords || [])
            .map(r => normalizeDate(r.serviceDate || r.docId))
            .filter(Boolean);
    }

    const SyncPastoralPrayerDatesCore = {
        cacheMatchesHistory,
        needsCacheCorrection,
        historyDatesFromRecords,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SyncPastoralPrayerDatesCore;
    }
    if (global) {
        global.SyncPastoralPrayerDatesCore = SyncPastoralPrayerDatesCore;
    }
})(typeof window !== 'undefined' ? window : null);
