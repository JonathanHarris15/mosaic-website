// What a Liturgy Orders save writes. Pure: no Firestore. Deleting an element
// or an order removes that document and does not touch a Sunday.

const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/liturgy-order-core.js');
const Store = require('../public/liturgy-order-store.js');

test('planSave writes the draft and deletes only the records the draft dropped', () => {
    const made = Core.addElement(Core.standardCatalog(), { name: 'Offertory', primitive: 'text' });
    const plan = Store.planSave(made.catalog, {
        elementIds: ['preparatoryHymn', 'retired'],
        orderIds: ['standard', 'oldOrder'],
    });

    assert.deepEqual(plan.setElements, []);
    assert.deepEqual(plan.deleteElements, ['preparatoryHymn', 'retired']);
    assert.deepEqual(plan.deleteOrders, ['oldOrder']);
    assert.ok(!plan.setOrders.some(function (order) { return order.id === 'oldOrder'; }));
    assert.equal(plan.services, undefined);
    const standard = plan.setOrders.find(function (order) { return order.id === 'standard'; });
    assert.ok(standard.elements.some(function (el) { return el.id === 'preparatoryHymn' && el.kind === 'hymn'; }));
    standard.elements.forEach(function (el) {
        assert.ok(!el.primitive, 'a kind is not stored as a primitive');
        assert.ok(!el.hasRole, 'a person event is the person; there is no carried-by flag');
    });
});
