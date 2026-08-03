// The panel beside the grid (MS-182): the directory, and why this person is
// here. The load section is the part worth guarding — it must never invent a
// category split the model does not produce, and it is the control an editor
// uses to seed a Role that launched with no history at all.

const test = require('node:test');
const assert = require('node:assert');

const Panel = require('../public/auto-assign-panel-core.js');

const PEOPLE = [
    { id: 'p1', name: 'Alice Brown' },
    { id: 'p2', name: 'Bob Carter' },
    { id: 'p3', name: 'Chris Doyle' },
];

const NAMES = { p1: 'Alice Brown', p2: 'Bob Carter', p3: 'Chris Doyle' };
const ROLES = { coffee: 'Coffee', welcome: 'Welcome', preacher: 'Preacher' };

// ── The directory ───────────────────────────────────────────────────────────

test('the directory offers everyone, least-loaded first', () => {
    const out = Panel.directory({
        people: PEOPLE, windowSize: 12,
        loadAt: id => ({ p1: 5, p2: 1, p3: 3 })[id],
    });

    assert.deepEqual(out.rows.map(r => r.name), ['Bob Carter', 'Chris Doyle', 'Alice Brown']);
    assert.equal(out.count, 3, 'the directory has to state how many it is offering');
});

test('a tie in load is broken by name, not by whatever order the read came back in', () => {
    const out = Panel.directory({
        people: PEOPLE, windowSize: 12, loadAt: () => 0,
    });

    assert.deepEqual(out.rows.map(r => r.name), ['Alice Brown', 'Bob Carter', 'Chris Doyle']);
});

test('searching narrows the list and the count with it', () => {
    const out = Panel.directory({
        people: PEOPLE, windowSize: 12, loadAt: () => 0, query: 'car',
    });

    assert.deepEqual(out.rows.map(r => r.name), ['Bob Carter']);
    assert.equal(out.count, 1);
});

test('a directory row carries the same load reading the grid cards use', () => {
    const out = Panel.directory({
        people: PEOPLE, windowSize: 12,
        loadAt: id => (id === 'p1' ? 12 : 0),
        servingCount: id => (id === 'p1' ? 2 : 0),
    });

    const alice = out.rows.filter(r => r.personId === 'p1')[0];
    assert.equal(alice.load, 12);
    assert.equal(alice.budget, 12);
    assert.equal(alice.spent, true, 'a directory that ranked people differently would argue with the grid');
    assert.equal(alice.serving, 2);
    assert.equal(alice.initials, 'AB');
});

// ── The load breakdown ──────────────────────────────────────────────────────

// ⚠ The design's three bars — Sunday, midweek, one-off — do not exist in the
// model. Load is one number, and what explains it is the list of things that
// made it up.
test('the load section lists each serve in the window, newest first', () => {
    const serves = Panel.servesInWindow({
        personId: 'p1',
        windowDates: ['2026-09-27', '2026-09-20', '2026-09-13'],
        history: [
            { personId: 'p1', type: 'coffee', serviceDate: '2026-09-13' },
            { personId: 'p1', type: 'welcome', serviceDate: '2026-09-27' },
            { personId: 'p2', type: 'coffee', serviceDate: '2026-09-20' },
        ],
        intensityOf: record => (record.type === 'coffee' ? 1.25 : 1),
        roleNameOf: slug => ROLES[slug],
        labelOf: date => date,
    });

    assert.deepEqual(serves.map(s => s.date), ['2026-09-27', '2026-09-13']);
    assert.deepEqual(serves.map(s => s.roleName), ['Welcome', 'Coffee']);
    assert.deepEqual(serves.map(s => s.intensity), [1, 1.25],
        'the number is 2.25 because of these two things, not because somebody typed it');
});

test('a serve outside the window is not part of the load, so it is not listed', () => {
    const serves = Panel.servesInWindow({
        personId: 'p1',
        windowDates: ['2026-09-27'],
        history: [
            { personId: 'p1', type: 'coffee', serviceDate: '2026-09-27' },
            { personId: 'p1', type: 'coffee', serviceDate: '2026-06-07' },
        ],
        intensityOf: () => 1, roleNameOf: slug => ROLES[slug], labelOf: d => d,
    });

    assert.equal(serves.length, 1);
});

// A Sunday that actually happened is a fact. The place to argue with one is the
// People's Directory, not a rota-drafting screen.
test('only a serve the editor seeded here can be taken back', () => {
    const serves = Panel.servesInWindow({
        personId: 'p1',
        windowDates: ['2026-09-27', '2026-09-20'],
        history: [
            { id: 'i1', personId: 'p1', type: 'coffee', serviceDate: '2026-09-27', seeded: true },
            { id: 'i2', personId: 'p1', type: 'coffee', serviceDate: '2026-09-20' },
        ],
        intensityOf: () => 1, roleNameOf: slug => ROLES[slug], labelOf: d => d,
    });

    assert.deepEqual(serves.map(s => s.removable), [true, false]);
});

// ── Across the range ────────────────────────────────────────────────────────

test('the panel lists everything that person holds across the range', () => {
    const out = Panel.acrossRange({
        personId: 'p1',
        selected: { date: '2026-10-11', roleSlug: 'coffee', slotId: 's1' },
        dates: [
            { date: '2026-10-04', seats: [
                { roleSlug: 'welcome', slotId: 's1', personId: 'p1' },
                { roleSlug: 'coffee', slotId: 's1', personId: 'p2' },
            ] },
            { date: '2026-10-11', seats: [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }] },
        ],
        roleNameOf: slug => ROLES[slug],
        labelOf: date => date,
    });

    assert.equal(out.length, 2, 'so the editor need not scan every column to find the rest');
    assert.deepEqual(out.map(s => s.selected), [false, true]);
    assert.deepEqual(out.map(s => s.roleName), ['Welcome', 'Coffee']);
});

// ── Who could take this place instead ───────────────────────────────────────

// Nothing records the runners-up, so this is the eligibility check asked again
// for this place against the roster AS IT STANDS — which is what keeps it true
// after the editor has moved things about.
test('everybody who could take the place is offered, with what is wrong with each', () => {
    const out = Panel.replacements({
        seatedPersonId: 'p1',
        candidates: [
            { personId: 'p1', eligible: true },
            { personId: 'p2', eligible: false, reason: 'sexMismatch' },
            { personId: 'p3', eligible: true },
        ],
        nameOf: id => NAMES[id],
        loadAt: id => (id === 'p3' ? 4 : 9),
        reasonText: c => 'because: ' + c.reason,
    });

    assert.deepEqual(out.map(c => c.name), ['Chris Doyle', 'Bob Carter']);
    assert.equal(out[0].reason, null, 'they could have had it — that is the point');
    assert.equal(out[1].reason, 'because: sexMismatch');
    assert.equal(out.some(c => c.personId === 'p1'), false,
        'the person in the place is not one of the others');
});

test('the ones who could have it come first, then the ones who could not', () => {
    const out = Panel.replacements({
        seatedPersonId: 'p1',
        candidates: [
            { personId: 'p2', eligible: false, reason: 'inactive' },
            { personId: 'p3', eligible: true },
        ],
        nameOf: id => NAMES[id],
        loadAt: () => 0,
        reasonText: c => c.reason,
    });

    assert.deepEqual(out.map(c => c.eligible), [true, false]);
});

test('typing a name narrows the list to it', () => {
    const of = query => Panel.replacements({
        seatedPersonId: 'p1',
        query: query,
        candidates: [
            { personId: 'p2', eligible: true },
            { personId: 'p3', eligible: true },
        ],
        nameOf: id => NAMES[id],
        loadAt: () => 0,
        reasonText: () => '',
    });

    assert.deepEqual(of('bob').map(c => c.name), ['Bob Carter']);
    assert.deepEqual(of('').map(c => c.name).length, 2, 'no query is everybody');
});

// ⚠ ELIGIBILITY ADVISES, THE EDITOR DECIDES (ADR-0021). Hiding somebody the
// rules are unhappy about turns an advisory into a wall, and leaves the editor
// typing a name and watching nothing come back.
test('somebody who cannot have the place is still offered, with the reason on them', () => {
    const out = Panel.replacements({
        seatedPersonId: 'p1',
        query: 'bob',
        candidates: [{ personId: 'p2', eligible: false, reason: 'sexMismatch' }],
        nameOf: id => NAMES[id],
        loadAt: () => 0,
        reasonText: c => 'because: ' + c.reason,
    });

    assert.deepEqual(out.map(c => c.name), ['Bob Carter']);
    assert.equal(out[0].reason, 'because: sexMismatch');
});
