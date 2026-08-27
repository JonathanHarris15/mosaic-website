// Pressing an arrow must never be how somebody loses a hymn.
//
// The Order of Service saves itself three seconds after the last edit
// (ADR-0032), which means there is always a window where what is on screen is
// not yet in the database. An arrow pressed inside that window has three
// possible manners, and only one of them is right:
//
//   - Raise the browser's "leave site?" box. Rejected: at the service guide
//     party you step through eight Sundays in a row, and eight questions is
//     seven too many. The page saves itself; it does not ask.
//   - Move anyway. Rejected: that is the data loss, dressed as convenience.
//   - Flush the save first, and only move if it landed.
//
// The third is what these tests pin. The failure case matters more than the
// success one: a save that fails and a page that leaves anyway is silent, and
// the work only ever existed in the tab that just navigated away.

const { test } = require('node:test');
const assert = require('node:assert');

const { stepToService, stepHref } = require('../public/service-builder.js');

// A step where the save is spied on, so a test can say whether it was asked for
// and what it answered.
function attempt(overrides) {
    const calls = { saves: 0, went: null };
    const step = Object.assign({
        target: '2026-09-06',
        canEdit: true,
        isDirty: false,
        save: async () => { calls.saves++; return true; },
        go: (date) => { calls.went = date; },
    }, overrides);
    return { calls, run: () => stepToService(step) };
}

test('a clean page moves straight to the Sunday asked for', async () => {
    const { calls, run } = attempt({ isDirty: false });

    assert.strictEqual(await run(), true);
    assert.strictEqual(calls.went, '2026-09-06');
    assert.strictEqual(calls.saves, 0, 'nothing had changed, so nothing needed writing');
});

test('an unsaved change is written before the page moves', async () => {
    const order = [];
    const { calls, run } = attempt({
        isDirty: true,
        save: async () => { order.push('save'); return true; },
        go: (date) => { order.push('go'); calls.went = date; },
    });

    assert.strictEqual(await run(), true);
    assert.deepStrictEqual(order, ['save', 'go'], 'the save has to land first, not race the navigation');
    assert.strictEqual(calls.went, '2026-09-06');
});

test('a save that fails leaves you where you were', async () => {
    const { calls, run } = attempt({ isDirty: true, save: async () => false });

    assert.strictEqual(await run(), false);
    assert.strictEqual(calls.went, null, 'moving on would have abandoned work only this tab has');
});

test('a save that throws also leaves you where you were', async () => {
    const { calls, run } = attempt({
        isDirty: true,
        save: async () => { throw new Error('offline'); },
    });

    await assert.rejects(run);
    assert.strictEqual(calls.went, null);
});

test('a read-only visitor moves without anything being written on their behalf', async () => {
    // isDirty can be true for a viewer — the page normalises what it loaded —
    // but they may not write, and asking them to would fail on the rules.
    const { calls, run } = attempt({ canEdit: false, isDirty: true });

    assert.strictEqual(await run(), true);
    assert.strictEqual(calls.saves, 0);
    assert.strictEqual(calls.went, '2026-09-06');
});

test('an arrow at the end of the range does nothing at all', async () => {
    const { calls, run } = attempt({ target: null, isDirty: true });

    assert.strictEqual(await run(), false);
    assert.strictEqual(calls.saves, 0);
    assert.strictEqual(calls.went, null);
});

// ── Where the arrow points ──────────────────────────────────────────────────

test('the address it moves to names the Sunday, so refresh and copied links work', () => {
    assert.strictEqual(stepHref('2026-09-06'), 'service-builder.html?date=2026-09-06');
});

test('the phone stays on the phone', () => {
    assert.strictEqual(
        stepHref('2026-09-06', { shell: 'mobile' }),
        'service-builder.html?date=2026-09-06&shell=mobile');
});

test('the tab you were on comes with you', () => {
    assert.strictEqual(
        stepHref('2026-09-06', { tab: 'roles' }),
        'service-builder.html?date=2026-09-06&tab=roles');
});

test('the order of service is the default, so it is not written down', () => {
    assert.strictEqual(stepHref('2026-09-06', { tab: 'order' }), 'service-builder.html?date=2026-09-06');
});
