const { test } = require('node:test');
const assert = require('node:assert');

// The Fall 2026 Master Plan, checked against itself.
//
// The importer runs these checks too, and refuses to write when one fails — but
// it needs credentials to run at all, so the checks live here as well where
// `npm test` reaches them. A recurrence rule that produces a plausible calendar
// which is silently wrong is the failure this exists for: nobody finds out until
// they open November.

const Core = require('../public/events-occurrence-core.js');
const { SERIES, EXPECTED, ONE_OFFS } = require('../scripts/fall-2026-plan.js');

const WINDOW = { from: '2026-08-01', to: '2027-01-31' };

test('every recurrence rule produces exactly the dates the workbook shows', () => {
    SERIES.forEach(series => {
        const produced = Core.datesBetween(series.recurrence, WINDOW.from, WINDOW.to);
        assert.deepStrictEqual(
            produced, EXPECTED[series.id],
            `${series.id} does not match the workbook`
        );
    });
});

test('every series in the plan has an expected list to be checked against', () => {
    // Otherwise a new series could be added with no check at all, and the test
    // above would pass by comparing undefined to undefined.
    SERIES.forEach(series => {
        assert.ok(Array.isArray(EXPECTED[series.id]), `${series.id} has no expected dates`);
        assert.ok(EXPECTED[series.id].length, `${series.id} expects no dates`);
    });
});

test('every skipped date is one the pattern actually produces', () => {
    // A skip on a date the rule never produces is a document saying "not
    // happening" about a day nothing was happening on.
    SERIES.forEach(series => {
        const produced = Core.datesBetween(series.recurrence, WINDOW.from, WINDOW.to);
        (series.skip || []).forEach(skip => {
            assert.ok(
                produced.indexOf(skip.date) !== -1,
                `${series.id} skips ${skip.date}, which its rule never produces`
            );
        });
    });
});

test('no one-off id reads as one date of a series', () => {
    // ⚠ The failure that would ship quietly. `parseOccurrenceId` splits at the
    // last underscore and reads a trailing date as a series occurrence, so an id
    // like `fall2026_splash_2026-08-15` would deny that one-off its own date and
    // its own span — and it would look completely normal until somebody tried to
    // edit it.
    ONE_OFFS.forEach(o => {
        assert.strictEqual(
            Core.parseOccurrenceId(o.id), null,
            `${o.id} reads as one date of a series`
        );
    });
});

test('every one-off id is used once', () => {
    const ids = ONE_OFFS.map(o => o.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'a one-off id is used twice');
});

test('every span in the plan is one the model will store', () => {
    ONE_OFFS.forEach(o => {
        assert.strictEqual(Core.spanError(o), null, `${o.id}: ${Core.spanError(o)}`);
    });
});

test('every event says who can see it, in words the ladder knows', () => {
    // An unrecognised stamp is readable by NOBODY once the security rule reads
    // it — so a typo here imports an event that vanishes for everyone.
    [].concat(SERIES, ONE_OFFS).forEach(e => {
        assert.ok(
            Core.VISIBILITY_ORDER.indexOf(e.visibility) !== -1,
            `${e.id} has unknown visibility "${e.visibility}"`
        );
    });
});

test('the four runs of days are the ones the workbook has', () => {
    const runs = ONE_OFFS.filter(o => Core.isMultiDay(o))
        .map(o => [o.name, Core.spanLength(o)]);
    assert.deepStrictEqual(runs, [
        ['CSISD Fall Break', 2],
        ['CSISD Thanksgiving Break', 5],
        ['TAMU Finals', 4],
        ['CAMO CWC Indianapolis', 5],
    ]);
});
