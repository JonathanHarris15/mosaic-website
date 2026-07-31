const { test } = require('node:test');
const assert = require('node:assert');

// MS-153 – MS-157 — the sentences a person actually reads.
//
// Every one of these is copy the design considered carefully, and copy left in
// a template is copy nobody tests. The picker's block reasons especially: the
// whole point of that screen is that an editor can see who was passed over AND
// why, so "returns a reason, never a boolean" is pinned here.

const View = require('../public/calendar-view.js');
const Core = require('../public/events-occurrence-core.js');
const Roles = require('../public/roles-core.js');

// ── A failure must never read as an empty church ──────────────────────────────

test('each way the Calendar can fail gets its own sentence', () => {
    // All of these render as an empty calendar if you let them, and "this church
    // has no events" is exactly what a real failure looks like from the outside.
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'calendar.js'), 'utf8');

    const CAUSES = [
        ['permission-denied', /permissions problem/],
        // Raised while a composite index is still building, for a few minutes
        // after a deploy. It fixes itself, so the wording must say so.
        ['failed-precondition', /index it needs is being built/],
        ['unavailable', /connection/],
    ];

    CAUSES.forEach(([code, wording]) => {
        assert.match(src, new RegExp("'" + code + "'"), code + ' is not distinguished');
        assert.match(src, wording, code + ' has no sentence of its own');
    });
});

// ── Small formatting ──────────────────────────────────────────────────────────

test('initials take the first and last name', () => {
    assert.strictEqual(View.initials('Bethany Croft'), 'BC');
    assert.strictEqual(View.initials('Caleb van der Munro'), 'CM');
    assert.strictEqual(View.initials('Prince'), 'P');
    assert.strictEqual(View.initials(''), '?');
    assert.strictEqual(View.initials(null), '?');
});

test('times read unhurried, in lower case', () => {
    assert.strictEqual(View.formatTime('19:00'), '7:00 pm');
    assert.strictEqual(View.formatTime('09:30'), '9:30 am');
    assert.strictEqual(View.formatTime('12:00'), '12:00 pm');
    assert.strictEqual(View.formatTime('00:15'), '12:15 am');
    assert.strictEqual(View.formatTime(''), '');
});

test('a list of things reads as a sentence, not a comma dump', () => {
    assert.strictEqual(View.listSentence(['Setup']), 'Setup');
    assert.strictEqual(View.listSentence(['Setup', 'Sound']), 'Setup and Sound');
    assert.strictEqual(View.listSentence(['Setup', 'Sound', 'Kids']), 'Setup, Sound and Kids');
    assert.strictEqual(View.listSentence([]), '');
});

// ── The visibility ladder ─────────────────────────────────────────────────────

test('every rung has a name, an icon, and a sentence saying who sees it', () => {
    // An editor has to tell five levels apart at a glance without reading
    // documentation, so a label alone is not enough.
    Core.VISIBILITY_ORDER.forEach(level => {
        assert.ok(View.visibilityLabel(level), level + ' has no label');
        assert.ok(View.visibilityIcon(level), level + ' has no icon');
        assert.ok(View.visibilityWho(level).length > 20, level + ' has no plain-language sentence');
    });
});

test('the ladder renders in model order', () => {
    assert.deepStrictEqual(
        View.visibilityLadder().map(r => r.level),
        Core.VISIBILITY_ORDER
    );
});

test('an unset rung reads as locked, not as anything reassuring', () => {
    assert.strictEqual(View.visibilityLabel(undefined), 'Not set');
    assert.strictEqual(View.visibilityIcon(undefined), 'lock');
    assert.match(View.visibilityWho(undefined), /Nobody can see this/);
});

test('the roster toggle is meaningless where everyone can see the Event anyway', () => {
    // At Anyone and Members, hiding the roster from "participants" hides it from
    // nobody. The design drops the control and explains rather than silently
    // doing nothing.
    assert.strictEqual(View.rosterToggleApplies('public'), false);
    assert.strictEqual(View.rosterToggleApplies('member'), false);
    assert.strictEqual(View.rosterToggleApplies('participant'), true);
    assert.strictEqual(View.rosterToggleApplies('editor'), true);
    assert.strictEqual(View.rosterToggleApplies('elder'), true);
});

// ── The recurrence sentence ───────────────────────────────────────────────────

test('a weekly pattern reads as one sentence', () => {
    assert.strictEqual(
        View.recurrenceSentence({ freq: 'weekly', startDate: '2026-07-01', weekday: 3, time: '19:00' }),
        'Every Wednesday at 7:00 pm, until further notice.'
    );
});

test('a fortnightly pattern says every other', () => {
    assert.strictEqual(
        View.recurrenceSentence({ freq: 'fortnightly', startDate: '2026-07-01', weekday: 3, time: '19:00' }),
        'Every other Wednesday at 7:00 pm, until further notice.'
    );
});

test('a monthly pattern names which weekday of the month', () => {
    // The model repeats the same weekday-of-month, so the sentence has to say
    // so — "every month" would leave the editor guessing which Wednesday.
    assert.strictEqual(
        View.recurrenceSentence({ freq: 'monthly', startDate: '2026-07-01', weekday: 3, time: '19:00' }),
        'The first Wednesday of the month at 7:00 pm, until further notice.'
    );
    assert.match(
        View.recurrenceSentence({ freq: 'monthly', startDate: '2026-07-15', weekday: 3 }),
        /^The third Wednesday of the month/
    );
});

test('a one-off says once, and does not carry on', () => {
    const s = View.recurrenceSentence({ freq: 'once', startDate: '2026-07-15', time: '19:00' });
    assert.strictEqual(s, 'Once, on Wednesday 15 July at 7:00 pm.');
    assert.ok(!/until further notice/.test(s), 'a single date has nothing to carry on');
});

test('an ending is named rather than left implied', () => {
    assert.match(
        View.recurrenceSentence({
            freq: 'weekly', startDate: '2026-07-01', weekday: 3, time: '19:00',
            ends: { kind: 'onDate', date: '2026-09-30' },
        }),
        /until 30 September\.$/
    );
    assert.match(
        View.recurrenceSentence({
            freq: 'weekly', startDate: '2026-07-01', weekday: 3, time: '19:00',
            ends: { kind: 'afterCount', count: 12 },
        }),
        /, 12 times\.$/
    );
});

test('a pattern with no time still reads as a sentence', () => {
    assert.strictEqual(
        View.recurrenceSentence({ freq: 'weekly', startDate: '2026-07-01', weekday: 3 }),
        'Every Wednesday, until further notice.'
    );
});

test('the next few dates are the chips under the sentence', () => {
    const dates = View.nextDates({ freq: 'weekly', startDate: '2026-07-01', weekday: 3 }, '2026-07-01', 5);
    assert.deepStrictEqual(dates, ['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22', '2026-07-29']);
});

// ── The month grid ────────────────────────────────────────────────────────────

test('the grid is Sunday-start and always whole weeks', () => {
    const cells = View.monthGrid('2026-07', []);
    assert.strictEqual(cells.length % 7, 0);
    assert.strictEqual(cells[0].date, '2026-06-28', 'the leading days of the previous month fill the corner');
    assert.ok(cells.some(c => c.date === '2026-07-31' && c.inMonth));
});

test('a month that needs six rows gets six, rather than hiding real dates', () => {
    // August 2026 starts on a Saturday, so five rows cannot hold it. Truncating
    // would hide dates from the one screen whose job is showing them.
    const cells = View.monthGrid('2026-08', []);
    assert.strictEqual(cells.length, 42);
    assert.ok(cells.some(c => c.date === '2026-08-31' && c.inMonth));
});

test('out-of-month days are marked so they can be dimmed', () => {
    const cells = View.monthGrid('2026-07', []);
    assert.strictEqual(cells[0].inMonth, false);
    assert.strictEqual(cells.find(c => c.date === '2026-07-01').inMonth, true);
});

test('today is marked, and only today', () => {
    const cells = View.monthGrid('2026-07', [], '2026-07-15');
    assert.strictEqual(cells.filter(c => c.isToday).length, 1);
    assert.strictEqual(cells.find(c => c.isToday).date, '2026-07-15');
});

test('a cell carries its events, and flags the ones that need sorting', () => {
    const declined = {
        id: 'a', date: '2026-07-15', name: 'Midweek',
        assignments: [{ personId: 'p1', roleSlug: 'kids', slotId: 's1', state: 'declined' }],
    };
    const calm = {
        id: 'b', date: '2026-07-16', name: 'Prayer',
        assignments: [{ personId: 'p2', roleSlug: 'kids', slotId: 's1', state: 'pending' }],
    };
    const cells = View.monthGrid('2026-07', [declined, calm]);

    assert.strictEqual(cells.find(c => c.date === '2026-07-15').needsAttention, true);
    assert.strictEqual(cells.find(c => c.date === '2026-07-16').needsAttention, false,
        'Pending is the resting state — if every unconfirmed assignment shouts, nothing does');
    assert.strictEqual(cells.find(c => c.date === '2026-07-15').events.length, 1);
});

test('an empty month is still a grid, not a message', () => {
    const cells = View.monthGrid('2026-07', []);
    assert.ok(cells.length > 0);
    assert.ok(cells.every(c => c.events.length === 0));
});

// ── Week grouping ─────────────────────────────────────────────────────────────

test('the list view groups by week, in date order', () => {
    const groups = View.weekGroups([
        { id: 'b', date: '2026-07-22' },
        { id: 'a', date: '2026-07-15' },
        { id: 'c', date: '2026-07-16' },
    ]);

    assert.strictEqual(groups.length, 2);
    assert.deepStrictEqual(groups[0].events.map(e => e.id), ['a', 'c']);
    assert.deepStrictEqual(groups[1].events.map(e => e.id), ['b']);
});

test('only the current week is labelled "this week"', () => {
    const groups = View.weekGroups([{ id: 'a', date: '2026-07-15' }, { id: 'b', date: '2026-07-22' }], '2026-07-16');
    assert.match(groups[0].label, /this week$/);
    assert.ok(!/this week/.test(groups[1].label));
});

// ── The picker's reasons ──────────────────────────────────────────────────────

test('an eligible person has no reason', () => {
    assert.strictEqual(View.blockReason({ personId: 'p1', eligible: true }), null);
});

test('every ineligibility the model can produce yields a reason, never a boolean', () => {
    // A boolean here would turn the picker back into a silent omission with
    // extra steps. Every reason the model knows must have words.
    Object.keys(Roles.REASONS).forEach(key => {
        const reason = View.blockReason(
            { personId: 'p1', eligible: false, reason: Roles.REASONS[key] },
            { people: [], requirement: 'female' }
        );
        assert.strictEqual(typeof reason, 'string', Roles.REASONS[key] + ' produced no words');
        assert.ok(reason.length > 3, Roles.REASONS[key] + ' produced an empty subtitle');
    });
});

test('a reason the model does not know still gets words', () => {
    const reason = View.blockReason({ personId: 'p1', eligible: false, reason: 'somethingNew' }, {});
    assert.strictEqual(reason, 'Cannot take this place');
});

test('the sex requirement is named as the design words it', () => {
    assert.strictEqual(
        View.blockReason({ eligible: false, reason: Roles.REASONS.SEX_MISMATCH }, { requirement: 'female' }),
        'This place needs a woman'
    );
    assert.strictEqual(
        View.blockReason({ eligible: false, reason: Roles.REASONS.SEX_MISMATCH }, { requirement: 'male' }),
        'This place needs a man'
    );
});

// The two "already busy" reasons are deliberately separate (ADR-0020).
// ALREADY_ASSIGNED is a second slot of THIS Role; SERVING_ELSEWHERE is another
// Role the same morning. They used to be one, which is how the liturgy ended up
// faked in as a seat and tripping this Role's relationship rules.

test('already assigned means this Role, and needs no list of elsewhere', () => {
    assert.strictEqual(
        View.blockReason(
            { eligible: false, reason: Roles.REASONS.ALREADY_ASSIGNED },
            { otherRoles: ['Setup', 'Sound'] }
        ),
        'Already in this Role'
    );
});

test('serving elsewhere names where, rather than leaving the editor hunting', () => {
    assert.strictEqual(
        View.blockReason(
            { eligible: false, reason: Roles.REASONS.SERVING_ELSEWHERE },
            { otherRoles: ['Setup', 'Sound'] }
        ),
        'Already serving this morning — Setup and Sound'
    );
});

test('serving elsewhere still says so when the Roles cannot be named', () => {
    assert.strictEqual(
        View.blockReason({ eligible: false, reason: Roles.REASONS.SERVING_ELSEWHERE }, {}),
        'Already serving this morning'
    );
});

test('being off an allowlist says so plainly, never "cannot take this place"', () => {
    assert.strictEqual(
        View.blockReason({ eligible: false, reason: Roles.REASONS.NOT_ON_ALLOWLIST }, {}),
        'Not on the list of people who do this Role'
    );
});

test('a relationship conflict names the person it clashes with', () => {
    assert.strictEqual(
        View.blockReason(
            { eligible: false, reason: Roles.REASONS.RELATIONSHIP_CONFLICT, conflictsWith: 'p2' },
            { people: [{ id: 'p2', name: 'Caleb Munro' }] }
        ),
        'Married to Caleb Munro, who is already in this Role'
    );
});

test('a group requirement names the group', () => {
    assert.strictEqual(
        View.blockReason(
            { eligible: false, reason: Roles.REASONS.NOT_IN_REQUIRED_GROUP },
            { groupName: 'Kids Ministry' }
        ),
        'Not in the Kids Ministry group'
    );
});

test('an inactive person is not proposed, and is told so plainly', () => {
    assert.strictEqual(
        View.blockReason({ eligible: false, reason: Roles.REASONS.INACTIVE }, {}),
        'No longer active'
    );
});

test('the fairness note sits in the same slot a reason would', () => {
    // Which is also where an auto-assign suggestion will sit later, so no
    // relayout is needed then.
    assert.strictEqual(
        View.fairnessNote({ personId: 'p1', eligible: true }, { groupName: 'Kids Ministry', lastServed: '6 weeks ago' }),
        'Kids Ministry group · last served 6 weeks ago'
    );
});

// ── Changing a pattern ────────────────────────────────────────────────────────

const orphan = (date, n) => ({
    date: date,
    assignments: Array.from({ length: n }, (_, i) => ({ personId: 'p' + i })),
});

test('each row says exactly what its choice will do', () => {
    assert.strictEqual(
        View.orphanOutcome(orphan('2026-07-01', 4), 'delete'),
        'This one goes, and so do its 4 assignments.'
    );
    assert.strictEqual(
        View.orphanOutcome(orphan('2026-07-01', 4), 'move'),
        'This one moves onto the new pattern, and its 4 assignments come with it.'
    );
});

test('one assignment is not "1 assignments"', () => {
    assert.match(View.orphanOutcome(orphan('2026-07-01', 1), 'delete'), /its 1 assignment\./);
});

test('the footer recomputes from the choices', () => {
    const orphans = [orphan('2026-07-01', 2), orphan('2026-07-08', 3), orphan('2026-07-15', 1)];
    assert.strictEqual(
        View.orphanSummary(orphans, { '2026-07-01': 'move', '2026-07-08': 'delete', '2026-07-15': 'delete' }),
        '1 moving, 2 going — which loses 4 assignments.'
    );
});

test('when nothing is being deleted, the footer says nothing is lost', () => {
    const orphans = [orphan('2026-07-01', 2), orphan('2026-07-08', 3)];
    assert.strictEqual(
        View.orphanSummary(orphans, { '2026-07-01': 'move', '2026-07-08': 'move' }),
        '2 dates moving. Nothing is lost.'
    );
});

test('Move is the default, so an undecided row counts as moving', () => {
    assert.strictEqual(View.orphanSummary([orphan('2026-07-01', 2)], {}), '1 date moving. Nothing is lost.');
});

// ── The past-event question ───────────────────────────────────────────────────

test('the prompt uses small words for small numbers', () => {
    const four = { assignments: Array.from({ length: 4 }, (_, i) => ({ personId: 'p' + i, state: 'pending' })) };
    assert.strictEqual(View.unconfirmedPrompt(four), 'Four people were never confirmed. Did they serve?');
});

test('one person is singular', () => {
    assert.strictEqual(
        View.unconfirmedPrompt({ assignments: [{ personId: 'p1', state: 'pending' }] }),
        'One person was never confirmed. Did they serve?'
    );
});

test('nothing unconfirmed renders nothing — a prompt with nothing to ask is a nag', () => {
    assert.strictEqual(View.unconfirmedPrompt({ assignments: [] }), null);
    assert.strictEqual(View.unconfirmedPrompt({ assignments: [{ personId: 'p1', state: 'confirmed' }] }), null);
    assert.strictEqual(View.unconfirmedPrompt({}), null);
});

test('a declined assignment is never a question', () => {
    assert.strictEqual(
        View.unconfirmedPrompt({ assignments: [{ personId: 'p1', state: 'declined' }] }),
        null,
        'they told us — there is nothing to ask'
    );
});

test('the tick-list footer recomputes, and says "for good"', () => {
    const questions = [{ personId: 'p1' }, { personId: 'p2' }, { personId: 'p3' }, { personId: 'p4' }];
    assert.strictEqual(
        View.serveTickSummary(questions, { p1: true, p2: true }),
        '2 serves recorded. 2 stay unanswered, for good.'
    );
    assert.strictEqual(
        View.serveTickSummary(questions, {}),
        'Nothing recorded. All 4 stay unanswered, for good.'
    );
    assert.strictEqual(
        View.serveTickSummary(questions, { p1: true, p2: true, p3: true, p4: true }),
        'All 4 serves recorded.'
    );
});

// ── Upcoming ──────────────────────────────────────────────────────────────────

const OCCURRENCES = [
    {
        id: 'b', date: '2026-07-19', name: 'Prayer Evening',
        assignments: [{ personId: 'me', roleSlug: 'prayer', slotId: 's1', state: 'pending', label: 'Prayer' }],
    },
    {
        id: 'a', date: '2026-07-15', name: 'Midweek Gathering',
        assignments: [
            { personId: 'me', roleSlug: 'kids', slotId: 's1', state: 'confirmed', label: 'Kids Ministry' },
            { personId: 'p9', roleSlug: 'kids', slotId: 's2', state: 'declined', label: 'Kids Ministry' },
        ],
    },
];

test('the rail is derived from the events themselves, and sorted by date', () => {
    // Never a second list. A parallel list is a list that goes stale.
    const mine = View.myCommitments(OCCURRENCES, 'me');
    assert.deepStrictEqual(mine.map(c => c.date), ['2026-07-15', '2026-07-19']);
    assert.deepStrictEqual(mine.map(c => c.roleLabel), ['Kids Ministry', 'Prayer']);
});

test('the window runs from today, not from the month the grid is on', () => {
    assert.deepStrictEqual(View.upcomingRange('2026-07-31', 'week'),
        { from: '2026-07-31', to: '2026-08-07' });
    assert.deepStrictEqual(View.upcomingRange('2026-07-31', 'fortnight'),
        { from: '2026-07-31', to: '2026-08-14' });
    assert.deepStrictEqual(View.upcomingRange('2026-07-31', 'month'),
        { from: '2026-07-31', to: '2026-08-30' });
});

test('a window nobody recognises falls back rather than asking for nothing', () => {
    // A bad id used to be an empty range, which reads as "nothing on" — the one
    // answer this card must never give by accident.
    const fallback = View.upcomingRange('2026-07-31', 'wobble');
    assert.deepStrictEqual(fallback, View.upcomingRange('2026-07-31', View.DEFAULT_UPCOMING_WINDOW));
    assert.ok(fallback.to > fallback.from);
});

test('each window says its own name in the empty sentence', () => {
    assert.strictEqual(
        View.myCommitmentsSentence([], View.upcomingWindow('fortnight').phrase),
        'Nothing on for you in the next two weeks.'
    );
});

test('a day already gone is not something you have on', () => {
    // The card is about what is coming. A serve you have already done sitting
    // under "Upcoming" reads as a thing still to do.
    const withPast = [
        { id: 'gone', date: '2026-07-01', name: 'Pluckers Trivia', isPast: true,
          assignments: [{ personId: 'me', roleSlug: 'contestants', slotId: 's1', state: 'confirmed', label: 'Contestants' }] },
    ].concat(OCCURRENCES);

    const mine = View.myCommitments(withPast, 'me');
    assert.deepStrictEqual(mine.map(c => c.date), ['2026-07-15', '2026-07-19']);
});

test('a window with nothing left says so plainly', () => {
    const allPast = [
        { id: 'gone', date: '2026-07-29', name: 'Pluckers Trivia', isPast: true,
          assignments: [{ personId: 'me', roleSlug: 'contestants', slotId: 's1', state: 'confirmed', label: 'Contestants' }] },
    ];
    const mine = View.myCommitments(allPast, 'me');
    assert.deepStrictEqual(mine, []);
    assert.strictEqual(View.myCommitmentsSentence(mine, 'the next week'),
        'Nothing on for you in the next week.');
});

test('the rail carries somebody else’s nothing', () => {
    assert.deepStrictEqual(View.myCommitments(OCCURRENCES, 'nobody'), []);
    assert.deepStrictEqual(View.myCommitments(OCCURRENCES, null), []);
});

test('each commitment carries its state and tone for the dot', () => {
    const mine = View.myCommitments(OCCURRENCES, 'me');
    assert.strictEqual(mine[0].stateLabel, 'Confirmed');
    assert.strictEqual(mine[0].tone, 'good');
    assert.strictEqual(mine[1].tone, 'calm');
});

test('the summary sentence counts what is still waiting on your yes', () => {
    const mine = View.myCommitments(OCCURRENCES, 'me');
    assert.strictEqual(
        View.myCommitmentsSentence(mine),
        '2 things — Kids Ministry and Prayer. 1 is still waiting on your yes.'
    );
});

test('with nothing outstanding the sentence does not invent a nag', () => {
    const confirmed = [{ roleLabel: 'Setup', state: 'confirmed' }];
    assert.strictEqual(View.myCommitmentsSentence(confirmed), 'One thing — Setup.');
});

test('an empty window says so plainly', () => {
    assert.strictEqual(View.myCommitmentsSentence([], 'the next month'),
        'Nothing on for you in the next month.');
});

// ── Places still to fill ──────────────────────────────────────────────────────
//
// A place is open when it is empty OR when the person in it said no. One rule,
// both cases — which is what brings the warning back by itself when somebody
// declines, with nothing having to remember it was ever cleared.

const KIDS = { slug: 'kids', name: 'Kids Ministry', slots: [{ id: 's1' }, { id: 's2' }] };
const SOUND = { slug: 'sound_desk', name: 'Sound desk', slots: [{ id: 's1' }] };
const DEFS = [KIDS, SOUND];

test('an untouched date is every place open', () => {
    // The sparse promise: a date nobody has done anything to has no document at
    // all, and it is exactly the date with the most to fill.
    const date = { id: 'x', date: '2026-08-09', seriesRoleSlugs: ['kids', 'sound_desk'] };
    assert.strictEqual(View.openPlaces(date, DEFS), 3);
});

test('somebody standing in a place closes it, and their no opens it again', () => {
    const base = { id: 'x', date: '2026-08-09', seriesRoleSlugs: ['sound_desk'] };

    const empty = View.openPlaces(base, DEFS);
    const filled = View.openPlaces(Object.assign({}, base, {
        assignments: [{ personId: 'p1', roleSlug: 'sound_desk', slotId: 's1', state: 'pending' }],
    }), DEFS);
    const declined = View.openPlaces(Object.assign({}, base, {
        assignments: [{ personId: 'p1', roleSlug: 'sound_desk', slotId: 's1', state: 'declined' }],
    }), DEFS);

    assert.strictEqual(empty, 1);
    assert.strictEqual(filled, 0, 'a pending yes still holds the place');
    assert.strictEqual(declined, 1, 'the warning must come back on its own');
});

test('the Roles come from both levels, and the same Role twice is one Role', () => {
    const date = {
        id: 'x', date: '2026-08-09',
        seriesRoleSlugs: ['sound_desk'],
        occurrenceRoleSlugs: ['sound_desk', 'kids'],
    };
    assert.strictEqual(View.openPlaces(date, DEFS), 3, 'the sound desk was counted twice');
});

test('a liturgical Role is not a place this screen can chase', () => {
    // It is filled in the order of service and prints in the booklet.
    const liturgical = Roles.LITURGICAL_SLUGS[0];
    const sunday = {
        id: 'sunday_service_2026-08-09', date: '2026-08-09',
        seriesRoleSlugs: [liturgical, 'sound_desk'],
    };
    const defs = DEFS.concat([{ slug: liturgical, name: 'Preacher', slots: [{ id: 'p1' }] }]);
    assert.strictEqual(View.openPlaces(sunday, defs), 1);
});

test('a one-off Role is open only while nobody at all is on it', () => {
    // No slots, no count — it is a label and some people.
    const base = { id: 'x', date: '2026-08-09', oneOffRoles: [{ id: 'o1', label: 'Unlock the hall' }] };

    assert.strictEqual(View.openPlaces(base, DEFS), 1);
    assert.strictEqual(View.openPlaces(Object.assign({}, base, {
        assignments: [{ personId: 'p1', oneOffId: 'o1', state: 'pending' }],
    }), DEFS), 0);
    assert.strictEqual(View.openPlaces(Object.assign({}, base, {
        assignments: [{ personId: 'p1', oneOffId: 'o1', state: 'declined' }],
    }), DEFS), 1);
});

test('a date nothing is happening on has nothing to chase', () => {
    const roles = { seriesRoleSlugs: ['kids'] };
    const cancelled = Object.assign({ id: 'x', date: '2026-08-09', cancelled: true }, roles);
    const gone = Object.assign({ id: 'x', date: '2026-08-09', movedTo: '2026-08-16' }, roles);
    const past = Object.assign({ id: 'x', date: '2026-06-09', isPast: true }, roles);

    assert.strictEqual(View.openPlaces(cancelled, DEFS), 0);
    assert.strictEqual(View.openPlaces(gone, DEFS), 0);
    assert.strictEqual(View.openPlaces(past, DEFS), 0, 'nobody can fill last month');
});

test('a Role whose definition is not in hand is not counted as a gap', () => {
    // Guessing would put a number on the screen nobody can act on.
    const date = { id: 'x', date: '2026-08-09', seriesRoleSlugs: ['welcome_team'] };
    assert.strictEqual(View.openPlaces(date, DEFS), 0);
    assert.strictEqual(View.openPlaces(date, []), 0);
});

test('the gap is said the same way wherever it appears', () => {
    assert.strictEqual(View.placesToFillLabel(1), '1 place to fill');
    assert.strictEqual(View.placesToFillLabel(3), '3 places to fill');
});

// ── Needs sorting ─────────────────────────────────────────────────────────────

const PEOPLE = [{ id: 'p9', name: 'Bethany Croft' }];

test('a decline becomes one plain sentence', () => {
    const rows = View.needsSorting(OCCURRENCES, PEOPLE);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].sentence, 'Bethany Croft declined Kids Ministry. The place still needs someone.');
    assert.strictEqual(rows[0].icon, 'error');
});

test('silence is only a question once the date has passed', () => {
    // Before then it is simply nobody having answered yet, which is normal and
    // must not be dressed up as a problem.
    const future = [{ id: 'a', date: '2030-01-01', assignments: [{ personId: 'p1', state: 'pending' }] }];
    assert.deepStrictEqual(View.needsSorting(future, PEOPLE), []);

    const past = [{ id: 'a', date: '2020-01-01', isPast: true, assignments: [{ personId: 'p1', state: 'pending' }] }];
    const rows = View.needsSorting(past, PEOPLE);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].icon, 'help');
});

test('a calm month produces no rows at all', () => {
    const calm = [{ id: 'a', date: '2026-07-15', assignments: [{ personId: 'p1', state: 'confirmed' }] }];
    assert.deepStrictEqual(View.needsSorting(calm, PEOPLE), []);
});

// ── The colour an Event shows up as ───────────────────────────────────────────
//
// A fixed palette, not a free colour. A free colour lets somebody pick
// something unreadable, and — worse here — pick the error red, which is the one
// colour on this calendar that means something specific and must keep meaning
// it.

test('the palette is a closed set, each entry usable on its own', () => {
    assert.ok(View.EVENT_COLOURS.length >= 6, 'too few to be worth choosing between');

    const slugs = View.EVENT_COLOURS.map(c => c.slug);
    assert.strictEqual(new Set(slugs).size, slugs.length, 'two colours share a slug');

    View.EVENT_COLOURS.forEach(c => {
        assert.match(c.bar, /^#[0-9A-Fa-f]{6}$/, c.slug + ' has no usable bar colour');
        assert.ok(c.name && c.name.length, c.slug + ' has no name a person could say');
    });
});

test('nothing in the palette is the red that means "needs sorting"', () => {
    // Red is spoken for. A chip in the error red says one thing on this
    // calendar, and a chosen colour must never be able to say it by accident.
    View.EVENT_COLOURS.forEach(c => {
        assert.notStrictEqual(c.bar.toUpperCase(), '#A8463E', c.slug + ' is the error red');
    });
});

test('an Event with no colour chosen looks exactly as it did before', () => {
    // The whole existing calendar has no colour stored on anything, so the
    // fallback IS the current appearance. If this changes, every event in the
    // church silently restyles.
    assert.strictEqual(View.colourOf({}).bar, '#5D94A9');
    assert.strictEqual(View.colourOf(null).bar, '#5D94A9');
});

test('a stored colour nobody recognises falls back rather than blanking the chip', () => {
    // An old slug, a typo, a hand-edited document. A chip with no left edge
    // reads as a rendering bug, not as "unknown colour".
    assert.strictEqual(View.colourOf({ colour: 'chartreuse' }).bar, '#5D94A9');
    assert.strictEqual(View.colourOf({ colour: 42 }).bar, '#5D94A9');
});

test('a recurring Event takes its colour from the series, a one-off from itself', () => {
    const gold = View.EVENT_COLOURS.find(c => c.slug === 'gold');

    // Inherited: every date of the series shows the same colour.
    assert.strictEqual(View.colourOf({ seriesId: 'midweek', seriesColour: 'gold' }).slug, 'gold');
    // A one-off Event's occurrence IS the whole Event, so it carries its own.
    assert.strictEqual(View.colourOf({ seriesId: null, colour: 'gold' }).slug, 'gold');
    assert.strictEqual(View.colourOf({ colour: 'gold' }).bar, gold.bar);
});

test('the store and the display layer agree on what the colours are', () => {
    // events-store.js restates the slugs because it must not depend on a display
    // module. Restating is fine; drifting is not — a slug the store accepts and
    // the palette does not know renders as the fallback, so an editor picks a
    // colour, it saves, and nothing changes.
    const Store = require('../public/events-store.js');
    assert.deepStrictEqual(
        Store.COLOUR_SLUGS.slice().sort(),
        View.EVENT_COLOURS.map(c => c.slug).sort()
    );
});

test('a Sunday keeps the colour it already draws in', () => {
    const Core = require('../public/events-occurrence-core.js');
    assert.strictEqual(View.colourOf({ seriesId: Core.SUNDAY_SERVICE_ID }).slug, 'ocean');
    // But it is only a default. A colour is decoration — unlike a Sunday's
    // visibility and its liturgy, there is nothing to protect by settling it.
    assert.strictEqual(
        View.colourOf({ seriesId: Core.SUNDAY_SERVICE_ID, seriesColour: 'plum' }).slug, 'plum');
});

test('the red a chip uses for "needs sorting" is the theme\'s error red', () => {
    // Restated in calendar-view.js so a chip can use it inline. If it drifts
    // from the token, the loudest thing on the calendar stops matching the same
    // warning everywhere else it appears.
    const theme = require('../tailwind.config.js').theme.extend.colors;
    assert.strictEqual(View.ATTENTION_COLOUR.toUpperCase(), theme.error.toUpperCase());
});

test('the amber a chip uses for "places to fill" is the theme\'s warning', () => {
    const theme = require('../tailwind.config.js').theme.extend.colors;
    assert.strictEqual(View.WARNING_COLOUR.toUpperCase(), theme.warning.toUpperCase());

    // The pair the chip background needs. Without them the class is simply not
    // generated and the chip draws with no background at all.
    assert.ok(theme['warning-container'], 'no background for the warning chip');
    assert.ok(theme['on-warning-container'], 'no text colour for the warning chip');
});

test('a chosen colour and the warning amber cannot be mistaken for each other', () => {
    // They are the same amber. A chosen colour only ever draws the BAR down the
    // side of a chip; the warning only ever tints the BACKGROUND. So a tinted
    // chip always means the app is saying something.
    const amber = View.EVENT_COLOURS.find(c => c.slug === 'amber');
    assert.strictEqual(amber.bar.toUpperCase(), View.WARNING_COLOUR.toUpperCase());
    assert.ok(View.EVENT_COLOURS.every(c => c.tint !== c.bar), 'a bar and a background look alike');
});
