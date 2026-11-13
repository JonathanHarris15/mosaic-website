const { test } = require('node:test');
const assert = require('node:assert/strict');

const Plan = require('../public/migrate-inline-liturgy-elements-core.js');

test('an order with elements needs no write', () => {
    const out = Plan.planOrderInline(
        { id: 'standard', elements: [{ id: 'hymn1', kind: 'hymn', name: 'Hymn', hasNote: true }] },
        new Map()
    );
    assert.equal(out.kind, 'ok');
    assert.equal(out.write, false);
});

test('elementIds without elements inlines from loose docs', () => {
    const loose = new Map([
        ['offertory', { id: 'offertory', kind: 'other', name: 'Offertory', hasNote: true }],
    ]);
    const out = Plan.planOrderInline(
        { id: 'evening', elementIds: ['offertory'] },
        loose
    );
    assert.equal(out.kind, 'ok');
    assert.equal(out.write, true);
    assert.deepEqual(out.update.elementIds, ['offertory']);
    assert.equal(out.update.elements[0].kind, 'other');
});

test('missing loose elements block the plan', () => {
    const out = Plan.planOrderInline(
        { id: 'evening', elementIds: ['ghost'] },
        new Map()
    );
    assert.equal(out.kind, 'blocked');
    assert.deepEqual(out.missingIds, ['ghost']);
});
