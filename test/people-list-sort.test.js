const { test } = require('node:test');
const assert = require('node:assert');
const Core = require('../public/shepherding-core.js');

const DAY = 24 * 60 * 60 * 1000;

test('comparePeopleList sorts date added newest first', () => {
    const a = { name: 'A', createdAt: { toMillis: () => 1000 } };
    const b = { name: 'B', createdAt: { toMillis: () => 1000 + DAY } };
    assert.ok(Core.comparePeopleList(a, b, 'added') > 0);
    assert.ok(Core.comparePeopleList(b, a, 'added') < 0);
});

test('comparePeopleList sinks missing createdAt when sorting by added', () => {
    const old = { name: 'Old', createdAt: { toMillis: () => 1000 } };
    const unknown = { name: 'Unknown' };
    assert.ok(Core.comparePeopleList(unknown, old, 'added') > 0);
});

test('comparePeopleList sorts tag date by heldSinceMs newest first', () => {
    const a = { id: 'p1', name: 'A' };
    const b = { id: 'p2', name: 'B' };
    const tagHolds = {
        p1: { T: { heldSinceMs: 1000, durationMs: DAY } },
        p2: { T: { heldSinceMs: 5000, durationMs: DAY } },
    };
    assert.ok(Core.comparePeopleList(a, b, 'tagDate', { tagHolds, tagId: 'T' }) > 0);
});

test('comparePeopleList sinks unknown tag hold when sorting by tag date', () => {
    const known = { id: 'p1', name: 'K' };
    const unknown = { id: 'p2', name: 'U' };
    const tagHolds = { p1: { T: { heldSinceMs: 1000, durationMs: DAY } } };
    assert.ok(Core.comparePeopleList(unknown, known, 'tagDate', { tagHolds, tagId: 'T' }) > 0);
});
