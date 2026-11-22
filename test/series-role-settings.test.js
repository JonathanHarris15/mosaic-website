const { test } = require('node:test');
const assert = require('node:assert');

const Events = require('../public/events-core.js');

// Who a Role needs, who may fill it, how much rest it owes and whether it uses
// up the morning belong to the EVENT that runs the Role, not to the Role: Setup
// needs two men on a Sunday and one of anybody on a Wednesday. The Role keeps
// its name and what it involves.
//
// A series stores its own answer per Role in `roleSettings`, and only that is
// read. A Role Definition stored before ADR 0085 may still carry old copies of
// these fields until they are stripped; they must never be read again.

const definition = () => ({
    slug: 'setup',
    name: 'Setup & Teardown',
    description: 'Chairs out by 9:30.',
    slots: [{ id: 's1', requirement: 'male' }, { id: 's2', requirement: 'male' }],
    nextSlotSeq: 3,
    restrictions: [{ kind: 'excludeTag', tagId: 't-new' }],
    intensity: 2,
    allowsAnotherRole: true,
});

/** @param {*} extra */
const series = extra => Object.assign(
    { id: 'midweek', name: 'Midweek', roleSlugs: ['setup', 'coffee'] }, extra || {}
);

test('with no settings of its own, the event needs nobody — the Role’s old copies are not read', () => {
    const role = Events.effectiveRole(series(), definition());
    ['slots', 'nextSlotSeq', 'restrictions', 'intensity', 'allowsAnotherRole'].forEach(field => {
        assert.equal(role[field], undefined, field + ' came from the Role Definition');
    });
    assert.equal(role.name, 'Setup & Teardown');
});

test('a field the event has not set is absent, not borrowed from the Role', () => {
    const s = series({ roleSettings: { setup: { slots: [{ id: 's1' }] } } });
    const role = Events.effectiveRole(s, definition());
    assert.deepEqual(role.slots, [{ id: 's1' }]);
    assert.equal(role.restrictions, undefined);
    assert.equal(role.intensity, undefined);
});

test('the event’s own settings win, field by field', () => {
    const s = series({ roleSettings: { setup: {
        slots: [{ id: 's1' }],
        nextSlotSeq: 3,
        restrictions: [],
        intensity: 1,
        allowsAnotherRole: false,
    } } });
    const role = Events.effectiveRole(s, definition());
    assert.deepEqual(role.slots, [{ id: 's1' }]);
    assert.deepEqual(role.restrictions, []);
    assert.equal(role.intensity, 1);
    assert.equal(role.allowsAnotherRole, false);
});

test('the Role keeps its own name, slug and description on every event', () => {
    const s = series({ roleSettings: { setup: { slots: [{ id: 's1' }] } } });
    const role = Events.effectiveRole(s, definition());
    assert.equal(role.slug, 'setup');
    assert.equal(role.name, 'Setup & Teardown');
    assert.equal(role.description, 'Chairs out by 9:30.');
});

test('effectiveRole never changes the definition or the series it was given', () => {
    const def = definition();
    const s = series({ roleSettings: { setup: { intensity: 5 } } });
    Events.effectiveRole(s, def);
    assert.deepEqual(def, definition());
    assert.equal(s.roleSettings.setup.intensity, 5);
});

test('no series means no settings, never the definition’s old ones', () => {
    const role = Events.effectiveRole(null, definition());
    assert.equal(role.slots, undefined);
    assert.equal(role.slug, 'setup');
});

test('rolesFor maps a list of definitions to this event’s version of each', () => {
    const s = series({ roleSettings: { setup: { intensity: 4 } } });
    const roles = Events.rolesFor(s, [definition(), { slug: 'coffee', slots: [{ id: 's1' }] }]);
    assert.equal(roles[0].intensity, 4);
    assert.equal(roles[1].slug, 'coffee');
});

// ── Starting an event's own settings ─────────────────────────────────────────

test('withRoleSettings stores one Role’s settings and leaves the rest', () => {
    const s = series({ roleSettings: { coffee: { intensity: 2 } } });
    const next = Events.withRoleSettings(s, 'setup', { intensity: 3 });
    assert.equal(next.roleSettings.setup.intensity, 3);
    assert.equal(next.roleSettings.coffee.intensity, 2);
    assert.equal(s.roleSettings.setup, undefined);
});

test('taking a Role off an event takes its settings with it', () => {
    // Same reasoning as the rules across Roles: put Setup back a year later and
    // it should start fresh, not from settings nobody remembers.
    const s = series({ roleSettings: { setup: { intensity: 3 }, coffee: { intensity: 2 } } });
    const next = Events.removeRole(s, 'setup');
    assert.equal(next.roleSettings.setup, undefined);
    assert.equal(next.roleSettings.coffee.intensity, 2);
});

// ── Rest resolves through the event first ───────────────────────────────────

test('rest: the event’s own value wins over the definition', () => {
    const s = series({ roleSettings: { setup: { intensity: 5 } } });
    assert.equal(Events.roleIntensity(s, 'setup', { definition: definition() }), 5);
});

test('rest: with nothing on the event it is the default, whatever the Role still carries', () => {
    assert.equal(Events.roleIntensity(series(), 'setup', { definition: definition() }), 1);
});

test('rest: a one-off Role still answers for itself', () => {
    const s = series({ roleSettings: { setup: { intensity: 5 } } });
    assert.equal(Events.roleIntensity(s, 'setup', { oneOff: { intensity: 0.5 } }), 0.5);
});

// ── Validation ───────────────────────────────────────────────────────────────

test('a stored setting with no places is refused', () => {
    const s = series({ roleSettings: { setup: { slots: [] } } });
    const result = Events.validateSeries(s);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /at least one person/i);
});

test('a stored setting with a place that has no id, or bad rest, is refused', () => {
    const s = series({ roleSettings: { setup: {
        slots: [{ requirement: 'either' }], intensity: -1,
    } } });
    const errors = Events.validateSeries(s).errors.join(' ');
    assert.match(errors, /needs an id/i);
    assert.match(errors, /number of weeks/i);
});

test('settings for a Role the event does not carry are refused', () => {
    const s = series({ roleSettings: { sound: { intensity: 1 } } });
    assert.match(Events.validateSeries(s).errors.join(' '), /not carried/i);
});
