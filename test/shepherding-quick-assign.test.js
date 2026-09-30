const { test } = require('node:test');
const assert = require('node:assert');

// Profile quick-assign (MS-104). The card applies vocabulary. Its decisions — which
// side of a prioritized type this Person takes, whether a leader seat is open — are
// pinned here against an in-memory Firestore. Family left this card for the
// Household card (MS-709). The Alpine template is not covered; it needs a real page.

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

// ── Family is not this card's (MS-709) ──────────────────────────────────────
// The Household card seats parents and children; this card neither shows Family
// rows nor writes `families`.

test('Family is not on the card: no Family rows, no Family mode', async () => {
    const card = await mountCard({
        families: { famA: { husbandId: BOB, wifeId: ALICE, childIds: [CARA] } },
    });
    assert.deepStrictEqual(card.personRelationships, []);
    assert.strictEqual(typeof card.qaAddFamily, 'undefined');
    assert.strictEqual(typeof card.qaRemoveFamily, 'undefined');
});

// ── The panel shows both sources ──────────────────────────────────────────────

test('the panel merges Pairwise and Group rows', async () => {
    const card = await mountCard({
        relationship_types: { t1: DISCIPLESHIP, t2: BIBLE_STUDY },
        relationships: { e1: { fromId: ALICE, toId: BOB, typeId: 't1' } },
        relationship_groups: { g1: { typeId: 't2', name: 'Tuesday', leaderId: null, memberIds: [ALICE] } },
        families: { famA: { husbandId: BOB, wifeId: ALICE, childIds: [] } },
    });
    const sources = card.personRelationships.map(r => r.source);
    assert.ok(!sources.includes('family'), 'Family lives on the Household card');
    assert.ok(sources.includes('pairwise'));
    assert.ok(sources.includes('group'));

    const group = card.personRelationships.find(r => r.source === 'group');
    assert.strictEqual(group.groupName, 'Tuesday');
    assert.strictEqual(group.roleLabel, 'Member');
});
