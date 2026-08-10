const { test } = require('node:test');
const assert = require('node:assert');

const Commitments = require('../public/commitments-core.js');
const Core = require('../public/events-occurrence-core.js');

// What a Person is down for (MS-20) — their own Assignments across the dates
// ahead, whatever state each is in.
//
// The work is that it comes from two places stored nothing alike. An Assignment
// lives on an Event occurrence and carries a state. A liturgical Role is a plain
// FIELD on services/{date} and carries no state at all (ADR-0018 §2) — being on
// the printed booklet is the commitment, so there is nothing to confirm.
//
// Both belong on the page. Only one can be answered.

const TODAY = '2026-08-07';

const occurrence = (id, date, extra) => Object.assign({
    id: id,
    date: date,
    name: 'Midweek',
    seriesId: 'midweek',
    assignments: [],
}, extra);

const assignment = (personId, extra) => Object.assign({
    personId: personId,
    roleSlug: 'kids',
    slotId: 's1',
    state: Core.STATES.PENDING,
}, extra);

const ask = (over) => Commitments.commitmentsFor(Object.assign({
    personId: 'carl',
    today: TODAY,
    occurrences: [],
    services: [],
}, over || {}));

// ── What belongs on it ───────────────────────────────────────────────────────

test('an Assignment of mine on a date ahead is a Commitment', () => {
    const rows = ask({
        occurrences: [occurrence('o1', '2026-08-14', {
            assignments: [assignment('carl')],
        })],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].date, '2026-08-14');
    assert.equal(rows[0].occurrenceId, 'o1');
    assert.equal(rows[0].eventName, 'Midweek');
    assert.equal(rows[0].state, Core.STATES.PENDING);
    assert.equal(rows[0].answerable, true);
});

test('somebody else’s Assignment is not mine', () => {
    const rows = ask({
        occurrences: [occurrence('o1', '2026-08-14', {
            assignments: [assignment('alice')],
        })],
    });
    assert.equal(rows.length, 0);
});

test('they come back in date order, soonest first', () => {
    const rows = ask({
        occurrences: [
            occurrence('o3', '2026-09-02', { assignments: [assignment('carl')] }),
            occurrence('o1', '2026-08-14', { assignments: [assignment('carl')] }),
            occurrence('o2', '2026-08-21', { assignments: [assignment('carl')] }),
        ],
    });
    assert.deepEqual(rows.map(r => r.date),
        ['2026-08-14', '2026-08-21', '2026-09-02']);
});

test('several Assignments on one date are several Commitments', () => {
    const rows = ask({
        occurrences: [occurrence('o1', '2026-08-14', {
            assignments: [
                assignment('carl', { roleSlug: 'kids', slotId: 's1' }),
                assignment('carl', { roleSlug: 'coffee', slotId: 's9' }),
            ],
        })],
    });
    assert.equal(rows.length, 2);
});

// ── What is dropped ──────────────────────────────────────────────────────────
//
// A serve you have already done must not sit in a list of things still to do.

test('a date already past is absent', () => {
    const rows = ask({
        occurrences: [occurrence('o1', '2026-08-01', {
            assignments: [assignment('carl')],
        })],
    });
    assert.equal(rows.length, 0);
});

test('today itself is still ahead — it has not happened until it has', () => {
    const rows = ask({
        occurrences: [occurrence('o1', TODAY, { assignments: [assignment('carl')] })],
    });
    assert.equal(rows.length, 1);
});

test('an occurrence already flagged past is absent whatever its date says', () => {
    const rows = ask({
        occurrences: [occurrence('o1', '2026-08-14', {
            isPast: true,
            assignments: [assignment('carl')],
        })],
    });
    assert.equal(rows.length, 0);
});

// ── The liturgy: present, and unanswerable ───────────────────────────────────

test('a Sunday I am preaching on is a Commitment too', () => {
    const rows = ask({
        services: [{ date: '2026-08-16', preacherId: 'carl' }],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].date, '2026-08-16');
    assert.equal(rows[0].roleSlug, 'preacher');
});

test('a liturgical Role carries no state and cannot be answered', () => {
    const rows = ask({
        services: [{ date: '2026-08-16', preacherId: 'carl' }],
    });
    assert.equal(rows[0].answerable, false);
    assert.equal(rows[0].state, null);
});

test('holding a Servant Role and a liturgical Role the same Sunday gives both', () => {
    const rows = ask({
        occurrences: [occurrence('sunday_2026-08-16', '2026-08-16', {
            name: 'Sunday Service',
            assignments: [assignment('carl', { roleSlug: 'coffee' })],
        })],
        services: [{ date: '2026-08-16', preacherId: 'carl' }],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows.filter(r => r.answerable).length, 1);
    assert.equal(rows.filter(r => !r.answerable).length, 1);
});

test('the two sources interleave by date rather than clumping', () => {
    const rows = ask({
        occurrences: [occurrence('o1', '2026-08-21', {
            assignments: [assignment('carl')],
        })],
        services: [
            { date: '2026-08-16', preacherId: 'carl' },
            { date: '2026-08-30', preacherId: 'carl' },
        ],
    });
    assert.deepEqual(rows.map(r => r.date),
        ['2026-08-16', '2026-08-21', '2026-08-30']);
});

test('a past Sunday I preached on is absent, like any other past date', () => {
    const rows = ask({ services: [{ date: '2026-08-02', preacherId: 'carl' }] });
    assert.equal(rows.length, 0);
});

test('a visiting speaker typed in by name is nobody, and belongs to nobody', () => {
    const rows = ask({
        personId: 'carl',
        services: [{ date: '2026-08-16', preacher: 'A visitor', preacherId: null }],
    });
    assert.equal(rows.length, 0);
});

// ── How it reads to the person themselves ────────────────────────────────────

test('an unanswered Assignment reads as Unconfirmed to its owner', () => {
    const rows = ask({
        occurrences: [occurrence('o1', '2026-08-14', {
            assignments: [assignment('carl')],
        })],
    });
    assert.equal(rows[0].stateLabel, 'Unconfirmed');
    assert.equal(rows[0].state, Core.STATES.PENDING, 'the stored state is untouched');
});

test('the editor’s word for the same state is unchanged', () => {
    assert.equal(Core.stateLabel({ state: Core.STATES.PENDING }), 'Pending');
});

test('confirmed and declined read the same to everybody', () => {
    const rows = ask({
        occurrences: [
            occurrence('o1', '2026-08-14', {
                assignments: [assignment('carl', { state: Core.STATES.CONFIRMED })],
            }),
            occurrence('o2', '2026-08-21', {
                assignments: [assignment('carl', { state: Core.STATES.DECLINED })],
            }),
        ],
    });
    assert.equal(rows[0].stateLabel, 'Confirmed');
    assert.equal(rows[1].stateLabel, 'Declined');
});

// ── Nothing on ───────────────────────────────────────────────────────────────

test('a Person down for nothing gets an empty list, not a null', () => {
    assert.deepEqual(ask(), []);
});

test('no personId means no answer — never everybody’s Commitments', () => {
    assert.deepEqual(ask({
        personId: null,
        occurrences: [occurrence('o1', '2026-08-14', {
            assignments: [assignment('carl')],
        })],
    }), []);
});

test('a declined Commitment carries whether it is off the open list', () => {
    // ⚠ Without it the screen's toggle draws as "on the list" whatever the
    // truth is — a control that lies about its own state, which is worse than
    // no control at all.
    const rows = Commitments.commitmentsFor({
        personId: 'carl',
        occurrences: [{
            id: 'occ-1', date: '2026-08-14', name: 'Midweek',
            assignments: [{
                personId: 'carl', roleSlug: 'kids', slotId: 's1',
                state: 'declined', quiet: true,
            }],
        }],
        services: [],
        today: '2026-08-01',
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].quiet, true);
});
