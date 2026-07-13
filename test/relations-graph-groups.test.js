const { test } = require('node:test');
const assert = require('node:assert');

const Graph = require('../public/relations-graph-core.js');

// MS-105 / ADR-0014 s5. The Relations Viewer must show the enriched model:
// prioritized relationships as directional edges, and Relationship Groups as
// bubbles. buildGraph owns the DATA half of that — the hull descriptors, the
// per-group colours, and the per-type priority flag. It still carries no geometry
// and no canvas: the viewer draws.

const people = [
    { id: 'stephen', name: 'Stephen Kane', tags: ['Elder'] },
    { id: 'tim', name: 'Tim Ross' },
    { id: 'carter', name: 'Carter Vale' },
    { id: 'nathan', name: 'Nathan Poole' },
    { id: 'ruth', name: 'Ruth Ellis' },
];

const DISCIPLESHIP = { id: 'td', name: 'Discipleship', kind: 'pairwise', priority: true, holderLabel: 'Discipler', counterpartLabel: 'Disciplee' };
const FRIENDSHIP = { id: 'tf', name: 'Friendship', kind: 'pairwise', priority: false, label: 'Friend' };
const BIBLE_STUDY = { id: 'tb', name: 'Bible Study', kind: 'group', priority: true, leaderLabel: 'Leader', memberLabel: 'Member' };
const PRAYER = { id: 'tp', name: 'Prayer Circle', kind: 'group', priority: false, label: 'Participant' };

const base = () => ({
    people,
    families: [],
    relationships: [
        { id: 'e1', fromId: 'stephen', toId: 'tim', typeId: 'td' },  // prioritized: Stephen is the holder
        { id: 'e2', fromId: 'carter', toId: 'nathan', typeId: 'tf' }, // symmetric
    ],
    relationshipTypes: [DISCIPLESHIP, FRIENDSHIP, BIBLE_STUDY, PRAYER],
    relationshipGroups: [
        { id: 'g1', typeId: 'tb', name: 'Tuesday Bible Study', leaderId: 'stephen', memberIds: ['tim', 'carter', 'nathan'] },
        { id: 'g2', typeId: 'tb', name: 'Thursday Study', leaderId: null, memberIds: ['ruth'] },        // leaderless
        { id: 'g3', typeId: 'tp', name: 'Sunday Prayer', leaderId: null, memberIds: ['tim', 'ruth'] },  // symmetric type
    ],
});

// ── Priority travels with the TYPE, and the holder is the edge's `a` end ───────

test('a type carries its priority to the viewer, so only prioritized edges get an arrowhead', () => {
    const g = Graph.buildGraph(base());
    const byKey = Object.fromEntries(g.customTypes.map(t => [t.key, t]));
    assert.strictEqual(byKey['rel:td'].prio, true, 'Discipleship is Prioritized');
    assert.strictEqual(byKey['rel:tf'].prio, false, 'Friendship is symmetric');
});

test('a prioritized edge puts the priority holder at the `a` end, so the arrow points at the counterpart', () => {
    const g = Graph.buildGraph(base());
    const edge = g.edges.find(e => e.type === 'rel:td');
    assert.strictEqual(edge.a, 'stephen', 'the Discipler is `a`');
    assert.strictEqual(edge.b, 'tim', 'the arrow points at the Disciplee');
});

test('Family and Elder Assignment are never directional', () => {
    const input = base();
    input.families = [{ id: 'f1', husbandId: 'stephen', wifeId: 'ruth', childIds: ['tim'] }];
    input.people = people.map(p => p.id === 'tim' ? { ...p, shepherding: { assignedElderId: 'stephen' } } : p);
    const g = Graph.buildGraph(input);
    assert.strictEqual(g.primaryTypes.family.prio, false);
    assert.strictEqual(g.primaryTypes.elder.prio, false);
});

test('a legacy directional type still reads as Prioritized before the backfill has run', () => {
    const input = base();
    input.relationshipTypes = [{ id: 'told', name: 'mentors', directional: true }];
    input.relationships = [{ id: 'e9', fromId: 'stephen', toId: 'tim', typeId: 'told' }];
    const g = Graph.buildGraph(input);
    assert.strictEqual(g.customTypes[0].prio, true);
});

// ── Group types govern bubbles, not edges ─────────────────────────────────────

test('a Group-kind type produces no edges — it governs bubbles only', () => {
    const g = Graph.buildGraph(base());
    assert.strictEqual(g.edges.some(e => e.type === 'rel:tb' || e.type === 'rel:tp'), false);
});

test('the type list tells the viewer which types are groups, so the sidebar can split them', () => {
    const g = Graph.buildGraph(base());
    const byKey = Object.fromEntries(g.customTypes.map(t => [t.key, t]));
    assert.strictEqual(byKey['rel:tb'].kind, 'group');
    assert.strictEqual(byKey['rel:td'].kind, 'pairwise');
    assert.strictEqual(byKey['rel:tb'].prio, true, 'a Prioritized group type draws leader lines');
    assert.strictEqual(byKey['rel:tp'].prio, false, 'a symmetric group type has no leader');
});

// ── Hull descriptors ──────────────────────────────────────────────────────────

test('each Relationship Group becomes one hull descriptor for the viewer to draw', () => {
    const g = Graph.buildGraph(base());
    const tuesday = g.groups.find(x => x.id === 'g1');
    assert.deepStrictEqual(
        { id: tuesday.id, name: tuesday.name, typeId: tuesday.typeId, leaderId: tuesday.leaderId, memberIds: tuesday.memberIds },
        { id: 'g1', name: 'Tuesday Bible Study', typeId: 'tb', leaderId: 'stephen', memberIds: ['tim', 'carter', 'nathan'] });
    assert.ok(tuesday.colour, 'the group carries its assigned colour');
});

test('the leader is NOT one of the members — the viewer draws one line to the bubble, not into it', () => {
    const g = Graph.buildGraph(base());
    const tuesday = g.groups.find(x => x.id === 'g1');
    assert.strictEqual(tuesday.memberIds.includes('stephen'), false);
    assert.strictEqual(tuesday.leaderId, 'stephen');
});

test('a leaderless group and a symmetric group both carry leaderId null — normal resting states', () => {
    const g = Graph.buildGraph(base());
    assert.strictEqual(g.groups.find(x => x.id === 'g2').leaderId, null, 'leaderless Prioritized group');
    assert.strictEqual(g.groups.find(x => x.id === 'g3').leaderId, null, 'symmetric group never has a leader');
});

test('a leader recorded on a SYMMETRIC group type is ignored — nobody leads a flat roster', () => {
    const input = base();
    input.relationshipGroups = [{ id: 'gx', typeId: 'tp', name: 'Flat', leaderId: 'stephen', memberIds: ['tim'] }];
    const g = Graph.buildGraph(input);
    assert.strictEqual(g.groups[0].leaderId, null, 'the stray leader is dropped, not drawn');
});

test('a group whose members are unknown People is dropped rather than drawn empty', () => {
    const input = base();
    input.relationshipGroups = [{ id: 'ghost', typeId: 'tb', name: 'Ghosts', leaderId: null, memberIds: ['nobody'] }];
    const g = Graph.buildGraph(input);
    assert.deepStrictEqual(g.groups, []);
});

test('a group of a type that no longer exists is skipped', () => {
    const input = base();
    input.relationshipGroups = [{ id: 'orphan', typeId: 'gone', name: 'Orphan', leaderId: null, memberIds: ['tim'] }];
    const g = Graph.buildGraph(input);
    assert.deepStrictEqual(g.groups, []);
});

// ── Colours ───────────────────────────────────────────────────────────────────

test('groups are coloured from the group palette, cycling in stable order', () => {
    const g = Graph.buildGraph(base());
    const colours = g.groups.map(x => x.colour);
    assert.deepStrictEqual(colours, Graph.GROUP_PALETTE.slice(0, 3), 'first three palette entries, in order');
});

test('a group keeps its colour across reloads — the order is stable, not incidental', () => {
    const a = Graph.buildGraph(base()).groups.find(x => x.id === 'g2').colour;
    const b = Graph.buildGraph(base()).groups.find(x => x.id === 'g2').colour;
    assert.strictEqual(a, b);
});

test('more groups than palette entries wrap around rather than running out', () => {
    const input = base();
    input.relationshipGroups = Array.from({ length: Graph.GROUP_PALETTE.length + 2 }, (_, i) => ({
        id: 'g' + i, typeId: 'tb', name: 'Group ' + i, leaderId: null, memberIds: ['tim'],
    }));
    const g = Graph.buildGraph(input);
    assert.strictEqual(g.groups.length, Graph.GROUP_PALETTE.length + 2);
    assert.strictEqual(g.groups[Graph.GROUP_PALETTE.length].colour, Graph.GROUP_PALETTE[0], 'wraps');
});

test('a leader takes the colour of the group they lead, for the node ring', () => {
    const g = Graph.buildGraph(base());
    const tuesday = g.groups.find(x => x.id === 'g1');
    assert.strictEqual(g.leaderColourByPerson['stephen'], tuesday.colour);
    assert.strictEqual('tim' in g.leaderColourByPerson, false, 'a mere member gets no leader ring');
});

// ── The union is preserved ────────────────────────────────────────────────────

test('groups do not disturb the Pairwise + Family + Elder Assignment union', () => {
    const input = base();
    input.families = [{ id: 'f1', husbandId: 'stephen', wifeId: 'ruth', childIds: ['tim'] }];
    input.people = people.map(p => p.id === 'carter' ? { ...p, shepherding: { assignedElderId: 'stephen' } } : p);
    const g = Graph.buildGraph(input);
    const types = new Set(g.edges.map(e => e.type));
    assert.ok(types.has('family'));
    assert.ok(types.has('elder'));
    assert.ok(types.has('rel:td'));
    assert.ok(types.has('rel:tf'));
    assert.strictEqual(g.hasData, true);
});

test('a graph with no groups still builds, and simply has none to draw', () => {
    const input = base();
    delete input.relationshipGroups;
    const g = Graph.buildGraph(input);
    assert.deepStrictEqual(g.groups, []);
    assert.deepStrictEqual(g.leaderColourByPerson, {});
});
