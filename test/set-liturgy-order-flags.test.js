const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
    ordersMatchingName,
    resolveOrderIdByNameMatch,
    formatOrderListLines,
} = require('../scripts/set-liturgy-order-flags-lib');

const SAMPLE = [
    {id: 'standard', name: 'Standard', ops: false},
    {id: 'abc123', name: 'TEXTBELT URL whitelist test (ops)'},
    {id: 'baptism', name: 'Baptism week', hidden: true},
];

test('ordersMatchingName is case-insensitive substring', () => {
    const hits = ordersMatchingName(SAMPLE, 'textbelt');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, 'abc123');
});

test('resolveOrderIdByNameMatch returns the sole match', () => {
    assert.equal(
        resolveOrderIdByNameMatch(SAMPLE, 'whitelist test'),
        'abc123');
});

test('resolveOrderIdByNameMatch errors on zero or many', () => {
    assert.throws(
        () => resolveOrderIdByNameMatch(SAMPLE, 'missing'),
        /No liturgy_orders/);
    assert.throws(
        () => resolveOrderIdByNameMatch(SAMPLE, 'a'),
        /Multiple liturgy orders/);
});

test('formatOrderListLines prints id, name, ops, hidden', () => {
    const lines = formatOrderListLines(SAMPLE);
    assert.equal(lines[0], 'id\tname\tops\thidden');
    assert.match(lines.join('\n'), /abc123\tTEXTBELT URL whitelist test \(ops\)\tfalse\tfalse/);
    assert.match(lines.join('\n'), /baptism\tBaptism week\tfalse\ttrue/);
});
