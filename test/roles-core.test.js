const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');

// A Role Definition is the editable specification of a Servant Role (ADR-0016
// §3): a name plus an ordered set of slots, each requiring male, female, or
// either. Three people needed means three slots — the slot is the unit of
// assignment, not a count paired with a separate sex rule.

const kidsTeam = () => ({
    id: 'r1',
    name: 'Kids Ministry',
    family: Roles.FAMILIES.SERVANT,
    slots: [
        { id: 's1', requirement: Roles.REQUIREMENTS.FEMALE },
        { id: 's2', requirement: Roles.REQUIREMENTS.EITHER },
        { id: 's3', requirement: Roles.REQUIREMENTS.EITHER },
    ],
    restrictions: [],
});

// ── Validation ────────────────────────────────────────────────────────────────

test('a well-formed Role Definition validates', () => {
    const result = Roles.validateDefinition(kidsTeam());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
});

test('a Role Definition needs a non-empty name', () => {
    for (const name of ['', '   ', null, undefined]) {
        const result = Roles.validateDefinition({ ...kidsTeam(), name });
        assert.equal(result.valid, false, `expected "${name}" to be rejected`);
        assert.ok(result.errors.some(e => /name/i.test(e)));
    }
});

test('a Role Definition needs at least one slot', () => {
    const result = Roles.validateDefinition({ ...kidsTeam(), slots: [] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => /slot/i.test(e)));
});

test('every slot requirement must be male, female, or either', () => {
    const def = kidsTeam();
    def.slots[1].requirement = 'any';
    const result = Roles.validateDefinition(def);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => /requirement/i.test(e)));
});

test('a slot with no requirement is rejected rather than silently defaulted', () => {
    const def = kidsTeam();
    delete def.slots[0].requirement;
    assert.equal(Roles.validateDefinition(def).valid, false);
});

test('slots must carry an identifier, so assignments can point at one', () => {
    const def = kidsTeam();
    delete def.slots[2].id;
    const result = Roles.validateDefinition(def);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => /id/i.test(e)));
});

test('duplicate slot ids are rejected', () => {
    const def = kidsTeam();
    def.slots[2].id = def.slots[0].id;
    assert.equal(Roles.validateDefinition(def).valid, false);
});

// ── The two families ──────────────────────────────────────────────────────────

test('a Role Definition authored here belongs to the servant family', () => {
    assert.equal(Roles.newDefinition('Coffee').family, Roles.FAMILIES.SERVANT);
});

test('a Role Definition may not claim the liturgical family', () => {
    // Liturgical Roles are code-defined and locked (MS-25); a user-authored
    // definition claiming that family would forge a locked Role.
    const result = Roles.validateDefinition({
        ...kidsTeam(),
        family: Roles.FAMILIES.LITURGICAL,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => /family/i.test(e)));
});

test('a new Role Definition starts with one either-slot and validates', () => {
    const def = Roles.newDefinition('Setup');
    assert.equal(def.name, 'Setup');
    assert.equal(def.slots.length, 1);
    assert.equal(def.slots[0].requirement, Roles.REQUIREMENTS.EITHER);
    assert.equal(Roles.validateDefinition(def).valid, true);
});

// ── Slot helpers: ordered, stable, non-mutating ───────────────────────────────

test('slots keep the order they were authored in', () => {
    const def = kidsTeam();
    assert.deepEqual(def.slots.map(s => s.requirement), ['female', 'either', 'either']);
    assert.deepEqual(Roles.slotOrder(def), ['s1', 's2', 's3']);
});

test('adding a slot appends it and leaves the original untouched', () => {
    const before = kidsTeam();
    const after = Roles.addSlot(before, Roles.REQUIREMENTS.MALE);

    assert.equal(before.slots.length, 3, 'original must not be mutated');
    assert.equal(after.slots.length, 4);
    assert.equal(after.slots[3].requirement, Roles.REQUIREMENTS.MALE);
    assert.notEqual(after, before);
});

test('an added slot gets an id that no existing slot uses', () => {
    const def = Roles.addSlot(kidsTeam(), Roles.REQUIREMENTS.MALE);
    const ids = def.slots.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length);
});

test('slot ids stay unique even after a middle slot is removed', () => {
    // Removing s2 then adding must not re-issue s2 — an old assignment could
    // still point at it, and the new slot would silently inherit that person.
    let def = Roles.removeSlot(kidsTeam(), 's2');
    def = Roles.addSlot(def, Roles.REQUIREMENTS.EITHER);
    assert.equal(def.slots.filter(s => s.id === 's2').length, 0);
    assert.equal(Roles.validateDefinition(def).valid, true);
});

test('removing a slot drops exactly that slot and leaves the original untouched', () => {
    const before = kidsTeam();
    const after = Roles.removeSlot(before, 's2');

    assert.equal(before.slots.length, 3, 'original must not be mutated');
    assert.deepEqual(after.slots.map(s => s.id), ['s1', 's3']);
});

test('removing a slot that is not there changes nothing', () => {
    const before = kidsTeam();
    const after = Roles.removeSlot(before, 'nope');
    assert.deepEqual(after.slots.map(s => s.id), ['s1', 's2', 's3']);
});

test('reordering slots changes their order but not their identity', () => {
    const before = kidsTeam();
    const after = Roles.reorderSlots(before, 0, 2);

    assert.deepEqual(after.slots.map(s => s.id), ['s2', 's3', 's1']);
    assert.deepEqual(before.slots.map(s => s.id), ['s1', 's2', 's3'], 'original untouched');
    // The female requirement travels with the slot, not with the position.
    assert.equal(after.slots[2].requirement, Roles.REQUIREMENTS.FEMALE);
});

test('reordering to the same position is a no-op', () => {
    const after = Roles.reorderSlots(kidsTeam(), 1, 1);
    assert.deepEqual(after.slots.map(s => s.id), ['s1', 's2', 's3']);
});

test('reordering with an out-of-range index leaves the order alone', () => {
    for (const [from, to] of [[-1, 1], [0, 9], [5, 0]]) {
        const after = Roles.reorderSlots(kidsTeam(), from, to);
        assert.deepEqual(after.slots.map(s => s.id), ['s1', 's2', 's3']);
    }
});

test('changing a slot requirement leaves the slot id and position alone', () => {
    const after = Roles.setSlotRequirement(kidsTeam(), 's2', Roles.REQUIREMENTS.MALE);
    assert.deepEqual(after.slots.map(s => s.id), ['s1', 's2', 's3']);
    assert.equal(after.slots[1].requirement, Roles.REQUIREMENTS.MALE);
});

test('a slot requirement cannot be set to something outside the three values', () => {
    assert.throws(
        () => Roles.setSlotRequirement(kidsTeam(), 's2', 'any'),
        /requirement/i
    );
});

// ── How many people a Role needs ──────────────────────────────────────────────

test('the number of people a Role needs is its slot count', () => {
    assert.equal(Roles.slotCount(kidsTeam()), 3);
});

// ── Who may even be offered for a Role ────────────────────────────────────────
//
// Distinct from ELIGIBILITY, and the difference matters. An ineligible Person is
// SHOWN, blocked, with a reason — seeing who was passed over is the whole point
// of that screen. Somebody who has left, or whom this viewer is not allowed to
// see at all, is a different thing: they are not a candidate who lost, they are
// not a candidate. Showing them blocked would be an answer to a question nobody
// asked, and for a hidden Person it would leak the name the tag exists to hide.

const HIDDEN_TAG = 'safeguarding';

test('somebody no longer active is not offered at all', () => {
    const people = [
        { id: 'p1', name: 'Dave Rowe' },
        { id: 'p2', name: 'Gone Away', membership: { inactive: true } },
        { id: 'p3', name: 'Also Gone', membership: { status: 'inactive' } },
    ];
    const offered = Roles.assignablePeople(people, { rank: 'editor' });
    assert.deepStrictEqual(offered.map(p => p.id), ['p1']);
});

test('a Person hidden by a tag is not offered to an editor', () => {
    // The tag exists to keep them out of sight. A blocked row saying "already
    // serving here" would still print their name.
    const people = [
        { id: 'p1', name: 'Dave Rowe' },
        { id: 'p2', name: 'Private Person', tags: [HIDDEN_TAG] },
    ];
    const opts = { rank: 'editor', hidingTags: [HIDDEN_TAG] };
    assert.deepStrictEqual(Roles.assignablePeople(people, opts).map(p => p.id), ['p1']);
});

test('an elder sees the hidden Person, because the tag hides them from everyone else', () => {
    const people = [
        { id: 'p1', name: 'Dave Rowe' },
        { id: 'p2', name: 'Private Person', tags: [HIDDEN_TAG] },
    ];
    ['elder', 'super_admin'].forEach(rank => {
        assert.deepStrictEqual(
            Roles.assignablePeople(people, { rank: rank, hidingTags: [HIDDEN_TAG] }).map(p => p.id),
            ['p1', 'p2'], rank + ' lost sight of a hidden Person');
    });
});

test('an elder still does not get somebody who has left', () => {
    // Hiding is about who may look. Inactive is about whether they are here at
    // all, and no rank changes that.
    const people = [{ id: 'p2', name: 'Gone Away', membership: { inactive: true } }];
    assert.deepStrictEqual(Roles.assignablePeople(people, { rank: 'super_admin' }), []);
});

test('the shepherding system can hide somebody on its own', () => {
    const people = [
        { id: 'p1', name: 'Dave Rowe' },
        { id: 'p2', name: 'Sensitive', shepherdingHidden: true },
    ];
    assert.deepStrictEqual(
        Roles.assignablePeople(people, { rank: 'editor' }).map(p => p.id), ['p1']);
});

// ── Somebody who does not serve ─────────────────────────────────────────────
//
// The youngest children, anyone too frail, anyone in a season of not serving.
// Absolute like Inactive: not a candidate who lost, so there is no reason to
// show and no warning to leave.

test('somebody who does not serve is never offered a Role', () => {
    const people = [
        { id: 'p1', name: 'Dave Rowe' },
        { id: 'p2', name: 'Small Child', doesNotServe: true },
    ];
    assert.deepStrictEqual(
        Roles.assignablePeople(people, { rank: 'editor' }).map(p => p.id), ['p1']);
});

// ⚠ ABOVE THE ELDER BYPASS. That bypass exists because hiding tags hide people
// from everyone else FOR elders — a privacy rule. This is not one, and a
// four-year-old is not offered for coffee to an elder either.
test('no rank sees past somebody who does not serve', () => {
    const people = [{ id: 'p2', name: 'Small Child', doesNotServe: true }];

    ['editor', 'admin', 'elder', 'super_admin'].forEach(rank => {
        assert.deepStrictEqual(Roles.assignablePeople(people, { rank: rank }), [],
            rank + ' was offered somebody who does not serve');
    });
});

// It is not a privacy setting and it hides nobody — which is the whole reason
// it is a field of its own rather than one more hiding tag.
test('not serving is one flag, and nothing else about the Person', () => {
    assert.equal(Roles.doesNotServe({ id: 'p1', doesNotServe: true }), true);
    assert.equal(Roles.doesNotServe({ id: 'p1' }), false);
    assert.equal(Roles.doesNotServe({ id: 'p1', doesNotServe: false }), false);
    assert.equal(Roles.doesNotServe(null), false);
    assert.equal(Roles.doesNotServe({ id: 'p1', shepherdingHidden: true }), false,
        'hidden and not-serving are different facts');
});

test('with no hiding tags configured, everybody active is offered', () => {
    const people = [{ id: 'p1', tags: ['member'] }, { id: 'p2' }];
    assert.deepStrictEqual(Roles.assignablePeople(people, { rank: 'editor' }).map(p => p.id),
        ['p1', 'p2']);
    assert.deepStrictEqual(Roles.assignablePeople(people, {}).map(p => p.id), ['p1', 'p2']);
    assert.deepStrictEqual(Roles.assignablePeople(null, {}), []);
});
