const { test } = require('node:test');
const assert = require('node:assert');

// MS-188 — the pure model for Away.
//
// A stretch of whole days a Person said they will not be here. Everything worth
// getting wrong is here: how two stretches combine, whether somebody is away on
// a date, which of their places fall inside a stretch they are entering, and
// what the screen says about all of it.
//
// No Firestore, no browser.

const Core = require('../public/away-core.js');

// ── Days ─────────────────────────────────────────────────────────────────────

test('a stretch is counted inclusively, so one day is one day', () => {
    // The screen answering "0 days" for "I'm away Saturday" would look broken in
    // a way that costs the whole feature its credibility.
    assert.strictEqual(Core.spanDays('2026-09-12', '2026-09-12'), 1);
    assert.strictEqual(Core.spanDays('2026-09-12', '2026-09-13'), 2);
    assert.strictEqual(Core.spanDays('2026-08-07', '2026-08-23'), 17);
});

test('days are counted across a month and a year boundary', () => {
    assert.strictEqual(Core.spanDays('2026-07-30', '2026-08-02'), 4);
    assert.strictEqual(Core.spanDays('2026-12-30', '2027-01-02'), 4);
});

test('addDays crosses months without a timezone getting involved', () => {
    assert.strictEqual(Core.addDays('2026-08-31', 1), '2026-09-01');
    assert.strictEqual(Core.addDays('2026-03-01', -1), '2026-02-28');
});

// ── Stretches ────────────────────────────────────────────────────────────────

test('a range tapped backwards means what it looks like', () => {
    const s = Core.normalise({ start: '2026-09-20', end: '2026-09-04' });
    assert.strictEqual(s.start, '2026-09-04');
    assert.strictEqual(s.end, '2026-09-20');
});

test('overlapping stretches merge into one', () => {
    const list = Core.addStretch(
        [{ id: 'a', start: '2026-08-07', end: '2026-08-14' }],
        { id: 'b', start: '2026-08-10', end: '2026-08-23' }
    );
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].start, '2026-08-07');
    assert.strictEqual(list[0].end, '2026-08-23');
});

test('stretches that merely TOUCH also merge', () => {
    // The 10th-14th beside the 15th-20th is one absence with a seam in it.
    // Leaving the seam means the list grows a row every time a holiday is
    // extended, and "have I told them about August" stops being answerable at a
    // glance.
    const list = Core.addStretch(
        [{ id: 'a', start: '2026-08-10', end: '2026-08-14' }],
        { id: 'b', start: '2026-08-15', end: '2026-08-20' }
    );
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].start, '2026-08-10');
    assert.strictEqual(list[0].end, '2026-08-20');
});

test('a merge reports what it swallowed, so nothing is orphaned', () => {
    // The store deletes by id. A merge that forgot what it absorbed would leave
    // the old documents behind, and they would go on making people away.
    const list = Core.addStretch(
        [
            { id: 'a', start: '2026-08-07', end: '2026-08-14' },
            { id: 'b', start: '2026-08-16', end: '2026-08-23' },
        ],
        { start: '2026-08-13', end: '2026-08-17' }
    );
    assert.strictEqual(list.length, 1);
    assert.deepStrictEqual(list[0].absorbed.sort(), ['a', 'b']);
    assert.strictEqual(list[0].start, '2026-08-07');
    assert.strictEqual(list[0].end, '2026-08-23');
});

test('a stretch with a clear day between it and another stays separate', () => {
    const list = Core.addStretch(
        [{ id: 'a', start: '2026-08-10', end: '2026-08-14' }],
        { id: 'b', start: '2026-08-16', end: '2026-08-20' }
    );
    assert.strictEqual(list.length, 2);
});

test('stretches come back in date order however they went in', () => {
    let list = Core.addStretch([], { id: 'b', start: '2026-10-24', end: '2026-10-25' });
    list = Core.addStretch(list, { id: 'a', start: '2026-08-07', end: '2026-08-23' });
    assert.deepStrictEqual(list.map(s => s.id), ['a', 'b']);
});

// ── The predicate everything downstream asks ─────────────────────────────────

test('somebody is away on every day of the stretch, ends included', () => {
    const list = [{ start: '2026-09-04', end: '2026-09-06' }];
    assert.strictEqual(Core.isAwayOn(list, '2026-09-03'), false);
    assert.strictEqual(Core.isAwayOn(list, '2026-09-04'), true);
    assert.strictEqual(Core.isAwayOn(list, '2026-09-05'), true);
    assert.strictEqual(Core.isAwayOn(list, '2026-09-06'), true);
    assert.strictEqual(Core.isAwayOn(list, '2026-09-07'), false);
});

test('no stretches means never away, rather than an error', () => {
    assert.strictEqual(Core.isAwayOn([], '2026-09-04'), false);
    assert.strictEqual(Core.isAwayOn(null, '2026-09-04'), false);
    assert.strictEqual(Core.isAwayOn([{ start: '2026-09-04', end: '2026-09-06' }], null), false);
});

// ── Upcoming and past ────────────────────────────────────────────────────────

test('a holiday you are in the middle of is not past', () => {
    // Split on `end`, not `start`. Splitting on start would drop today's absence
    // off the screen while the person is still in it.
    const list = [{ id: 'now', start: '2026-09-01', end: '2026-09-30' }];
    assert.deepStrictEqual(Core.upcoming(list, '2026-09-15').map(s => s.id), ['now']);
    assert.deepStrictEqual(Core.past(list, '2026-09-15'), []);
});

test('past stretches come back newest first', () => {
    const list = [
        { id: 'old', start: '2026-01-01', end: '2026-01-05' },
        { id: 'newer', start: '2026-05-01', end: '2026-05-05' },
    ];
    assert.deepStrictEqual(Core.past(list, '2026-09-15').map(s => s.id), ['newer', 'old']);
});

// ── The clash ────────────────────────────────────────────────────────────────

const PLACES = [
    { date: '2026-09-06', role: 'Coffee', event: 'Sunday Service' },
    { date: '2026-09-13', role: 'Sound desk', event: 'Sunday Service' },
    { date: '2026-09-20', role: 'Setup', event: 'Workday' },
];

test('the clash is every place inside the stretch, in date order', () => {
    const found = Core.clashesIn(PLACES, '2026-09-06', '2026-09-13');
    assert.deepStrictEqual(found.map(p => p.role), ['Coffee', 'Sound desk']);
});

test('a place on the first or last day of the stretch counts', () => {
    assert.strictEqual(Core.clashesIn(PLACES, '2026-09-06', '2026-09-06').length, 1);
    assert.strictEqual(Core.clashesIn(PLACES, '2026-09-01', '2026-09-06').length, 1);
});

test('a backwards or half-made range clashes with nothing', () => {
    // Asking about a range that is not one must be quiet rather than wrong.
    assert.deepStrictEqual(Core.clashesIn(PLACES, '2026-09-13', '2026-09-06'), []);
    assert.deepStrictEqual(Core.clashesIn(PLACES, null, '2026-09-06'), []);
});

// ── Painting days on the grid ────────────────────────────────────────────────
//
// The screen marks and clears DAYS; stretches are only how they are stored.

const MARKER = { personId: 'p_ann', uid: 'u_ann', name: 'Ann Reid' };
const ids = list => list.map(s => s.start + '..' + s.end);

test('marking one day on an empty diary is one new one-day stretch', () => {
    const plan = Core.paintDays([], '2026-09-04', '2026-09-04', true, MARKER);
    assert.deepStrictEqual(ids(plan.stretches), ['2026-09-04..2026-09-04']);
    assert.strictEqual(plan.set.length, 1);
    assert.strictEqual(plan.set[0].id, null, 'a new day is a new document');
    assert.strictEqual(plan.set[0].authorPersonId, 'p_ann');
    assert.deepStrictEqual(plan.remove, []);
});

test('a drag run backwards means what it looks like', () => {
    const plan = Core.paintDays([], '2026-09-10', '2026-09-04', true, MARKER);
    assert.deepStrictEqual(ids(plan.stretches), ['2026-09-04..2026-09-10']);
});

test('marking a day beside a stretch grows that stretch, in the same document', () => {
    const existing = [{ id: 'a', start: '2026-09-04', end: '2026-09-06', authorPersonId: 'p_sarah' }];
    const plan = Core.paintDays(existing, '2026-09-07', '2026-09-07', true, MARKER);
    assert.deepStrictEqual(ids(plan.stretches), ['2026-09-04..2026-09-07']);
    assert.strictEqual(plan.set[0].id, 'a', 'grew into a second document rather than the one it joined');
    assert.strictEqual(plan.set[0].authorPersonId, 'p_ann', 'whoever extends it is making the claim now');
});

test('marking the gap between two stretches joins them and deletes the spare', () => {
    const existing = [
        { id: 'a', start: '2026-09-04', end: '2026-09-06' },
        { id: 'b', start: '2026-09-08', end: '2026-09-10' },
    ];
    const plan = Core.paintDays(existing, '2026-09-07', '2026-09-07', true, MARKER);
    assert.deepStrictEqual(ids(plan.stretches), ['2026-09-04..2026-09-10']);
    assert.strictEqual(plan.set.length, 1);
    assert.deepStrictEqual(plan.remove.length, 1, 'the swallowed document is left behind');
});

test('marking days that are already away changes nothing and re-attributes nothing', () => {
    const existing = [{ id: 'a', start: '2026-09-04', end: '2026-09-10', authorPersonId: 'p_sarah' }];
    const plan = Core.paintDays(existing, '2026-09-05', '2026-09-08', true, MARKER);
    assert.deepStrictEqual(plan.set, []);
    assert.deepStrictEqual(plan.remove, []);
    assert.strictEqual(plan.stretches[0].authorPersonId, 'p_sarah');
});

test('clearing a one-day stretch deletes it', () => {
    const plan = Core.paintDays([{ id: 'a', start: '2026-09-04', end: '2026-09-04' }], '2026-09-04', '2026-09-04', false, MARKER);
    assert.deepStrictEqual(plan.stretches, []);
    assert.deepStrictEqual(plan.remove, ['a']);
});

test('clearing an end day trims the stretch and keeps its author', () => {
    // Taking a day out of Sarah's fortnight is not anybody claiming the rest
    // of it on her behalf.
    const existing = [{ id: 'a', start: '2026-09-04', end: '2026-09-10', authorPersonId: 'p_sarah' }];
    const plan = Core.paintDays(existing, '2026-09-10', '2026-09-10', false, MARKER);
    assert.deepStrictEqual(ids(plan.stretches), ['2026-09-04..2026-09-09']);
    assert.strictEqual(plan.set[0].id, 'a');
    assert.strictEqual(plan.set[0].authorPersonId, 'p_sarah');
});

test('clearing the middle of a stretch splits it in two', () => {
    const existing = [{ id: 'a', start: '2026-09-04', end: '2026-09-10', authorPersonId: 'p_sarah' }];
    const plan = Core.paintDays(existing, '2026-09-06', '2026-09-07', false, MARKER);
    assert.deepStrictEqual(ids(plan.stretches), ['2026-09-04..2026-09-05', '2026-09-08..2026-09-10']);
    assert.deepStrictEqual(plan.set.map(s => s.id), ['a', null], 'the left half keeps the document, the right is new');
    assert.ok(plan.set.every(s => s.authorPersonId === 'p_sarah'));
    assert.deepStrictEqual(plan.remove, []);
});

test('clearing a drag across several stretches deals with each of them', () => {
    const existing = [
        { id: 'a', start: '2026-09-01', end: '2026-09-05' },
        { id: 'b', start: '2026-09-08', end: '2026-09-09' },
        { id: 'c', start: '2026-09-12', end: '2026-09-20' },
    ];
    const plan = Core.paintDays(existing, '2026-09-04', '2026-09-14', false, MARKER);
    assert.deepStrictEqual(ids(plan.stretches), ['2026-09-01..2026-09-03', '2026-09-15..2026-09-20']);
    assert.deepStrictEqual(plan.remove, ['b']);
    assert.deepStrictEqual(plan.set.map(s => s.id), ['a', 'c']);
});

test('clearing days that are not away changes nothing', () => {
    const existing = [{ id: 'a', start: '2026-09-04', end: '2026-09-06' }];
    const plan = Core.paintDays(existing, '2026-09-10', '2026-09-12', false, MARKER);
    assert.deepStrictEqual(plan.set, []);
    assert.deepStrictEqual(plan.remove, []);
    assert.deepStrictEqual(ids(plan.stretches), ['2026-09-04..2026-09-06']);
});

test('days ahead counts only from today on, ends included', () => {
    const list = [
        { start: '2026-08-01', end: '2026-08-05' },   // passed
        { start: '2026-09-08', end: '2026-09-12' },   // in it: 10, 11, 12
        { start: '2026-09-20', end: '2026-09-20' },
    ];
    assert.strictEqual(Core.daysAhead(list, '2026-09-10'), 4);
    assert.strictEqual(Core.daysAhead([], '2026-09-10'), 0);
});

// ── The words ────────────────────────────────────────────────────────────────

test('the sentence counts the days marked, rather than listing ranges', () => {
    assert.strictEqual(Core.sentence([], '2026-09-01', null), 'No days marked yet.');
    assert.strictEqual(
        Core.sentence([{ start: '2026-09-04', end: '2026-09-04' }], '2026-09-01', null),
        'One day marked from today on. Tap one to clear it.'
    );
    assert.strictEqual(
        Core.sentence([{ start: '2026-09-04', end: '2026-09-06' }], '2026-09-01', null),
        'Three days marked from today on. Tap one to clear it.'
    );
});

test('mid-drag, the sentence says what letting go will do', () => {
    assert.strictEqual(
        Core.sentence([], '2026-09-01', { from: '2026-09-06', to: '2026-09-04', on: true }),
        'Friday 4 September to Sunday 6 September — 3 days, away.'
    );
    assert.strictEqual(
        Core.sentence([], '2026-09-01', { from: '2026-09-04', to: '2026-09-04', on: false }),
        'Friday 4 September, cleared.'
    );
});

test('the prompt says what the grid does', () => {
    assert.strictEqual(Core.prompt(null), "Tap a day you're away, or drag across several");
    assert.strictEqual(Core.prompt({ from: 'x', to: 'x', on: true }), 'Marking these days away');
    assert.strictEqual(Core.prompt({ from: 'x', to: 'x', on: false }), 'Clearing these days');
});

test('the conflict heading counts in words and never scolds', () => {
    // It has to read the same whether the days were just chosen or chosen a
    // fortnight ago, because the panel covers both — so it says nothing about
    // "these days" or anything else that assumes a selection is in hand.
    assert.strictEqual(Core.conflictHeading(1), "One place of yours falls on a day you're away.");
    assert.strictEqual(Core.conflictHeading(3), "Three places of yours fall on days you're away.");
    // Nothing in it reads as an error — the Away is recorded either way.
    assert.doesNotMatch(Core.conflictHeading(2), /can't|cannot|error|invalid/i);
});

test('nothing anywhere says unavailable, blackout or absence', () => {
    // The word is Away. This is the one string test worth having, because the
    // wrong word here is what makes the screen feel like booking leave with HR.
    const strings = [
        Core.prompt(null),
        Core.prompt({ from: '2026-09-04', to: '2026-09-06', on: true }),
        Core.prompt({ from: '2026-09-04', to: '2026-09-06', on: false }),
        Core.sentence([], '2026-09-01', null),
        Core.sentence([{ start: '2026-09-04', end: '2026-09-06' }], '2026-09-01', null),
        Core.sentence([], '2026-09-01', { from: '2026-09-04', to: '2026-09-06', on: true }),
        Core.conflictHeading(1),
        Core.conflictHeading(4),
    ].join(' | ');
    assert.doesNotMatch(strings, /unavailab|blackout|absence|submit|request|pending|approv/i);
});

// ── How an editor reads it ───────────────────────────────────────────────────

const SARAH = { id: 'p_sarah', name: 'Sarah Whitfield' };
const ANN = { id: 'p_ann', name: 'Ann Reid' };

test('an Away the person entered is attributed to them', () => {
    const note = Core.awayNote({ authorPersonId: 'p_sarah' }, SARAH, SARAH);
    assert.strictEqual(note, "Sarah said they're away");
});

test('an Away an editor entered is attributed to the editor', () => {
    // Because the responsibility rule is only fair when the claim is really
    // theirs — Sarah cannot be expected to sort out a clash from an Away she
    // never made.
    const note = Core.awayNote({ authorPersonId: 'p_ann' }, SARAH, ANN);
    assert.strictEqual(note, 'Ann marked Sarah away');
});

test('an unattributed Away reads as the person’s own, never the editor’s', () => {
    // Fails towards the person's own words. Putting an unattributed claim in an
    // editor's mouth would invent a statement nobody made.
    assert.strictEqual(Core.awayNote({}, SARAH, ANN), "Sarah said they're away");
});

test('the note never says Unavailable', () => {
    assert.doesNotMatch(Core.awayNote({ authorPersonId: 'p_ann' }, SARAH, ANN), /unavailab/i);
});

// ── The grid ─────────────────────────────────────────────────────────────────

const gridOpts = {
    stretches: [{ start: '2026-09-06', end: '2026-09-13' }, { start: '2026-09-21', end: '2026-09-22' }],
    places: PLACES,
    today: '2026-09-01',
};

test('a month grid is whole weeks, with the leading blanks outside the month', () => {
    const grid = Core.monthGrid(2026, 8, gridOpts);
    assert.strictEqual(grid.label, 'September 2026');
    assert.strictEqual(grid.cells.length % 7, 0);
    // 1 September 2026 is a Tuesday, so two blanks lead.
    assert.strictEqual(grid.cells[0].inMonth, false);
    assert.strictEqual(grid.cells[1].inMonth, false);
    assert.strictEqual(grid.cells[2].iso, '2026-09-01');
});

test('every away day is marked, and nothing else is', () => {
    const grid = Core.monthGrid(2026, 8, gridOpts);
    const at = iso => grid.cells.find(c => c.iso === iso);
    ['2026-09-06', '2026-09-09', '2026-09-13', '2026-09-21'].forEach(iso => {
        assert.strictEqual(at(iso).away, true, iso + ' is not drawn away');
    });
    ['2026-09-05', '2026-09-14', '2026-09-20'].forEach(iso => {
        assert.strictEqual(at(iso).away, false, iso + ' is drawn away');
    });
});

test('a run of away days draws as one block, broken at the end of each week', () => {
    // 6 September 2026 is a Sunday, so 6–12 fills a row and 13 starts the next.
    const grid = Core.monthGrid(2026, 8, gridOpts);
    const at = iso => grid.cells.find(c => c.iso === iso);
    assert.strictEqual(at('2026-09-06').runStart, true);
    assert.strictEqual(at('2026-09-09').runStart, false);
    assert.strictEqual(at('2026-09-09').runEnd, false, 'a middle day is rounded off');
    assert.strictEqual(at('2026-09-12').runEnd, true, 'the Saturday ends the row');
    assert.strictEqual(at('2026-09-13').runStart, true, 'the next row starts again');
    assert.strictEqual(at('2026-09-13').runEnd, true);
});

test('the days a drag is touching are marked as not saved yet', () => {
    const grid = Core.monthGrid(2026, 8, Object.assign({}, gridOpts, {
        drag: { from: '2026-09-25', to: '2026-09-23', on: true },
    }));
    const at = iso => grid.cells.find(c => c.iso === iso);
    assert.strictEqual(at('2026-09-23').pending, 'on');
    assert.strictEqual(at('2026-09-25').pending, 'on');
    assert.strictEqual(at('2026-09-26').pending, null);

    const clearing = Core.monthGrid(2026, 8, Object.assign({}, gridOpts, {
        drag: { from: '2026-09-21', to: '2026-09-21', on: false },
    }));
    assert.strictEqual(clearing.cells.find(c => c.iso === '2026-09-21').pending, 'off');
});

test('days before today are marked as gone, today is not', () => {
    const grid = Core.monthGrid(2026, 8, Object.assign({}, gridOpts, { today: '2026-09-10' }));
    const at = iso => grid.cells.find(c => c.iso === iso);
    assert.strictEqual(at('2026-09-09').past, true);
    assert.strictEqual(at('2026-09-10').past, false, 'today is still yours to mark');
    assert.strictEqual(at('2026-09-11').past, false);
    assert.strictEqual(at('2026-09-09').away, true, 'a past away day stopped showing as away');
});

test('a place you hold turns amber on a day you are away', () => {
    // Same dot, saying "this one is now your problem".
    const grid = Core.monthGrid(2026, 8, gridOpts);
    const at = iso => grid.cells.find(c => c.iso === iso);
    assert.strictEqual(at('2026-09-06').dotTone, 'warning', 'on an away day');
    assert.strictEqual(at('2026-09-20').dotTone, 'sand', 'on a day you are here');
    assert.strictEqual(at('2026-09-09').dotTone, null, 'no place that day');
});

test('months run on across a year boundary', () => {
    const months = Core.monthsFrom(2026, 11, 3, gridOpts);
    assert.deepStrictEqual(months.map(m => m.label), ['December 2026', 'January 2027', 'February 2027']);
});

test('the grid is the same computation on every size', () => {
    // The desktop shows two months and the phone runs several on; if they were
    // computed separately they would eventually disagree about what a day looks
    // like, which is the bug nobody finds by eye.
    const one = Core.monthGrid(2026, 8, gridOpts);
    const fromRun = Core.monthsFrom(2026, 8, 2, gridOpts)[0];
    assert.deepStrictEqual(fromRun, one);
});

// ── A conflict stands until one side of it moves ─────────────────────────────

test('conflicts cover every stretch, not just the one being chosen', () => {
    const stretches = [
        { start: '2026-09-06', end: '2026-09-06' },
        { start: '2026-09-20', end: '2026-09-20' },
    ];
    const found = Core.conflictsIn(PLACES, stretches);
    assert.deepStrictEqual(found.map(p => p.role), ['Coffee', 'Setup']);
});

test('a conflict already on record is still reported with nothing selected', () => {
    // The bug this replaced: the clash was computed from the range in hand, so a
    // conflict locked in last week vanished the moment you stopped choosing.
    const found = Core.conflictsIn(PLACES, [{ start: '2026-09-13', end: '2026-09-13' }]);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].role, 'Sound desk');
});

test('conflicts come back in date order across separate stretches', () => {
    const found = Core.conflictsIn(PLACES, [
        { start: '2026-09-20', end: '2026-09-20' },
        { start: '2026-09-06', end: '2026-09-06' },
    ]);
    assert.deepStrictEqual(found.map(p => p.date), ['2026-09-06', '2026-09-20']);
});

test('no stretches means no conflicts, rather than everything', () => {
    assert.deepStrictEqual(Core.conflictsIn(PLACES, []), []);
    assert.deepStrictEqual(Core.conflictsIn(PLACES, null), []);
});

// ── Whose days, and whose word (MS-196) ──────────────────────────────────────

test('a stretch keeps the author it was given, not the person it is about', () => {
    // An editor recording somebody else's days must be stamped as the editor.
    // One field doing both jobs would turn "Ann marked Sarah away" into "Sarah
    // said she's away" — a claim Sarah never made, and the attribution is the
    // whole safeguard on a block an editor is allowed to overrule.
    const list = Core.addStretch([], {
        start: '2026-09-04', end: '2026-09-06', authorPersonId: 'p_ann',
    });
    assert.strictEqual(list[0].authorPersonId, 'p_ann');
    assert.strictEqual(
        Core.awayNote(list[0], { id: 'p_sarah', name: 'Sarah Whitfield' }, { id: 'p_ann', name: 'Ann Reid' }),
        'Ann marked Sarah away'
    );
});

test('extending somebody else’s stretch re-attributes it to whoever extended it', () => {
    // The surviving stretch carries the NEW author, because the person making
    // the current claim is the one who just made it.
    const existing = [{ id: 'a', start: '2026-09-04', end: '2026-09-06', authorPersonId: 'p_sarah' }];
    const list = Core.addStretch(existing, {
        start: '2026-09-06', end: '2026-09-10', authorPersonId: 'p_ann',
    });
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].authorPersonId, 'p_ann');
});
