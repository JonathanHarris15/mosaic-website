const { test } = require('node:test');
const assert = require('node:assert');

// Profile quick-assign (MS-104). The card applies vocabulary and authors Family by
// write-through. Its decisions — which side of a prioritized type this Person takes,
// whether a leader seat is open, and above all that a Family change lands in
// `families` and NEVER in `relationships` — are pinned here against an in-memory
// Firestore. The Alpine template is not covered; it needs a real page.

function fakeDb(seed = {}) {
    const data = JSON.parse(JSON.stringify(seed));
    let n = 1;
    const coll = name => (data[name] = data[name] || {});
    return {
        _data: data,
        collection(name) {
            return {
                get: async () => ({ docs: Object.entries(coll(name)).map(([id, d]) => ({ id, data: () => d })) }),
                orderBy: () => ({ get: async () => ({ docs: Object.entries(coll(name)).map(([id, d]) => ({ id, data: () => d })) }) }),
                add: async doc => { const id = 'new' + (n++); coll(name)[id] = { ...doc }; return { id }; },
                doc: id => ({
                    update: async patch => { coll(name)[id] = { ...coll(name)[id], ...patch }; },
                    delete: async () => { delete coll(name)[id]; },
                }),
            };
        },
    };
}

global.window = global;
global.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } };
require('../public/relationship-core.js');
require('../public/relationship-group-core.js');
require('../public/family-core.js');
require('../public/shepherding-quick-assign.js');

const stored = name => global.db._data[name] || {};

const ALICE = 'alice', BOB = 'bob', CARA = 'cara';
const PEOPLE = [
    { id: ALICE, name: 'Alice Chen', sex: 'female' },
    { id: BOB, name: 'Bob Marsh', sex: 'male' },
    { id: CARA, name: 'Cara Doyle', sex: 'female' },
];

const DISCIPLESHIP = { name: 'Discipleship', kind: 'pairwise', priority: true, holderLabel: 'Discipler', counterpartLabel: 'Disciplee' };
const BIBLE_STUDY = { name: 'Bible Study', kind: 'group', priority: true, leaderLabel: 'Leader', memberLabel: 'Member' };

// Mount the card with the slice of the profile component it leans on.
async function mountCard(seed, personId = ALICE, { confirmAnswer = true } = {}) {
    global.db = fakeDb(seed);
    global.confirm = () => confirmAnswer;

    const card = window.withQuickAssign({
        personId,
        person: PEOPLE.find(p => p.id === personId),
        allPeople: PEOPLE,
        relationships: Object.entries(seed.relationships || {}).map(([id, d]) => ({ id, ...d })),
        relationshipTypes: Object.entries(seed.relationship_types || {}).map(([id, d]) => ({ id, ...d })),
        families: Object.entries(seed.families || {}).map(([id, d]) => ({ id, ...d })),
        toasts: [],
        showToast(message, type = 'success') { this.toasts.push({ message, type }); },
        relTypeById(id) { return this.relationshipTypes.find(t => t.id === id) || null; },
        relPersonName(id) { const p = PEOPLE.find(x => x.id === id); return p ? p.name : '(unknown)'; },
        relPersonSex(id) { const p = PEOPLE.find(x => x.id === id); return p ? p.sex : null; },
    });
    card.relGroups = Object.entries(seed.relationship_groups || {}).map(([id, d]) => ({ leaderId: null, memberIds: [], id, ...d }));
    return card;
}

// ── Composition (the bug that broke the manager once already) ──────────────────

test('folding the card into the profile keeps its getters live', async () => {
    const card = await mountCard({ relationship_types: { t1: DISCIPLESHIP } });
    card.qaOpen('pairwise');
    card.qaForm.typeId = 't1';
    assert.ok(card.qaSelectedType, 'qaSelectedType must recompute — spread would have frozen it');
    assert.strictEqual(card.qaSelectedType.name, 'Discipleship');
});

// ── The card may only apply what the manager defined ───────────────────────────

test('only Pairwise types are offered, and a legacy type is read as its enriched equivalent', async () => {
    const card = await mountCard({
        relationship_types: {
            t1: DISCIPLESHIP,
            t2: BIBLE_STUDY,                       // a Group type — not offered here
            t3: { name: 'mentors', directional: true }, // legacy, pre-backfill
        },
    });
    const offered = card.qaPairwiseTypes;
    assert.deepStrictEqual(offered.map(t => t.id).sort(), ['t1', 't3']);
    assert.strictEqual(offered.find(t => t.id === 't3').priority, true, 'legacy directional reads as Prioritized');
});

test('a group this Person already belongs to is not offered to join again', async () => {
    const card = await mountCard({
        relationship_types: { t2: BIBLE_STUDY },
        relationship_groups: {
            g1: { typeId: 't2', name: 'Tuesday', leaderId: null, memberIds: [ALICE] },
            g2: { typeId: 't2', name: 'Thursday', leaderId: null, memberIds: [BOB] },
            g3: { typeId: 't2', name: 'Friday', leaderId: ALICE, memberIds: [] }, // she leads it
        },
    });
    assert.deepStrictEqual(card.qaJoinableGroups.map(g => g.id), ['g2']);
});

// ── Applying a Pairwise type: the side decides which end she occupies ──────────

test('taking the holder side makes this Person the fromId — the priority holder', async () => {
    const card = await mountCard({ relationship_types: { t1: DISCIPLESHIP } });
    card.qaOpen('pairwise');
    card.qaForm.typeId = 't1';
    card.qaForm.side = 'holder';
    card.qaPickPerson({ id: BOB, name: 'Bob Marsh' });
    await card.qaAddPairwise();

    const edge = Object.values(stored('relationships'))[0];
    assert.strictEqual(edge.fromId, ALICE, 'the holder is fromId (ADR-0014 s2)');
    assert.strictEqual(edge.toId, BOB);
});

test('taking the counterpart side puts the OTHER Person at the holder end', async () => {
    const card = await mountCard({ relationship_types: { t1: DISCIPLESHIP } });
    card.qaOpen('pairwise');
    card.qaForm.typeId = 't1';
    card.qaForm.side = 'counterpart'; // Alice is the Disciplee
    card.qaPickPerson({ id: BOB, name: 'Bob Marsh' });
    await card.qaAddPairwise();

    const edge = Object.values(stored('relationships'))[0];
    assert.strictEqual(edge.fromId, BOB, 'Bob is the Discipler, so he is fromId');
    assert.strictEqual(edge.toId, ALICE);
});

test('the same relationship cannot be added twice', async () => {
    const card = await mountCard({
        relationship_types: { t1: DISCIPLESHIP },
        relationships: { e1: { fromId: ALICE, toId: BOB, typeId: 't1' } },
    });
    card.qaOpen('pairwise');
    card.qaForm.typeId = 't1';
    card.qaForm.side = 'holder';
    card.qaPickPerson({ id: BOB, name: 'Bob Marsh' });
    await card.qaAddPairwise();

    assert.match(card.toasts.at(-1).message, /already exists/i);
    assert.strictEqual(Object.keys(stored('relationships')).length, 1);
});

// ── Groups: join as member, or take an open leader seat ────────────────────────

test('the leader seat is offered only on a Prioritized group that has none', async () => {
    const flat = { name: 'Prayer', kind: 'group', priority: false, label: 'Participant' };
    const card = await mountCard({
        relationship_types: { t2: BIBLE_STUDY, t3: flat },
        relationship_groups: {
            open: { typeId: 't2', name: 'Open', leaderId: null, memberIds: [] },
            led: { typeId: 't2', name: 'Led', leaderId: BOB, memberIds: [] },
            symmetric: { typeId: 't3', name: 'Flat', leaderId: null, memberIds: [] },
        },
    });
    card.qaOpen('group');

    card.qaForm.groupId = 'open';
    assert.strictEqual(card.qaLeaderSeatOpen, true);
    card.qaForm.groupId = 'led';
    assert.strictEqual(card.qaLeaderSeatOpen, false, 'the seat is taken');
    card.qaForm.groupId = 'symmetric';
    assert.strictEqual(card.qaLeaderSeatOpen, false, 'nobody leads a Non-Prioritized group');
});

test('joining as leader seats her as leader, not as a member', async () => {
    const card = await mountCard({
        relationship_types: { t2: BIBLE_STUDY },
        relationship_groups: { g1: { typeId: 't2', name: 'Tuesday', leaderId: null, memberIds: [BOB] } },
    });
    card.qaOpen('group');
    card.qaForm.groupId = 'g1';
    card.qaForm.asLeader = true;
    await card.qaJoinGroup();

    assert.strictEqual(stored('relationship_groups')['g1'].leaderId, ALICE);
    assert.deepStrictEqual(stored('relationship_groups')['g1'].memberIds, [BOB], 'she holds one seat, not two');
});

test('leaving a group she leads vacates the leader seat and leaves the roster intact', async () => {
    const card = await mountCard({
        relationship_types: { t2: BIBLE_STUDY },
        relationship_groups: { g1: { typeId: 't2', name: 'Tuesday', leaderId: ALICE, memberIds: [BOB] } },
    });
    const row = card.qaGroupRows[0];
    assert.strictEqual(row.leading, true);
    assert.strictEqual(row.roleLabel, 'Leader');

    await card.qaLeaveGroup(row);
    assert.strictEqual(stored('relationship_groups')['g1'].leaderId, null);
    assert.deepStrictEqual(stored('relationship_groups')['g1'].memberIds, [BOB]);
});

// ── Family write-through: it lands in `families`, never in `relationships` ─────

test('adding a spouse writes the families record and creates no edge', async () => {
    const card = await mountCard({});
    card.qaOpen('family');
    card.qaForm.familyKind = 'spouse';
    card.qaPickPerson({ id: BOB, name: 'Bob Marsh' });
    await card.qaAddFamily();

    const fam = Object.values(stored('families'))[0];
    assert.strictEqual(fam.wifeId, ALICE);
    assert.strictEqual(fam.husbandId, BOB);
    assert.deepStrictEqual(stored('relationships'), {}, 'Family is NEVER a relationships edge');
});

test('removing a spouse ends the pairing for both, and keeps the children', async () => {
    const card = await mountCard({
        families: { famA: { husbandId: BOB, wifeId: ALICE, childIds: [CARA] } },
    });
    const spouseRow = card.personRelationships.find(r => r.familyKind === 'spouse');
    assert.strictEqual(spouseRow.otherId, BOB);
    assert.strictEqual(spouseRow.removable, true);

    await card.qaRemoveFamily(spouseRow);
    assert.strictEqual(stored('families')['famA'].husbandId, null, 'Bob vacates the husband seat');
    assert.strictEqual(stored('families')['famA'].wifeId, ALICE);
    assert.deepStrictEqual(stored('families')['famA'].childIds, [CARA], 'the children stay');
});

test('removing a parent detaches HER from the family — the siblings keep both parents', async () => {
    const card = await mountCard(
        { families: { famA: { husbandId: BOB, wifeId: CARA, childIds: [ALICE, 'ben'] } } },
        ALICE);
    const parentRow = card.personRelationships.find(r => r.familyKind === 'parent');
    await card.qaRemoveFamily(parentRow);

    const fam = stored('families')['famA'];
    assert.deepStrictEqual(fam.childIds, ['ben'], 'Alice leaves; Ben stays');
    assert.strictEqual(fam.husbandId, BOB, 'Bob is still Ben\'s father');
    assert.strictEqual(fam.wifeId, CARA);
});

test('a sibling row offers no remove — it is emergent, not a link she holds', async () => {
    // Bob's children are Alice and Cara, so Cara is Alice's sister.
    const card = await mountCard(
        { families: { famA: { husbandId: BOB, wifeId: null, childIds: [ALICE, CARA] } } },
        ALICE);
    const sibling = card.personRelationships.find(r => r.familyKind === 'sibling');
    assert.ok(sibling, 'the sibling still shows');
    assert.strictEqual(sibling.otherId, CARA);
    assert.strictEqual(sibling.removable, false);

    // Her father, by contrast, can be removed — that is a link she holds.
    const parent = card.personRelationships.find(r => r.familyKind === 'parent');
    assert.strictEqual(parent.removable, true);
});

test('declining the confirmation writes nothing', async () => {
    const card = await mountCard(
        { families: { famA: { husbandId: BOB, wifeId: ALICE, childIds: [] } } },
        ALICE, { confirmAnswer: false });
    const spouseRow = card.personRelationships.find(r => r.familyKind === 'spouse');
    await card.qaRemoveFamily(spouseRow);
    assert.strictEqual(stored('families')['famA'].husbandId, BOB, 'unchanged');
});

// ── The panel shows all three sources ─────────────────────────────────────────

test('the panel merges Family, Pairwise and Group rows', async () => {
    const card = await mountCard({
        relationship_types: { t1: DISCIPLESHIP, t2: BIBLE_STUDY },
        relationships: { e1: { fromId: ALICE, toId: BOB, typeId: 't1' } },
        relationship_groups: { g1: { typeId: 't2', name: 'Tuesday', leaderId: null, memberIds: [ALICE] } },
        families: { famA: { husbandId: BOB, wifeId: ALICE, childIds: [] } },
    });
    const sources = card.personRelationships.map(r => r.source);
    assert.ok(sources.includes('family'));
    assert.ok(sources.includes('pairwise'));
    assert.ok(sources.includes('group'));

    const group = card.personRelationships.find(r => r.source === 'group');
    assert.strictEqual(group.groupName, 'Tuesday');
    assert.strictEqual(group.roleLabel, 'Member');
});
