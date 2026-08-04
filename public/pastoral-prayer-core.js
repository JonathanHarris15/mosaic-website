// Pastoral Prayer Core — the one place that knows how "who was prayed for, and
// when" is stored, updated, and read back.
//
// Being prayed for is recorded twice, on purpose:
//
//   1. THE HISTORY. `people/{id}/pastoral_prayer_history/{serviceDate}` — one
//      doc per Sunday a person was a subject. The doc ID *is* the service date,
//      which is what lets a save address the exact record it means to add or
//      remove without a query. Anything that copies these docs (a merge, a
//      schedule shift) has to carry that ID across or the record is stranded:
//      still counted, but no longer addressable.
//
//   2. THE CACHE. `people/{id}.lastPastoralPrayerDate` — the newest date in the
//      history, denormalized onto the Person so the rotation and the people
//      lists can rank hundreds of members without reading a subcollection each.
//
// The cache is derived; the history is the truth. Four surfaces used to
// recompute the cache by hand and none of them agreed — two wrote `null` for
// "never" and two wrote `'0000-00-00'`, and the Order of Service editor read
// the history *before* committing the write it was supposed to be reading, so
// the person you had just put down for Sunday came back still overdue. Those
// answers live here now, once.
//
// "Never prayed for" is `null`. `'0000-00-00'` is legacy and is normalized away
// on read, so old records keep working until the repair script has run.
//
// Loaded as a classic <script> before the page scripts; IIFE exposes only
// window.PastoralPrayerCore. Also module.exports for Node tests.
(function (global) {
    'use strict';

    const HISTORY_COLLECTION = 'pastoral_prayer_history';

    // The sentinel two of the old write paths used for "never prayed for". Never
    // written now — only recognised, so data already carrying it reads right.
    const LEGACY_NEVER = '0000-00-00';

    const isDateStr = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

    // A stored `lastPastoralPrayerDate` as this module means it: a real service
    // date, or `null` for never. Anything else — the legacy sentinel, an empty
    // string, a Timestamp somebody wrote by hand — reads as never rather than
    // sorting to the top of the rotation as a date from the year zero.
    function normalizeDate(value) {
        if (!isDateStr(value) || value === LEGACY_NEVER) return null;
        return value;
    }

    // True when this person has ever been a pastoral-prayer subject.
    function wasPrayedFor(value) {
        return normalizeDate(value) !== null;
    }

    // The doc ID for a history record. The ID is the date, so the same Sunday
    // can never be recorded twice for one person and a removal can address the
    // record directly.
    function historyDocId(serviceDate) {
        return isDateStr(serviceDate) ? serviceDate : null;
    }

    // The stored shape of a history record. `createdAt` is added by the caller,
    // which is the only side that has a server timestamp to hand.
    function historyRecord(serviceDate) {
        return { serviceDate: serviceDate };
    }

    // The newest date in a set of history dates, or null if there are none.
    // Dates are 'YYYY-MM-DD' strings and compare lexicographically, which is
    // valid because the format sorts chronologically.
    //
    // Future dates count. A Sunday six weeks out is already a commitment to pray
    // for that person, so the rotation must stop offering them — which is why
    // this is the newest date and not the newest *past* date.
    function latestDate(dates) {
        let latest = null;
        (dates || []).forEach(d => {
            const date = normalizeDate(d);
            if (date && (latest === null || date > latest)) latest = date;
        });
        return latest;
    }

    // What `lastPastoralPrayerDate` should become once this save lands: the
    // person's existing history dates, with `serviceDate` added or taken away
    // according to whether they are a subject of that service after the edit.
    //
    // This is what lets the cache be written in the same batch as the history
    // change instead of after it. Reading the history and hoping it already
    // reflects an uncommitted batch is what broke the editor.
    function nextLastPrayerDate(existingDates, serviceDate, isSubject) {
        const dates = (existingDates || []).map(normalizeDate).filter(Boolean)
            .filter(d => d !== serviceDate);
        if (isSubject && isDateStr(serviceDate)) dates.push(serviceDate);
        return latestDate(dates);
    }

    // The one label every surface shows for "when were they last prayed for".
    function lastPrayedLabel(value) {
        const date = normalizeDate(value);
        return date ? `Last: ${date}` : 'Never prayed for';
    }

    const PastoralPrayerCore = {
        HISTORY_COLLECTION,
        LEGACY_NEVER,
        normalizeDate,
        wasPrayedFor,
        historyDocId,
        historyRecord,
        latestDate,
        nextLastPrayerDate,
        lastPrayedLabel,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PastoralPrayerCore;
    }
    if (global) {
        global.PastoralPrayerCore = PastoralPrayerCore;
    }
})(typeof window !== 'undefined' ? window : null);
