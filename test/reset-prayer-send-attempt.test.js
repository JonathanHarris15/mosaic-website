const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
    parsePersonIds,
    assertServiceDate,
    planClears,
} = require('../scripts/reset-prayer-send-attempt-lib');

test('parsePersonIds splits and dedupes', () => {
    assert.deepStrictEqual(
        parsePersonIds('a,b , c'),
        ['a', 'b', 'c']);
    assert.throws(() => parsePersonIds('a,a'), /Duplicate/);
    assert.throws(() => parsePersonIds(''), /--ids/);
});

test('assertServiceDate requires YYYY-MM-DD', () => {
    assertServiceDate('2026-10-25');
    assert.throws(() => assertServiceDate('10-25-2026'), /--service-date/);
});

test('planClears builds prayer_requests paths', () => {
    const plans = planClears('2026-10-25', ['p1', 'p2']);
    assert.deepStrictEqual(plans, [
        {personId: 'p1', path: 'people/p1/prayer_requests/2026-10-25'},
        {personId: 'p2', path: 'people/p2/prayer_requests/2026-10-25'},
    ]);
});
