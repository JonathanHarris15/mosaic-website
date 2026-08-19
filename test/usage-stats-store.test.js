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

test('buildScriptureHeatMap folds a single-verse reference into its book, chapter, and verse', () => {
    const heatMap = UsageStats.buildScriptureHeatMap([
        { reference: 'John 3:16', count: 4, lastUsed: '2026-01-04' },
    ]);
    assert.strictEqual(heatMap.bookCounts['John'], 4);
    assert.deepStrictEqual(heatMap.chapterStats['John-3'], { count: 4, lastUsed: '2026-01-04' });
    assert.deepStrictEqual(heatMap.verseStats['John-3-16'], { count: 4, lastUsed: '2026-01-04' });
});

test('a verse range lights up every verse it spans, not just the endpoints', () => {
    const heatMap = UsageStats.buildScriptureHeatMap([
        { reference: 'Romans 8:28-30', count: 2, lastUsed: '2026-02-01' },
    ]);
    assert.strictEqual(heatMap.verseStats['Romans-8-28'].count, 2);
    assert.strictEqual(heatMap.verseStats['Romans-8-29'].count, 2);
    assert.strictEqual(heatMap.verseStats['Romans-8-30'].count, 2);
    // The chapter is credited once per reference, not once per verse in it —
    // otherwise a 12-verse range would outweigh twelve single-verse uses.
    assert.strictEqual(heatMap.chapterStats['Romans-8'].count, 2);
});

test('two references in the same chapter accumulate rather than overwrite', () => {
    const heatMap = UsageStats.buildScriptureHeatMap([
        { reference: 'John 3:16', count: 3, lastUsed: '2025-01-01' },
        { reference: 'John 3:1-5', count: 1, lastUsed: '2026-06-01' },
    ]);
    assert.strictEqual(heatMap.chapterStats['John-3'].count, 4);
    assert.strictEqual(heatMap.chapterStats['John-3'].lastUsed, '2026-06-01');
    assert.strictEqual(heatMap.bookCounts['John'], 4);
});

test('maxBookCount/maxChapterCount/maxVerseCount are the true maxima, never zero', () => {
    const empty = UsageStats.buildScriptureHeatMap([]);
    assert.strictEqual(empty.maxBookCount, 1);
    assert.strictEqual(empty.maxChapterCount, 1);
    assert.strictEqual(empty.maxVerseCount, 1);

    const heatMap = UsageStats.buildScriptureHeatMap([
        { reference: 'John 3:16', count: 5, lastUsed: '2026-01-01' },
        { reference: 'Psalm 23:1', count: 2, lastUsed: '2026-01-01' },
    ]);
    assert.strictEqual(heatMap.maxChapterCount, 5);
});

test('heatColorFor buckets 0 to the empty color and scales the rest across the 10-step palette', () => {
    assert.strictEqual(UsageStats.heatColorFor(0, 10), 'bg-surface-container');
    assert.strictEqual(UsageStats.heatColorFor(10, 10), 'bg-blue-900');
    assert.strictEqual(UsageStats.heatColorFor(1, 10), 'bg-blue-100');
});

test('heatColorFor never divides by zero when nothing has been used yet', () => {
    assert.strictEqual(UsageStats.heatColorFor(0, 0), 'bg-surface-container');
});

test('heatTextColorFor stays dark on the light half of the palette and turns white only once the background is dark enough to need it', () => {
    // Buckets 1-4 (light blues) — dark text.
    assert.strictEqual(UsageStats.heatTextColorFor(1, 10), 'text-on-surface');
    assert.strictEqual(UsageStats.heatTextColorFor(4, 10), 'text-on-surface');
    // Buckets 5-9 (mid-to-dark blues) — white text.
    assert.strictEqual(UsageStats.heatTextColorFor(5, 10), 'text-white');
    assert.strictEqual(UsageStats.heatTextColorFor(10, 10), 'text-white');
    // Unused cell — dark text, same as light buckets.
    assert.strictEqual(UsageStats.heatTextColorFor(0, 10), 'text-on-surface');
});
