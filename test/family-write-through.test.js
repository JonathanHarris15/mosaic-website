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

test('a spouse cannot also be seated as a child of the same household', () => {
    const plan = Family.planAddFamilyRelation(seeded(), ROB, 'child', MARY, personById);
    assert.strictEqual(plan.valid, false);
    assert.match(plan.errors.join(' '), /spouse, not their child/i);
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

test('naming the parent you already have says so, rather than "already has a father"', () => {
    const plan = Family.planAddFamilyRelation(seeded(), ALICE, 'parent', ROB, personById);
    assert.strictEqual(plan.valid, false);
    assert.match(plan.errors.join(' '), /already this Person's father/i);
});

// ── One couple is one household, however the children were added ──────────────
// The bug this pins: a child with no family of origin used to get a BRAND NEW
// Family every time, even when the parent was already married into one. Naming
// both parents of each child in turn therefore recorded the same couple once per
// child — five children, five Families, five spouse links in the Relations Viewer.

test('a child joins the household their parent is already married into', () => {
    const plan = Family.planAddFamilyRelation(seeded(), CARA, 'parent', ROB, personById);
    assert.strictEqual(plan.action, 'update');
    assert.strictEqual(plan.familyId, 'famA');           // Rob and Mary's, not a new one
    assert.deepStrictEqual(plan.changes, { childIds: [ALICE, BEN, CARA] });
});

test('adding every child by naming its parents never mints a second Family', () => {
    // Walk the exact sequence that caused it: marry the couple, then for each
    // child name the father and then the mother.
    let families = [{ id: 'famA', husbandId: ROB, wifeId: MARY, childIds: [] }];
    const apply = (plan) => {
        assert.strictEqual(plan.valid, true, plan.errors.join(' '));
        assert.strictEqual(plan.action, 'update', 'a second Family was created');
        families = families.map(f => f.id === plan.familyId ? { ...f, ...plan.changes } : f);
    };
    for (const child of [ALICE, BEN, CARA]) {
        apply(Family.planAddFamilyRelation(families, child, 'parent', ROB, personById));
        // The mother is now already seated in that same Family, so this is a no-op
        // the planner refuses by name rather than a second household.
        const mother = Family.planAddFamilyRelation(families, child, 'parent', MARY, personById);
        assert.strictEqual(mother.valid, false);
        assert.match(mother.errors.join(' '), /already this Person's mother/i);
    }
    assert.strictEqual(families.length, 1);
    assert.deepStrictEqual(families[0].childIds, [ALICE, BEN, CARA]);
});

test('a parent already seated elsewhere is refused, not seated in a second household', () => {
    // Cara's family of origin has only a mother; Rob is married into famA. Filling
    // the empty father seat with him would make him a spouse in two Families.
    const families = seeded().concat([{ id: 'famC', wifeId: CARA, childIds: [DAN] }]);
    const plan = Family.planAddFamilyRelation(families, DAN, 'parent', ROB, personById);
    assert.strictEqual(plan.valid, false);
    assert.match(plan.errors.join(' '), /already seated in another Family/i);
});

test('two People who each head a household cannot be married into one of them', () => {
    // Joining two households is a restructure — it would leave one of them a
    // spouse in two Families, which the model does not allow.
    const families = [
        { id: 'famA', husbandId: ROB, childIds: [ALICE] },
        { id: 'famB', wifeId: CARA, childIds: [BEN] },
    ];
    const plan = Family.planAddFamilyRelation(families, ROB, 'spouse', CARA, personById);
    assert.strictEqual(plan.valid, false);
    assert.match(plan.errors.join(' '), /already head a Family/i);
});

test('no plan ever seats a Person as a spouse in a Family they are not already in', () => {
    // The invariant behind all of the above: an update may fill an EMPTY seat in a
    // Family, and a create makes exactly one. Nothing else moves a spouse.
    const families = seeded();
    const seatKeys = ['husbandId', 'wifeId'];
    for (const kind of ['spouse', 'parent', 'child']) {
        for (const other of [ROB, MARY, ALICE, BEN, CARA]) {
            for (const self of [ALICE, BEN, CARA]) {
                const plan = Family.planAddFamilyRelation(families, self, kind, other, personById);
                if (!plan.valid || plan.action !== 'update') continue;
                const target = families.find(f => f.id === plan.familyId);
                for (const seat of seatKeys) {
                    if (!(seat in plan.changes)) continue;
                    assert.ok(!target[seat], `${kind}: ${seat} was already taken in ${plan.familyId}`);
                    const elsewhere = Family.familyOfSpouse(families, plan.changes[seat]);
                    assert.ok(!elsewhere || elsewhere.id === plan.familyId,
                        `${kind}: ${plan.changes[seat]} would be a spouse in two Families`);
                }
            }
        }
    }
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
