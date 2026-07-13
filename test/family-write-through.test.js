const { test } = require('node:test');
const assert = require('node:assert');

const Family = require('../public/family-core.js');

// Family write-through (MS-104, ADR-0014 s4). The Shepherding Profile's
// quick-assign card can now ADD and REMOVE Family relations. It writes straight to
// the `families` collection — find-or-create the Family, set a spouse, append or
// pull a child — and NEVER creates a parallel edge in `relationships`. `families`
// stays the single source of truth, so Family remains a Projected Relationship for
// display. This supersedes ADR-0013's "Family is edited only in the Directory".
//
// These planners are pure: they return the write to make, and a browser writer
// applies it. Same shape as planTagMerge (ADR-0011).

const ROB = 'rob', MARY = 'mary', ALICE = 'alice', BEN = 'ben', CARA = 'cara', DAN = 'dan';

const people = {
    rob: { id: ROB, name: 'Rob', sex: 'male' },
    mary: { id: MARY, name: 'Mary', sex: 'female' },
    alice: { id: ALICE, name: 'Alice', sex: 'female' },
    ben: { id: BEN, name: 'Ben', sex: 'male' },
    cara: { id: CARA, name: 'Cara', sex: 'female' },
    dan: { id: DAN, name: 'Dan' }, // sex deliberately unset
};
const personById = id => people[id] || null;

// Rob + Mary, with Alice and Ben as their children.
const seeded = () => ([
    { id: 'famA', husbandId: ROB, wifeId: MARY, childIds: [ALICE, BEN] },
]);

// ── Adding a spouse ───────────────────────────────────────────────────────────

test('adding a spouse to a Person with no Family creates one, seating each by sex', () => {
    const plan = Family.planAddFamilyRelation([], ALICE, 'spouse', BEN, personById);
    assert.strictEqual(plan.valid, true);
    assert.strictEqual(plan.action, 'create');
    assert.strictEqual(plan.changes.wifeId, ALICE);   // Alice is female
    assert.strictEqual(plan.changes.husbandId, BEN);  // Ben is male
    assert.deepStrictEqual(plan.changes.childIds, []);
});

test('adding a spouse to an existing Family fills the empty seat rather than making a second one', () => {
    const families = [{ id: 'famB', husbandId: BEN, wifeId: null, childIds: [CARA] }];
    const plan = Family.planAddFamilyRelation(families, BEN, 'spouse', ALICE, personById);
    assert.strictEqual(plan.action, 'update');
    assert.strictEqual(plan.familyId, 'famB');
    assert.deepStrictEqual(plan.changes, { wifeId: ALICE });
    // The children already recorded against that Family are untouched.
    assert.strictEqual('childIds' in plan.changes, false);
});

test('a Person who already has a spouse cannot be given another', () => {
    const plan = Family.planAddFamilyRelation(seeded(), ROB, 'spouse', CARA, personById);
    assert.strictEqual(plan.valid, false);
    assert.match(plan.errors.join(' '), /already has a spouse/i);
});

test('a spouse whose sex is unset is refused — the seat cannot be chosen', () => {
    // Husband must be male and wife female (ADR-0012); an unset sex fails closed.
    const plan = Family.planAddFamilyRelation([], ALICE, 'spouse', DAN, personById);
    assert.strictEqual(plan.valid, false);
    assert.match(plan.errors.join(' '), /sex/i);
});

test('two Persons of the same sex cannot fill the husband and wife seats', () => {
    const plan = Family.planAddFamilyRelation([], ALICE, 'spouse', CARA, personById);
    assert.strictEqual(plan.valid, false);
});

// ── Adding a child ────────────────────────────────────────────────────────────

test('adding a child appends to the Family the Person is married into', () => {
    const plan = Family.planAddFamilyRelation(seeded(), ROB, 'child', CARA, personById);
    assert.strictEqual(plan.action, 'update');
    assert.strictEqual(plan.familyId, 'famA');
    assert.deepStrictEqual(plan.changes.childIds, [ALICE, BEN, CARA]);
});

test('adding a child to a Person with no Family creates one seating them alone', () => {
    const plan = Family.planAddFamilyRelation([], ROB, 'child', CARA, personById);
    assert.strictEqual(plan.action, 'create');
    assert.strictEqual(plan.changes.husbandId, ROB); // Rob is male
    assert.deepStrictEqual(plan.changes.childIds, [CARA]);
});

test('a Person who is already a child somewhere cannot be adopted into a second Family', () => {
    // A Person is a child in at most one Family — that is what makes the
    // generational walk unambiguous.
    const families = seeded().concat([{ id: 'famB', husbandId: BEN, wifeId: CARA, childIds: [] }]);
    const plan = Family.planAddFamilyRelation(families, BEN, 'child', ALICE, personById);
    assert.strictEqual(plan.valid, false);
    assert.match(plan.errors.join(' '), /already a child|family of origin/i);
});

test('a Person cannot be their own child', () => {
    const plan = Family.planAddFamilyRelation(seeded(), ROB, 'child', ROB, personById);
    assert.strictEqual(plan.valid, false);
});

// ── Adding a parent ───────────────────────────────────────────────────────────

test('adding a parent seats them in the Person\'s family of origin', () => {
    const families = [{ id: 'famA', husbandId: ROB, wifeId: null, childIds: [ALICE] }];
    const plan = Family.planAddFamilyRelation(families, ALICE, 'parent', MARY, personById);
    assert.strictEqual(plan.action, 'update');
    assert.strictEqual(plan.familyId, 'famA');
    assert.deepStrictEqual(plan.changes, { wifeId: MARY });
});

test('adding a parent to a Person with no family of origin creates one', () => {
    const plan = Family.planAddFamilyRelation([], ALICE, 'parent', ROB, personById);
    assert.strictEqual(plan.action, 'create');
    assert.strictEqual(plan.changes.husbandId, ROB);
    assert.deepStrictEqual(plan.changes.childIds, [ALICE]);
});

test('a parent seat that is already taken cannot be filled twice', () => {
    const plan = Family.planAddFamilyRelation(seeded(), ALICE, 'parent', BEN, personById);
    assert.strictEqual(plan.valid, false);
    assert.match(plan.errors.join(' '), /already has a father|seat/i);
});

// ── Removing a spouse: mutual ─────────────────────────────────────────────────

test('removing a spouse ends the pairing for both — it is one mutual field', () => {
    const plan = Family.planRemoveFamilyRelation(seeded(), ROB, 'spouse', MARY);
    assert.strictEqual(plan.valid, true);
    assert.strictEqual(plan.familyId, 'famA');
    assert.deepStrictEqual(plan.changes, { wifeId: null }, 'Mary vacates the wife seat');
    // Rob keeps the Family and its children; only the pairing is gone.
    assert.strictEqual('childIds' in plan.changes, false);
    assert.strictEqual('husbandId' in plan.changes, false);
});

// ── Removing a child: scoped to that child ────────────────────────────────────

test('removing a child detaches only that child, leaving their siblings in place', () => {
    const plan = Family.planRemoveFamilyRelation(seeded(), ROB, 'child', ALICE);
    assert.strictEqual(plan.familyId, 'famA');
    assert.deepStrictEqual(plan.changes, { childIds: [BEN] });
});

// ── Removing a parent: detaches the individual, not the parent ────────────────

test('removing a parent detaches THIS Person from their family of origin', () => {
    // The model has one husband and one wife per Family, so a parent cannot be
    // removed from one child without removing them from every sibling. Scoping the
    // removal "to the individual" therefore means pulling this Person out of the
    // Family — their siblings keep both parents, and the parents keep their other
    // children. The card must say so before it does it.
    const plan = Family.planRemoveFamilyRelation(seeded(), ALICE, 'parent', ROB);
    assert.strictEqual(plan.familyId, 'famA');
    assert.deepStrictEqual(plan.changes, { childIds: [BEN] }, 'Alice leaves; Ben stays');
    // Rob and Mary keep their seats — Ben is still their son.
    assert.strictEqual('husbandId' in plan.changes, false);
    assert.strictEqual('wifeId' in plan.changes, false);
});

test('removing a parent reports the collateral it will cause, so the card can warn', () => {
    const plan = Family.planRemoveFamilyRelation(seeded(), ALICE, 'parent', ROB);
    // Alice also loses Mary as a mother and Ben as a sibling — the card confirms this.
    assert.deepStrictEqual(plan.alsoDetaches.parentIds, [ROB, MARY]);
    assert.deepStrictEqual(plan.alsoDetaches.siblingIds, [BEN]);
});

// ── Nothing ever writes an edge ───────────────────────────────────────────────

test('every plan targets the families collection and never a relationships edge', () => {
    const plans = [
        Family.planAddFamilyRelation([], ALICE, 'spouse', BEN, personById),
        Family.planAddFamilyRelation(seeded(), ROB, 'child', CARA, personById),
        Family.planRemoveFamilyRelation(seeded(), ROB, 'spouse', MARY),
        Family.planRemoveFamilyRelation(seeded(), ROB, 'child', ALICE),
    ];
    for (const p of plans) {
        assert.strictEqual(p.collection, 'families', 'Family is authored by write-through, never as an edge');
    }
});

test('an unknown relation kind is refused rather than guessed at', () => {
    const add = Family.planAddFamilyRelation(seeded(), ROB, 'cousin', CARA, personById);
    assert.strictEqual(add.valid, false);
    const remove = Family.planRemoveFamilyRelation(seeded(), ROB, 'sibling', ALICE);
    assert.strictEqual(remove.valid, false);
});
