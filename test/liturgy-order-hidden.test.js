const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const Core = require(path.join(__dirname, '..', 'public', 'liturgy-order-core.js'));

function catalogWithOrders(orders) {
    return Core.catalogFrom({ orders });
}

test('orderIsHidden is true when ops or hidden is set', () => {
    assert.equal(Core.orderIsHidden({ id: 'x', ops: true }), true);
    assert.equal(Core.orderIsHidden({ id: 'x', hidden: true }), true);
    assert.equal(Core.orderIsHidden({ id: 'x' }), false);
});

test('visibleOrders drops hidden fixtures from ordinary lists', () => {
    const catalog = catalogWithOrders([
        { id: 'standard', name: 'Standard', elements: [] },
        { id: 'baptism', name: 'Baptism week', elements: [] },
        { id: 'textbelt-url-test', name: 'TEXTBELT', ops: true, elements: [] },
    ]);
    const visible = Core.visibleOrders(catalog);
    assert.deepEqual(visible.map((o) => o.id), ['standard', 'baptism']);
});

test('readToggles forgets a stored hidden order id', () => {
    const catalog = catalogWithOrders([
        { id: 'standard', name: 'Standard', elements: [] },
        { id: 'textbelt-url-test', name: 'TEXTBELT', ops: true, elements: [] },
    ]);
    const toggles = Core.readToggles(['standard', 'textbelt-url-test'], catalog);
    assert.deepEqual(toggles, ['standard']);
});

test('orderFor still resolves a Sunday on a hidden order', () => {
    const catalog = catalogWithOrders([
        { id: 'standard', name: 'Standard', elements: [] },
        { id: 'textbelt-url-test', name: 'TEXTBELT', ops: true, elements: [{ id: 'hymn1', kind: 'hymn', name: 'Hymn' }] },
    ]);
    const order = Core.orderFor({ liturgyOrderId: 'textbelt-url-test' }, catalog);
    assert.equal(order.id, 'textbelt-url-test');
});
