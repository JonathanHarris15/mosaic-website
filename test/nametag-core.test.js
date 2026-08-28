const { test } = require('node:test');
const assert = require('node:assert');

const Nametag = require('../public/nametag-core.js');

test('an adult gets one name tag and a kid gets a tag plus a stub', () => {
    const pickup = { sam: '7QK4' };
    const labels = Nametag.labelsFor([
        { personId: 'bob', name: 'Bob Harris', kid: false },
        { personId: 'sam', name: 'Sam Harris', kid: true },
    ], { eventName: 'Sunday Service', date: 'Sunday, August 30, 2026' }, pickup);
    assert.deepStrictEqual(labels.map(l => l.kind), ['adult', 'child', 'stub']);
    assert.strictEqual(labels[0].first, 'Bob');
    assert.strictEqual(labels[1].code, '7QK4');
    assert.strictEqual(labels[2].code, '7QK4');
    assert.strictEqual(labels[2].kind, 'stub');
});

test('two kids in one batch get different pickup numbers', () => {
    const members = [
        { personId: 'a', name: 'Ann', kid: true },
        { personId: 'b', name: 'Ben', kid: true },
    ];
    const pickup = Nametag.assignPickupCodes(members, []);
    assert.ok(pickup.a);
    assert.ok(pickup.b);
    assert.notStrictEqual(pickup.a, pickup.b);
});

test('marking the same kid present again at the same event reuses the number', () => {
    const members = [{ personId: 'a', name: 'Ann', kid: true }];
    const once = Nametag.assignPickupCodes(members, []);
    const twice = Nametag.assignPickupCodes(members, [
        { personId: 'a', pickupCode: once.a },
    ]);
    assert.strictEqual(twice.a, once.a);
});

test('the print document is a 75mm by 50mm label page', () => {
    const html = Nametag.printHtml([{
        kind: 'adult', first: 'Ada', last: 'Cole', eventName: 'Picnic', date: 'Sat',
    }]);
    assert.match(html, /size: 75mm 50mm/);
    assert.match(html, />Ada</);
});
