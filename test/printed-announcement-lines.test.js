const { test } = require('node:test');
const assert = require('node:assert');

const Lines = require('../public/printed-announcement-lines.js');

// MS-639 — which printed announcements belong on a Sunday.
// Dates are church-local. 18 October 2026 is a Sunday, so 4, 11 and 25
// October and 27 September are the Sundays around it, and 21 October is
// the Wednesday in the brief.

const WEDNESDAY = {
    id: 'membership',
    title: 'Membership Matters',
    prose: 'Meets in the hall after the service.',
    way: 'printed',
    weeks: 2,
    dates: ['2026-10-21'],
    eventName: 'Membership Matters',
    startTime: '19:00',
    order: 0,
};

function titles(sunday, paired) {
    return Lines.linesOnSunday(sunday, paired).map(line => line.title);
}

test('a Wednesday two weeks ahead is on the Sundays that reach it, and not the ones outside', () => {
    assert.deepEqual(titles('2026-10-11', [WEDNESDAY]), ['Membership Matters']);
    assert.deepEqual(titles('2026-10-18', [WEDNESDAY]), ['Membership Matters']);
    assert.deepEqual(titles('2026-10-04', [WEDNESDAY]), []);
    assert.deepEqual(titles('2026-10-25', [WEDNESDAY]), []);
});

test('a Sunday two weeks ahead includes that Sunday and the two before it', () => {
    const onSunday = Object.assign({}, WEDNESDAY, {
        id: 'on-sunday',
        title: 'On the Sunday',
        dates: ['2026-10-18'],
    });
    assert.deepEqual(titles('2026-10-04', [onSunday]), ['On the Sunday']);
    assert.deepEqual(titles('2026-10-11', [onSunday]), ['On the Sunday']);
    assert.deepEqual(titles('2026-10-18', [onSunday]), ['On the Sunday']);
    assert.deepEqual(titles('2026-09-27', [onSunday]), []);
});

test('a repeating announcement that qualifies more than once is returned once, by the soonest date', () => {
    const repeating = Object.assign({}, WEDNESDAY, {
        id: 'every-week',
        title: 'Every week',
        dates: ['2026-10-14', '2026-10-21', '2026-10-28'],
    });
    const later = Object.assign({}, WEDNESDAY, {
        id: 'later',
        title: 'Later gathering',
        dates: ['2026-10-21'],
        eventName: 'Later gathering',
    });
    const lines = Lines.linesOnSunday('2026-10-11', [later, repeating]);
    assert.deepEqual(lines.map(line => line.title), ['Every week', 'Later gathering']);
    assert.equal(lines.length, 2);
});

test('a skipped date contributes nothing, and a moved date is counted from the day it was moved to', () => {
    const rule = { freq: 'weekly', weekday: 3, startDate: '2026-10-07', time: '19:00' };
    const skipped = Lines.datesTheEventHappens({
        seriesId: 'midweek',
        rule,
        stored: [{ seriesId: 'midweek', date: '2026-10-21', cancelled: true }],
    }, '2026-10-18', '2026-10-25');
    assert.deepEqual(skipped.dates, []);

    const moved = Lines.datesTheEventHappens({
        seriesId: 'midweek',
        rule,
        stored: [
            { seriesId: 'midweek', date: '2026-10-21', movedTo: '2026-10-22' },
            { seriesId: 'midweek', date: '2026-10-22', movedFrom: '2026-10-21' },
        ],
    }, '2026-10-18', '2026-10-25');
    assert.deepEqual(moved.dates, ['2026-10-22']);

    const announcement = Object.assign({}, WEDNESDAY, { dates: moved.dates });
    assert.deepEqual(titles('2026-10-18', [announcement]), ['Membership Matters']);
    assert.deepEqual(titles('2026-10-04', [Object.assign({}, announcement, { weeks: 1 })]), []);
});

test('a Friday-through-Sunday run is included when any day of it falls in the window, and sorts by its first day', () => {
    const run = Lines.datesTheEventHappens({
        occurrence: { date: '2026-10-16', endDate: '2026-10-18' },
    });
    assert.equal(run.run, true);
    assert.deepEqual(run.dates, ['2026-10-16', '2026-10-17', '2026-10-18']);

    const conference = {
        id: 'conference',
        title: 'Conference',
        prose: 'Friday through Sunday.',
        way: 'printed',
        weeks: 2,
        dates: run.dates,
        run: true,
        eventName: 'Conference',
        startTime: '09:00',
        order: 0,
    };
    const sameSunday = Object.assign({}, WEDNESDAY, {
        id: 'evening',
        title: 'Evening',
        dates: ['2026-10-18'],
        eventName: 'Evening',
        startTime: '18:00',
    });
    assert.deepEqual(titles('2026-10-04', [conference]), ['Conference']);
    assert.deepEqual(titles('2026-10-11', [conference]), ['Conference']);
    assert.deepEqual(titles('2026-10-18', [conference]), ['Conference']);
    assert.deepEqual(titles('2026-09-27', [conference]), []);
    assert.deepEqual(titles('2026-10-25', [conference]), []);
    assert.deepEqual(
        Lines.linesOnSunday('2026-10-18', [sameSunday, conference]).map(line => line.title),
        ['Conference', 'Evening']
    );
});

test('same day follows the earlier start time, and two announcements on one event stay in written order', () => {
    const early = Object.assign({}, WEDNESDAY, {
        id: 'early',
        title: 'Morning',
        eventName: 'Morning',
        startTime: '09:00',
        dates: ['2026-10-21'],
    });
    const late = Object.assign({}, WEDNESDAY, {
        id: 'late',
        title: 'Evening',
        eventName: 'Evening',
        startTime: '18:00',
        dates: ['2026-10-21'],
    });
    const first = Object.assign({}, WEDNESDAY, { id: 'first', title: 'First note', order: 0 });
    const second = Object.assign({}, WEDNESDAY, { id: 'second', title: 'Second note', order: 1 });
    assert.deepEqual(titles('2026-10-11', [late, early]), ['Morning', 'Evening']);
    assert.deepEqual(titles('2026-10-11', [second, first]), ['First note', 'Second note']);
});

test('a told announcement produces no line', () => {
    const told = Object.assign({}, WEDNESDAY, { way: 'told', tagIds: ['choir'] });
    assert.deepEqual(Lines.linesOnSunday('2026-10-11', [told, WEDNESDAY]).map(line => line.id), ['membership']);
});

test('the handed-out guide keeps a public event and the Sunday Service, and drops the rest', () => {
    const printed = {
        id: 'note',
        title: 'Membership Matters',
        prose: 'After the service.',
        way: 'printed',
        weeks: 2,
        order: 0,
    };
    const told = Object.assign({}, printed, { id: 'told', title: 'Told', way: 'told' });
    const events = [
        {
            id: 'midweek',
            seriesId: 'midweek',
            name: 'Midweek',
            visibility: 'member',
            startTime: '19:00',
            occurrence: { date: '2026-10-21' },
            announcements: [printed],
        },
        {
            id: 'supper',
            name: 'Supper',
            visibility: 'public',
            startTime: '18:00',
            occurrence: { date: '2026-10-21' },
            announcements: [printed, told],
        },
        {
            id: 'sunday_service',
            seriesId: 'sunday_service',
            name: 'Sunday Service',
            visibility: 'member',
            rule: { freq: 'weekly', weekday: 0, startDate: '2023-01-01', time: '10:30' },
            startTime: '10:30',
            stored: [],
            announcements: [Object.assign({}, printed, { id: 'sunday-note', title: 'From the Sunday', weeks: 1 })],
        },
        {
            id: 'elders',
            seriesId: 'elders',
            name: 'Elders',
            visibility: 'elder',
            occurrence: { date: '2026-10-21' },
            announcements: [Object.assign({}, printed, { id: 'elder-note', title: 'Elders only' })],
        },
        {
            id: 'editors',
            name: 'Editors',
            visibility: 'editor',
            occurrence: { date: '2026-10-21' },
            announcements: [Object.assign({}, printed, { id: 'editor-note', title: 'Editors only' })],
        },
        {
            id: 'roster',
            name: 'Roster',
            visibility: 'participant',
            occurrence: { date: '2026-10-21' },
            announcements: [Object.assign({}, printed, { id: 'roster-note', title: 'Roster only' })],
        },
    ];
    const lines = Lines.linesForHandedOutGuide('2026-10-18', events);
    assert.deepEqual(lines.map(line => line.title), ['From the Sunday', 'Membership Matters']);
    ['Told', 'Elders only', 'Editors only', 'Roster only'].forEach(title => {
        assert.ok(!lines.some(line => line.title === title), title);
    });
});

test('booklet text follows the typed lines and does not store the event lines on them', () => {
    const typed = [{ title: 'Picnic', content: 'Bring a plate' }];
    const lines = [{ id: 'm', title: 'Membership Matters', prose: 'Line one.\nLine two.' }];
    const booklet = Lines.bookletAnnouncements(typed, lines);
    assert.deepEqual(booklet, [
        { title: 'Picnic', content: 'Bring a plate' },
        { title: 'Membership Matters', content: 'Line one.\nLine two.' },
    ]);
    assert.deepEqual(typed, [{ title: 'Picnic', content: 'Bring a plate' }]);

    const values = { announcements: [{ title: '', content: '' }, { title: 'Picnic', content: 'Bring a plate' }] };
    const drawn = Lines.renderedGuideValues(values, lines);
    assert.equal(drawn.announcements[0].title, 'Picnic');
    assert.equal(drawn.announcements[1].content, 'Line one.<br>Line two.');
    assert.ok(!drawn.announcements[1].content.includes('<script>'));
    const hostile = Lines.renderedGuideValues(values, [{ title: 'Careful', prose: '<b>not markup</b>' }]);
    assert.equal(hostile.announcements[1].content, '&lt;b&gt;not markup&lt;/b&gt;');
    assert.equal(values.announcements.length, 2);
    assert.equal(values.announcements[0].title, '');
});

test('the line is the title and the prose, and the Sunday list is not written back onto the announcement', () => {
    const paired = [Object.assign({}, WEDNESDAY)];
    const lines = Lines.linesOnSunday('2026-10-11', paired);
    assert.deepEqual(lines, [{
        id: 'membership',
        title: 'Membership Matters',
        prose: 'Meets in the hall after the service.',
    }]);
    assert.deepEqual(paired[0].dates, ['2026-10-21']);
});
