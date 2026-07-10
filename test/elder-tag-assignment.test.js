const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/shepherding-core.js');

// The Elder Tag (a Projected Tag) and Elder Assignment (ADR-0013, MS-91). The
// pure pieces — the generalised immutable-tag check, the elder-tag projection,
// the assignable-set / Care-Group queries, and the Assignment Change builders —
// live in shepherding-core.js and are pinned here. The browser dual-write
// (commitAssignmentChange) is exercised with the same fake-batch pattern as the
// existing Pastoral Record writer tests.

// ── Projected Tag = Membership Tags ∪ Elder Tag ─────────────────────────────
// The immutability check the tag-management UI consults must now cover BOTH
// families, without loosening the membership-only check that still has callers.

test('isProjectedTagId covers every Membership Tag and the Elder Tag', () => {
    for (const id of Core.MEMBERSHIP_TAG_IDS) {
        assert.strictEqual(Core.isProjectedTagId(id), true, `${id} is projected`);
    }
    assert.strictEqual(Core.isProjectedTagId(Core.ELDER_TAG_ID), true);
    assert.strictEqual(Core.isProjectedTagId('Elder'), true);
});

test('isProjectedTagId rejects ordinary hand-authored tags', () => {
    assert.strictEqual(Core.isProjectedTagId('Needs a call'), false);
    assert.strictEqual(Core.isProjectedTagId('New Believer'), false);
    assert.strictEqual(Core.isProjectedTagId(''), false);
    assert.strictEqual(Core.isProjectedTagId(undefined), false);
});

test('the Elder Tag is a Projected Tag but NOT a Membership Tag', () => {
    // The two families stay distinct: membership-only callers must not suddenly
    // treat the Elder Tag as a membership tag (it would corrupt the re-projection).
    assert.strictEqual(Core.isMembershipTagId('Elder'), false);
    assert.strictEqual(Core.isProjectedTagId('Elder'), true);
    // ...and a Membership Tag is still projected.
    assert.strictEqual(Core.isMembershipTagId('Member'), true);
    assert.strictEqual(Core.isProjectedTagId('Member'), true);
});

test('PROJECTED_TAG_IDS is exactly the Membership Tags plus the Elder Tag', () => {
    assert.deepStrictEqual(
        Core.PROJECTED_TAG_IDS.slice().sort(),
        Core.MEMBERSHIP_TAG_IDS.concat(['Elder']).sort());
});

// ── isElderUser — the projection's source of truth ──────────────────────────
// Elder-ness projects from the linked User's role being exactly 'elder'. A Super
// Admin is a distinct office and is NOT an elder.

test('isElderUser is true only for the elder role', () => {
    assert.strictEqual(Core.isElderUser({ role: 'elder' }), true);
    assert.strictEqual(Core.isElderUser({ role: 'super_admin' }), false);
    assert.strictEqual(Core.isElderUser({ role: 'admin' }), false);
    assert.strictEqual(Core.isElderUser({ role: 'editor' }), false);
    assert.strictEqual(Core.isElderUser({ role: 'viewer' }), false);
    assert.strictEqual(Core.isElderUser(null), false);
    assert.strictEqual(Core.isElderUser(undefined), false);
});

// ── applyElderTag — the pure projection ─────────────────────────────────────
// Re-project the Elder Tag onto a Person's tags: drop it, then re-add iff elder.
// Idempotent and order-preserving, exactly like applyMembershipTags.

test('applyElderTag adds the Elder Tag for an elder and leaves other tags intact', () => {
    assert.deepStrictEqual(Core.applyElderTag(['Member', 'Needs a call'], true), ['Member', 'Needs a call', 'Elder']);
});

test('applyElderTag removes the Elder Tag when the Person is no longer an elder', () => {
    assert.deepStrictEqual(Core.applyElderTag(['Member', 'Elder', 'Needs a call'], false), ['Member', 'Needs a call']);
});

test('applyElderTag is idempotent — never duplicates the Elder Tag', () => {
    assert.deepStrictEqual(Core.applyElderTag(['Elder', 'Member'], true), ['Member', 'Elder']);
});

test('applyElderTag on empty / missing tags', () => {
    assert.deepStrictEqual(Core.applyElderTag([], true), ['Elder']);
    assert.deepStrictEqual(Core.applyElderTag(undefined, true), ['Elder']);
    assert.deepStrictEqual(Core.applyElderTag(undefined, false), []);
});

test('applyElderTag composes with applyMembershipTags without clobbering either', () => {
    // A member who becomes an elder ends up carrying both projected tags.
    let tags = Core.applyMembershipTags(['Needs a call'], { stage: 'member', inactive: false });
    tags = Core.applyElderTag(tags, true);
    assert.deepStrictEqual(tags, ['Needs a call', 'Member', 'Elder']);
    // Re-projecting membership must not drop the Elder Tag (it's not a membership tag).
    tags = Core.applyMembershipTags(tags, { stage: 'member', inactive: false });
    assert.ok(tags.includes('Elder'), 'membership re-projection preserves the Elder Tag');
});

// ── isElderPerson / careGroupOf — assignable set + reverse query ─────────────

test('isElderPerson is the Elder-Tag predicate (the assignable set)', () => {
    assert.strictEqual(Core.isElderPerson({ tags: ['Member', 'Elder'] }), true);
    assert.strictEqual(Core.isElderPerson({ tags: ['Member'] }), false);
    assert.strictEqual(Core.isElderPerson({ tags: [] }), false);
    assert.strictEqual(Core.isElderPerson({}), false);
    assert.strictEqual(Core.isElderPerson(null), false);
});

test('careGroupOf returns the members assigned to an elder, and nothing for a non-elder id', () => {
    const people = [
        { id: 'm1', shepherding: { assignedElderId: 'e1' } },
        { id: 'm2', shepherding: { assignedElderId: 'e2' } },
        { id: 'm3', shepherding: { assignedElderId: 'e1' } },
        { id: 'm4' },                              // unassigned
        { id: 'm5', shepherding: {} },             // no assignment
    ];
    assert.deepStrictEqual(Core.careGroupOf(people, 'e1').map(p => p.id), ['m1', 'm3']);
    assert.deepStrictEqual(Core.careGroupOf(people, 'e2').map(p => p.id), ['m2']);
    assert.deepStrictEqual(Core.careGroupOf(people, 'nobody'), []);
    assert.deepStrictEqual(Core.careGroupOf(people, null), []);
});

// ── buildAssignmentChange / describeAssignmentChange ────────────────────────

test('buildAssignmentChange produces an assignment_change record mirroring Membership Change', () => {
    const rec = Core.buildAssignmentChange({
        previous: { elderId: null, elderName: '' },
        next: { elderId: 'e1', elderName: 'Sam Elder' },
        authorUid: 'u9', authorName: 'Admin', source: 'profile',
    });
    assert.strictEqual(rec.kind, 'assignment_change');
    assert.strictEqual(rec.previousElderId, null);
    assert.strictEqual(rec.newElderId, 'e1');
    assert.strictEqual(rec.newElderName, 'Sam Elder');
    assert.strictEqual(rec.authorName, 'Admin');
    assert.strictEqual(rec.source, 'profile');
    assert.strictEqual(rec.explanation, '');
});

test('describeAssignmentChange reads set / reassign / clear naturally', () => {
    assert.strictEqual(
        Core.describeAssignmentChange({ previousElderId: null, newElderId: 'e1', newElderName: 'Sam' }),
        'Assigned to Sam');
    assert.strictEqual(
        Core.describeAssignmentChange({ previousElderId: 'e1', previousElderName: 'Sam', newElderId: 'e2', newElderName: 'Pat' }),
        'Reassigned from Sam to Pat');
    assert.strictEqual(
        Core.describeAssignmentChange({ previousElderId: 'e1', previousElderName: 'Sam', newElderId: null }),
        'Unassigned from Sam');
});

// ── commitAssignmentChange — atomic dual-write (browser) ─────────────────────
// One batch: set shepherding.assignedElderId on the member AND append exactly one
// Assignment Change. Same fake-batch recorder the Pastoral Record writer uses.

test('commitAssignmentChange writes the field and one Assignment Change in a single batch', () => {
    const calls = { update: [], set: [], commit: 0 };
    const batch = {
        update: (ref, data) => calls.update.push({ ref, data }),
        set: (ref, data) => calls.set.push({ ref, data }),
        commit: () => { calls.commit++; return Promise.resolve(); },
    };
    const fakeDb = {
        batch: () => batch,
        collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ __activity: true }) }), __person: true }) }),
    };
    global.firebase = { firestore: { FieldValue: { serverTimestamp: () => '__ts__' } } };
    try {
        return Core.commitAssignmentChange(fakeDb, 'm1', {
            previous: { elderId: null, elderName: '' },
            next: { elderId: 'e1', elderName: 'Sam Elder' },
            authorUid: 'u9', authorName: 'Admin', source: 'profile',
        }).then(() => {
            assert.strictEqual(calls.update.length, 1, 'one person update');
            assert.strictEqual(calls.update[0].data['shepherding.assignedElderId'], 'e1');
            assert.strictEqual(calls.set.length, 1, 'one activity set');
            assert.strictEqual(calls.set[0].data.kind, 'assignment_change');
            assert.strictEqual(calls.set[0].data.newElderId, 'e1');
            assert.strictEqual(calls.set[0].data.createdAt, '__ts__', 'activity stamped at write time');
            assert.strictEqual(calls.commit, 1, 'committed exactly once');
        });
    } finally {
        delete global.firebase;
    }
});

test('commitAssignmentChange clears the assignment (unassign) as a null field write', () => {
    const calls = { update: [], set: [], commit: 0 };
    const batch = {
        update: (ref, data) => calls.update.push({ ref, data }),
        set: (ref, data) => calls.set.push({ ref, data }),
        commit: () => { calls.commit++; return Promise.resolve(); },
    };
    const fakeDb = {
        batch: () => batch,
        collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }),
    };
    global.firebase = { firestore: { FieldValue: { serverTimestamp: () => '__ts__' } } };
    try {
        return Core.commitAssignmentChange(fakeDb, 'm1', {
            previous: { elderId: 'e1', elderName: 'Sam Elder' },
            next: { elderId: null, elderName: '' },
            authorName: 'Admin', source: 'profile',
        }).then(() => {
            assert.strictEqual(calls.update[0].data['shepherding.assignedElderId'], null);
            assert.strictEqual(calls.set[0].data.kind, 'assignment_change');
            assert.strictEqual(calls.set[0].data.previousElderId, 'e1');
            assert.strictEqual(calls.set[0].data.newElderId, null);
        });
    } finally {
        delete global.firebase;
    }
});
