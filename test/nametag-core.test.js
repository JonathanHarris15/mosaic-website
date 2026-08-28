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

test('a new pickup number dodges the ones this Event has already given out', () => {
    // Pin the generator so it always reaches for the same code. If the codes
    // already handed out are not in the taken set, it hands that one out again
    // — which is exactly what a stub on one child and a tag on another means.
    const realRandom = Math.random;
    Math.random = () => 0;
    try {
        const codes = Nametag.assignPickupCodes(
            [{ personId: 'new', name: 'Sam', kid: true }],
            [{ personId: 'old', pickupCode: '2222' }]
        );
        assert.notStrictEqual(codes.new, '2222');
    } finally {
        Math.random = realRandom;
    }
});

test('a Kid already carrying a number keeps it', () => {
    const codes = Nametag.assignPickupCodes(
        [{ personId: 'sam', name: 'Sam', kid: true }],
        [{ personId: 'sam', pickupCode: 'K7QF' }]
    );
    assert.strictEqual(codes.sam, 'K7QF');
});

// ── The name has to fit on the stock (MS-320) ───────────────────────────────

test('a short given name is printed as large as the label allows', () => {
    assert.strictEqual(Nametag.firstNameSizeMm('Ada'), 15);
    assert.strictEqual(Nametag.firstNameSizeMm('Molly'), 15);
});

test('a long given name is shrunk to fit rather than clipped', () => {
    const big = Nametag.firstNameSizeMm('Ada');
    const long = Nametag.firstNameSizeMm('Christopher');
    assert.ok(long < big, 'a long name is set smaller');
    // Whatever the length, it stays inside the 67mm of usable label width.
    ['Ada', 'Jonathan', 'Christopher', 'Maximilian-Rose'].forEach(name => {
        const width = name.length * 0.58 * Nametag.firstNameSizeMm(name);
        assert.ok(width <= 51.5, name + ' runs off the label at ' + width.toFixed(1) + 'mm');
    });
});

test('the size is written onto the label, not left to the stylesheet', () => {
    const html = Nametag.printHtml([
        { kind: 'adult', first: 'Christopher', last: 'Vale', eventName: 'E', date: 'D' },
    ]);
    assert.match(html, /class="first" style="font-size:[\d.]+mm"/);
});

test('a sheet of labels is one page each, with no blank page between', () => {
    const html = Nametag.printHtml([
        { kind: 'adult', first: 'Ada', last: 'Cole', eventName: 'E', date: 'D' },
        { kind: 'adult', first: 'Pip', last: 'Cole', eventName: 'E', date: 'D' },
    ]);
    assert.match(html, /@page \{ size: 75mm 50mm; margin: 0; \}/);
    // A box the exact height of the page rounds up and spills onto a blank one.
    assert.match(html, /height: calc\(50mm - 0\.4mm\)/);
    assert.match(html, /page-break-after: always/);
    assert.match(html, /\.label:last-child \{ page-break-after: auto/);
});

// ── The tag says a name and carries the mark, and stops there (MS-320) ──────

test('a tag is a name and the Mosaic mark, with the event and date gone', () => {
    const html = Nametag.printHtml([
        { kind: 'adult', first: 'Ada', last: 'Cole', eventName: 'Harvest Picnic', date: 'Sat 5 Sep' },
    ]);
    assert.match(html, />Ada</);
    assert.match(html, />Cole</);
    assert.match(html, /class="mark" src="assets\/mosaic-icon\.png"/);
    // The clutter that was crowding the name.
    assert.doesNotMatch(html, /Harvest Picnic/);
    assert.doesNotMatch(html, /Sat 5 Sep/);
});

test('the mark sits in its own column, so a long name cannot run under it', () => {
    const html = Nametag.printHtml([{ kind: 'adult', first: 'Christopher', last: 'Vale' }]);
    assert.match(html, /\.side \{ flex: 0 0 16mm/);
    assert.match(html, /class="who"/);
});

test('a Kid keeps the pickup number on the tag and on the stub', () => {
    const codes = { k: 'K7QF' };
    const labels = Nametag.labelsFor([{ personId: 'k', name: 'Nora Crites', kid: true }], {}, codes);
    const html = Nametag.printHtml(labels);
    assert.strictEqual(labels.length, 2);
    assert.strictEqual((html.match(/K7QF/g) || []).length, 2);
    // Only the stub says what it is; the tag is just the child's name.
    assert.strictEqual((html.match(/Pickup stub/g) || []).length, 1);
});

test('an adult tag carries no pickup number at all', () => {
    const html = Nametag.printHtml([{ kind: 'adult', first: 'Ada', last: 'Cole' }]);
    assert.doesNotMatch(html, /class="code"/);
});

test('the mark can be pointed somewhere else, for a page that is not the kiosk', () => {
    const html = Nametag.printHtml([{ kind: 'adult', first: 'Ada', last: 'Cole' }],
        { logoSrc: '/other/mark.png' });
    assert.match(html, /src="\/other\/mark\.png"/);
});
