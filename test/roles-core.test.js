const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');

// A Role Definition is a Servant Role's name and what it involves (ADR 0085).
// Who it needs (its slots), its rules and its rest are each Event's, and the
// Role an Event seats is EventsCore.effectiveRole of the two.

const kidsTeam = () => ({
    id: 'r1',
    name: 'Kids Ministry',
    slug: 'kids_ministry',
    family: Roles.FAMILIES.SERVANT,
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

test('a Role Definition is not judged on seats it no longer owns', () => {
    // A Role stored before ADR 0085 may still carry old slots until they are
    // stripped; they are the Event's business now, and say nothing here.
    assert.equal(Roles.validateDefinition({ ...kidsTeam(), slots: [] }).valid, true);
    assert.equal(Roles.validateDefinition({ ...kidsTeam(), slots: [{ requirement: 'any' }] }).valid, true);
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

test('a new Role Definition is its name and what it involves, and validates', () => {
    // Who it needs, its rules and its rest are each Event's (ADR 0085).
    const def = Roles.newDefinition('Setup');
    assert.equal(def.name, 'Setup');
    assert.deepEqual(Object.keys(def).sort(), ['description', 'family', 'name', 'slug']);
    assert.equal(Roles.validateDefinition(def).valid, true);
});

// ── How many people a Role needs ──────────────────────────────────────────────

test('the number of people a Role needs is its slot count', () => {
    assert.equal(Roles.slotCount({ slots: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] }), 3);
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
        { id: 'p3', name: 'Also Gone', membership: { inactive: true } },
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

test('a tag marked hidden is not shown to anyone below an elder', () => {
    // Two separate flags: `hidePeople` hides who carries the tag, and
    // `hiddenFromOthers` hides the tag itself. This is the second one.
    const tags = [
        { id: 't1', name: 'Kids Cleared' },
        { id: 't2', name: 'Under Discipline', hiddenFromOthers: true },
    ];
    ['editor', 'admin', 'member', undefined].forEach(rank => {
        assert.deepStrictEqual(Roles.visibleTags(tags, rank).map(t => t.id), ['t1'],
            String(rank) + ' was shown a hidden tag');
    });
    ['elder', 'super_admin'].forEach(rank => {
        assert.deepStrictEqual(Roles.visibleTags(tags, rank).map(t => t.id), ['t1', 't2'],
            rank + ' lost sight of a hidden tag');
    });
    assert.deepStrictEqual(Roles.visibleTags(null, 'editor'), []);
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
