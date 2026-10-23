const { test } = require('node:test');
const assert = require('node:assert');

const Plan = require('../public/delete-legacy-irregular-sunday-core.js');
const ServiceRead = require('../public/service-read-core.js');
const Liturgy = require('../public/liturgy-order-core.js');

test('MS-796 — irregular elements migrate into liturgyLeftovers', () => {
    const plan = Plan.planIrregularSundayMigration({
        isIrregular: true,
        liturgyLeftovers: [{ sourceId: 'x', name: 'Kept', kind: 'text', value: 'a' }],
        irregularElements: [{ key: 'Sermon', type: 'text', value: 'John 1' }],
    });
    assert.equal(plan.migrate, true);
    assert.equal(plan.leftoversAdded, 1);
    assert.equal(plan.liturgyLeftovers.length, 2);
    assert.equal(plan.liturgyLeftovers[1].name, 'Sermon');
    assert.equal(plan.liturgyLeftovers[1].valueText, 'John 1');
});

test('MS-796 — MCP read no longer returns irregular fields', () => {
    const readable = ServiceRead.readableService('2026-01-05', {
        liturgyOrderId: 'standard',
        liturgy: {},
        isIrregular: true,
        irregularElements: [{ id: 'e1', name: 'Extra' }],
    }, { orders: [Liturgy.STANDARD_ORDER] });
    assert.equal(readable.isIrregular, undefined);
    assert.equal(readable.irregularElements, undefined);
});
