const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');

// The three fields fairness reads off a Role (MS-17, ADR-0020):
//
//   • intensity          — the rest the job owes, in weeks. Sound is 1, setup is 4.
//   • allowsAnotherRole  — whether doing it leaves you free for a second Role.
//   • allowlist          — the named handful who may do it at all.
//
// The first is a number this module only stores and validates; resolving it
// across its three storage homes belongs to events-core, because two of those
// homes are the Event series and the Event. The other two are ELIGIBILITY, and
// live here so the manual picker obeys them exactly as the solver does.

const person = (id, extra) => Object.assign({ id: id, name: id, tags: [] }, extra);

const alice = person('alice', { sex: 'female' });
const brenda = person('brenda', { sex: 'female' });
const carl = person('carl', { sex: 'male' });

const eitherSlot = { id: 's1', requirement: Roles.REQUIREMENTS.EITHER };

const roleWith = extra => Object.assign({
    id: 'r1',
    name: 'Coffee',
    family: Roles.FAMILIES.SERVANT,
    slots: [eitherSlot],
    restrictions: [],
}, extra || {});

const resultFor = (results, id) => results.find(r => r.personId === id);
const eligibleIds = results => results.filter(r => r.eligible).map(r => r.personId);

// ── Intensity ────────────────────────────────────────────────────────────────

test('a Role Definition with no intensity reads as 1', () => {
    assert.equal(Roles.intensityOf(roleWith()), 1);
});

test('a Role Definition carries its own intensity', () => {
    assert.equal(Roles.intensityOf(roleWith({ intensity: 4 })), 4);
});

test('intensity is a float, so a Role can cost slightly more than a week', () => {
    assert.equal(Roles.intensityOf(roleWith({ intensity: 1.25 })), 1.25);
});

test('intensity 0 is a real value, not an absent one — the job is free', () => {
    assert.equal(Roles.intensityOf(roleWith({ intensity: 0 })), 0);
});

test('a nonsense intensity reads as the default rather than poisoning every load', () => {
    assert.equal(Roles.intensityOf(roleWith({ intensity: 'heavy' })), 1);
    assert.equal(Roles.intensityOf(roleWith({ intensity: null })), 1);
});

test('a definition with a negative intensity is invalid', () => {
    const result = Roles.validateDefinition(roleWith({ intensity: -1 }));
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /intensity/i);
});

test('a definition with intensity 0 is valid', () => {
    assert.equal(Roles.validateDefinition(roleWith({ intensity: 0 })).valid, true);
});

test('a definition with a non-numeric intensity is invalid', () => {
    assert.equal(Roles.validateDefinition(roleWith({ intensity: 'heavy' })).valid, false);
});

// ── Exclusivity ──────────────────────────────────────────────────────────────
//
// Exclusive is the DEFAULT and the assumption. This reverses what candidatesFor
// used to do — it deliberately allowed two Roles the same morning, which was
// reasonable when a human with the whole Sunday in view was choosing, and is
// not when a solver is.

const exclusive = roleWith({ name: 'Setup' });
const permissive = roleWith({ name: 'Greeting', allowsAnotherRole: true });

// Who is seated in OTHER Roles at this occurrence, and whether each of those
// Roles leaves them free. Distinct from `assigned`, which is this Role's own
// seats — the relationship rules stay scoped to one Role.
const elsewhere = seats => seats.map(s => ({
    personId: s.personId,
    roleSlug: s.roleSlug || 'setup',
    allowsAnotherRole: s.allowsAnotherRole === true,
}));

test('holding an exclusive Role elsewhere blocks you from this one', () => {
    const results = Roles.candidatesFor(exclusive, eitherSlot, {
        people: [alice, brenda],
        assigned: [],
        assignedElsewhere: elsewhere([{ personId: 'alice', roleSlug: 'sound' }]),
    });

    assert.deepEqual(eligibleIds(results), ['brenda']);
    assert.equal(resultFor(results, 'alice').reason, Roles.REASONS.SERVING_ELSEWHERE);
});

test('the block names the Role that has them, so the picker can say which', () => {
    const results = Roles.candidatesFor(exclusive, eitherSlot, {
        people: [alice],
        assigned: [],
        assignedElsewhere: elsewhere([{ personId: 'alice', roleSlug: 'sound' }]),
    });
    assert.equal(resultFor(results, 'alice').roleSlug, 'sound');
});

test('two permissive Roles may be held together', () => {
    const results = Roles.candidatesFor(permissive, eitherSlot, {
        people: [alice],
        assigned: [],
        assignedElsewhere: elsewhere([
            { personId: 'alice', roleSlug: 'welcome', allowsAnotherRole: true },
        ]),
    });
    assert.deepEqual(eligibleIds(results), ['alice']);
});

test('a permissive Role does not rescue you from an exclusive one you already hold', () => {
    const results = Roles.candidatesFor(permissive, eitherSlot, {
        people: [alice],
        assigned: [],
        assignedElsewhere: elsewhere([{ personId: 'alice', roleSlug: 'setup' }]),
    });
    assert.equal(resultFor(results, 'alice').eligible, false);
});

test('an exclusive Role is refused even when everything you hold is permissive', () => {
    const results = Roles.candidatesFor(exclusive, eitherSlot, {
        people: [alice],
        assigned: [],
        assignedElsewhere: elsewhere([
            { personId: 'alice', roleSlug: 'welcome', allowsAnotherRole: true },
        ]),
    });
    assert.equal(resultFor(results, 'alice').eligible, false);
});

test('two is the ceiling — a third permissive Role is refused', () => {
    const results = Roles.candidatesFor(permissive, eitherSlot, {
        people: [alice],
        assigned: [],
        assignedElsewhere: elsewhere([
            { personId: 'alice', roleSlug: 'welcome', allowsAnotherRole: true },
            { personId: 'alice', roleSlug: 'greeting', allowsAnotherRole: true },
        ]),
    });
    assert.equal(resultFor(results, 'alice').eligible, false);
});

test('nobody seated elsewhere means nobody is blocked by exclusivity', () => {
    const results = Roles.candidatesFor(exclusive, eitherSlot, {
        people: [alice, brenda],
        assigned: [],
        assignedElsewhere: [],
    });
    assert.deepEqual(eligibleIds(results), ['alice', 'brenda']);
});

test('an omitted assignedElsewhere is treated as empty, not as everyone busy', () => {
    const results = Roles.candidatesFor(exclusive, eitherSlot, {
        people: [alice],
        assigned: [],
    });
    assert.equal(resultFor(results, 'alice').eligible, true);
});

// ── Allowlist ────────────────────────────────────────────────────────────────
//
// A restriction rather than a Tag: this is a fact about the ROLE, not about the
// person, and a Shepherding Tag is a pastoral concept. Living in restrictions[]
// is what makes hand-assignment obey it for free.

const withAllowlist = ids => roleWith({
    restrictions: [{ kind: Roles.RESTRICTIONS.ALLOWLIST, personIds: ids }],
});

test('only people on the allowlist may fill the Role', () => {
    const results = Roles.candidatesFor(withAllowlist(['alice', 'carl']), eitherSlot, {
        people: [alice, brenda, carl],
        assigned: [],
    });

    assert.deepEqual(eligibleIds(results), ['alice', 'carl']);
    assert.equal(resultFor(results, 'brenda').reason, Roles.REASONS.NOT_ON_ALLOWLIST);
});

test('someone off the allowlist is SHOWN and blocked, never silently dropped', () => {
    const results = Roles.candidatesFor(withAllowlist(['alice']), eitherSlot, {
        people: [alice, brenda],
        assigned: [],
    });
    assert.equal(results.length, 2);
});

test('a Role with no allowlist rule is open to everyone', () => {
    const results = Roles.candidatesFor(roleWith(), eitherSlot, {
        people: [alice, brenda, carl],
        assigned: [],
    });
    assert.deepEqual(eligibleIds(results), ['alice', 'brenda', 'carl']);
});

test('the allowlist composes with other restrictions rather than replacing them', () => {
    const role = roleWith({
        slots: [{ id: 's1', requirement: Roles.REQUIREMENTS.FEMALE }],
        restrictions: [{ kind: Roles.RESTRICTIONS.ALLOWLIST, personIds: ['alice', 'carl'] }],
    });
    const results = Roles.candidatesFor(role, role.slots[0], {
        people: [alice, brenda, carl],
        assigned: [],
    });
    // Carl is allowlisted but the slot needs a woman; Brenda is a woman but not
    // allowlisted. Only Alice satisfies both.
    assert.deepEqual(eligibleIds(results), ['alice']);
});

test('an empty allowlist is refused at authoring time, not left to empty a rota', () => {
    const rule = { kind: Roles.RESTRICTIONS.ALLOWLIST, personIds: [] };
    const result = Roles.validateRestriction(rule, []);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /at least one person|empty|nobody/i);
});

test('an allowlist with no personIds at all is refused the same way', () => {
    assert.equal(Roles.validateRestriction({ kind: Roles.RESTRICTIONS.ALLOWLIST }, []).valid, false);
});

test('a populated allowlist is valid and needs no Relationship Type', () => {
    const rule = { kind: Roles.RESTRICTIONS.ALLOWLIST, personIds: ['alice'] };
    assert.equal(Roles.validateRestriction(rule, []).valid, true);
});

test('a definition carrying an empty allowlist is invalid', () => {
    const def = withAllowlist([]);
    assert.equal(Roles.validateDefinition(def).valid, false);
});

// ── The two stay separate ────────────────────────────────────────────────────

test('intensity and exclusivity are independent — a light job can still occupy you', () => {
    // Sound: easy work, but you are stuck at the desk all morning.
    const sound = roleWith({ name: 'Sound', intensity: 1 });
    assert.equal(Roles.intensityOf(sound), 1);

    const results = Roles.candidatesFor(sound, eitherSlot, {
        people: [alice],
        assigned: [],
        assignedElsewhere: elsewhere([{ personId: 'alice', roleSlug: 'coffee' }]),
    });
    assert.equal(resultFor(results, 'alice').eligible, false);
});
