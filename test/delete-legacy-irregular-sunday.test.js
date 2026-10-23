const { test } = require('node:test');
const assert = require('node:assert');

const Plan = require('../public/delete-legacy-irregular-sunday-core.js');
const ServiceRead = require('../public/service-read-core.js');

test('MS-796 — irregular field deletion is planned for legacy services', () => {
    assert.equal(Plan.planIrregularFieldDeletion({ theme: 'x' }).deleteFields, false);
    assert.equal(Plan.planIrregularFieldDeletion({ isIrregular: true }).deleteFields, true);
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
