const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/backfill-occurrence-visibility-core.js');
const Occ = require('../public/events-occurrence-core.js');

test('occurrence without visibility needs a stamp', () => {
    assert.equal(Core.occurrenceNeedsVisibilityStamp({ date: '2026-01-05' }), true);
    assert.equal(Core.occurrenceNeedsVisibilityStamp({ visibility: 'member' }), false);
});

test('stamp follows the series visibility', () => {
    assert.deepStrictEqual(
        Core.stampFor({ visibility: 'elder', rosterShared: true }, 'midweek'),
        { visibility: 'elder', rosterShared: true },
    );
});

test('Sunday Service series without a stamp is public', () => {
    assert.deepStrictEqual(
        Core.stampFor({}, Occ.SUNDAY_SERVICE_ID),
        { visibility: 'public', rosterShared: false },
    );
});

test('a series with no visibility defaults to member', () => {
    assert.deepStrictEqual(
        Core.stampFor({}, 'midweek'),
        { visibility: 'member', rosterShared: false },
    );
});

test('plan stamps an unstamped occurrence from its series', () => {
    const plan = Core.planStampForOccurrence(
        { seriesId: 'midweek', date: '2026-02-01' },
        { midweek: { visibility: 'member', rosterShared: false } },
    );
    assert.equal(plan.kind, 'stamp');
    assert.deepStrictEqual(plan.stamp, { visibility: 'member', rosterShared: false });
});

test('plan skips occurrences that already carry visibility', () => {
    assert.deepStrictEqual(
        Core.planStampForOccurrence({ visibility: 'public', seriesId: 'x' }, {}),
        { kind: 'already' },
    );
});

test('plan reports orphans with no seriesId', () => {
    assert.deepStrictEqual(
        Core.planStampForOccurrence({ date: '2026-02-01' }, {}),
        { kind: 'orphan' },
    );
});
