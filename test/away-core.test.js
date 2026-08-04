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
    // The grid always has a half-made range in it — one tap in — and asking for
    // clashes then must be quiet rather than wrong.
    assert.deepStrictEqual(Core.clashesIn(PLACES, '2026-09-13', '2026-09-06'), []);
    assert.deepStrictEqual(Core.clashesIn(PLACES, null, '2026-09-06'), []);
});

// ── Choosing a range on the grid ─────────────────────────────────────────────

test('the first tap sets one day and waits for the last', () => {
    const sel = Core.nextSelection(Core.EMPTY_SELECTION, '2026-09-04');
    assert.deepStrictEqual(sel, { start: '2026-09-04', end: '2026-09-04', awaiting: 'end' });
});

test('the second tap closes the range', () => {
    let sel = Core.nextSelection(Core.EMPTY_SELECTION, '2026-09-04');
    sel = Core.nextSelection(sel, '2026-09-20');
    assert.deepStrictEqual(sel, { start: '2026-09-04', end: '2026-09-20', awaiting: 'start' });
});

test('tapping BEFORE the first day starts again from there', () => {
    // Rather than producing a backwards range nobody meant.
    let sel = Core.nextSelection(Core.EMPTY_SELECTION, '2026-09-20');
    sel = Core.nextSelection(sel, '2026-09-04');
    assert.deepStrictEqual(sel, { start: '2026-09-04', end: '2026-09-04', awaiting: 'end' });
});

test('tapping again on a finished range starts a new one', () => {
    let sel = { start: '2026-09-04', end: '2026-09-20', awaiting: 'start' };
    sel = Core.nextSelection(sel, '2026-09-25');
    assert.deepStrictEqual(sel, { start: '2026-09-25', end: '2026-09-25', awaiting: 'end' });
});

// ── The words ────────────────────────────────────────────────────────────────

test('the sentence names the days rather than echoing two fields', () => {
    assert.match(Core.sentence(Core.EMPTY_SELECTION), /^Nothing chosen yet/);
    assert.strictEqual(
        Core.sentence({ start: '2026-09-04', end: '2026-09-04', awaiting: 'start' }),
        'Friday 4 September — one day.'
    );
    assert.strictEqual(
        Core.sentence({ start: '2026-09-04', end: '2026-09-06', awaiting: 'start' }),
        'Friday 4 September to Sunday 6 September — 3 days.'
    );
});

test('one tap in, the sentence offers the single day rather than nagging', () => {
    const half = { start: '2026-09-04', end: '2026-09-04', awaiting: 'end' };
    assert.match(Core.sentence(half), /now tap the last day, or press below for the one day/);
});

test('the prompt says what the grid wants next', () => {
    assert.strictEqual(Core.prompt(Core.EMPTY_SELECTION), "Tap the first day you're away");
    assert.strictEqual(Core.prompt({ start: '2026-09-04', end: '2026-09-04', awaiting: 'end' }), 'Now tap the last day');
    assert.strictEqual(Core.prompt({ start: '2026-09-04', end: '2026-09-06', awaiting: 'start' }), 'Tap again to choose different days');
});

test('the clash heading counts in words and never scolds', () => {
    assert.strictEqual(Core.clashHeading(1), "One of these days is a day you're serving.");
    assert.strictEqual(Core.clashHeading(3), "Three of these days are days you're serving.");
    // Nothing in it reads as an error — the Away is recorded either way.
    assert.doesNotMatch(Core.clashHeading(2), /can't|cannot|error|invalid/i);
});

test('a row says how long it is and whether anything of yours is inside', () => {
    const row = Core.stretchRow({ id: 'a', start: '2026-09-06', end: '2026-09-13' }, PLACES);
    assert.strictEqual(row.range, '6 Sep to 13 Sep');
    assert.strictEqual(row.meta, '8 days · two places of yours inside');

    const quiet = Core.stretchRow({ id: 'b', start: '2026-10-24', end: '2026-10-25' }, PLACES);
    assert.strictEqual(quiet.meta, '2 days · nothing of yours inside');

    const single = Core.stretchRow({ id: 'c', start: '2026-09-06', end: '2026-09-06' }, PLACES);
    assert.strictEqual(single.range, 'Sunday 6 September');
    assert.strictEqual(single.meta, 'One day · one place of yours inside');
});

test('nothing anywhere says unavailable, blackout or absence', () => {
    // The word is Away. This is the one string test worth having, because the
    // wrong word here is what makes the screen feel like booking leave with HR.
    const strings = [
        Core.prompt(Core.EMPTY_SELECTION),
        Core.sentence(Core.EMPTY_SELECTION),
        Core.sentence({ start: '2026-09-04', end: '2026-09-06', awaiting: 'start' }),
        Core.clashHeading(1),
        Core.clashHeading(4),
        Core.stretchRow({ start: '2026-09-06', end: '2026-09-13' }, PLACES).meta,
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
    selection: { start: '2026-09-06', end: '2026-09-13', awaiting: 'start' },
    stretches: [{ start: '2026-09-20', end: '2026-09-22' }],
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

test('the ends of the range are marked, and the days between are in it', () => {
    const grid = Core.monthGrid(2026, 8, gridOpts);
    const at = iso => grid.cells.find(c => c.iso === iso);
    assert.strictEqual(at('2026-09-06').isStart, true);
    assert.strictEqual(at('2026-09-13').isEnd, true);
    assert.strictEqual(at('2026-09-09').inRange, true);
    assert.strictEqual(at('2026-09-06').inRange, false, 'an end is an end, not a middle');
    assert.strictEqual(at('2026-09-14').inRange, false);
});

test('days already on record are marked without being part of the selection', () => {
    const grid = Core.monthGrid(2026, 8, gridOpts);
    const at = iso => grid.cells.find(c => c.iso === iso);
    assert.strictEqual(at('2026-09-21').onRecord, true);
    assert.strictEqual(at('2026-09-21').inRange, false);
    assert.strictEqual(at('2026-09-09').onRecord, false);
});

test('a place you hold turns amber once it is inside the range', () => {
    // Same dot, saying "this one is now your problem".
    const grid = Core.monthGrid(2026, 8, gridOpts);
    const at = iso => grid.cells.find(c => c.iso === iso);
    assert.strictEqual(at('2026-09-06').dotTone, 'warning', 'inside the range');
    assert.strictEqual(at('2026-09-20').dotTone, 'sand', 'outside it');
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
