// Pure helpers for stamping `visibility` on occurrence documents that were
// written without it (MS-783). Used by `scripts/backfill-occurrence-visibility.js`
// and unit tests.
(function (global) {
    'use strict';

    const OccCore = (typeof require === 'function')
        ? require('./events-occurrence-core.js')
        : null;

    function sundayServiceId() {
        return OccCore ? OccCore.SUNDAY_SERVICE_ID : 'sunday_service';
    }

    /** @param {Record<string, unknown>|null|undefined} data */
    function occurrenceNeedsVisibilityStamp(data) {
        return !('visibility' in (data || {}));
    }

    /**
     * Same resolution as `stampFor` in events-store.js when an occurrence is created.
     * @param {Record<string, unknown>|null|undefined} series
     * @param {string} seriesId
     */
    function stampFor(series, seriesId) {
        const sundayId = sundayServiceId();
        return {
            visibility: (series && series.visibility)
                || (seriesId === sundayId ? 'public' : 'member'),
            rosterShared: !!(series && series.rosterShared === true),
        };
    }

    /**
     * @param {Record<string, unknown>} occurrenceData
     * @param {Record<string, Record<string, unknown>>} seriesById
     * @return {{kind: 'already'}|{kind: 'orphan'}|{kind: 'stamp', stamp: {visibility: string, rosterShared: boolean}}}
     */
    function planStampForOccurrence(occurrenceData, seriesById) {
        if (!occurrenceNeedsVisibilityStamp(occurrenceData)) {
            return { kind: 'already' };
        }
        const seriesId = occurrenceData.seriesId;
        if (!seriesId) {
            return { kind: 'orphan' };
        }
        return {
            kind: 'stamp',
            stamp: stampFor(seriesById[seriesId], String(seriesId)),
        };
    }

    const BackfillOccurrenceVisibilityCore = {
        occurrenceNeedsVisibilityStamp,
        stampFor,
        planStampForOccurrence,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = BackfillOccurrenceVisibilityCore;
    }
    if (global) {
        global.BackfillOccurrenceVisibilityCore = BackfillOccurrenceVisibilityCore;
    }
})(typeof window !== 'undefined' ? window : null);
