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

    // One-time load of every scripture reference ever used, for the
    // scripture picker's typeahead — same shape as HymnRegistry.load()
    // (public/hymn-registry.js) and the people Fuse index
    // (service-builder.js loadPeopleRegistry()). The collection is bounded
    // by how many distinct references a church has ever used, not by
    // services or people, so one read is cheap for the picker's lifetime.
    async function loadScriptureIndex(db) {
        const snap = await db.collection('scripture_usage').get();
        const references = snap.docs.map(d => d.data());
        const fuse = (typeof Fuse !== 'undefined')
            ? new Fuse(references, { keys: ['reference'], threshold: 0.3 })
            : null;
        return { references, fuse };
    }

    // References matching `query`, most-used first when there's no query
    // (an empty box should offer the regulars, not an arbitrary order).
    function searchScriptureIndex(index, query, limit = 8) {
        if (!index) return [];
        const q = (query || '').trim();
        if (!q) {
            return index.references
                .slice()
                .sort((a, b) => (b.count || 0) - (a.count || 0))
                .slice(0, limit);
        }
        if (!index.fuse) return [];
        return index.fuse.search(q).slice(0, limit).map(r => r.item);
    }

    const UsageStats = {
        formatLabel,
        isTrackedField,
        personStatFor,
        loadScriptureIndex,
        searchScriptureIndex,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = UsageStats;
    }
    if (global) {
        global.UsageStats = UsageStats;
    }
})(typeof window !== 'undefined' ? window : null);
