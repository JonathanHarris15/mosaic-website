// Usage Stats Store — the client half of "last used / times used" on the
// Order of Service pickers (hymns, scripture, people). UsageStatsCore
// (public/usage-stats-core.js) decides what changed on a save; this decides
// how a cached count/date reads to a human and how to load the one new
// collection this feature adds (scripture_usage).
//
// The counts themselves are written by Cloud Functions reacting to
// services/{date}, people/{id}/involvement/{id} and
// people/{id}/pastoral_prayer_history/{date} writes (functions/index.js) —
// nothing here writes usage stats, it only reads and formats them.
//
// Loaded as a classic <script> after usage-stats-core.js and date-utils.js.
// Also module.exports for Node tests.
(function (global) {
    'use strict';

    const Core = (typeof module !== 'undefined' && module.exports)
        ? require('./usage-stats-core.js')
        : global.UsageStatsCore;
    const Dates = (typeof module !== 'undefined' && module.exports)
        ? require('./date-utils.js')
        : global.DateUtils;
    const AnalyticsUtils = (typeof module !== 'undefined' && module.exports)
        ? require('./analytics-utils.js')
        : global.AnalyticsUtils;
    const BibleData = (typeof module !== 'undefined' && module.exports)
        ? require('./bible-data.js')
        : global.BIBLE_DATA;

    // A cached {count, lastUsed} → what a picker row shows beside a
    // candidate. One formatter, so the wording can't drift between the hymn
    // dropdown, the scripture dropdown, and the person picker.
    function formatLabel(stat) {
        const count = (stat && stat.count) || 0;
        if (!count) return 'Never used';
        const times = count === 1 ? '1×' : `${count}×`;
        if (!stat.lastUsed) return `Used ${times}`;
        const date = Dates.parseDateStr(stat.lastUsed).toLocaleDateString('default', {
            month: 'short', day: 'numeric', year: 'numeric',
        });
        return `Used ${times} · last ${date}`;
    }

    // Field name on the Order of Service (as personPicker/CANONICAL_MAPPING
    // name it) → the key its stats are cached under. `prayerMale`/
    // `prayerFemale` aren't serving roles (service-involvement-core.js
    // excludes them deliberately) — they read from the separate pastoral
    // prayer cache instead.
    const PASTORAL_PRAYER_FIELDS = Object.freeze(['prayerMale', 'prayerFemale']);

    // service-builder.js names these fields `prayerPraise`/`prayerConfession`
    // (CANONICAL_MAPPING); service-calendar.js's table view names the same
    // two fields `prayerPraiseName`/`prayerConfessionName` (personFields).
    // Both spellings are kept here rather than normalized at the call site,
    // so each picker can pass whatever it already calls its own field.
    const ROLE_STAT_KEY_BY_FIELD = Object.freeze({
        serviceLeader: Core.roleStatKey('service_leader'),
        musicLeader: Core.roleStatKey('worship_leader'),
        preacher: Core.roleStatKey('preacher'),
        prayerPraise: Core.roleStatKey('prayer', 'praise'),
        prayerPraiseName: Core.roleStatKey('prayer', 'praise'),
        prayerConfession: Core.roleStatKey('prayer', 'confession'),
        prayerConfessionName: Core.roleStatKey('prayer', 'confession'),
        elements: Core.roleStatKey('elements'),
        other: Core.roleStatKey('other'),
        musicHelpers: Core.roleStatKey('worship_helper'),
    });

    // Whether this feature tracks usage for a field at all — as opposed to
    // "tracked, but this candidate has never filled it" (personStatFor
    // returning null). A shared modal that reuses one picker for many
    // fields (service-calendar.js's person selector) needs this to tell
    // "show nothing" apart from "show Never used" for a field like
    // assignedWriter that isn't a serving role at all.
    function isTrackedField(field) {
        return !!field && (PASTORAL_PRAYER_FIELDS.includes(field) || field in ROLE_STAT_KEY_BY_FIELD);
    }

    // A candidate person's cached stat for one Order of Service field, or
    // null if the field isn't one this feature tracks (e.g. a picker the
    // caller opened for something unrelated) or the person has never
    // filled it.
    function personStatFor(personDoc, field) {
        if (!personDoc) return null;
        if (PASTORAL_PRAYER_FIELDS.includes(field)) {
            return personDoc.pastoralPrayerStats || null;
        }
        const key = ROLE_STAT_KEY_BY_FIELD[field];
        if (!key) return null;
        return (personDoc.roleStats && personDoc.roleStats[key]) || null;
    }

    // One-time load of every scripture reference ever used. The collection
    // is bounded by how many distinct references a church has ever used,
    // not by services or people, so one read is cheap for the picker's
    // lifetime — see buildScriptureHeatMap for what it's loaded FOR.
    async function loadScriptureIndex(db) {
        const snap = await db.collection('scripture_usage').get();
        return snap.docs.map(d => d.data());
    }

    // Every scripture_usage doc, folded into how often each BOOK, CHAPTER,
    // and VERSE has actually been touched — what the verse picker colors
    // its book/chapter/verse buttons with (public/verse-picker.js), mirrors
    // the Analytics page's own Bible heat map (bibleStats.chapters, built by
    // processBibleReferences in analytics.js) so the two read the same way
    // — but built from this collection's pre-aggregated counts rather than
    // a live scan of every service, which is fine on the one page gated to
    // editors reading the church's whole history but not on a picker
    // opened on every keystroke of planning a Sunday.
    //
    // A reference spanning a range (`"John 3:16 - 4:5"`) is parsed into one
    // entry per chapter it touches (AnalyticsUtils.parseBibleReference), and
    // that reference's count is added to EVERY chapter/verse the range
    // covers — the same "a range lights up its whole span" semantics
    // analytics.js already uses for its own heat map.
    function buildScriptureHeatMap(references) {
        const bookCounts = {};
        const chapterStats = {};
        const verseStats = {};

        (references || []).forEach(doc => {
            const refs = AnalyticsUtils.parseBibleReference(doc.reference, BibleData);
            const count = doc.count || 0;
            const touchedChapters = new Set();

            refs.forEach(ref => {
                const chapterKey = `${ref.book}-${ref.chapter}`;
                if (!touchedChapters.has(chapterKey)) {
                    touchedChapters.add(chapterKey);
                    bookCounts[ref.book] = (bookCounts[ref.book] || 0) + count;
                    const bucket = chapterStats[chapterKey] || (chapterStats[chapterKey] = { count: 0, lastUsed: null });
                    bucket.count += count;
                    if (doc.lastUsed && (!bucket.lastUsed || doc.lastUsed > bucket.lastUsed)) {
                        bucket.lastUsed = doc.lastUsed;
                    }
                }
                (ref.verses || []).forEach(v => {
                    const verseKey = `${ref.book}-${ref.chapter}-${v}`;
                    const bucket = verseStats[verseKey] || (verseStats[verseKey] = { count: 0, lastUsed: null });
                    bucket.count += count;
                    if (doc.lastUsed && (!bucket.lastUsed || doc.lastUsed > bucket.lastUsed)) {
                        bucket.lastUsed = doc.lastUsed;
                    }
                });
            });
        });

        const maxOf = obj => Object.values(obj).reduce(
            (max, v) => Math.max(max, typeof v === 'number' ? v : v.count), 1);

        return {
            bookCounts,
            chapterStats,
            verseStats,
            maxBookCount: maxOf(bookCounts),
            maxChapterCount: maxOf(chapterStats),
            maxVerseCount: maxOf(verseStats),
        };
    }

    // The same 10-step palette analytics.js's getHeatColor/getVerseHeatColor
    // use, generalized to one function both levels (and the verse picker's
    // book level, which analytics.js doesn't have) share — a discrete
    // bucket scale reads more clearly than continuous opacity at this cell
    // size, and matching it exactly is what makes the two features look
    // like one system rather than two similar-but-different ones.
    const HEAT_COLORS = Object.freeze([
        'bg-blue-50', 'bg-blue-100', 'bg-blue-200', 'bg-blue-300',
        'bg-blue-400', 'bg-blue-500', 'bg-blue-600', 'bg-blue-700',
        'bg-blue-800', 'bg-blue-900',
    ]);

    function heatColorFor(count, max) {
        if (!count) return 'bg-surface-container';
        const intensity = Math.min(Math.ceil((count / (max || 1)) * 9), 9);
        return HEAT_COLORS[intensity];
    }

    const UsageStats = {
        formatLabel,
        isTrackedField,
        personStatFor,
        loadScriptureIndex,
        buildScriptureHeatMap,
        heatColorFor,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = UsageStats;
    }
    if (global) {
        global.UsageStats = UsageStats;
    }
})(typeof window !== 'undefined' ? window : null);
