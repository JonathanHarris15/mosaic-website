// MS-685 — the kiosk prints what the Kid toggle says, and nothing else.
//
// ⚠ WHAT WENT WRONG. A Person whose Kid box was UNTICKED in the Membership
// Directory still came out of the kiosk with a pickup number and a guardian
// stub. The toggle writes the Person; the kiosk read the member row inside the
// Household (and the Family's childIds) instead, and those are snapshots
// nobody can untick. So the whole print path — a code minted and written into
// Attendance, a child tag, a stub — ran for somebody who is not a Kid.
//
// This drives the real kiosk page over the real Household and Nametag modules,
// because the seam the bug lived in is between them: every part in isolation
// was doing what it was told.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Household = require('../public/household-core.js');

const EVENT = { id: 'occ1', name: 'Sunday Service', date: '2026-09-27', needsNameTags: true };

// The directory the kiosk reads. The Family says Sam is a child — it was
// written when he was one — so the only thing that can turn Kid off is his
// own flag.
function directoryWith(kidToggle) {
    return {
        people: [
            { id: 'bob', name: 'Bob Harris', kid: false },
            { id: 'sam', name: 'Sam Harris', kid: kidToggle },
        ],
        families: [{ id: 'f1', husbandId: 'bob', childIds: ['sam'] }],
    };
}

function kioskWith(kidToggle, attendanceRows) {
    const rows = (attendanceRows || []).slice();
    const written = [];
    const context = {
        console: { log() {}, warn() {}, error() {} },
        auth: { onAuthStateChanged() {} },
        localStorage: { getItem() { return null; }, setItem() {} },
        db: {},
    };
    context.window = context;
    context.HouseholdCore = Household;
    context.KioskCore = require('../public/kiosk-core.js');
    context.NametagCore = require('../public/nametag-core.js');
    context.PersonName = require('../public/person-name.js');
    context.HouseholdStore = {};
    context.EventsStore = {
        async loadAttendance() { return rows.slice(); },
        async markPresent(db, occurrenceId, personIds, markedAt, extras) {
            (personIds || []).forEach(function (id) {
                const extra = (extras || {})[id] || {};
                written.push({ personId: id, pickupCode: extra.pickupCode });
                rows.push({ personId: id, markedAt: markedAt, pickupCode: extra.pickupCode });
            });
        },
    };
    context.DateUtils = { todayStr() { return '2026-09-27'; }, formatDateLong(d) { return d; } };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'public', 'kiosk.js'), 'utf8'),
        context
    );

    const page = context.kioskPage();
    const printed = [];
    // The print itself is the browser's (ADR-0042); what is under test is what
    // was handed to it.
    page.printNow = function () { printed.push(this.lastLabels); };

    const dir = directoryWith(kidToggle);
    page.event = EVENT;
    page.seriesById = {};
    page.households = Household.householdsFromDirectory(dir.people, dir.families);
    page.selected = page.households.find(function (h) { return h.id === 'family:f1'; });
    page.attendance = context.KioskCore.attendanceIndex(rows);

    return { page: page, printed: printed, written: written };
}

function kinds(labels) {
    return (labels || []).map(function (l) { return l.kind; });
}

test('with the Kid toggle off, nobody gets a stub and no pickup code is written', async () => {
    const kiosk = kioskWith(false);
    kiosk.page.toggleAll();
    await kiosk.page.submitPresent();

    assert.strictEqual(kiosk.printed.length, 1, 'the tags still print');
    assert.deepStrictEqual(kinds(kiosk.printed[0]), ['adult', 'adult']);
    assert.deepStrictEqual(kiosk.written.map(function (w) { return w.pickupCode; }),
        [undefined, undefined]);
});


test('with the Kid toggle on, the child tag and the stub print on one number', async () => {
    const kiosk = kioskWith(true);
    kiosk.page.toggleAll();
    await kiosk.page.submitPresent();

    const labels = kiosk.printed[0];
    assert.deepStrictEqual(kinds(labels), ['adult', 'child', 'stub']);
    const child = labels[1];
    const stub = labels[2];
    assert.ok(child.code, 'the child tag carries a pickup number');
    assert.strictEqual(stub.code, child.code, 'the stub carries the same one');

    const sam = kiosk.written.find(function (w) { return w.personId === 'sam'; });
    const bob = kiosk.written.find(function (w) { return w.personId === 'bob'; });
    assert.strictEqual(sam.pickupCode, child.code);
    assert.strictEqual(bob.pickupCode, undefined);
});

test('a reprint with the Kid toggle off is one tag, and mints no number', async () => {
    // The number they were given last week is still sitting in Attendance.
    // Reprinting must not put it back on a label, and must not write a new one.
    const kiosk = kioskWith(false, [{ personId: 'sam', markedAt: 't', pickupCode: 'OLD1' }]);
    const sam = kiosk.page.selected.members.find(function (m) { return m.personId === 'sam'; });
    await kiosk.page.reprint(sam);

    assert.strictEqual(kiosk.page.error, '');
    assert.deepStrictEqual(kinds(kiosk.printed[0]), ['adult']);
    assert.strictEqual(kiosk.printed[0][0].code, undefined);
    assert.deepStrictEqual(kiosk.written, []);
});

test('a reprint with the Kid toggle on repeats the tag and the stub on the same number', async () => {
    const kiosk = kioskWith(true, [{ personId: 'sam', markedAt: 't', pickupCode: 'OLD1' }]);
    const sam = kiosk.page.selected.members.find(function (m) { return m.personId === 'sam'; });
    await kiosk.page.reprint(sam);

    assert.deepStrictEqual(kinds(kiosk.printed[0]), ['child', 'stub']);
    assert.strictEqual(kiosk.printed[0][0].code, 'OLD1');
    assert.strictEqual(kiosk.printed[0][1].code, 'OLD1');
    assert.deepStrictEqual(kiosk.written, [], 'a number it already has is not rewritten');
});
