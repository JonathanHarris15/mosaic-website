const { test } = require('node:test');
const assert = require('node:assert');

// The Relationships tab (MS-103) is Alpine glue over the cores, but it carries
// real decisions of its own: which validator to run, what a cascading delete will
// take with it, whether a pair already exists, and what shape actually reaches
// Firestore. Those are pinned here against an in-memory Firestore, so the tab's
// logic is exercised without a browser. The x-show/x-for template bindings are
// declarative and are not covered — they need a real page.

// ── An in-memory stand-in for the Firestore compat API ────────────────────────

function permissionDenied() {
    const e = new Error('Missing or insufficient permissions.');
    e.code = 'permission-denied';
    return e;
}

// `denied` names collections the rules reject — e.g. relationship_groups before
// its rule is deployed.
function fakeDb(seed = {}, denied = []) {
    const data = JSON.parse(JSON.stringify(seed)); // { collection: { id: doc } }
    let nextId = 1;
    const coll = name => (data[name] = data[name] || {});
    const guard = name => { if (denied.includes(name)) throw permissionDenied(); };

    const api = {
        _data: data,
        collection(name) {
            return {
                get: async () => {
                    guard(name);
                    return { docs: Object.entries(coll(name)).map(([id, d]) => ({ id, data: () => d })) };
                },
                orderBy: () => ({
                    get: async () => ({
                        docs: Object.entries(coll(name))
                            .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''))
                            .map(([id, d]) => ({ id, data: () => d })),
                    }),
                }),
                add: async doc => {
                    const id = 'new' + (nextId++);
                    coll(name)[id] = { ...doc };
                    return { id };
                },
                doc: id => ({
                    set: async doc => { coll(name)[id] = { ...doc }; },
                    update: async patch => { coll(name)[id] = { ...coll(name)[id], ...patch }; },
                    delete: async () => { delete coll(name)[id]; },
                }),
            };
        },
        batch() {
            const ops = [];
            return {
                delete: ref => ops.push(ref),
                commit: async () => { for (const ref of ops) await ref.delete(); },
            };
        },
    };
    return api;
}

// The tab reads its collaborators off the page globals, so stand them up once.
global.window = global;
require('../public/relationship-core.js');
require('../public/relationship-group-core.js');
require('../public/shepherding-relationships.js');

// Build a tab wired to a seeded database, with the bits the Tags component
// normally supplies (a toast sink) and the browser normally supplies (confirm).
// Read straight out of the fake Firestore, to assert what actually got written.
const storedIn = name => global.db._data[name] || {};

async function mountTab(seed, { confirmAnswer = true, denied = [] } = {}) {
    global.db = fakeDb(seed, denied);
    global.confirm = () => confirmAnswer;

    const tab = window.RelationshipsTab();
    tab.toasts = [];
    tab.showToast = (message, type = 'success') => tab.toasts.push({ message, type });
    await tab.loadRelationshipsTab();
    return tab;
}

const DISCIPLESHIP = {
    name: 'Discipleship', kind: 'pairwise', priority: true,
    holderLabel: 'Discipler', counterpartLabel: 'Disciplee',
};
const BIBLE_STUDY = {
    name: 'Bible Study', kind: 'group', priority: true,
    leaderLabel: 'Leader', memberLabel: 'Member',
};
const PEOPLE = { alice: { name: 'Alice' }, bob: { name: 'Bob' }, cara: { name: 'Cara' } };

// ── Loading ───────────────────────────────────────────────────────────────────

test('the tab reads a legacy directional type as its enriched equivalent', async () => {
    // The tab must work before the MS-102 backfill has run (ADR-0014 s6).
    const tab = await mountTab({
        relationship_types: { t1: { name: 'mentors', directional: true } },
        people: PEOPLE,
    });
    const type = tab.relTypes[0];
    assert.strictEqual(type.kind, 'pairwise');
    assert.strictEqual(type.priority, true);
    assert.strictEqual(tab.typeSummary(type), 'Pairwise · Prioritized (mentors / mentors)');
});

test('a denied collection read is absorbed, not thrown — the Tags tab must survive it', async () => {
    // relationship_groups is a new collection: production denies the READ (not just
    // the write) until its rule is deployed. This tab is one half of a shared page,
    // and letting that rejection escape leaves the whole page stuck on its spinner.
    const tab = await mountTab(
        { relationship_types: { t1: DISCIPLESHIP }, people: PEOPLE },
        { denied: ['relationship_groups'] });

    assert.match(tab.relError, /permission|deployed/i, 'the failure is reported, not swallowed silently');
    assert.deepStrictEqual(tab.relGroups, [], 'and the tab degrades to empty rather than half-built');
});

// ── Creating and editing Relationship Types ───────────────────────────────────

test('creating a Prioritized Pairwise type stores both role labels and no symmetric Label', async () => {
    const tab = await mountTab({ people: PEOPLE });
    tab.typeForm = { ...tab.typeForm, ...DISCIPLESHIP };
    await tab.saveType();

    const stored = Object.values(storedIn('relationship_types'))[0];
    assert.strictEqual(stored.holderLabel, 'Discipler');
    assert.strictEqual(stored.counterpartLabel, 'Disciplee');
    assert.strictEqual('label' in stored, false);
    assert.strictEqual(tab.relTypes.length, 1);
});

test('a Prioritized type missing a role label is rejected, and nothing is written', async () => {
    const tab = await mountTab({ people: PEOPLE });
    tab.typeForm = { ...tab.typeForm, name: 'Discipleship', kind: 'pairwise', priority: true, holderLabel: 'Discipler' };
    await tab.saveType();

    assert.strictEqual(tab.relTypes.length, 0);
    assert.strictEqual(tab.toasts[0].type, 'error');
    assert.match(tab.toasts[0].message, /Counterpart Label/i);
});

test('editing a Prioritized type down to Non-Prioritized clears its stale role labels', async () => {
    const tab = await mountTab({ relationship_types: { t1: DISCIPLESHIP }, people: PEOPLE });
    tab.startEditType(tab.relTypes[0]);
    tab.typeForm.priority = false;
    tab.typeForm.label = 'Peer';
    await tab.saveType();

    const stored = storedIn('relationship_types')['t1'];
    assert.strictEqual(stored.label, 'Peer');
    assert.strictEqual('holderLabel' in stored, false, 'the old role labels must not linger');
    assert.strictEqual('counterpartLabel' in stored, false);
});

test('an edit cannot change a type kind', async () => {
    const tab = await mountTab({ relationship_types: { t1: DISCIPLESHIP }, people: PEOPLE });
    tab.startEditType(tab.relTypes[0]);
    tab.typeForm.kind = 'group';
    tab.typeForm.leaderLabel = 'Leader';
    tab.typeForm.memberLabel = 'Member';
    await tab.saveType();

    assert.match(tab.toasts[0].message, /kind is immutable/i);
    assert.strictEqual(storedIn('relationship_types')['t1'].kind, 'pairwise', 'the stored kind is unchanged');
});

// ── Deleting a type cascades, and says so first ───────────────────────────────

test('deleting a type in use removes its pairs and groups too', async () => {
    const tab = await mountTab({
        relationship_types: { t1: DISCIPLESHIP, t2: BIBLE_STUDY },
        relationships: {
            e1: { fromId: 'alice', toId: 'bob', typeId: 't1' },
            e2: { fromId: 'cara', toId: 'bob', typeId: 't2' }, // a different type — must survive
        },
        relationship_groups: { g1: { typeId: 't1', name: 'Pairs group', leaderId: null, memberIds: [] } },
        people: PEOPLE,
    });
    assert.strictEqual(tab.instanceCount('t1'), 2); // 1 pair + 1 group

    await tab.deleteType(tab.relTypes.find(t => t.id === 't1'));

    assert.deepStrictEqual(Object.keys(storedIn('relationship_types')), ['t2']);
    assert.deepStrictEqual(Object.keys(storedIn('relationships')), ['e2'], 'only the deleted type\'s edges go');
    assert.deepStrictEqual(Object.keys(storedIn('relationship_groups')), []);
    assert.strictEqual(tab.relTypes.length, 1);
});

test('declining the delete confirmation leaves everything in place', async () => {
    const tab = await mountTab(
        { relationship_types: { t1: DISCIPLESHIP }, people: PEOPLE },
        { confirmAnswer: false });
    await tab.deleteType(tab.relTypes[0]);
    assert.strictEqual(tab.relTypes.length, 1);
    assert.deepStrictEqual(Object.keys(storedIn('relationship_types')), ['t1']);
});

// ── Pairwise Relationships ────────────────────────────────────────────────────

test('adding a pair to a Prioritized type stores the holder as fromId', async () => {
    const tab = await mountTab({ relationship_types: { t1: DISCIPLESHIP }, people: PEOPLE });
    tab.selectType(tab.relTypes[0]);
    tab.pickPairPerson('holder', { id: 'alice', name: 'Alice' });
    tab.pickPairPerson('counterpart', { id: 'bob', name: 'Bob' });
    await tab.addPair();

    const edge = Object.values(storedIn('relationships'))[0];
    assert.strictEqual(edge.fromId, 'alice', 'fromId is the priority holder (ADR-0014 s2)');
    assert.strictEqual(edge.toId, 'bob');
    assert.strictEqual(tab.pairSentence(tab.relPairs[0], tab.selectedType), 'Alice (Discipler) → Bob (Disciplee)');
});

test('the same pair cannot be added twice, and a person cannot pair with themselves', async () => {
    const tab = await mountTab({
        relationship_types: { t1: DISCIPLESHIP },
        relationships: { e1: { fromId: 'alice', toId: 'bob', typeId: 't1' } },
        people: PEOPLE,
    });
    tab.selectType(tab.relTypes[0]);

    tab.pickPairPerson('holder', { id: 'alice', name: 'Alice' });
    tab.pickPairPerson('counterpart', { id: 'bob', name: 'Bob' });
    await tab.addPair();
    assert.match(tab.toasts.at(-1).message, /already exists/i);

    tab.pickPairPerson('counterpart', { id: 'alice', name: 'Alice' });
    await tab.addPair();
    assert.match(tab.toasts.at(-1).message, /two different people/i);

    assert.strictEqual(Object.keys(storedIn('relationships')).length, 1);
});

test('a Non-Prioritized pair is symmetric, so the reversed pair is a duplicate', async () => {
    const friendship = { name: 'Friendship', kind: 'pairwise', priority: false, label: 'Friend' };
    const tab = await mountTab({
        relationship_types: { t1: friendship },
        relationships: { e1: { fromId: 'alice', toId: 'bob', typeId: 't1' } },
        people: PEOPLE,
    });
    tab.selectType(tab.relTypes[0]);
    tab.pickPairPerson('holder', { id: 'bob', name: 'Bob' });      // reversed
    tab.pickPairPerson('counterpart', { id: 'alice', name: 'Alice' });
    await tab.addPair();

    assert.match(tab.toasts.at(-1).message, /already exists/i);
    assert.strictEqual(Object.keys(storedIn('relationships')).length, 1);
});

// ── Relationship Groups ───────────────────────────────────────────────────────

test('a newly created group is leaderless and empty, and persists that way', async () => {
    const tab = await mountTab({ relationship_types: { t2: BIBLE_STUDY }, people: PEOPLE });
    tab.selectType(tab.relTypes[0]);
    tab.groupForm.name = 'Tuesday Bible Study';
    await tab.createGroup();

    const stored = Object.values(storedIn('relationship_groups'))[0];
    assert.strictEqual(stored.name, 'Tuesday Bible Study');
    assert.strictEqual(stored.leaderId, null);
    assert.deepStrictEqual(stored.memberIds, []);
});

test('promoting a member to leader takes them out of the roster, and standing down puts nobody back', async () => {
    const tab = await mountTab({
        relationship_types: { t2: BIBLE_STUDY },
        relationship_groups: { g1: { typeId: 't2', name: 'Tuesday', leaderId: null, memberIds: ['alice', 'bob'] } },
        people: PEOPLE,
    });
    const group = () => tab.relGroups[0];

    await tab.setGroupLeader(group(), 'alice');
    assert.strictEqual(storedIn('relationship_groups')['g1'].leaderId, 'alice');
    assert.deepStrictEqual(storedIn('relationship_groups')['g1'].memberIds, ['bob'],
        'the leader holds one slot, not two');

    await tab.clearGroupLeader(group());
    assert.strictEqual(storedIn('relationship_groups')['g1'].leaderId, null);
    assert.deepStrictEqual(storedIn('relationship_groups')['g1'].memberIds, ['bob'],
        'standing down does not silently re-add the leader as a member');
});

test('adding and removing members writes the roster through to Firestore', async () => {
    const tab = await mountTab({
        relationship_types: { t2: BIBLE_STUDY },
        relationship_groups: { g1: { typeId: 't2', name: 'Tuesday', leaderId: null, memberIds: [] } },
        people: PEOPLE,
    });
    await tab.addGroupMember(tab.relGroups[0], { id: 'alice', name: 'Alice' });
    await tab.addGroupMember(tab.relGroups[0], { id: 'bob', name: 'Bob' });
    assert.deepStrictEqual(storedIn('relationship_groups')['g1'].memberIds, ['alice', 'bob']);

    await tab.removeGroupMember(tab.relGroups[0], 'alice');
    assert.deepStrictEqual(storedIn('relationship_groups')['g1'].memberIds, ['bob']);
});

// ── The person picker ─────────────────────────────────────────────────────────

test('the person picker matches on name and excludes people already chosen', async () => {
    const tab = await mountTab({ people: PEOPLE });
    assert.deepStrictEqual(tab.personCandidates('a').map(p => p.id), ['alice', 'cara']); // both contain "a"
    assert.deepStrictEqual(tab.personCandidates('a', ['alice']).map(p => p.id), ['cara']);
    assert.deepStrictEqual(tab.personCandidates(''), [], 'an empty query offers nobody');
});
