const { test } = require('node:test');
const assert = require('node:assert');

const Elder = require('../functions/elder-sync.js');

// Pure decision logic for the Elder-Tag projection (ADR-0013, MS-92). The
// Firestore trigger reconciles the Person's tag from its linked user's role;
// these are the rules it wraps. Sibling of functions/member-sync.js, but the
// Elder Tag syncs BOTH ways (add and remove) because it is a Projected Tag.

test('isElderPermissionLevel is true only for elder — super_admin is NOT an elder', () => {
    assert.strictEqual(Elder.isElderPermissionLevel('elder'), true);
    assert.strictEqual(Elder.isElderPermissionLevel('super_admin'), false);
    assert.strictEqual(Elder.isElderPermissionLevel('admin'), false);
    assert.strictEqual(Elder.isElderPermissionLevel('editor'), false);
    assert.strictEqual(Elder.isElderPermissionLevel('member'), false);
    assert.strictEqual(Elder.isElderPermissionLevel('viewer'), false);
    assert.strictEqual(Elder.isElderPermissionLevel(undefined), false);
});

test('hasElderTag detects the Elder tag by exact name', () => {
    assert.strictEqual(Elder.hasElderTag(['Member', 'Elder']), true);
    assert.strictEqual(Elder.hasElderTag(['Member']), false);
    assert.strictEqual(Elder.hasElderTag([]), false);
    assert.strictEqual(Elder.hasElderTag(undefined), false);
    // Whole-tag match — a tag that merely contains the word doesn't count.
    assert.strictEqual(Elder.hasElderTag(['Elder Board']), false);
});

test('shouldAddElderTag: add iff an elder whose person lacks the tag', () => {
    assert.strictEqual(Elder.shouldAddElderTag('elder', ['Member']), true);
    assert.strictEqual(Elder.shouldAddElderTag('elder', ['Member', 'Elder']), false); // already tagged → no-op
    assert.strictEqual(Elder.shouldAddElderTag('super_admin', ['Member']), false);    // not an elder
    assert.strictEqual(Elder.shouldAddElderTag('viewer', []), false);
});

test('shouldRemoveElderTag: remove iff a non-elder whose person still carries the tag', () => {
    assert.strictEqual(Elder.shouldRemoveElderTag('member', ['Member', 'Elder']), true); // role changed away
    assert.strictEqual(Elder.shouldRemoveElderTag('super_admin', ['Elder']), true);      // not an elder
    assert.strictEqual(Elder.shouldRemoveElderTag('elder', ['Elder']), false);           // still an elder → keep
    assert.strictEqual(Elder.shouldRemoveElderTag('member', ['Member']), false);         // nothing to remove
});

test('add and remove are mutually exclusive — a tag is never both added and removed', () => {
    for (const role of ['elder', 'super_admin', 'member', 'viewer', undefined]) {
        for (const tags of [[], ['Elder'], ['Member'], ['Member', 'Elder']]) {
            assert.ok(!(Elder.shouldAddElderTag(role, tags) && Elder.shouldRemoveElderTag(role, tags)),
                `role=${role} tags=${JSON.stringify(tags)} must not both add and remove`);
        }
    }
});

test('the projected tag id matches the client ELDER_TAG_ID', () => {
    // Both surfaces must agree on the tag name (the client sets ShepherdingCore.ELDER_TAG_ID = 'Elder').
    assert.strictEqual(Elder.ELDER_TAG, 'Elder');
});
