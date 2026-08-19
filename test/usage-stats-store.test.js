const { test } = require('node:test');
const assert = require('node:assert');

const UsageStats = require('../public/usage-stats-store.js');

test('never used reads as "Never used", not "Used 0×"', () => {
    assert.strictEqual(UsageStats.formatLabel(null), 'Never used');
    assert.strictEqual(UsageStats.formatLabel({ count: 0, lastUsed: null }), 'Never used');
});

test('a single use is singular, more than one is not', () => {
    assert.strictEqual(UsageStats.formatLabel({ count: 1, lastUsed: null }), 'Used 1×');
    assert.strictEqual(UsageStats.formatLabel({ count: 4, lastUsed: null }), 'Used 4×');
});

test('a cached date is appended once formatted', () => {
    const label = UsageStats.formatLabel({ count: 3, lastUsed: '2026-07-14' });
    assert.strictEqual(label, 'Used 3× · last Jul 14, 2026');
});

test('personStatFor reads serving roles from roleStats, keyed to the field', () => {
    const person = { roleStats: { preacher: { count: 5, lastUsed: '2026-01-04' } } };
    assert.deepStrictEqual(UsageStats.personStatFor(person, 'preacher'), { count: 5, lastUsed: '2026-01-04' });
    assert.strictEqual(UsageStats.personStatFor(person, 'musicLeader'), null);
});

test('personStatFor tells the two prayer slots apart', () => {
    const person = {
        roleStats: {
            prayer_praise: { count: 2, lastUsed: '2026-02-01' },
            prayer_confession: { count: 7, lastUsed: '2026-03-01' },
        },
    };
    assert.strictEqual(UsageStats.personStatFor(person, 'prayerPraise').count, 2);
    assert.strictEqual(UsageStats.personStatFor(person, 'prayerConfession').count, 7);
});

test('personStatFor reads prayerMale/prayerFemale from the separate pastoral prayer cache', () => {
    const person = {
        roleStats: { preacher: { count: 9, lastUsed: '2026-01-01' } },
        pastoralPrayerStats: { count: 2, lastUsed: '2026-05-10' },
    };
    assert.deepStrictEqual(UsageStats.personStatFor(person, 'prayerMale'), { count: 2, lastUsed: '2026-05-10' });
    assert.deepStrictEqual(UsageStats.personStatFor(person, 'prayerFemale'), { count: 2, lastUsed: '2026-05-10' });
});

test('personStatFor is null for a field this feature does not track, and for no person', () => {
    assert.strictEqual(UsageStats.personStatFor({ roleStats: {} }, 'notAField'), null);
    assert.strictEqual(UsageStats.personStatFor(null, 'preacher'), null);
});

test('isTrackedField tells "not a serving role" apart from "never filled it"', () => {
    // A shared modal that reuses one picker for many fields (the table
    // view's person selector) needs this: assignedWriter isn't a serving
    // role at all, so it must read as untracked, not as "Never used".
    assert.strictEqual(UsageStats.isTrackedField('preacher'), true);
    assert.strictEqual(UsageStats.isTrackedField('prayerMale'), true);
    assert.strictEqual(UsageStats.isTrackedField('prayerPraiseName'), true);
    assert.strictEqual(UsageStats.isTrackedField('assignedWriter'), false);
    assert.strictEqual(UsageStats.isTrackedField(null), false);
    assert.strictEqual(UsageStats.isTrackedField(''), false);
});

test('searchScriptureIndex with an empty query returns the most-used references first', () => {
    const index = {
        fuse: null,
        references: [
            { reference: 'Romans 8:28', count: 2 },
            { reference: 'John 3:16', count: 9 },
            { reference: 'Psalm 23:1', count: 5 },
        ],
    };
    const results = UsageStats.searchScriptureIndex(index, '', 2);
    assert.deepStrictEqual(results.map(r => r.reference), ['John 3:16', 'Psalm 23:1']);
});

test('searchScriptureIndex with no index loaded returns nothing', () => {
    assert.deepStrictEqual(UsageStats.searchScriptureIndex(null, 'John'), []);
});
