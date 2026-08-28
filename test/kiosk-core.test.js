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

test('the event list is today first, then whatever is coming', () => {
    const sorted = Kiosk.sortOccurrencesForKiosk([
        { id: 'future-late', date: '2026-09-14' },
        { id: 'today', date: '2026-08-27' },
        { id: 'future-soon', date: '2026-09-01' },
    ], '2026-08-27').map(o => o.id);
    assert.deepStrictEqual(sorted, ['today', 'future-soon', 'future-late']);
});

test('a gathering that has been and gone is not on the kiosk at all', () => {
    const sorted = Kiosk.sortOccurrencesForKiosk([
        { id: 'yesterday', date: '2026-08-26' },
        { id: 'today', date: '2026-08-27' },
        { id: 'last-month', date: '2026-07-01' },
    ], '2026-08-27').map(o => o.id);
    assert.deepStrictEqual(sorted, ['today']);
});

test('an occurrence with no date is not guessed at', () => {
    assert.deepStrictEqual(Kiosk.sortOccurrencesForKiosk([{ id: 'x' }, null], '2026-08-27'), []);
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

// ── Who is already here (MS-321) ────────────────────────────────────────────

const rows = [
    { personId: 'bob', markedAt: '2026-08-30T09:00:00Z' },
    { personId: 'sam', markedAt: '2026-08-30T09:00:00Z', pickupCode: 'K7QF' },
];
const members = [
    { personId: 'bob', name: 'Bob Harris', kid: false },
    { personId: 'sam', name: 'Sam Harris', kid: true },
    { personId: 'alice', name: 'Alice Harris', kid: false },
];

test('the Attendance already written says who is in the room', () => {
    const index = Kiosk.attendanceIndex(rows);
    assert.strictEqual(Kiosk.isPresent(index, 'bob'), true);
    assert.strictEqual(Kiosk.isPresent(index, 'alice'), false);
    assert.strictEqual(Kiosk.isPresent(index, undefined), false);
    assert.strictEqual(index.sam.pickupCode, 'K7QF');
});

test('only the people not yet here are arrivals, so nobody is tagged twice', () => {
    const index = Kiosk.attendanceIndex(rows);
    assert.deepStrictEqual(Kiosk.arrivals(members, index).map(m => m.personId), ['alice']);
    assert.deepStrictEqual(Kiosk.arrivals(members, {}).map(m => m.personId), ['bob', 'sam', 'alice']);
});

test('a reprint carries the pickup number the Kid was already given', () => {
    const index = Kiosk.attendanceIndex(rows);
    assert.deepStrictEqual(Kiosk.pickupCodesFrom(index, [members[1]]), { sam: 'K7QF' });
    assert.deepStrictEqual(Kiosk.pickupCodesFrom(index, [members[0]]), {});
});
