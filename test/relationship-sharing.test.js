const { test } = require('node:test');
const assert = require('node:assert');

const Rel = require('../public/relationship-core.js');

// Shared with Editors (MS-128). The Relationship graph is elder-only (ADR-0013,
// ADR-0014). Serving restrictions need "no married couple in Kids", which means
// an editor has to see SOME of it — so elders open a door one Relationship Type
// at a time.
//
// This is a disclosure boundary, so everything here fails closed: not shared
// unless something explicitly says shared.

const marriage = {
    id: 't1', name: 'Marriage', kind: 'pairwise', priority: false, label: 'Spouse',
};
const discipleship = {
    id: 't2', name: 'Discipleship', kind: 'pairwise', priority: true,
    holderLabel: 'Discipler', counterpartLabel: 'Disciplee',
};

// ── Fail closed ───────────────────────────────────────────────────────────────

test('a Type says nothing about sharing, so it is not shared', () => {
    assert.equal(Rel.isSharedWithEditors(marriage), false);
});

test('only a real boolean true means shared', () => {
    assert.equal(Rel.isSharedWithEditors({ ...marriage, sharedWithEditors: true }), true);
});

test('anything truthy-but-not-true is still not shared', () => {
    // A string "true" out of a form, a 1 out of a checkbox, a stray object —
    // none of these may open the door. Being wrong here leaks the graph.
    for (const value of ['true', 'yes', 1, {}, [], 'false', -1]) {
        assert.equal(
            Rel.isSharedWithEditors({ ...marriage, sharedWithEditors: value }),
            false,
            `${JSON.stringify(value)} must not count as shared`
        );
    }
});

test('an absent, null, or undefined Type is not shared', () => {
    assert.equal(Rel.isSharedWithEditors(null), false);
    assert.equal(Rel.isSharedWithEditors(undefined), false);
    assert.equal(Rel.isSharedWithEditors({}), false);
});

// ── The setting survives being stored ─────────────────────────────────────────

test('canonicalType keeps the setting', () => {
    const stored = Rel.canonicalType({ ...marriage, sharedWithEditors: true });
    assert.equal(stored.sharedWithEditors, true);
});

test('canonicalType keeps the setting across a priority change', () => {
    // Editing a Type's shape rewrites its label fields. The sharing decision is
    // not a label and must not be collateral damage.
    const stored = Rel.canonicalType({
        ...marriage, sharedWithEditors: true,
        priority: true, holderLabel: 'Husband', counterpartLabel: 'Wife',
    });
    assert.equal(stored.sharedWithEditors, true);
    assert.equal(stored.holderLabel, 'Husband');
});

test('canonicalType keeps the setting across a kind change', () => {
    const stored = Rel.canonicalType({
        ...discipleship, sharedWithEditors: true, kind: 'group',
        leaderLabel: 'Leader', memberLabel: 'Member',
    });
    assert.equal(stored.sharedWithEditors, true);
});

test('canonicalType writes the setting as an explicit boolean', () => {
    // The security rule (MS-133) should never have to tell "absent" from
    // "false" — a stored Type always states its answer.
    assert.equal(Rel.canonicalType(marriage).sharedWithEditors, false);
    assert.equal(typeof Rel.canonicalType(marriage).sharedWithEditors, 'boolean');
});

test('canonicalType normalises a junk value down to false, never up to true', () => {
    assert.equal(Rel.canonicalType({ ...marriage, sharedWithEditors: 'true' }).sharedWithEditors, false);
});

test('canonicalType still strips the label fields a shape does not use', () => {
    // Guarding the behaviour this ticket originally misread: adding the sharing
    // field must not have turned canonicalType into a pass-through.
    const stored = Rel.canonicalType({
        ...marriage, sharedWithEditors: true,
        holderLabel: 'stale', counterpartLabel: 'stale',
    });
    assert.equal(stored.holderLabel, undefined);
    assert.equal(stored.counterpartLabel, undefined);
    assert.equal(stored.label, 'Spouse');
});

// ── Validation ────────────────────────────────────────────────────────────────

test('a Type with no sharing setting is valid', () => {
    assert.equal(Rel.validateType(marriage).valid, true);
});

test('a boolean sharing setting is valid either way', () => {
    assert.equal(Rel.validateType({ ...marriage, sharedWithEditors: true }).valid, true);
    assert.equal(Rel.validateType({ ...marriage, sharedWithEditors: false }).valid, true);
});

test('a non-boolean sharing setting is rejected, not coerced', () => {
    const result = Rel.validateType({ ...marriage, sharedWithEditors: 'true' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => /shared/i.test(e)));
});

test('editing a Type validates the sharing setting too', () => {
    const bad = Rel.validateEdit(marriage, { sharedWithEditors: 'yes' });
    assert.equal(bad.valid, false);

    const good = Rel.validateEdit(marriage, { sharedWithEditors: true });
    assert.equal(good.valid, true);
});

test('sharing can be turned on and off — it is not immutable like kind', () => {
    const on = Rel.validateEdit({ ...marriage, sharedWithEditors: false }, { sharedWithEditors: true });
    const off = Rel.validateEdit({ ...marriage, sharedWithEditors: true }, { sharedWithEditors: false });
    assert.equal(on.valid, true);
    assert.equal(off.valid, true);
});

// ── Selecting what an editor may see ──────────────────────────────────────────

test('the shared Types are filtered out of a mixed list', () => {
    const types = [
        { ...marriage, sharedWithEditors: true },
        discipleship,
        { id: 't3', name: 'Care Group', kind: 'group', priority: false, label: 'Member' },
    ];
    assert.deepEqual(Rel.sharedTypes(types).map(t => t.name), ['Marriage']);
});

test('filtering an empty or missing list yields nothing', () => {
    assert.deepEqual(Rel.sharedTypes([]), []);
    assert.deepEqual(Rel.sharedTypes(null), []);
});

test('when nothing is shared, an editor sees nothing', () => {
    assert.deepEqual(Rel.sharedTypes([marriage, discipleship]), []);
});
