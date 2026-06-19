const { test } = require('node:test');
const assert = require('node:assert');

const { topPrayerCandidates } = require('../public/prayer-suggestions.js');

// Pastoral-prayer suggestions: of the members of a given sex, surface those not
// yet prayed for "today or later", least-recently-prayed first. This ranking was
// copied into service-builder.js and service-calendar.js; it lives once now.

const TODAY = '2026-06-18';

const people = [
    { id: 'm1', sex: 'male',   lastPastoralPrayerDate: '2026-01-01' },
    { id: 'm2', sex: 'male',   lastPastoralPrayerDate: '2026-05-01' },
    { id: 'm3', sex: 'male' },                                         // never prayed for
    { id: 'm4', sex: 'male',   lastPastoralPrayerDate: '2026-06-18' }, // prayed for today
    { id: 'm5', sex: 'male',   lastPastoralPrayerDate: '2026-09-01' }, // future
    { id: 'f1', sex: 'female', lastPastoralPrayerDate: '2026-03-01' },
];

test('filters by sex', () => {
    const males = topPrayerCandidates(people, 'male', TODAY, 10);
    assert.ok(males.every(m => m.sex === 'male'));
    assert.deepStrictEqual(topPrayerCandidates(people, 'female', TODAY, 10).map(m => m.id), ['f1']);
});

test('excludes members already prayed for today or in the future', () => {
    const ids = topPrayerCandidates(people, 'male', TODAY, 10).map(m => m.id);
    assert.ok(!ids.includes('m4'), 'today is excluded');
    assert.ok(!ids.includes('m5'), 'future is excluded');
});

test('orders least-recently-prayed first; never-prayed is most overdue', () => {
    const ids = topPrayerCandidates(people, 'male', TODAY, 10).map(m => m.id);
    assert.deepStrictEqual(ids, ['m3', 'm1', 'm2']); // null(0000) < Jan < May
});

test('caps at the limit (default 3)', () => {
    assert.strictEqual(topPrayerCandidates(people, 'male', TODAY).length, 3);
    assert.strictEqual(topPrayerCandidates(people, 'male', TODAY, 1).length, 1);
    assert.strictEqual(topPrayerCandidates(people, 'male', TODAY, 1)[0].id, 'm3');
});

test('tolerates an empty or missing member list', () => {
    assert.deepStrictEqual(topPrayerCandidates([], 'male', TODAY, 3), []);
    assert.deepStrictEqual(topPrayerCandidates(null, 'male', TODAY, 3), []);
});
