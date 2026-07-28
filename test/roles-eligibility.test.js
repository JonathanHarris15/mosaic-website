const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');

// Who may fill a slot (ADR-0016 §3). Restrictions are expressed against data the
// app already has — Shepherding Tags and the Relationship graph — never a new
// store. Eligibility answers per Person with a REASON, because the Roles tab and
// auto-assign both have to tell the user why someone was passed over.

const person = (id, extra) => Object.assign({ id: id, name: id, tags: [] }, extra);

const alice = person('alice', { sex: 'female', tags: ['kids-cleared'] });
const brenda = person('brenda', { sex: 'female', tags: ['kids-cleared'] });
const carl = person('carl', { sex: 'male', tags: ['kids-cleared'] });
const dan = person('dan', { sex: 'male', tags: [] });
const erin = person('erin', {}); // sex never recorded
const frank = person('frank', {
    sex: 'male',
    tags: ['kids-cleared'],
    membership: { inactive: true },
});

const EVERYONE = [alice, brenda, carl, dan, erin, frank];

// Alice and Carl are married; the type id is whatever the church called it.
const MARRIAGE = 'type-marriage';
const relationships = [{ fromId: 'carl', toId: 'alice', typeId: MARRIAGE }];

const roleWith = (slots, restrictions) => ({
    id: 'r1',
    name: 'Kids Ministry',
    family: Roles.FAMILIES.SERVANT,
    slots: slots,
    restrictions: restrictions || [],
});

const eitherSlot = { id: 's1', requirement: Roles.REQUIREMENTS.EITHER };
const femaleSlot = { id: 's2', requirement: Roles.REQUIREMENTS.FEMALE };
const maleSlot = { id: 's3', requirement: Roles.REQUIREMENTS.MALE };

// Convenience: the ids judged eligible, in candidate order.
const eligibleIds = results => results.filter(r => r.eligible).map(r => r.personId);
const resultFor = (results, id) => results.find(r => r.personId === id);

// ── A slot's sex requirement ──────────────────────────────────────────────────

test('an either-slot admits people of either recorded sex', () => {
    const results = Roles.candidatesFor(roleWith([eitherSlot]), eitherSlot, {
        people: [alice, carl],
    });
    assert.deepEqual(eligibleIds(results), ['alice', 'carl']);
});

test('a female slot admits only women', () => {
    const results = Roles.candidatesFor(roleWith([femaleSlot]), femaleSlot, {
        people: [alice, carl],
    });
    assert.deepEqual(eligibleIds(results), ['alice']);
    assert.equal(resultFor(results, 'carl').reason, Roles.REASONS.SEX_MISMATCH);
});

test('a male slot admits only men', () => {
    const results = Roles.candidatesFor(roleWith([maleSlot]), maleSlot, {
        people: [alice, carl],
    });
    assert.deepEqual(eligibleIds(results), ['carl']);
});

test('a Person with no recorded sex is ineligible for a sexed slot', () => {
    const results = Roles.candidatesFor(roleWith([femaleSlot]), femaleSlot, {
        people: [erin],
    });
    assert.equal(resultFor(results, 'erin').eligible, false);
    assert.equal(resultFor(results, 'erin').reason, Roles.REASONS.SEX_UNKNOWN);
});

test('a Person with no recorded sex is still eligible for an either-slot', () => {
    const results = Roles.candidatesFor(roleWith([eitherSlot]), eitherSlot, {
        people: [erin],
    });
    assert.equal(resultFor(results, 'erin').eligible, true);
});

// ── Inactive ──────────────────────────────────────────────────────────────────

test('an Inactive Person is never proposed', () => {
    const results = Roles.candidatesFor(roleWith([eitherSlot]), eitherSlot, {
        people: [frank],
    });
    assert.equal(resultFor(results, 'frank').eligible, false);
    assert.equal(resultFor(results, 'frank').reason, Roles.REASONS.INACTIVE);
});

test('the legacy inactive status is honoured as well as the flag', () => {
    // CONTEXT.md: `membership.inactive` replaced `membership.status: 'inactive'`.
    // Read both, so eligibility is right before every record is migrated.
    const legacy = person('legacy', { sex: 'male', membership: { status: 'inactive' } });
    const results = Roles.candidatesFor(roleWith([eitherSlot]), eitherSlot, {
        people: [legacy],
    });
    assert.equal(resultFor(results, 'legacy').eligible, false);
    assert.equal(resultFor(results, 'legacy').reason, Roles.REASONS.INACTIVE);
});

test('Inactive outranks every other reason, so the user sees the real cause', () => {
    const role = roleWith([femaleSlot], [
        { kind: Roles.RESTRICTIONS.REQUIRE_TAG, tagId: 'nobody-has-this' },
    ]);
    // Frank is Inactive AND the wrong sex AND missing the tag.
    const results = Roles.candidatesFor(role, femaleSlot, { people: [frank] });
    assert.equal(resultFor(results, 'frank').reason, Roles.REASONS.INACTIVE);
});

// ── Tag restrictions ──────────────────────────────────────────────────────────

test('a require-tag restriction admits only people carrying that Tag', () => {
    const role = roleWith([eitherSlot], [
        { kind: Roles.RESTRICTIONS.REQUIRE_TAG, tagId: 'kids-cleared' },
    ]);
    const results = Roles.candidatesFor(role, eitherSlot, { people: [alice, dan] });

    assert.deepEqual(eligibleIds(results), ['alice']);
    assert.equal(resultFor(results, 'dan').reason, Roles.REASONS.MISSING_REQUIRED_TAG);
    assert.equal(resultFor(results, 'dan').tagId, 'kids-cleared',
        'the reason names the tag, so the UI can say which one');
});

test('an exclude-tag restriction rejects people carrying that Tag', () => {
    const role = roleWith([eitherSlot], [
        { kind: Roles.RESTRICTIONS.EXCLUDE_TAG, tagId: 'kids-cleared' },
    ]);
    const results = Roles.candidatesFor(role, eitherSlot, { people: [alice, dan] });

    assert.deepEqual(eligibleIds(results), ['dan']);
    assert.equal(resultFor(results, 'alice').reason, Roles.REASONS.EXCLUDED_BY_TAG);
});

test('several tag restrictions all have to pass', () => {
    const role = roleWith([eitherSlot], [
        { kind: Roles.RESTRICTIONS.REQUIRE_TAG, tagId: 'kids-cleared' },
        { kind: Roles.RESTRICTIONS.EXCLUDE_TAG, tagId: 'on-sabbatical' },
    ]);
    const resting = person('resting', { sex: 'female', tags: ['kids-cleared', 'on-sabbatical'] });
    const results = Roles.candidatesFor(role, eitherSlot, { people: [alice, resting] });

    assert.deepEqual(eligibleIds(results), ['alice']);
});

test('a Role with no restrictions admits everyone active', () => {
    const results = Roles.candidatesFor(roleWith([eitherSlot]), eitherSlot, { people: EVERYONE });
    assert.deepEqual(eligibleIds(results), ['alice', 'brenda', 'carl', 'dan', 'erin']);
});

// ── Relationship restrictions: who may not serve alongside whom ───────────────

test('two people joined by the named Relationship may not fill the same Role', () => {
    const role = roleWith([femaleSlot, maleSlot], [
        { kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: MARRIAGE },
    ]);
    // Alice already holds the female slot; Carl is her husband.
    const results = Roles.candidatesFor(role, maleSlot, {
        people: [carl, dan],
        relationships: relationships,
        assigned: [{ slotId: 's2', personId: 'alice' }],
    });

    assert.deepEqual(eligibleIds(results), ['dan']);
    assert.equal(resultFor(results, 'carl').reason, Roles.REASONS.RELATIONSHIP_CONFLICT);
    assert.equal(resultFor(results, 'carl').conflictsWith, 'alice',
        'the reason names who they clash with');
});

test('the relationship conflict holds whichever way round the edge is stored', () => {
    const role = roleWith([femaleSlot, maleSlot], [
        { kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: MARRIAGE },
    ]);
    // The stored edge is carl -> alice; here Carl is seated and Alice is the candidate.
    const results = Roles.candidatesFor(role, femaleSlot, {
        people: [alice, brenda],
        relationships: relationships,
        assigned: [{ slotId: 's3', personId: 'carl' }],
    });

    assert.deepEqual(eligibleIds(results), ['brenda']);
});

test('a relationship of some other type is no obstacle', () => {
    const role = roleWith([femaleSlot, maleSlot], [
        { kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: MARRIAGE },
    ]);
    const results = Roles.candidatesFor(role, maleSlot, {
        people: [carl],
        relationships: [{ fromId: 'carl', toId: 'alice', typeId: 'type-friendship' }],
        assigned: [{ slotId: 's2', personId: 'alice' }],
    });
    assert.deepEqual(eligibleIds(results), ['carl']);
});

test('with nobody else seated yet, a relationship restriction blocks nobody', () => {
    const role = roleWith([femaleSlot, maleSlot], [
        { kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: MARRIAGE },
    ]);
    const results = Roles.candidatesFor(role, maleSlot, {
        people: [carl, dan],
        relationships: relationships,
        assigned: [],
    });
    assert.deepEqual(eligibleIds(results), ['carl', 'dan']);
});

test('the restriction is scoped to this Role — a spouse serving elsewhere is fine', () => {
    const role = roleWith([femaleSlot, maleSlot], [
        { kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: MARRIAGE },
    ]);
    // `assigned` carries only this Role's seats on this Event, so Alice being on
    // Coffee the same morning never reaches here.
    const results = Roles.candidatesFor(role, maleSlot, {
        people: [carl],
        relationships: relationships,
        assigned: [],
    });
    assert.deepEqual(eligibleIds(results), ['carl']);
});

// ── One person, one slot ──────────────────────────────────────────────────────

test('somebody already seated in this Role is not offered a second slot', () => {
    const role = roleWith([eitherSlot, femaleSlot]);
    const results = Roles.candidatesFor(role, femaleSlot, {
        people: [alice, brenda],
        assigned: [{ slotId: 's1', personId: 'alice' }],
    });

    assert.deepEqual(eligibleIds(results), ['brenda']);
    assert.equal(resultFor(results, 'alice').reason, Roles.REASONS.ALREADY_ASSIGNED);
});

test('the person seated in THIS slot is still offered, so re-picking them is a no-op', () => {
    const role = roleWith([eitherSlot, femaleSlot]);
    const results = Roles.candidatesFor(role, femaleSlot, {
        people: [alice],
        assigned: [{ slotId: 's2', personId: 'alice' }],
    });
    assert.equal(resultFor(results, 'alice').eligible, true);
});

// ── Shape of the answer ───────────────────────────────────────────────────────

test('every candidate comes back, eligible or not, so the UI can grey them out', () => {
    const role = roleWith([femaleSlot], [
        { kind: Roles.RESTRICTIONS.REQUIRE_TAG, tagId: 'kids-cleared' },
    ]);
    const results = Roles.candidatesFor(role, femaleSlot, { people: EVERYONE });

    assert.equal(results.length, EVERYONE.length);
    assert.deepEqual(results.map(r => r.personId), EVERYONE.map(p => p.id));
    results.forEach(r => assert.equal(typeof r.eligible, 'boolean'));
});

test('an eligible candidate carries no reason', () => {
    const results = Roles.candidatesFor(roleWith([eitherSlot]), eitherSlot, { people: [alice] });
    assert.equal(resultFor(results, 'alice').reason, null);
});

test('an unknown restriction kind is ignored rather than silently excluding everyone', () => {
    const role = roleWith([eitherSlot], [{ kind: 'not-a-real-rule', tagId: 'x' }]);
    const results = Roles.candidatesFor(role, eitherSlot, { people: [alice] });
    assert.equal(resultFor(results, 'alice').eligible, true);
});

test('missing relationship or assignment data is treated as none', () => {
    const role = roleWith([eitherSlot], [
        { kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: MARRIAGE },
    ]);
    const results = Roles.candidatesFor(role, eitherSlot, { people: [alice] });
    assert.equal(resultFor(results, 'alice').eligible, true);
});

// ── Eligibility never touches history ─────────────────────────────────────────

test('judging an Inactive Person ineligible leaves their record untouched', () => {
    const before = JSON.parse(JSON.stringify(frank));
    Roles.candidatesFor(roleWith([eitherSlot]), eitherSlot, { people: [frank] });
    assert.deepEqual(frank, before, 'eligibility is a read — it must not mutate the Person');
});
