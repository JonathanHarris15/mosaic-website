const { test } = require('node:test');
const assert = require('node:assert');

const EventsCore = require('../public/events-core.js');
const RolesCore = require('../public/roles-core.js');

// Fairness config on the Event series (MS-17, ADR-0020).
//
// [[Role intensity]] lives in THREE places depending on what the Role is, and
// something has to resolve the three into one number:
//
//   • a Servant Role      — on its own Role Definition
//   • a Liturgical Role   — in `liturgicalIntensity` here, because a liturgical
//                           Role has no stored definition and must never get
//                           one: /roles is editor-writable, so a document there
//                           would make a locked Role editable (ADR-0016)
//   • a one-off Role      — on the Event, since there is no definition at all
//
// If the default is applied in three places it will drift in three places, and
// nobody will notice — a load quietly computed against the wrong intensity looks
// exactly like a load computed correctly.

const series = extra => Object.assign({
    id: 'sunday_service',
    name: 'Sunday Service',
    roleSlugs: [],
    lockedRoleSlugs: [],
}, extra || {});

// ── The window ───────────────────────────────────────────────────────────────

test('a series with no window set uses the default season of 12 occurrences', () => {
    assert.equal(EventsCore.fairnessWindowOf(series()), 12);
});

test('a series may carry its own window', () => {
    assert.equal(EventsCore.fairnessWindowOf(series({ fairnessWindow: 8 })), 8);
});

test('a nonsense window falls back to the default rather than emptying the history', () => {
    assert.equal(EventsCore.fairnessWindowOf(series({ fairnessWindow: 0 })), 12);
    assert.equal(EventsCore.fairnessWindowOf(series({ fairnessWindow: -3 })), 12);
    assert.equal(EventsCore.fairnessWindowOf(series({ fairnessWindow: 'a season' })), 12);
});

test('the window is measured in occurrences, so it is the same number for any cadence', () => {
    // A fortnightly Event is judged on 12 of ITS OWN occurrences, not on 12
    // weeks — which would give it half the history a weekly Event gets.
    const midweek = series({ id: 'midweek', name: 'Midweek Gathering' });
    assert.equal(EventsCore.fairnessWindowOf(midweek), EventsCore.fairnessWindowOf(series()));
});

// ── Resolving intensity across its three homes ───────────────────────────────

test('a Servant Role takes its intensity from its own definition', () => {
    const definition = { slug: 'setup', name: 'Setup', intensity: 4 };
    assert.equal(EventsCore.roleIntensity(series(), 'setup', { definition: definition }), 4);
});

test('a liturgical Role takes its intensity from the series map', () => {
    const s = series({ liturgicalIntensity: { preacher: 3, prayer: 1 } });
    assert.equal(EventsCore.roleIntensity(s, 'preacher'), 3);
    assert.equal(EventsCore.roleIntensity(s, 'prayer'), 1);
});

test('a one-off Role takes its intensity from the Event', () => {
    const oneOff = { id: 'job-1', label: 'Unlock the hall', intensity: 0.5 };
    assert.equal(EventsCore.roleIntensity(series(), 'one_off', { oneOff: oneOff }), 0.5);
});

test('every unset case resolves to 1', () => {
    assert.equal(EventsCore.roleIntensity(series(), 'setup'), 1);
    assert.equal(EventsCore.roleIntensity(series(), 'setup', { definition: { slug: 'setup' } }), 1);
    assert.equal(EventsCore.roleIntensity(series(), 'preacher'), 1);
    assert.equal(EventsCore.roleIntensity(series(), 'one_off', { oneOff: { id: 'j' } }), 1);
    assert.equal(EventsCore.roleIntensity(null, null), 1);
});

test('a slug absent from the liturgical map reads as 1, not as missing', () => {
    const s = series({ liturgicalIntensity: { preacher: 3 } });
    assert.equal(EventsCore.roleIntensity(s, 'worship_leader'), 1);
});

test('intensity 0 survives resolution — it is a real value, not an absent one', () => {
    const s = series({ liturgicalIntensity: { prayer: 0 } });
    assert.equal(EventsCore.roleIntensity(s, 'prayer'), 0);
    assert.equal(EventsCore.roleIntensity(series(), 'greet', { definition: { intensity: 0 } }), 0);
    assert.equal(EventsCore.roleIntensity(series(), 'one_off', { oneOff: { intensity: 0 } }), 0);
});

test('a one-off Role wins over anything else, because it is the whole Role', () => {
    const s = series({ liturgicalIntensity: { one_off: 9 } });
    const oneOff = { id: 'job-1', intensity: 2 };
    assert.equal(EventsCore.roleIntensity(s, 'one_off', { oneOff: oneOff }), 2);
});

test('a bad stored value resolves to the default rather than poisoning every load', () => {
    const s = series({ liturgicalIntensity: { preacher: 'heavy' } });
    assert.equal(EventsCore.roleIntensity(s, 'preacher'), 1);
    assert.equal(EventsCore.roleIntensity(series(), 'x', { definition: { intensity: -2 } }), 1);
});

// ── The two modules must agree about what a valid intensity is ───────────────
//
// events-core and roles-core are deliberately independent of one another, so the
// default is stated twice. A duplicated rule is a rule that can drift, and this
// is the same guard already held over RolesCore.inGroup / RelationshipGroupCore
// .belongsTo and over the liturgical field list.

test('the servant path agrees with RolesCore.intensityOf for every case', () => {
    const cases = [undefined, null, 0, 1, 4, 1.25, -1, 'heavy', NaN];
    cases.forEach(value => {
        const definition = { slug: 'setup', intensity: value };
        assert.equal(
            EventsCore.roleIntensity(series(), 'setup', { definition: definition }),
            RolesCore.intensityOf(definition),
            'disagreed about intensity ' + String(value)
        );
    });
});

test('the two modules share one default', () => {
    assert.equal(EventsCore.roleIntensity(series(), 'anything'), RolesCore.DEFAULT_INTENSITY);
});

// ── Validation ───────────────────────────────────────────────────────────────

test('a series carrying a negative liturgical intensity is invalid', () => {
    const s = series({ liturgicalIntensity: { preacher: -1 } });
    const result = EventsCore.validateSeries(s);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /intensity/i);
});

test('a series carrying intensity 0 is valid', () => {
    assert.equal(EventsCore.validateSeries(series({ liturgicalIntensity: { prayer: 0 } })).valid, true);
});

test('a series with no fairness config at all is still valid', () => {
    assert.equal(EventsCore.validateSeries(series()).valid, true);
});

// ── The invariant this design exists to protect ──────────────────────────────

test('liturgical intensity never implies a Role Definition in /roles', () => {
    // The whole reason it lives on the series: a stored definition carrying a
    // liturgical slug would make a locked Role editable, and allRoles refuses
    // one outright rather than merging it.
    const s = series({ liturgicalIntensity: { preacher: 3 } });
    assert.equal(EventsCore.roleIntensity(s, 'preacher'), 3);
    assert.throws(
        () => RolesCore.allRoles([{ name: 'Preacher', slug: 'preacher' }]),
        /liturgical slug/
    );
});
