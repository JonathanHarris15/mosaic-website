const { test } = require('node:test');
const assert = require('node:assert');
const Plan = require('../public/delete-legacy-membership-status-core.js');
const Core = require('../public/shepherding-core.js');

test('status inactive backfills inactive and deletes status', () => {
    const plan = Plan.planMembershipStatusRemoval({
        membership: { stage: 'member', status: 'inactive' },
    });
    assert.strictEqual(plan.blocked, false);
    assert.strictEqual(plan.setInactive, true);
    assert.strictEqual(plan.deleteStatus, true);
    assert.strictEqual(Core.isInactiveMembership({ stage: 'member', status: 'inactive' }), false);
    assert.strictEqual(Core.isInactiveMembership({ stage: 'member', inactive: true }), true);
});

test('a conflicting status blocks deletion', () => {
    const plan = Plan.planMembershipStatusRemoval({
        membership: { stage: 'visitor', status: 'member' },
    });
    assert.strictEqual(plan.blocked, true);
    assert.ok(plan.blockReasons.length);
});

test('inactive flag alone is enough with no status field', () => {
    const plan = Plan.planMembershipStatusRemoval({
        membership: { stage: 'member', inactive: true },
    });
    assert.strictEqual(plan.deleteStatus, false);
    assert.strictEqual(plan.setInactive, false);
});
