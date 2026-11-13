const { test } = require('node:test');
const assert = require('node:assert');
const Plan = require('../public/normalise-care-list-documents-core.js');
const CareList = require('../public/care-list-core.js');

const body = (text) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

test('a bare care-list body plans a column normalise', () => {
    const data = {
        docType: 'care-list',
        title: 'Visits',
        careListData: { bob: body('Meals') },
    };
    const plan = Plan.planCareListNormalise(data);
    assert.strictEqual(plan.needsNormalise, true);
    assert.deepStrictEqual(plan.patch.careListColumns, [{ id: 'col_default', name: 'Notes' }]);
    assert.deepStrictEqual(plan.patch.careListData.bob.col_default, body('Meals'));
    assert.strictEqual(CareList.isOldShape(Object.assign({}, data, plan.patch)), false);
});

test('a column-shaped care list needs no patch', () => {
    const data = {
        docType: 'care-list',
        careListColumns: [{ id: 'col_1', name: 'Notes' }],
        careListData: { bob: { col_1: body('ok') } },
    };
    const plan = Plan.planCareListNormalise(data);
    assert.strictEqual(plan.needsNormalise, false);
});
