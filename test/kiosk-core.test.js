const { test } = require('node:test');
const assert = require('node:assert');

const Kiosk = require('../public/kiosk-core.js');

test('isKiosk is its own check, not a rank on the ladder', () => {
    assert.strictEqual(Kiosk.isKiosk('kiosk'), true);
    assert.strictEqual(Kiosk.isKiosk('admin'), false);
    assert.strictEqual(Kiosk.isKiosk('elder'), false);
    assert.strictEqual(Kiosk.isKiosk('viewer'), false);
    assert.strictEqual(Kiosk.isKiosk(undefined), false);
});

test('a kiosk on any ordinary page is sent to the kiosk landing page', () => {
    const data = { permissionLevel: 'kiosk' };
    assert.strictEqual(Kiosk.kioskGateDestination(data, '/peoples-page.html'), 'kiosk.html');
    assert.strictEqual(Kiosk.kioskGateDestination(data, 'index.html'), 'kiosk.html');
    assert.strictEqual(Kiosk.kioskGateDestination(data, 'calendar-event.html?id=x'), 'kiosk.html');
});

test('a kiosk may stay on the kiosk page and on login', () => {
    const data = { permissionLevel: 'kiosk' };
    assert.strictEqual(Kiosk.kioskGateDestination(data, 'kiosk.html'), null);
    assert.strictEqual(Kiosk.kioskGateDestination(data, '/kiosk.html'), null);
    assert.strictEqual(Kiosk.kioskGateDestination(data, 'login.html'), null);
});

test('a non-kiosk on the kiosk page is sent home', () => {
    assert.strictEqual(Kiosk.kioskGateDestination({ permissionLevel: 'editor' }, 'kiosk.html'), 'index.html');
    assert.strictEqual(Kiosk.kioskGateDestination({ permissionLevel: 'viewer' }, 'index.html'), null);
});

test('signing in as a kiosk lands on the kiosk page, not the dashboard', () => {
    assert.strictEqual(Kiosk.landingPageFor({ permissionLevel: 'kiosk' }), 'kiosk.html');
    assert.strictEqual(Kiosk.landingPageFor({ permissionLevel: 'editor' }), 'index.html');
});

test('the event list is most-recent first, with future events below', () => {
    const sorted = Kiosk.sortOccurrencesForKiosk([
        { id: 'future-late', date: '2026-09-14' },
        { id: 'past', date: '2026-08-10' },
        { id: 'today', date: '2026-08-27' },
        { id: 'future-soon', date: '2026-09-01' },
        { id: 'older', date: '2026-07-01' },
    ], '2026-08-27').map(o => o.id);
    assert.deepStrictEqual(sorted, ['today', 'past', 'older', 'future-soon', 'future-late']);
});

test('marking the same person present twice writes one document id', () => {
    assert.strictEqual(Kiosk.attendanceDocId('p1'), 'p1');
    const once = Kiosk.markPresentWrites('occ1', ['p1', 'p2'], '2026-08-27T12:00:00Z');
    const twice = Kiosk.markPresentWrites('occ1', ['p1'], '2026-08-27T12:05:00Z');
    assert.strictEqual(once.length, 2);
    assert.strictEqual(twice[0].personId, 'p1');
    assert.strictEqual(once[0].personId, twice[0].personId);
    assert.deepStrictEqual(
        [...new Set(once.concat(twice).map(w => w.personId))].sort(),
        ['p1', 'p2']
    );
});

test('a duplicate id in one click is still one write', () => {
    const writes = Kiosk.markPresentWrites('occ1', ['p1', 'p1', 'p2'], 't');
    assert.strictEqual(writes.length, 2);
});

test('the footer button names the live count', () => {
    assert.strictEqual(Kiosk.presentCountLabel(0), 'Mark 0 present');
    assert.strictEqual(Kiosk.presentCountLabel(4), 'Mark 4 present');
});
