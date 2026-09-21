const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Guide = require('../public/printed-announcement-guide.js');

// MS-641 — the handed-out guide reads printed lines when it opens and
// does not write them onto the Sunday.

const SUNDAY = '2026-09-06';
const PUBLIC = path.join(__dirname, '..', 'public');

function read(name) {
    return fs.readFileSync(path.join(PUBLIC, name), 'utf8');
}

test('a public one-off and the Sunday Service are gathered, and a member event is not asked', async () => {
    const asked = [];
    const deps = {
        events: {
            loadVisibleSeries: async () => [
                { id: 'open-night', name: 'Open night', visibility: 'public' },
                { id: 'members', name: 'Members meeting', visibility: 'member' },
                { id: 'sunday_service', name: 'Sunday Service', visibility: 'member' },
            ],
            recurrenceFor: (series) => {
                if (series.id === 'sunday_service') {
                    return { freq: 'weekly', weekday: 0, startDate: '2023-01-01', time: '10:30' };
                }
                return { freq: 'weekly', weekday: 3, startDate: '2026-09-02', time: '19:00' };
            },
            loadCalendar: async (_db, range) => {
                assert.equal(range.from, SUNDAY);
                return [
                    { id: 'hall', name: 'Hall work day', visibility: 'public', date: '2026-09-12', time: '09:00' },
                    { id: 'retreat', name: 'Elder retreat', visibility: 'elder', date: '2026-09-12', time: '18:00' },
                ];
            },
        },
        announcements: {
            loadPrintedAnnouncements: async (_db, place) => {
                asked.push(place);
                if (place.seriesId === 'open-night') {
                    return [{ id: 'come', title: 'Come', prose: 'Bring a friend', way: 'printed', weeks: 2, order: 0 }];
                }
                if (place.seriesId === 'sunday_service') {
                    return [{ id: 'lunch', title: 'Lunch', prose: 'After church', way: 'printed', weeks: 1, order: 0 }];
                }
                if (place.occurrenceId === 'hall') {
                    return [{ id: 'work', title: 'Work day', prose: 'Gloves', way: 'printed', weeks: 1, order: 0 }];
                }
                return [];
            },
        },
    };

    const events = await Guide.eventsForSunday({}, SUNDAY, { level: 'editor', personId: 'p1' }, deps);
    const ids = events.map(event => event.id);
    assert.deepEqual(ids.filter(id => id === 'members' || id === 'retreat'), []);
    assert.ok(ids.includes('open-night'));
    assert.ok(ids.includes('sunday_service'));
    assert.ok(ids.includes('hall'));
    assert.deepEqual(asked.filter(place => place.seriesId === 'members' || place.occurrenceId === 'retreat'), []);

    const lines = await Guide.loadLinesForSunday({}, SUNDAY, { level: 'member' }, deps);
    assert.deepEqual(lines.map(line => line.title), ['Lunch', 'Come', 'Work day']);
});

test('a week count longer than the read bound widens the calendar read', async () => {
    const windows = [];
    const deps = {
        events: {
            loadVisibleSeries: async () => [],
            recurrenceFor: () => null,
            loadCalendar: async (_db, range) => {
                windows.push(range.to);
                return [{ id: 'far', name: 'Far gathering', visibility: 'public', date: '2028-06-01', time: '09:00' }];
            },
        },
        announcements: {
            loadPrintedAnnouncements: async () => [{
                id: 'later', title: 'Later', prose: 'Come', way: 'printed', weeks: 200, order: 0,
            }],
        },
    };
    await Guide.eventsForSunday({}, SUNDAY, {}, deps);
    assert.equal(windows.length, 2);
    assert.ok(windows[0] < windows[1]);
});

test('the classic guide draws printed prose as plain text and saves the typed elements', () => {
    const page = read('service-guide.html');
    const script = read('service-guide.js');
    assert.match(page, /announcementsOnThePage\(el\)/);
    assert.match(page, /whitespace-pre-line/);
    assert.match(page, /x-text="item\.prose"/);
    assert.match(page, /x-for="\(item, i\) in selectedElement\.items"/);
    assert.match(script, /elements: JSON\.parse\(JSON\.stringify\(this\.elements\)\)/);
    assert.match(script, /clone\(this\.elements\.find\(el => el\.type === 'announcements'\)\)/);
    assert.match(script, /data\.guide\.elements/);
    assert.match(page, /printed-announcement-lines\.js/);
    assert.match(page, /printed-announcement-guide\.js/);
});

test('the template guide draws a copy and saves the typed values', () => {
    const page = read('service-guide-editor.html');
    const script = read('service-guide-editor.js');
    assert.match(script, /renderedGuideValues\(this\.values, this\.printedAnnouncementLines\)/);
    assert.match(script, /JSON\.parse\(JSON\.stringify\(this\.values\)\)/);
    assert.match(script, /guide\.values\.announcements/);
    assert.match(page, /x-for="\(item, i\) in \(values\[field\.key\] \|\| \[\]\)"/);
    assert.match(page, /printed-announcement-lines\.js/);
    assert.match(page, /printed-announcement-guide\.js/);
});

test('a Sunday booklet loads the printed lines with the typed text', () => {
    ['printable-view.html', 'printable-editor.html'].forEach(name => {
        const page = read(name);
        const linesAt = page.indexOf('printed-announcement-lines.js');
        const dataAt = page.indexOf('printable-data-core.js');
        assert.ok(linesAt !== -1 && linesAt < dataAt, name);
        assert.match(page, /printed-announcement-guide\.js/);
    });
    const render = read('printable-render-core.js');
    assert.match(render, /bind\.field === 'announcements'/);
    assert.match(render, /white-space': 'pre-line'/);
});
