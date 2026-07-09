const { test } = require('node:test');
const assert = require('node:assert');

const { deriveMembership } = require('../scripts/migrate-membership-track.js');

// The migration derives the Membership Stage from the EXISTING tags first (that
// is where membership actually lives in the real data), falling back to the
// legacy `membership.status` only when no membership tag is present.

test('a Member tag derives the member stage even when status is empty', () => {
    const m = deriveMembership({ tags: ['Member', 'New Parent'], membership: { status: '' } });
    assert.strictEqual(m.stage, 'member');
    assert.strictEqual(m.inactive, false);
    assert.strictEqual(m.conflict, null);
});

test('Moving Membership wins over the Member tag it is paired with', () => {
    const m = deriveMembership({ tags: ['Member', 'Moving Membership'] });
    assert.strictEqual(m.stage, 'moving_membership');
});

test('each stage tag derives its stage', () => {
    assert.strictEqual(deriveMembership({ tags: ['Regular Attender'] }).stage, 'regular_attender');
    assert.strictEqual(deriveMembership({ tags: ['Visitor'] }).stage, 'visitor');
    assert.strictEqual(deriveMembership({ tags: ['Previous Member'] }).stage, 'previous_member');
});

test('with no membership tag, the legacy status is the fallback', () => {
    assert.strictEqual(deriveMembership({ tags: ['New Parent'], membership: { status: 'member' } }).stage, 'member');
    assert.strictEqual(deriveMembership({ tags: [], membership: { status: 'visitor' } }).stage, 'visitor');
    assert.strictEqual(deriveMembership({ tags: [] }).stage, null); // nothing to go on
});

test('Inactive comes from the flag, the legacy inactive status, or an Inactive tag', () => {
    assert.strictEqual(deriveMembership({ membership: { inactive: true } }).inactive, true);
    assert.strictEqual(deriveMembership({ membership: { status: 'inactive' } }).inactive, true);
    assert.strictEqual(deriveMembership({ tags: ['Inactive'] }).inactive, true);
    assert.strictEqual(deriveMembership({ tags: ['Member'] }).inactive, false);
});

test('a status that disagrees with the tag-derived stage is flagged as a conflict', () => {
    // Real case: status 'previous_member' but still carrying the Member tag.
    const m = deriveMembership({ tags: ['Member'], membership: { status: 'previous_member' } });
    assert.strictEqual(m.stage, 'member'); // tag wins, not silently overridden
    assert.deepStrictEqual(m.conflict, { statusStage: 'previous_member', tagStage: 'member' });
});

test('an agreeing status produces no conflict', () => {
    const m = deriveMembership({ tags: ['Member'], membership: { status: 'member' } });
    assert.strictEqual(m.conflict, null);
});
