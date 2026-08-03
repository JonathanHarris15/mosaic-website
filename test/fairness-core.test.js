const { test } = require('node:test');
const assert = require('node:assert');

const Fairness = require('../public/fairness-core.js');
const Roles = require('../public/roles-core.js');
const EventsCore = require('../public/events-core.js');

// The numbers fairness stands on (MS-17, ADR-0020).
//
//   Load    — how much a person is carrying this season. Σ intensity over the
//             window. Because intensity is measured in WEEKS OF REST OWED, load
//             comes out in the same unit as the window, so `load ≥ window` is a
//             real burnout line needing no tuning constant.
//   Recency — how long since they last did THIS Role, capped at the window.
//
// Load decides who is CONSIDERED. Recency decides who gets WHICH Role among
// those considered. They are never combined into one weighted score.

// The last 12 Sundays, most recent first. These come from the recurrence rule,
// NOT from the serve log — three quiet weeks where nobody served still happened,
// and a window built from the log would silently pretend they did not.
const SUNDAYS = [
    '2026-07-26', '2026-07-19', '2026-07-12', '2026-07-05',
    '2026-06-28', '2026-06-21', '2026-06-14', '2026-06-07',
    '2026-05-31', '2026-05-24', '2026-05-17', '2026-05-10',
    // older than the window
    '2026-05-03', '2026-04-26',
];

const serve = (personId, type, serviceDate, extra) => Object.assign({
    personId: personId, type: type, serviceDate: serviceDate, seriesId: 'sunday_service',
}, extra || {});

// Sound is a morning sitting down; setup is a morning hauling tables.
const INTENSITIES = { sound: 1, setup: 4, coffee: 1.25, greeting: 0, preacher: 3 };
const intensityOf = record => (
    INTENSITIES[record.type] === undefined ? 1 : INTENSITIES[record.type]
);

const person = (id, extra) => Object.assign({ id: id, name: id, tags: [] }, extra);

// ── The window ───────────────────────────────────────────────────────────────

test('the window is the most recent occurrences of the series, most recent first', () => {
    const dates = Fairness.windowDates(SUNDAYS, 12);
    assert.equal(dates.length, 12);
    assert.equal(dates[0], '2026-07-26');
    assert.equal(dates[11], '2026-05-10');
});

test('a series with fewer occurrences than the window uses what it has', () => {
    assert.equal(Fairness.windowDates(['2026-07-26', '2026-07-19'], 12).length, 2);
});

test('serving outside the window does not count', () => {
    const dates = Fairness.windowDates(SUNDAYS, 12);
    const history = [serve('alice', 'setup', '2026-04-26')];
    assert.equal(Fairness.loadOf(history, dates, intensityOf).alice || 0, 0);
});

// ── Load ─────────────────────────────────────────────────────────────────────

test('load is the sum of intensity, so twelve light jobs equal three heavy ones', () => {
    const dates = Fairness.windowDates(SUNDAYS, 12);

    const soundEveryWeek = SUNDAYS.slice(0, 12).map(d => serve('alice', 'sound', d));
    const threeSetups = ['2026-07-26', '2026-06-28', '2026-05-31']
        .map(d => serve('brenda', 'setup', d));

    const load = Fairness.loadOf(soundEveryWeek.concat(threeSetups), dates, intensityOf);

    assert.equal(load.alice, 12);
    assert.equal(load.brenda, 12);
});

test('load at or past the window means spent — the burnout line needs no constant', () => {
    assert.equal(Fairness.isSpent(12, 12), true);
    assert.equal(Fairness.isSpent(15.25, 12), true);
    assert.equal(Fairness.isSpent(11.9, 12), false);
});

test('a Role with intensity 0 never adds load', () => {
    const dates = Fairness.windowDates(SUNDAYS, 12);
    const history = SUNDAYS.slice(0, 12).map(d => serve('alice', 'greeting', d));
    assert.equal(Fairness.loadOf(history, dates, intensityOf).alice, 0);
});

test('load counts the Role being filled too, not only the other ones', () => {
    // Somebody who has done nothing but Coffee, heavily, must not read as
    // unloaded FOR Coffee. Excluding the current Role was tried and is wrong.
    const dates = Fairness.windowDates(SUNDAYS, 12);
    const history = SUNDAYS.slice(0, 8).map(d => serve('alice', 'coffee', d));
    assert.equal(Fairness.loadOf(history, dates, intensityOf).alice, 10);
});

test('liturgical serving counts as load — a sermon is not free work', () => {
    const dates = Fairness.windowDates(SUNDAYS, 12);
    const history = [serve('alice', 'preacher', '2026-07-26')];
    assert.equal(Fairness.loadOf(history, dates, intensityOf).alice, 3);
});

test('a one-off Role counts as load, since the hall gets unlocked every week', () => {
    const dates = Fairness.windowDates(SUNDAYS, 12);
    const history = SUNDAYS.slice(0, 12).map(d => serve('alice', 'one_off', d));
    assert.equal(Fairness.loadOf(history, dates, intensityOf).alice, 12);
});

test('serving in another Event series does not count — fairness is per series', () => {
    const dates = Fairness.windowDates(SUNDAYS, 12);
    const history = [serve('alice', 'setup', '2026-07-26', { seriesId: 'midweek' })];
    const mine = EventsCore.forSeries(history, 'sunday_service');
    assert.equal(Fairness.loadOf(mine, dates, intensityOf).alice || 0, 0);
});

test('a record written before seriesId existed reads as the Sunday Service', () => {
    const history = [{ personId: 'alice', type: 'setup', serviceDate: '2026-07-26' }];
    assert.equal(EventsCore.forSeries(history, 'sunday_service').length, 1);
});

// ── Recency ──────────────────────────────────────────────────────────────────

test('recency is how many occurrences ago they last held THIS Role', () => {
    const dates = Fairness.windowDates(SUNDAYS, 12);
    const history = [
        serve('alice', 'coffee', '2026-07-26'),   // the most recent Sunday
        serve('brenda', 'coffee', '2026-06-28'),  // four Sundays back
    ];
    const recency = Fairness.recencyOf(history, dates, 'coffee');

    assert.equal(recency.alice, 0);
    assert.equal(recency.brenda, 4);
});

test('never having held the Role reads the same as not having held it all season', () => {
    const dates = Fairness.windowDates(SUNDAYS, 12);
    const recency = Fairness.recencyOf([], dates, 'coffee');
    assert.equal(Fairness.recencyFor(recency, 'nobody', 12), 12);
});

test('recency is capped, so ancient history cannot overwhelm the load gate', () => {
    const dates = Fairness.windowDates(SUNDAYS, 12);
    const history = [serve('alice', 'coffee', '2020-01-05')];
    assert.equal(Fairness.recencyFor(Fairness.recencyOf(history, dates, 'coffee'), 'alice', 12), 12);
});

test('recency tracks only the Role asked about, not serving in general', () => {
    const dates = Fairness.windowDates(SUNDAYS, 12);
    const history = [serve('alice', 'setup', '2026-07-26')];
    const recency = Fairness.recencyOf(history, dates, 'coffee');
    assert.equal(Fairness.recencyFor(recency, 'alice', 12), 12);
});

test('a free Role still moves recency, even though it never moves load', () => {
    const dates = Fairness.windowDates(SUNDAYS, 12);
    const history = [serve('alice', 'greeting', '2026-07-26')];

    assert.equal(Fairness.loadOf(history, dates, intensityOf).alice, 0);
    assert.equal(Fairness.recencyOf(history, dates, 'greeting').alice, 0);
});

// ── The pool ─────────────────────────────────────────────────────────────────

const ALICE = person('alice');
const BRENDA = person('brenda');
const CARL = person('carl');
const DAN = person('dan');
const PREACHER = person('preacher-pete');
const GONE = person('gone', { membership: { inactive: true } });

const poolOptions = extra => Object.assign({
    people: [ALICE, BRENDA, CARL, DAN, PREACHER],
    history: [],
    occurrenceDates: SUNDAYS,
    windowSize: 12,
    intensityOf: intensityOf,
    liturgicalSlugs: Roles.LITURGICAL_SLUGS,
    liturgicalHolders: [],
}, extra || {});

const idsIn = pool => pool.candidates.map(c => c.personId);

test('the pool is ordered least-loaded first', () => {
    const pool = Fairness.pool(poolOptions({
        history: [
            serve('alice', 'setup', '2026-07-26'),
            serve('brenda', 'sound', '2026-07-26'),
        ],
    }));
    // Carl and Dan have done nothing, so they lead; Brenda's 1 beats Alice's 4.
    assert.deepEqual(idsIn(pool).slice(-2), ['brenda', 'alice']);
});

test('each candidate carries the numbers, so the picker can explain itself', () => {
    const pool = Fairness.pool(poolOptions({
        history: [serve('alice', 'setup', '2026-07-26')],
    }));
    const alice = pool.candidates.find(c => c.personId === 'alice');

    assert.equal(alice.load, 4);
    assert.equal(alice.spent, false);
});

test('holding a liturgical Role at this occurrence keeps you out of the pool', () => {
    const pool = Fairness.pool(poolOptions({ liturgicalHolders: ['carl'] }));
    assert.equal(idsIn(pool).includes('carl'), false);
});

test('holding a liturgical Role in half the window keeps you out of the pool', () => {
    const history = SUNDAYS.slice(0, 6).map(d => serve('preacher-pete', 'preacher', d));
    const pool = Fairness.pool(poolOptions({ history: history }));
    assert.equal(idsIn(pool).includes('preacher-pete'), false);
});

test('at 49% of the window they are still in — the cliff is at half', () => {
    const history = SUNDAYS.slice(0, 5).map(d => serve('preacher-pete', 'preacher', d));
    const pool = Fairness.pool(poolOptions({ history: history }));
    assert.equal(idsIn(pool).includes('preacher-pete'), true);
});

test('an occasional preacher stays in the pool but carries the load of it', () => {
    const history = [serve('preacher-pete', 'preacher', '2026-07-26')];
    const pool = Fairness.pool(poolOptions({ history: history }));
    const pete = pool.candidates.find(c => c.personId === 'preacher-pete');

    assert.ok(pete, 'one sermon a quarter must not cost someone the rota');
    assert.equal(pete.load, 3);
});

test('inactive people never reach the pool', () => {
    // Assignability is roles-core's judgment, applied by the caller. The pool
    // ranks whoever it is handed — and candidatesFor is the backstop, so an
    // Inactive Person who slipped through still could not be seated.
    const pool = Fairness.pool(poolOptions({
        people: Roles.assignablePeople([ALICE, GONE], {}),
    }));
    assert.deepEqual(idsIn(pool), ['alice']);
});

test('the pool says when everyone in it is over their rest budget', () => {
    const history = [];
    [ALICE, BRENDA, CARL, DAN, PREACHER].forEach(p => {
        SUNDAYS.slice(0, 12).forEach(d => history.push(serve(p.id, 'sound', d)));
    });
    const pool = Fairness.pool(poolOptions({ history: history }));

    assert.equal(pool.allSpent, true);
});

test('a pool with anyone fresh in it is not flagged as spent', () => {
    const pool = Fairness.pool(poolOptions());
    assert.equal(pool.allSpent, false);
});

test('the pool never restates an eligibility rule — restrictions are not its job', () => {
    // A Role's tags, relationships and allowlist are judged by roles-core when
    // the solver seats somebody. The pool is about load, and nothing else.
    const pool = Fairness.pool(poolOptions());
    assert.deepEqual(idsIn(pool).sort(), ['alice', 'brenda', 'carl', 'dan', 'preacher-pete']);
});

// ── Nudging a load by hand ──────────────────────────────────────────────────
//
// A claim on somebody's week the church has no record of: a new baby, a parent
// in hospital. The editor says it in the unit that already means something
// here — weeks of rest owed.

test('a nudge adds to a load the serve log already knows about', () => {
    const out = Fairness.withNudges({ p1: 3, p2: 1 }, { p1: 2 });

    assert.equal(out.p1, 5);
    assert.equal(out.p2, 1, 'nobody else moves');
});

test('somebody with no serves at all can still be carrying something', () => {
    assert.equal(Fairness.withNudges({}, { p1: 4 }).p1, 4);
});

test('a nudge can take load off as well as put it on', () => {
    assert.equal(Fairness.withNudges({ p1: 5 }, { p1: -2 }).p1, 3);
});

// ⚠ NEVER BELOW ZERO. A negative load is not a person with room to spare, it is
// a number that sorts them above people who genuinely have none.
test('a nudge cannot push a load below nothing', () => {
    assert.equal(Fairness.withNudges({ p1: 1 }, { p1: -9 }).p1, 0);
});

test('a nudge of nothing, or of nonsense, changes nothing', () => {
    assert.deepEqual(Fairness.withNudges({ p1: 2 }, { p1: 0 }), { p1: 2 });
    assert.deepEqual(Fairness.withNudges({ p1: 2 }, { p1: 'lots' }), { p1: 2 });
    assert.deepEqual(Fairness.withNudges({ p1: 2 }, null), { p1: 2 });
});

test('nudging leaves the load it was given alone', () => {
    const load = { p1: 2 };
    Fairness.withNudges(load, { p1: 3 });
    assert.equal(load.p1, 2, 'the caller keeps whatever it computed');
});

// ⚠ THE POINT OF THE WHOLE THING: a nudge has to reach the gate, or it is a
// number in a box that changes nobody's Sunday.
test('a nudge over the window takes somebody out of the running', () => {
    const spentByHand = Fairness.pool({
        people: [{ id: 'p1' }, { id: 'p2' }],
        history: [],
        occurrenceDates: SUNDAYS,
        windowSize: 12,
        intensityOf: () => 1,
        nudges: { p1: 12 },
    });

    const p1 = spentByHand.candidates.filter(c => c.personId === 'p1')[0];
    const p2 = spentByHand.candidates.filter(c => c.personId === 'p2')[0];

    assert.equal(p1.spent, true, 'twelve weeks owed is twelve weeks owed');
    assert.equal(p2.spent, false);
    assert.equal(spentByHand.candidates[0].personId, 'p2', 'and the free one comes first');
});
