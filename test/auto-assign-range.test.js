const { test } = require('node:test');
const assert = require('node:assert');

const AutoAssign = require('../public/auto-assign-core.js');
const Fairness = require('../public/fairness-core.js');
const Roles = require('../public/roles-core.js');

// The range loop (MS-18, ADR-0020 §1): staffing a stretch of dates is the
// one-occurrence solve run once per date, each step reading a history window
// that has rolled forward to include the steps before it.
//
// THE FAILURE THIS FILE EXISTS TO CATCH is invisible by inspection. An
// Assignment is a plan and an Involvement is a fact, and no Involvement exists
// for a date that has not happened (ADR-0018, ADR-0019). So a loop that forgets
// to carry its own picks forward reads the SAME history ten times, returns the
// same answer ten times, and puts one person on every Sunday — while every
// individual date looks perfectly fair. `secondDateSeesTheFirst` and
// `aRangeSpreadsTheWork` are the two that fail when that happens.

const WINDOW = 12;
const SERIES = 'sunday_service';

// Ten Sundays to draft, ascending — a range runs forwards.
const RANGE = [
    '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01',
    '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06',
];

// The series' own dates before the range, MOST RECENT FIRST — the window is
// built from the recurrence rule, never from the serve log (a quiet Sunday
// still happened).
const PAST = [
    '2026-09-27', '2026-09-20', '2026-09-13', '2026-09-06',
    '2026-08-30', '2026-08-23', '2026-08-16', '2026-08-09',
    '2026-08-02', '2026-07-26', '2026-07-19', '2026-07-12',
];

const person = (id, extra) => Object.assign({ id: id, name: id, tags: [] }, extra);
const either = n => ({ id: 's' + n, requirement: Roles.REQUIREMENTS.EITHER });

const role = (slug, slotCount, extra) => Object.assign({
    slug: slug,
    name: slug,
    family: Roles.FAMILIES.SERVANT,
    slots: Array.from({ length: slotCount }, (_, i) => either(i + 1)),
    restrictions: [],
    intensity: 1,
    allowsAnotherRole: false,
}, extra);

const held = (roleSlug, slotId, personId, state) => ({
    roleSlug: roleSlug, slotId: slotId, personId: personId, state: state,
});

// Six people, one Role, one place. Six dates. If the loop carries its picks
// forward, six different people serve; if it does not, one person serves six
// times. Nothing else in the fixture can produce that difference.
const SIX = ['ann', 'ben', 'cara', 'dan', 'eve', 'finn'].map(id => person(id));

function options(over) {
    return Object.assign({
        dates: RANGE,
        pastDates: PAST,
        history: [],
        existing: {},
        choice: AutoAssign.CHOICES.KEEP,
        roles: [role('coffee', 1)],
        people: SIX,
        windowSize: WINDOW,
        seriesId: SERIES,
        solve: Fairness.solve,
        candidatesFor: Roles.candidatesFor,
        intensityOf: () => 1,
        liturgicalSlugs: [],
        liturgicalHoldersFor: () => [],
        relationships: [],
        groups: [],
    }, over || {});
}

const seatedIds = day => day.seats.map(s => s.personId).sort();
const whoIsOn = (result, i) => result.dates[i].seats.map(s => s.personId);

// ── The shape of a draft ─────────────────────────────────────────────────────

test('draft returns one entry per date in the range, in order', () => {
    const result = AutoAssign.draft(options());

    assert.equal(result.dates.length, RANGE.length);
    result.dates.forEach((day, i) => {
        assert.equal(day.date, RANGE[i], 'dates come back in range order');
        assert.ok(Array.isArray(day.seats));
        assert.ok(Array.isArray(day.gaps));
    });
});

test('every place is either seated or reported as a gap, never dropped', () => {
    const result = AutoAssign.draft(options({
        roles: [role('coffee', 2), role('setup', 3)],
    }));

    result.dates.forEach(day => {
        assert.equal(day.seats.length + day.gaps.length, 5,
            'five places on every date: two coffee, three setup');
    });
});

// ── The carry-forward — the heart of it ──────────────────────────────────────

test('the second date sees the first date\'s picks', () => {
    const result = AutoAssign.draft(options({ dates: RANGE.slice(0, 2) }));

    const first = whoIsOn(result, 0);
    const second = whoIsOn(result, 1);

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.notEqual(second[0], first[0],
        'whoever served on the first date is no longer the freshest on the second');
});

test('a range spreads the work instead of repeating one answer', () => {
    const result = AutoAssign.draft(options({ dates: RANGE.slice(0, 6) }));

    const served = result.dates.map(day => day.seats[0].personId);
    const distinct = new Set(served);

    assert.equal(distinct.size, 6,
        'six dates, one place, six people — everybody serves exactly once');
});

test('a one-date range is exactly the solve called directly', () => {
    const shared = {
        roles: [role('coffee', 2)],
        people: SIX,
        windowSize: WINDOW,
        seriesId: SERIES,
        date: RANGE[0],
        history: [],
        occurrenceDates: PAST,
        candidatesFor: Roles.candidatesFor,
        intensityOf: () => 1,
        liturgicalSlugs: [],
        liturgicalHolders: [],
        relationships: [],
        groups: [],
    };
    const direct = Fairness.solve(shared);
    const looped = AutoAssign.draft(options({
        dates: [RANGE[0]],
        roles: [role('coffee', 2)],
    }));

    assert.deepEqual(
        whoIsOn(looped, 0).sort(),
        direct.filled.map(s => s.personId).sort(),
        'with nothing to carry forward the loop adds nothing'
    );
});

test('the same range drafted twice against unchanged data is identical', () => {
    const a = AutoAssign.draft(options());
    const b = AutoAssign.draft(options());

    assert.deepEqual(
        a.dates.map(seatedIds),
        b.dates.map(seatedIds),
        'a draft that redraws differently on Wednesday cannot be reviewed'
    );
});

// ── Assignments already sitting in the range ─────────────────────────────────

test('a Confirmed assignment in the range counts as history for later dates', () => {
    const withNone = AutoAssign.draft(options({ dates: RANGE.slice(0, 2) }));
    const freshest = whoIsOn(withNone, 0)[0];

    // Put that same person on the first date by hand, Confirmed. The second
    // date must now read them as having just served.
    const withHeld = AutoAssign.draft(options({
        dates: RANGE.slice(0, 2),
        existing: { [RANGE[0]]: [held('coffee', 's1', freshest, 'confirmed')] },
    }));

    assert.equal(whoIsOn(withHeld, 0)[0], freshest, 'the hand-made pick stands');
    assert.notEqual(whoIsOn(withHeld, 1)[0], freshest,
        'and the date after it knows they served');
});

test('a Declined assignment is not history and its place is offered again', () => {
    const result = AutoAssign.draft(options({
        dates: RANGE.slice(0, 1),
        existing: { [RANGE[0]]: [held('coffee', 's1', 'ann', 'declined')] },
    }));

    const day = result.dates[0];
    assert.equal(day.seats.length, 1, 'the declined place is filled by somebody else');
    assert.notEqual(day.seats[0].personId, 'ann',
        'a decline never becomes serving, and never holds the place');
});

test('a Confirmed assignment is never replaced, under any choice', () => {
    Object.values(AutoAssign.CHOICES).forEach(choice => {
        const result = AutoAssign.draft(options({
            dates: RANGE.slice(0, 1),
            choice: choice,
            existing: { [RANGE[0]]: [held('coffee', 's1', 'finn', 'confirmed')] },
        }));

        assert.equal(whoIsOn(result, 0)[0], 'finn',
            `${choice}: the machine does not un-say a yes`);
    });
});

test('keep fills around a Pending assignment; replace redraws it', () => {
    const existing = { [RANGE[0]]: [held('coffee', 's1', 'finn', 'pending')] };

    const kept = AutoAssign.draft(options({
        dates: RANGE.slice(0, 1), choice: AutoAssign.CHOICES.KEEP, existing: existing,
    }));
    assert.equal(whoIsOn(kept, 0)[0], 'finn', 'keep leaves hand-made work alone');

    const redrawn = AutoAssign.draft(options({
        dates: RANGE.slice(0, 1), choice: AutoAssign.CHOICES.REPLACE, existing: existing,
    }));
    assert.equal(redrawn.dates[0].seats.length, 1);
    // `finn` is last alphabetically and carries no history, so the solve has no
    // reason to pick him; if he is still there, nothing was redrawn.
    assert.notEqual(whoIsOn(redrawn, 0)[0], 'finn', 'replace draws the place again');
});

test('leave out skips a date that already has people on it', () => {
    const result = AutoAssign.draft(options({
        dates: RANGE.slice(0, 2),
        choice: AutoAssign.CHOICES.LEAVE_OUT,
        existing: { [RANGE[0]]: [held('coffee', 's1', 'finn', 'pending')] },
    }));

    assert.equal(result.dates[0].skipped, true, 'the date is marked as left alone');
    assert.equal(whoIsOn(result, 0)[0], 'finn', 'and keeps exactly what it had');
    assert.equal(result.dates[1].skipped, false, 'untouched dates are still drafted');
    assert.notEqual(whoIsOn(result, 1)[0], 'finn',
        'a skipped date still counts as history for the ones after it');
});

test('a held seat is marked as held, so the screen can tell them apart', () => {
    const result = AutoAssign.draft(options({
        dates: RANGE.slice(0, 1),
        roles: [role('coffee', 2)],
        existing: { [RANGE[0]]: [held('coffee', 's1', 'finn', 'confirmed')] },
    }));

    const seats = result.dates[0].seats;
    const finn = seats.find(s => s.personId === 'finn');
    const drafted = seats.find(s => s.personId !== 'finn');

    assert.equal(finn.held, true);
    assert.equal(finn.state, 'confirmed');
    assert.equal(drafted.held, false);
});

// ── Held places and the rules ────────────────────────────────────────────────

test('a held person is not handed a second exclusive Role on the same date', () => {
    const result = AutoAssign.draft(options({
        dates: RANGE.slice(0, 1),
        roles: [role('coffee', 1), role('setup', 1)],
        people: [person('ann'), person('ben')],
        existing: { [RANGE[0]]: [held('coffee', 's1', 'ann', 'confirmed')] },
    }));

    const seats = result.dates[0].seats;
    const ann = seats.filter(s => s.personId === 'ann');
    assert.equal(ann.length, 1, 'holding an exclusive Role means holding nothing else');
});

test('a held place is still visible to its own Role\'s relationship rules', () => {
    // Kids keeps married couples apart. Dana is held in place one by hand, so
    // the solve must not seat her husband in place two.
    const kids = role('kids', 2, {
        restrictions: [{ kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: 'spouse' }],
    });
    const result = AutoAssign.draft(options({
        dates: RANGE.slice(0, 1),
        roles: [kids],
        people: [person('dana'), person('marcus'), person('ruth')],
        relationships: [{ typeId: 'spouse', fromId: 'dana', toId: 'marcus' }],
        existing: { [RANGE[0]]: [held('kids', 's1', 'dana', 'confirmed')] },
    }));

    const ids = whoIsOn(result, 0);
    assert.ok(ids.includes('dana'));
    assert.ok(!ids.includes('marcus'),
        'the rule sees who is already seated, however they got there');
});

// ── Re-drafting from a date ──────────────────────────────────────────────────

test('re-drafting from a date leaves every earlier date untouched', () => {
    const first = AutoAssign.draft(options({ dates: RANGE.slice(0, 5) }));
    const again = AutoAssign.redraftFrom(first, 2, options({ dates: RANGE.slice(0, 5) }));

    assert.deepEqual(
        again.dates.slice(0, 3).map(seatedIds),
        first.dates.slice(0, 3).map(seatedIds),
        'the chosen date and everything before it is kept exactly as it stands'
    );
    assert.equal(again.dates.length, 5);
});

test('re-drafting reads the kept dates as history', () => {
    const first = AutoAssign.draft(options({ dates: RANGE.slice(0, 4) }));
    const again = AutoAssign.redraftFrom(first, 1, options({ dates: RANGE.slice(0, 4) }));

    const kept = again.dates.slice(0, 2).map(d => d.seats[0].personId);
    const redrawn = again.dates.slice(2).map(d => d.seats[0].personId);

    redrawn.forEach(id => {
        assert.ok(!kept.includes(id),
            'a redrawn date does not hand a place back to somebody kept just before it');
    });
});

test('re-drafting twice with no edits between produces the same result', () => {
    const base = AutoAssign.draft(options({ dates: RANGE.slice(0, 5) }));
    const a = AutoAssign.redraftFrom(base, 1, options({ dates: RANGE.slice(0, 5) }));
    const b = AutoAssign.redraftFrom(base, 1, options({ dates: RANGE.slice(0, 5) }));

    assert.deepEqual(a.dates.map(seatedIds), b.dates.map(seatedIds));
});

// ── Turning a draft into history ─────────────────────────────────────────────

test('historyFrom shapes seats like the Involvement records fairness reads', () => {
    const records = AutoAssign.historyFrom(
        [{ roleSlug: 'coffee', slotId: 's1', personId: 'ann' }],
        '2026-10-04',
        SERIES
    );

    assert.deepEqual(records, [{
        personId: 'ann',
        type: 'coffee',
        serviceDate: '2026-10-04',
        seriesId: SERIES,
        metadata: null,
    }], 'the same shape loadOf and recencyOf already read');
});

test('carriedHistory counts Confirmed and Pending, and never Declined', () => {
    const records = AutoAssign.carriedHistory([
        held('coffee', 's1', 'ann', 'confirmed'),
        held('coffee', 's2', 'ben', 'pending'),
        held('setup', 's1', 'cara', 'declined'),
    ], '2026-10-04', SERIES);

    assert.deepEqual(records.map(r => r.personId).sort(), ['ann', 'ben']);
});

// ── The module keeps to itself ───────────────────────────────────────────────

test('the module requires nothing — the solve and the rules are injected', () => {
    const source = require('node:fs').readFileSync(
        require.resolve('../public/auto-assign-core.js'), 'utf8'
    );
    const requires = source.match(/\brequire\s*\(/g) || [];

    assert.equal(requires.length, 0,
        'fairness asks roles-core and this asks fairness — never by importing it');
});

// ── Somebody who is not there ───────────────────────────────────────────────
//
// An editor knows things the church has no record of. Away is a fact about a
// person on a DATE, so it is asked per date: out on the 11th says nothing about
// the 18th.

test('somebody away on a date is not drafted onto it', () => {
    const out = AutoAssign.draft(options({
        people: [person('ann')],
        awayOn: date => (date === RANGE[1] ? ['ann'] : []),
    }));

    assert.deepEqual(whoIsOn(out, 0), ['ann']);
    assert.deepEqual(whoIsOn(out, 1), [], 'nobody at all, rather than somebody who is not there');
    assert.equal(out.dates[1].gaps.length, 1, 'and the place is a gap, not a silence');
    assert.deepEqual(whoIsOn(out, 2), ['ann'], 'the next date is a different question');
});

// ⚠ HELD SEATS TOO. A place they were already down for is exactly the place the
// editor is trying to empty — honouring the hold would be the one case where
// taking somebody out did nothing.
test('being away takes them off a place they were already down for', () => {
    const out = AutoAssign.draft(options({
        existing: { [RANGE[0]]: [held('coffee', 's1', 'ann', AutoAssign.STATES.CONFIRMED)] },
        awayOn: date => (date === RANGE[0] ? ['ann'] : []),
    }));

    assert.equal(whoIsOn(out, 0).indexOf('ann'), -1);
    assert.equal(whoIsOn(out, 0).length, 1, 'and somebody else gets the place');
});

test('a date left out keeps what it had, minus whoever is away', () => {
    const out = AutoAssign.draft(options({
        roles: [role('coffee', 2)],
        choice: AutoAssign.CHOICES.LEAVE_OUT,
        existing: {
            [RANGE[0]]: [
                held('coffee', 's1', 'ann', AutoAssign.STATES.CONFIRMED),
                held('coffee', 's2', 'ben', AutoAssign.STATES.CONFIRMED),
            ],
        },
        awayOn: date => (date === RANGE[0] ? ['ann'] : []),
    }));

    assert.deepEqual(whoIsOn(out, 0), ['ben']);
});

// ── Filling one date's gaps ─────────────────────────────────────────────────
//
// The narrow version of a re-draft: everybody already on the date stays exactly
// where they are, and only the empty places are staffed.

test('filling gaps leaves everybody already on the date alone', () => {
    const base = AutoAssign.draft(options({ roles: [role('coffee', 3)] }));
    const opts = options({ roles: [role('coffee', 3)] });

    // Take one person off, by hand, the way the screen does.
    const gone = base.dates[0].seats[0];
    base.dates[0] = Object.assign({}, base.dates[0], {
        seats: base.dates[0].seats.filter(s => s !== gone),
    });
    const stayed = base.dates[0].seats.map(s => s.personId).sort();

    const out = AutoAssign.fillGaps(base, 0, opts);

    assert.equal(out.dates[0].seats.length, 3, 'the place is filled again');
    stayed.forEach(id => assert.ok(
        out.dates[0].seats.some(s => s.personId === id), id + ' was left where they were'
    ));
});

test('filling gaps touches no other date', () => {
    const base = AutoAssign.draft(options());
    const before = base.dates.map(d => d.seats.map(s => s.personId).join(','));

    const out = AutoAssign.fillGaps(base, 3, options());

    out.dates.forEach((day, i) => {
        if (i === 3) return;
        assert.equal(day.seats.map(s => s.personId).join(','), before[i]);
    });
});

// ⚠ THE HISTORY IS REBUILT FROM THE DRAFT, not from the serve log alone. A fill
// that could not see the dates before it would happily pick somebody already
// down for the two Sundays running up to this one.
test('a fill reads the dates before it as history', () => {
    const opts = options({ people: SIX.slice(0, 3), roles: [role('coffee', 1)] });
    const base = AutoAssign.draft(opts);
    const wanted = base.dates[2].seats[0].personId;

    base.dates[2] = Object.assign({}, base.dates[2], { seats: [] });
    const out = AutoAssign.fillGaps(base, 2, opts);

    // Emptying a date and filling it again lands on the same person the draft
    // did — which can only be true if the fill sees the two dates in front of
    // it. Blind to them, everybody's recency ties at the window and the pick
    // falls to the tie-break shuffle instead.
    assert.equal(out.dates[2].seats[0].personId, wanted);
    assert.notEqual(wanted, base.dates[1].seats[0].personId);
});

test('somebody away cannot be filled back into the place they left', () => {
    const opts = options({
        people: SIX.slice(0, 2),
        roles: [role('coffee', 1)],
        awayOn: date => (date === RANGE[0] ? ['ann'] : []),
    });
    const base = AutoAssign.draft(options({ people: SIX.slice(0, 2), roles: [role('coffee', 1)] }));

    base.dates[0] = Object.assign({}, base.dates[0], { seats: [] });
    const out = AutoAssign.fillGaps(base, 0, opts);

    assert.equal(out.dates[0].seats.length, 1);
    assert.notEqual(out.dates[0].seats[0].personId, 'ann');
});

test('filling a date that is not in the draft changes nothing', () => {
    const base = AutoAssign.draft(options());
    assert.equal(AutoAssign.fillGaps(base, 99, options()), base);
});
