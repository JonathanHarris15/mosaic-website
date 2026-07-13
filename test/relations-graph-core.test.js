const { test } = require('node:test');
const assert = require('node:assert');

const Graph = require('../public/relations-graph-core.js');
const Core = require('../public/shepherding-core.js');
const Elder = require('../functions/elder-sync.js');

// The Relations Viewer's edge set (ADR-0013, MS-95) is the union of Custom
// Relationships + Family (spouse + parent→child) + Elder Assignment, built purely
// from the collections. These pin that union and the per-type keys the viewer
// filters on. A fixture: elder E, couple P(m)+S(f) with kids K1(m), K2(f); M is a
// lone member assigned to E; a custom "Mentor" type links E→M.
const people = [
    { id: 'e',  name: 'Ella Elder',  sex: 'female', tags: ['Member', 'Elder'], membership: { stage: 'member' } },
    { id: 'p',  name: 'Paul Dad',    sex: 'male',   tags: ['Member'], membership: { stage: 'member' } },
    { id: 's',  name: 'Sara Mom',    sex: 'female', tags: ['Member'], membership: { stage: 'member' } },
    { id: 'k1', name: 'Kid One',     sex: 'male',   tags: [], membership: { stage: 'regular_attender' } },
    { id: 'k2', name: 'Kid Two',     sex: 'female', tags: [], membership: { stage: 'visitor', inactive: true } },
    { id: 'm',  name: 'Mo Member',   sex: 'male',   tags: ['Member'], membership: { stage: 'member' }, shepherding: { assignedElderId: 'e' } },
];
const families = [{ id: 'fam', husbandId: 'p', wifeId: 's', childIds: ['k1', 'k2'] }];
const relationshipTypes = [{ id: 't1', name: 'Mentor' }];
const relationships = [{ id: 'r1', fromId: 'e', toId: 'm', typeId: 't1' }];

function edgeKey(e) { return [e.a, e.b].sort().join('~') + ':' + e.type; }

test('buildGraph makes one node per Person with derived stage/inactive/elder', () => {
    const g = Graph.buildGraph({ people, families, relationships, relationshipTypes });
    assert.strictEqual(g.nodes.length, 6);
    const byId = Object.fromEntries(g.nodes.map(n => [n.id, n]));
    assert.strictEqual(byId.e.elder, true, 'Elder Tag → elder node');
    assert.strictEqual(byId.p.elder, false);
    assert.strictEqual(byId.k2.inactive, true);
    assert.strictEqual(byId.k1.stage, 'regular_attender');
    assert.strictEqual(byId.e.initials, 'EE');
});

test('buildGraph builds the union of Family + Elder + Custom edges', () => {
    const g = Graph.buildGraph({ people, families, relationships, relationshipTypes });
    const keys = g.edges.map(edgeKey).sort();
    assert.deepStrictEqual(keys, [
        'e~m:elder',        // Mo → Ella (assignment)
        'e~m:rel:t1',       // Mentor
        'k1~p:family',      // Paul → Kid One
        'k1~s:family',      // Sara → Kid One
        'k2~p:family',      // Paul → Kid Two
        'k2~s:family',      // Sara → Kid Two
        'p~s:family',       // spouse
    ].sort());
    assert.strictEqual(g.hasData, true);
});

test('family edges are spouse + parent→child; siblings are NOT explicit edges', () => {
    const g = Graph.buildGraph({ people, families, relationships: [], relationshipTypes: [] });
    const fam = g.edges.filter(e => e.type === 'family');
    // spouse(1) + each parent→each child(4) = 5; K1~K2 sibling link is absent (emerges via shared parents).
    assert.strictEqual(fam.length, 5);
    assert.ok(!fam.some(e => edgeKey(e) === 'k1~k2:family'), 'no explicit sibling edge');
    const spouse = fam.find(e => e.rel === 'spouse');
    assert.deepStrictEqual([spouse.a, spouse.b].sort(), ['p', 's']);
});

test('elder assignment yields a member→elder edge and the Shepherded-By name map', () => {
    const g = Graph.buildGraph({ people, families: [], relationships: [], relationshipTypes: [] });
    const elderEdges = g.edges.filter(e => e.type === 'elder');
    assert.strictEqual(elderEdges.length, 1);
    assert.strictEqual(elderEdges[0].a, 'm');
    assert.strictEqual(elderEdges[0].b, 'e');
    assert.strictEqual(g.assignedElderName['m'], 'Ella Elder');
});

test('customTypes lists every Relationship Type as a toggle key, in input order', () => {
    // Since MS-105 each row also carries the type's kind (so the sidebar can split
    // Group types, which draw bubbles, from edge types) and its priority (which
    // decides an arrowhead, or a leader line). These legacy docs have neither field,
    // so they read as symmetric pairwise types.
    const types = [{ id: 't1', name: 'Mentor' }, { id: 't2', name: 'Dating' }];
    const g = Graph.buildGraph({ people, families: [], relationships: [], relationshipTypes: types });
    assert.deepStrictEqual(g.customTypes, [
        { key: 'rel:t1', label: 'Mentor', kind: 'pairwise', prio: false },
        { key: 'rel:t2', label: 'Dating', kind: 'pairwise', prio: false },
    ]);
});

test('dangling endpoints are dropped — edges only between present nodes', () => {
    const g = Graph.buildGraph({
        people: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
        families: [{ id: 'f', husbandId: 'a', wifeId: 'ghost', childIds: ['b', 'missing'] }],
        relationships: [{ id: 'r', fromId: 'a', toId: 'nobody', typeId: 't1' }],
        relationshipTypes: [{ id: 't1', name: 'Mentor' }],
    });
    // wife 'ghost' absent → no spouse edge and no ghost→child edge; only a→b (parent).
    assert.deepStrictEqual(g.edges.map(edgeKey), ['a~b:family']);
});

test('a relationship with an unknown typeId is skipped', () => {
    const g = Graph.buildGraph({
        people: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
        families: [], relationshipTypes: [{ id: 't1', name: 'Mentor' }],
        relationships: [{ id: 'r', fromId: 'a', toId: 'b', typeId: 'gone' }],
    });
    assert.strictEqual(g.edges.length, 0);
});

test('isElderNode reads the Elder Tag first, then the interim role fallback', () => {
    assert.strictEqual(Graph.isElderNode({ id: 'x', tags: ['Elder'] }), true);
    assert.strictEqual(Graph.isElderNode({ id: 'x', tags: [] }), false);
    // Interim fallback: linked to an elder-role user, tag not yet projected.
    assert.strictEqual(Graph.isElderNode({ id: 'x', tags: [] }, { x: true }), true);
});

test('empty input yields an empty graph with hasData false', () => {
    const g = Graph.buildGraph({});
    assert.deepStrictEqual(g.nodes, []);
    assert.deepStrictEqual(g.edges, []);
    assert.strictEqual(g.hasData, false);
});

test('the Elder Tag id agrees across graph core, shepherding core, and the Cloud Function', () => {
    assert.strictEqual(Graph.ELDER_TAG, Core.ELDER_TAG_ID);
    assert.strictEqual(Graph.ELDER_TAG, Elder.ELDER_TAG);
    assert.strictEqual(Graph.ELDER_TAG, 'Elder');
});
