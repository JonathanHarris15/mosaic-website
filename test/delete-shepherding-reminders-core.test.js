const { test } = require('node:test');
const assert = require('node:assert');

const P = require('../public/delete-shepherding-reminders-core.js');

test('planDelete allows removal when every reminder is migrated', () => {
    const plan = P.planDelete(
        [{id: 'r1', data: {dueDatetime: new Date()}}],
        [{id: 't1', data: {migratedFrom: 'r1'}}],
    );
    assert.strictEqual(plan.canDelete, true);
    assert.strictEqual(plan.unmigrated, 0);
});

test('planDelete blocks when a reminder is not migrated', () => {
    const plan = P.planDelete(
        [{id: 'r1', data: {dueDatetime: new Date()}}],
        [],
    );
    assert.strictEqual(plan.canDelete, false);
    assert.strictEqual(plan.unmigrated, 1);
});

test('planDelete blocks undated reminders', () => {
    const plan = P.planDelete(
        [{id: 'r1', data: {title: 'no date'}}],
        [],
    );
    assert.strictEqual(plan.canDelete, false);
    assert.strictEqual(plan.undated, 1);
});
