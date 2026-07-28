const { test } = require('node:test');
const assert = require('node:assert');

const Rel = require('../public/relationship-core.js');

// The sharing decision lives on the Relationship Type, but the SECURITY RULE has
// to answer it about an edge — and an edge stores only { fromId, toId, typeId }.
//
// A rule could look the Type up per edge, but that is a get() for every document
// a query returns: slow, and it hits the rules engine's lookup limits on any real
// list. So the decision is projected onto each edge, the same write-through this
// codebase already uses for Membership Tags, the Elder Tag, and Family relations
// (ADR-0014 §4). The Type stays the source of truth; the edge carries a copy.
//
// Fail closed throughout: an edge that doesn't say it's shared isn't.

const shared = { id: 't1', name: 'Marriage', kind: 'pairwise', priority: false, label: 'Spouse', sharedWithEditors: true };
const secret = { id: 't2', name: 'Discipleship', kind: 'pairwise', priority: true, holderLabel: 'Discipler', counterpartLabel: 'Disciplee' };

const edge = (id, typeId, extra) => Object.assign({ id, fromId: 'a', toId: 'b', typeId }, extra);

// ── Reading an edge ───────────────────────────────────────────────────────────

test('an edge that says it is shared, is', () => {
    assert.equal(Rel.isSharedRelationship(edge('e1', 't1', { sharedWithEditors: true })), true);
});

test('an edge with no projection is not shared', () => {
    // The pre-backfill case. It must read closed, so a record the backfill
    // missed leaks nothing rather than leaking everything.
    assert.equal(Rel.isSharedRelationship(edge('e1', 't1')), false);
});

test('only a real boolean true counts on an edge too', () => {
    for (const value of ['true', 1, {}, 'yes']) {
        assert.equal(
            Rel.isSharedRelationship(edge('e1', 't1', { sharedWithEditors: value })),
            false,
            `${JSON.stringify(value)} must not count as shared`
        );
    }
});

test('a missing edge is not shared', () => {
    assert.equal(Rel.isSharedRelationship(null), false);
    assert.equal(Rel.isSharedRelationship(undefined), false);
});

// ── Stamping a new edge ───────────────────────────────────────────────────────

test('a new edge inherits its Type sharing', () => {
    assert.equal(Rel.withSharing(edge('e1', 't1'), shared).sharedWithEditors, true);
    assert.equal(Rel.withSharing(edge('e2', 't2'), secret).sharedWithEditors, false);
});

test('an edge whose Type is unknown is stamped not-shared', () => {
    // A dangling typeId must not become a hole in the boundary.
    assert.equal(Rel.withSharing(edge('e1', 'gone'), null).sharedWithEditors, false);
});

test('stamping leaves the original edge untouched', () => {
    const original = edge('e1', 't1');
    Rel.withSharing(original, shared);
    assert.equal(original.sharedWithEditors, undefined);
});

test('stamping preserves the rest of the edge', () => {
    const stamped = Rel.withSharing(edge('e1', 't1'), shared);
    assert.equal(stamped.fromId, 'a');
    assert.equal(stamped.toId, 'b');
    assert.equal(stamped.typeId, 't1');
});

// ── Re-projecting when an elder flips the switch ──────────────────────────────

const edges = [
    edge('e1', 't1'),                              // Marriage, unstamped
    edge('e2', 't1', { sharedWithEditors: false }), // Marriage, stale
    edge('e3', 't2', { sharedWithEditors: false }), // Discipleship, correct
    edge('e4', 't1', { sharedWithEditors: true }),  // Marriage, already right
];

test('turning sharing on re-projects only that Type edges that are wrong', () => {
    const plan = Rel.planSharingReprojection(edges, shared);

    // e3 belongs to another Type; e4 is already correct. Neither should be written.
    assert.deepEqual(plan.map(u => u.id).sort(), ['e1', 'e2']);
    plan.forEach(u => assert.equal(u.sharedWithEditors, true));
});

test('turning sharing off re-projects only the edges that were actually open', () => {
    const plan = Rel.planSharingReprojection(edges, { ...shared, sharedWithEditors: false });

    // Only e4 was open. e1 carries no projection at all, which already READS as
    // not-shared, so closing the door costs it no write. e2 is already false.
    assert.deepEqual(plan.map(u => u.id), ['e4']);
    plan.forEach(u => assert.equal(u.sharedWithEditors, false));
});

test('an unprojected edge IS stamped when sharing is turned on', () => {
    // The direction that matters. Skipping a write here would leave an edge
    // reading closed while its Type says open — the failure would be a rule that
    // hides data, not one that leaks it, but it would still be wrong.
    const plan = Rel.planSharingReprojection([edge('e1', 't1')], shared);
    assert.deepEqual(plan, [{ id: 'e1', sharedWithEditors: true }]);
});

test('re-projecting is idempotent — a second pass has nothing to do', () => {
    const first = Rel.planSharingReprojection(edges, shared);
    const applied = edges.map(e => {
        const update = first.find(u => u.id === e.id);
        return update ? { ...e, sharedWithEditors: update.sharedWithEditors } : e;
    });
    assert.deepEqual(Rel.planSharingReprojection(applied, shared), []);
});

test('re-projecting never touches another Type edges', () => {
    const plan = Rel.planSharingReprojection(edges, shared);
    assert.equal(plan.some(u => u.id === 'e3'), false);
});

test('an elder never has to touch edges by hand — the plan covers every stale one', () => {
    const stale = [edge('x1', 't1'), edge('x2', 't1'), edge('x3', 't1')];
    assert.equal(Rel.planSharingReprojection(stale, shared).length, 3);
});

test('re-projecting an empty or missing edge list yields nothing', () => {
    assert.deepEqual(Rel.planSharingReprojection([], shared), []);
    assert.deepEqual(Rel.planSharingReprojection(null, shared), []);
});

test('re-projecting without a Type yields nothing rather than guessing', () => {
    assert.deepEqual(Rel.planSharingReprojection(edges, null), []);
});

test('planning does not mutate the edges it inspects', () => {
    const before = JSON.parse(JSON.stringify(edges));
    Rel.planSharingReprojection(edges, shared);
    assert.deepEqual(edges, before);
});

// ── The two halves agree ─────────────────────────────────────────────────────

test('an edge stamped from a Type reads back the same way the Type does', () => {
    for (const type of [shared, secret]) {
        const stamped = Rel.withSharing(edge('e', type.id), type);
        assert.equal(
            Rel.isSharedRelationship(stamped),
            Rel.isSharedWithEditors(type),
            type.name
        );
    }
});
