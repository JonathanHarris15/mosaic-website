const { test } = require('node:test');
const assert = require('node:assert');

const Ann = require('../public/event-announcement-core.js');
const Shepherding = require('../public/shepherding-core.js');

// MS-630 — what an event announcement may be, and who matches.
//
// The pages and the save path call this module. A refusal is not something
// to save. Expected values are the ones the PRD names, not a recomputation
// of the rules.

const WORDS = 'Membership Matters meets in the hall after the service.';

function draft(over) {
    return Object.assign({
        title: 'Membership Matters',
        prose: WORDS,
        way: 'printed',
        eventKind: 'one-off',
        weeks: 2,
    }, over);
}

function toldOnce(over) {
    return draft({
        way: 'told',
        weeks: undefined,
        dates: [{ date: '2026-05-03', time: '08:00' }],
        tagIds: ['choir'],
        savedTagIds: ['choir'],
        visibleTagIds: ['choir'],
        ...over,
    });
}

function toldEvery(over) {
    return draft({
        way: 'told',
        eventKind: 'repeating',
        weeks: undefined,
        daysBefore: 14,
        time: '08:00',
        tagIds: ['choir'],
        savedTagIds: ['choir'],
        visibleTagIds: ['choir'],
        ...over,
    });
}

function accepted(over) {
    const result = Ann.accept(draft(over));
    assert.equal(result.ok, true, result.refusal);
    return result.announcement;
}

// ── Words ─────────────────────────────────────────────────────────────────────

test('a blank title is refused and is not an announcement to save', () => {
    const result = Ann.accept(draft({ title: '   ' }));
    assert.equal(result.ok, false);
    assert.equal(result.announcement, undefined);
    assert.match(result.refusal, /title/i);
});

test('a blank prose is refused and is not an announcement to save', () => {
    const result = Ann.accept(draft({ prose: '\n' }));
    assert.equal(result.ok, false);
    assert.equal(result.announcement, undefined);
    assert.match(result.refusal, /prose/i);
});

test('title and prose are kept with the surrounding space trimmed', () => {
    const announcement = accepted({ title: '  Membership Matters  ', prose: '  ' + WORDS + '  ' });
    assert.equal(announcement.title, 'Membership Matters');
    assert.equal(announcement.prose, WORDS);
});

test('a title of 120 characters is kept, and 121 is refused', () => {
    assert.equal(accepted({ title: 'a'.repeat(120) }).title.length, 120);
    const over = Ann.accept(draft({ title: 'a'.repeat(121) }));
    assert.equal(over.ok, false);
    assert.equal(over.announcement, undefined);
    assert.match(over.refusal, /120/);
});

test('prose of 2,000 characters is kept, and 2,001 is refused', () => {
    assert.equal(accepted({ prose: 'a'.repeat(2000) }).prose.length, 2000);
    const over = Ann.accept(draft({ prose: 'a'.repeat(2001) }));
    assert.equal(over.ok, false);
    assert.equal(over.announcement, undefined);
    assert.match(over.refusal, /2,000|2000/);
});

test('an announcement is exactly one way', () => {
    const printed = accepted();
    assert.equal(printed.way, 'printed');
    assert.equal(printed.dates, undefined);
    assert.equal(printed.tagIds, undefined);

    const told = Ann.accept(toldOnce());
    assert.equal(told.ok, true, told.refusal);
    assert.equal(told.announcement.way, 'told');
    assert.equal(told.announcement.weeks, undefined);

    const neither = Ann.accept(draft({ way: 'both' }));
    assert.equal(neither.ok, false);
    assert.match(neither.refusal, /printed or told/i);
});

// ── Printed ───────────────────────────────────────────────────────────────────

test('printed weeks of 0, a fraction, and a negative are refused, and 1 is kept', () => {
    for (const weeks of [0, 1.5, -1, '', '1.5']) {
        const result = Ann.accept(draft({ weeks }));
        assert.equal(result.ok, false, 'weeks ' + weeks + ' should be refused');
        assert.equal(result.announcement, undefined);
    }
    assert.equal(accepted({ weeks: 1 }).weeks, 1);
    assert.equal(accepted({ weeks: '3' }).weeks, 3);
});

test('a printed announcement stores no tags', () => {
    const announcement = accepted({ tagIds: ['choir'], savedTagIds: ['choir', 'discipline'] });
    assert.equal(announcement.tagIds, undefined);
    assert.equal(announcement.weeks, 2);
});

test('switching from told to printed drops the tell', () => {
    const announcement = accepted({
        way: 'printed',
        weeks: 2,
        dates: [{ date: '2026-05-03', time: '08:00' }],
        tagIds: ['choir'],
        daysBefore: 14,
        time: '09:00',
    });
    assert.equal(announcement.way, 'printed');
    assert.equal(announcement.weeks, 2);
    assert.equal(announcement.dates, undefined);
    assert.equal(announcement.daysBefore, undefined);
    assert.equal(announcement.time, undefined);
    assert.equal(announcement.tagIds, undefined);
});

// ── The clock ─────────────────────────────────────────────────────────────────

test('7:59am and 8:00pm are refused, and 8:00am and 7:59pm are kept', () => {
    const refused = ['07:59', '20:00'];
    const kept = ['08:00', '19:59'];
    for (const time of refused) {
        const result = Ann.accept(toldOnce({ dates: [{ date: '2026-05-03', time }] }));
        assert.equal(result.ok, false, time + ' should be refused');
        assert.equal(result.announcement, undefined);
        assert.match(result.refusal, /8:00/);
    }
    for (const time of kept) {
        const result = Ann.accept(toldOnce({ dates: [{ date: '2026-05-03', time }] }));
        assert.equal(result.ok, true, time + ' should be kept: ' + result.refusal);
        assert.equal(result.announcement.dates[0].time, time);
    }
});

// ── Told, one-off ─────────────────────────────────────────────────────────────

test('the same date twice on a one-off tell is refused, and two dates are kept', () => {
    const twice = Ann.accept(toldOnce({
        dates: [
            { date: '2026-05-03', time: '08:00' },
            { date: '2026-05-03', time: '18:00' },
        ],
    }));
    assert.equal(twice.ok, false);
    assert.match(twice.refusal, /same date/i);

    const two = Ann.accept(toldOnce({
        dates: [
            { date: '2026-05-03', time: '08:00' },
            { date: '2026-05-10', time: '19:59' },
        ],
    }));
    assert.equal(two.ok, true, two.refusal);
    assert.deepEqual(two.announcement.dates, [
        { date: '2026-05-03', time: '08:00' },
        { date: '2026-05-10', time: '19:59' },
    ]);
});

test('a one-off tell may name a date in the past', () => {
    const result = Ann.accept(toldOnce({
        dates: [{ date: '2001-01-01', time: '08:00' }],
    }));
    assert.equal(result.ok, true, result.refusal);
    assert.equal(result.announcement.dates[0].date, '2001-01-01');
});

test('a one-off tell with no date is refused', () => {
    const result = Ann.accept(toldOnce({ dates: [] }));
    assert.equal(result.ok, false);
    assert.match(result.refusal, /date/i);
});

// ── Told, repeating ───────────────────────────────────────────────────────────

test('a repeating tell keeps days-before and one time, and 0 is the day itself', () => {
    const result = Ann.accept(toldEvery({ daysBefore: 0, time: '08:00' }));
    assert.equal(result.ok, true, result.refusal);
    assert.equal(result.announcement.daysBefore, 0);
    assert.equal(result.announcement.time, '08:00');
    assert.equal(result.announcement.dates, undefined);
});

test('days-before below 0 is refused, and a fraction is refused', () => {
    for (const daysBefore of [-1, -0.5, 1.5]) {
        const result = Ann.accept(toldEvery({ daysBefore }));
        assert.equal(result.ok, false, 'days-before ' + daysBefore);
        assert.equal(result.announcement, undefined);
    }
});

test('a calendar-date pick is refused on a repeating event', () => {
    const result = Ann.accept(toldEvery({
        dates: [{ date: '2026-05-03', time: '08:00' }],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.announcement, undefined);
    assert.match(result.refusal, /calendar date/i);
});

// ── Tags ──────────────────────────────────────────────────────────────────────

test('a tell with no tags is refused, and a tell with one tag is kept', () => {
    const none = Ann.accept(toldOnce({ tagIds: [], savedTagIds: [], visibleTagIds: ['choir'] }));
    assert.equal(none.ok, false);
    assert.match(none.refusal, /tag/i);

    const one = Ann.accept(toldOnce());
    assert.equal(one.ok, true, one.refusal);
    assert.deepEqual(one.announcement.tagIds, ['choir']);
});

test('a tag the viewer cannot see stays on the draft when the save did not remove it', () => {
    const result = Ann.accept(toldOnce({
        tagIds: ['choir'],
        savedTagIds: ['choir', 'under_care'],
        visibleTagIds: ['choir'],
    }));
    assert.equal(result.ok, true, result.refusal);
    assert.deepEqual(result.announcement.tagIds, ['choir', 'under_care']);
});

test('a private tag is described as private, and a visible tag keeps its name', () => {
    const shown = Ann.tagsAsShown(['choir', 'under_care'], [
        { id: 'choir', name: 'Choir' },
    ]);
    assert.deepEqual(shown, [
        { id: 'choir', name: 'Choir', private: false },
        { id: 'under_care', name: 'Private', private: true },
    ]);
});

test('the picker offers only tags this editor can already see', () => {
    const tags = [
        { id: 'choir', name: 'Choir', hiddenFromOthers: false },
        { id: 'under_care', name: 'Under care', hiddenFromOthers: true },
    ];
    assert.deepEqual(
        Ann.tagsTheEditorMayPick(tags, { viewerMaySeeHiddenTags: false }).map(t => t.id),
        ['choir']
    );
    assert.deepEqual(
        Ann.tagsTheEditorMayPick(tags, { viewerMaySeeHiddenTags: true }).map(t => t.id),
        ['choir', 'under_care']
    );
});

// ── Who matches ───────────────────────────────────────────────────────────────

function person(over) {
    return Object.assign({
        id: 'p',
        name: 'Ada',
        tags: ['choir'],
        membership: { inactive: false },
        hidden: false,
    }, over);
}

test('people match only when they carry every chosen tag', () => {
    const result = Ann.whoWouldBeTold({
        tagIds: ['choir', 'member'],
        people: [
            person({ id: 'ada', name: 'Ada', tags: ['choir', 'member'] }),
            person({ id: 'ben', name: 'Ben', tags: ['choir'] }),
        ],
        viewerMaySeeHidden: true,
    });
    assert.deepEqual(result.names, ['Ada']);
});

test('an inactive person matches only when the Inactive tag is chosen', () => {
    const inactive = person({
        name: 'Fran',
        tags: ['choir', Shepherding.INACTIVE_TAG_ID],
        membership: { inactive: true, status: 'inactive' },
    });
    const active = person({ name: 'Ada', tags: ['choir'] });

    const without = Ann.whoWouldBeTold({
        tagIds: ['choir'],
        people: [inactive, active],
        viewerMaySeeHidden: true,
    });
    assert.deepEqual(without.names, ['Ada']);

    const withInactive = Ann.whoWouldBeTold({
        tagIds: ['choir', Shepherding.INACTIVE_TAG_ID],
        people: [inactive, active],
        viewerMaySeeHidden: true,
    });
    assert.deepEqual(withInactive.names, ['Fran']);
});

test('inactivity is the directory membership test', () => {
    const legacy = person({
        name: 'Fran',
        tags: ['choir'],
        membership: { status: 'inactive' },
    });
    assert.equal(
        Shepherding.isInactiveMembership(legacy.membership),
        true
    );
    const result = Ann.whoWouldBeTold({
        tagIds: ['choir'],
        people: [legacy],
        viewerMaySeeHidden: true,
    });
    assert.deepEqual(result.names, []);
});

test('the name list leaves out people the viewer may not see, and does not say how many', () => {
    const result = Ann.whoWouldBeTold({
        tagIds: ['choir'],
        people: [
            person({ name: 'Ada', hidden: false }),
            person({ name: 'Hidden Hope', hidden: true }),
        ],
        viewerMaySeeHidden: false,
    });
    assert.deepEqual(Object.keys(result), ['names']);
    assert.deepEqual(result.names, ['Ada']);
    assert.equal(JSON.stringify(result).includes('1'), false);

    const elder = Ann.whoWouldBeTold({
        tagIds: ['choir'],
        people: [
            person({ name: 'Ada', hidden: false }),
            person({ name: 'Hidden Hope', hidden: true }),
        ],
        viewerMaySeeHidden: true,
    });
    assert.deepEqual(elder.names, ['Ada', 'Hidden Hope']);
});

test('no tags matches nobody — an empty filter is not everyone', () => {
    const result = Ann.whoWouldBeTold({
        tagIds: [],
        people: [person({ name: 'Ada' })],
        viewerMaySeeHidden: true,
    });
    assert.deepEqual(result, { names: [] });
});

// ── Where it lives, and what a tab may do ─────────────────────────────────────

test('a one-off keeps the announcement on its occurrence, and that page may change it', () => {
    assert.deepEqual(Ann.whereAnnouncementsLive({ kind: 'one-off' }), {
        on: 'occurrence',
        writable: true,
    });
});

test('a repeating event keeps the announcement on the series', () => {
    assert.deepEqual(Ann.whereAnnouncementsLive({ kind: 'repeating', onDate: false }), {
        on: 'series',
        writable: true,
    });
});

test('a date of a repeating event reads the series and cannot change it', () => {
    assert.deepEqual(Ann.whereAnnouncementsLive({ kind: 'repeating', onDate: true }), {
        on: 'series',
        writable: false,
    });
});

test('an editor on a one-off can change announcements and sees how they go out', () => {
    const tab = Ann.whatTheTabShows({ surface: 'one-off', isEditor: true });
    assert.equal(tab.editable, true);
    assert.equal(tab.showsGoingOut, true);
    assert.equal(tab.seriesHref, null);
});

test('an editor on a repeating event can change announcements on the series', () => {
    const tab = Ann.whatTheTabShows({ surface: 'series', isEditor: true, seriesId: 'midweek' });
    assert.equal(tab.editable, true);
    assert.equal(tab.showsGoingOut, true);
});

test('a locked series does not block announcements', () => {
    const tab = Ann.whatTheTabShows({
        surface: 'series',
        isEditor: true,
        seriesId: 'sunday_service',
        locked: true,
    });
    assert.equal(tab.editable, true);
    assert.equal(tab.showsGoingOut, true);
});

test('a member sees the words and not how they go out, and cannot change them', () => {
    for (const surface of ['one-off', 'series', 'date']) {
        const tab = Ann.whatTheTabShows({ surface, isEditor: false, seriesId: 'midweek' });
        assert.equal(tab.editable, false, surface);
        assert.equal(tab.showsGoingOut, false, surface);
        assert.equal(tab.seriesHref, null, surface);
    }
});

test('an editor opening one date is sent to the series announcements tab', () => {
    const tab = Ann.whatTheTabShows({
        surface: 'date',
        isEditor: true,
        seriesId: 'midweek',
    });
    assert.equal(tab.editable, false);
    assert.equal(tab.showsGoingOut, false);
    assert.equal(
        tab.seriesHref,
        'recurring-events.html?series=midweek&tab=announcements'
    );
});

test('a new announcement goes at the end, and deleting one leaves the others in order', () => {
    const first = { id: 'a', order: 0 };
    const second = { id: 'b', order: 1 };
    assert.equal(Ann.nextOrder([first, second]), 2);
    assert.deepEqual(
        Ann.withoutAnnouncement([first, second, { id: 'c', order: 2 }], 'b').map(a => a.id),
        ['a', 'c']
    );
});

test('the words and how it goes out are two records', () => {
    const told = Ann.accept(toldOnce()).announcement;
    const records = Ann.recordsOf(told, 4);
    assert.deepEqual(records.words, {
        title: 'Membership Matters',
        prose: WORDS,
        order: 4,
    });
    assert.deepEqual(records.goingOut, {
        way: 'told',
        dates: [{ date: '2026-05-03', time: '08:00' }],
        tagIds: ['choir'],
    });
    assert.equal(records.words.tagIds, undefined);
    assert.equal(records.goingOut.title, undefined);
});
