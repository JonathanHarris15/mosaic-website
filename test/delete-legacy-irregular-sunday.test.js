const { test } = require('node:test');
const assert = require('node:assert');

const Plan = require('../public/delete-legacy-irregular-sunday-core.js');
const ServiceRead = require('../public/service-read-core.js');

test('MS-796 — irregular elements migrate into liturgyLeftovers', () => {
    const plan = Plan.planIrregularSundayMigration({
        isIrregular: true,
        liturgyLeftovers: [{ sourceId: 'x', name: 'Kept', kind: 'text', value: 'a' }],
        irregularElements: [{ key: 'Sermon', type: 'text', value: 'John 1' }],
    });
    assert.equal(plan.migrate, true);
    assert.equal(plan.leftoversAdded, 1);
    const leftovers = plan.liturgyLeftovers || [];
    assert.equal(leftovers.length, 2);
    const added = /** @type {{name?: string, valueText?: string}} */ (leftovers[1]);
    assert.equal(added.name, 'Sermon');
    assert.equal(added.valueText, 'John 1');
});

test('MS-796 — stale legacy keys migrate with zero element copies', () => {
    const plan = Plan.planIrregularSundayMigration({
        isIrregular: false,
        irregularElements: [],
        liturgyOrderId: 'standard',
    });
    assert.equal(plan.migrate, true);
    assert.equal(plan.irregular, false);
    assert.equal(plan.leftoversAdded, 0);
});

test('MS-796 — replanning does not duplicate legacy-irregular leftovers', () => {
    const doc = {
        isIrregular: true,
        liturgyLeftovers: [{
            sourceId: 'legacy-irregular:0',
            name: 'Sermon',
            kind: 'text',
            value: 'John 1',
            valueText: 'John 1',
        }],
        irregularElements: [{ key: 'Sermon', type: 'text', value: 'John 1' }],
    };
    const plan = Plan.planIrregularSundayMigration(doc);
    assert.equal(plan.leftoversAdded, 0);
    assert.equal((plan.liturgyLeftovers || []).length, 1);
});

test('MS-796 — MCP read no longer returns irregularElements', () => {
    const readable = ServiceRead.readableService('2026-01-05', {
        liturgyOrderId: 'standard',
        liturgy: {},
        isIrregular: true,
        irregularElements: [{ id: 'e1', name: 'Extra' }],
    }, { id: 'standard', name: 'Standard', elementIds: [] }, []);
    assert.equal(readable.isIrregular, undefined);
    assert.equal(readable.irregularElements, undefined);
});
