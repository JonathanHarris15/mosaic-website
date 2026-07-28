const { test } = require('node:test');
const assert = require('node:assert');

const Events = require('../public/events-core.js');
const Roles = require('../public/roles-core.js');

// Seeding has to be safe to run twice — and safe to run against a church that
// has already added Servant Roles to its Sunday. So the seed is a RECONCILE:
// it restores what must be true (the series exists, is locked, carries every
// liturgical Role) without touching what the user owns (the Servant Roles they
// added, and the order they put them in).

const LITURGICAL = Roles.LITURGICAL_SLUGS;
const fresh = () => Events.sundayServiceSeries(LITURGICAL);

// ── First run ────────────────────────────────────────────────────────────────

test('with nothing stored, reconciling produces the Sunday Service series', () => {
    const result = Events.reconcileSundayService(null, LITURGICAL);

    assert.equal(result.changed, true);
    assert.deepEqual(result.series, fresh());
});

test('the first run reports what it did', () => {
    assert.match(Events.reconcileSundayService(null, LITURGICAL).reason, /creat/i);
});

// ── Second run ───────────────────────────────────────────────────────────────

test('reconciling an already-correct series changes nothing', () => {
    const result = Events.reconcileSundayService(fresh(), LITURGICAL);

    assert.equal(result.changed, false);
    assert.deepEqual(result.series, fresh());
});

test('reconciling is stable — a third run still changes nothing', () => {
    const once = Events.reconcileSundayService(null, LITURGICAL).series;
    const twice = Events.reconcileSundayService(once, LITURGICAL);
    const thrice = Events.reconcileSundayService(twice.series, LITURGICAL);

    assert.equal(twice.changed, false);
    assert.equal(thrice.changed, false);
});

// ── What the user owns is preserved ──────────────────────────────────────────

test('Servant Roles a user added to Sunday survive reconciling', () => {
    const withServant = Events.addRole(Events.addRole(fresh(), 'coffee'), 'kids_ministry');
    const result = Events.reconcileSundayService(withServant, LITURGICAL);

    assert.equal(result.changed, false, 'a user-extended series is already correct');
    assert.ok(result.series.roleSlugs.includes('coffee'));
    assert.ok(result.series.roleSlugs.includes('kids_ministry'));
});

test('the order the user put their Servant Roles in is kept', () => {
    const withServant = Events.addRole(Events.addRole(fresh(), 'kids_ministry'), 'coffee');
    const result = Events.reconcileSundayService(withServant, LITURGICAL);

    const servant = result.series.roleSlugs.filter(s => !LITURGICAL.includes(s));
    assert.deepEqual(servant, ['kids_ministry', 'coffee']);
});

test('seeding never invents a Servant Role', () => {
    const result = Events.reconcileSundayService(null, LITURGICAL);
    assert.deepEqual(result.series.roleSlugs, LITURGICAL.slice());
});

// ── Drift is repaired ────────────────────────────────────────────────────────

test('a liturgical Role missing from the stored series is restored', () => {
    const damaged = Object.assign(fresh(), {
        roleSlugs: LITURGICAL.filter(s => s !== 'preacher'),
    });
    const result = Events.reconcileSundayService(damaged, LITURGICAL);

    assert.equal(result.changed, true);
    assert.ok(result.series.roleSlugs.includes('preacher'));
    assert.match(result.reason, /preacher/);
});

test('a series that lost its lock is re-locked', () => {
    const damaged = Object.assign(fresh(), { locked: false });
    const result = Events.reconcileSundayService(damaged, LITURGICAL);

    assert.equal(result.changed, true);
    assert.equal(result.series.locked, true);
});

test('the liturgical Roles are re-marked undeletable if that drifted', () => {
    const damaged = Object.assign(fresh(), { lockedRoleSlugs: [] });
    const result = Events.reconcileSundayService(damaged, LITURGICAL);

    assert.equal(result.changed, true);
    assert.deepEqual(result.series.lockedRoleSlugs, LITURGICAL.slice());
});

test('a renamed series is left renamed — the name is the user\'s to change', () => {
    const renamed = Object.assign(fresh(), { name: 'Sunday Gathering' });
    const result = Events.reconcileSundayService(renamed, LITURGICAL);

    assert.equal(result.changed, false);
    assert.equal(result.series.name, 'Sunday Gathering');
});

// ── Reconciling never mutates its input ──────────────────────────────────────

test('reconciling leaves the stored value untouched', () => {
    const stored = Events.addRole(fresh(), 'coffee');
    const before = JSON.parse(JSON.stringify(stored));
    Events.reconcileSundayService(stored, LITURGICAL);
    assert.deepEqual(stored, before);
});

// ── The result is always valid ───────────────────────────────────────────────

test('whatever reconciling returns is a valid series', () => {
    const inputs = [
        null,
        fresh(),
        Object.assign(fresh(), { locked: false }),
        Object.assign(fresh(), { roleSlugs: [] }),
        Events.addRole(fresh(), 'coffee'),
    ];
    inputs.forEach((input, i) => {
        const { series } = Events.reconcileSundayService(input, LITURGICAL);
        assert.equal(Events.validateSeries(series).valid, true, 'input ' + i);
    });
});
