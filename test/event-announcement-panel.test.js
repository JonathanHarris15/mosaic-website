const { test } = require('node:test');
const assert = require('node:assert');

const Panel = require('../public/event-announcement-panel.js');
const fs = require('node:fs');
const path = require('node:path');

// MS-632 — the Announcements tab on a one-off, on a repeating event, and on
// one date of that repeating event. The panel calls the model and the store.
// The pages bind this object; they do not keep a second copy of the rules.

function memoryDb() {
    const docs = {};
    let n = 0;
    function ref(docPath) {
        return {
            path: docPath,
            id: docPath.split('/').pop(),
            collection(name) { return coll(docPath + '/' + name); },
        };
    }
    function coll(collPath) {
        return {
            doc(id) {
                const minted = id || ('ann_' + (++n));
                return ref(collPath + '/' + minted);
            },
            async get() {
                const prefix = collPath + '/';
                const found = Object.keys(docs).filter(key =>
                    key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') === -1
                );
                return {
                    docs: found.map(key => ({
                        id: key.slice(prefix.length),
                        data: () => Object.assign({}, docs[key]),
                    })),
                };
            },
        };
    }
    return {
        collection(name) { return coll(name); },
        batch() {
            const ops = [];
            return {
                set(target, data) { ops.push(['set', target.path, Object.assign({}, data)]); },
                delete(target) { ops.push(['delete', target.path]); },
                async commit() {
                    ops.forEach(([kind, docPath, data]) => {
                        if (kind === 'delete') delete docs[docPath];
                        else docs[docPath] = data;
                    });
                },
            };
        },
        _docs: docs,
    };
}

function host(over) {
    const page = Object.assign(Panel.bindings(), {
        isEditor: true,
        rank: 'editor',
        account: { permissionLevel: 'editor', pastoralAssistant: false },
        people: [
            { id: 'ada', name: 'Ada', tags: ['choir'], membership: { inactive: false } },
            { id: 'hope', name: 'Hidden Hope', tags: ['choir'], membership: {}, hidden: false, shepherdingHidden: true },
        ],
        announcementTagCatalogue: [
            { id: 'choir', name: 'Choir', hiddenFromOthers: false, hidePeople: false },
        ],
    }, over);
    return page;
}

function fill(page, over) {
    page.startAnnouncement();
    Object.assign(page.announcementForm, {
        title: 'Membership Matters',
        prose: 'Meets in the hall after the service.',
        way: 'printed',
        weeks: 2,
    }, over);
}

test('an editor on a one-off can add, change, and delete more than one announcement', async () => {
    globalThis.db = memoryDb();
    const page = host({ occurrence: { id: 'supper' } });

    fill(page);
    await page.saveAnnouncement();
    assert.equal(page.announcementRefusal, '');
    assert.equal(page.announcements.length, 1);

    page.editAnnouncement(page.announcements[0]);
    page.announcementForm.title = 'Membership Matters tonight';
    await page.saveAnnouncement();
    assert.equal(page.announcements[0].title, 'Membership Matters tonight');

    fill(page, { title: 'Choir', prose: 'Thursday, in the hall.', weeks: 1 });
    await page.saveAnnouncement();
    assert.deepEqual(page.announcements.map(item => item.title), [
        'Membership Matters tonight',
        'Choir',
    ]);

    await page.deleteAnnouncement(page.announcements[0].id);
    assert.deepEqual(page.announcements.map(item => item.title), ['Choir']);
});

test('a time outside 8:00am–8:00pm is refused and is not there after reload', async () => {
    globalThis.db = memoryDb();
    const page = host({ occurrence: { id: 'supper' } });
    fill(page, {
        way: 'told',
        dates: [{ date: '2026-05-03', time: '20:00' }],
        tagIds: ['choir'],
    });
    await page.saveAnnouncement();
    assert.match(page.announcementRefusal, /8:00/);
    assert.equal(page.announcements.length, 0);
    await page.loadAnnouncements();
    assert.equal(page.announcements.length, 0);
});

test('a tell with no tags cannot be saved, and with tags the editor sees who matches', async () => {
    globalThis.db = memoryDb();
    const page = host({ occurrence: { id: 'supper' } });
    fill(page, {
        way: 'told',
        dates: [{ date: '2026-05-03', time: '08:00' }],
        tagIds: [],
    });
    await page.saveAnnouncement();
    assert.match(page.announcementRefusal, /tag/i);
    assert.equal(page.announcements.length, 0);

    page.announcementForm.tagIds = ['choir'];
    page.refreshAnnouncementNames();
    assert.deepEqual(page.announcementNames, ['Ada']);
    await page.saveAnnouncement();
    assert.equal(page.announcementRefusal, '');
    assert.equal(page.announcements.length, 1);
    assert.equal(page.announcements[0].way, 'told');
});

test('an editor on a repeating event saves on the series, and a date cannot', async () => {
    globalThis.db = memoryDb();
    const series = host({ chosen: { id: 'midweek', name: 'Midweek', locked: false } });
    fill(series, { weeks: 1 });
    await series.saveAnnouncement();
    assert.equal(series.announcementRefusal, '');
    assert.equal(series.announcements[0].title, 'Membership Matters');
    assert.ok(globalThis.db._docs['events/midweek/announcements/' + series.announcements[0].id]);

    const date = host({
        occurrence: { id: 'midweek_2026-07-15', seriesId: 'midweek' },
    });
    await date.loadAnnouncements();
    assert.equal(date.announcements[0].title, 'Membership Matters');
    assert.equal(date.announcementTab().editable, false);
    assert.equal(date.announcementTab().showsGoingOut, false);
    assert.equal(date.announcements[0].way, undefined);
    assert.equal(
        date.announcementTab().seriesHref,
        'recurring-events.html?series=midweek&tab=announcements'
    );

    date.startAnnouncement();
    assert.equal(date.announcementForm, null);
    date.announcementForm = {
        title: 'Only this date',
        prose: 'Must not be stored.',
        way: 'printed',
        weeks: 1,
        dates: [],
        daysBefore: 0,
        time: '08:00',
        tagIds: [],
        savedTagIds: [],
        order: null,
    };
    await date.saveAnnouncement();
    assert.equal(
        Object.keys(globalThis.db._docs).some(key => key.startsWith('event_occurrences/')),
        false
    );
});

test('a member sees the title and the prose, and not how it goes out', async () => {
    globalThis.db = memoryDb();
    const editor = host({ occurrence: { id: 'supper' } });
    fill(editor);
    await editor.saveAnnouncement();

    const member = host({
        isEditor: false,
        rank: 'member',
        account: { permissionLevel: 'member', pastoralAssistant: false },
        occurrence: { id: 'supper' },
    });
    await member.loadAnnouncements();
    assert.equal(member.announcements[0].title, 'Membership Matters');
    assert.equal(member.announcements[0].prose, 'Meets in the hall after the service.');
    assert.equal(member.announcements[0].way, undefined);
    assert.equal(member.announcementTab().editable, false);
    assert.equal(member.announcementTab().showsGoingOut, false);
    member.startAnnouncement();
    assert.equal(member.announcementForm, null);
});

test('the Sunday Service series can carry an announcement', async () => {
    globalThis.db = memoryDb();
    const page = host({
        chosen: { id: 'sunday_service', name: 'Sunday Service', locked: true },
    });
    assert.equal(page.announcementTab().editable, true);
    fill(page, { weeks: 2 });
    await page.saveAnnouncement();
    assert.equal(page.announcementRefusal, '');
    assert.equal(page.announcements.length, 1);
    assert.ok(globalThis.db._docs['events/sunday_service/announcements/' + page.announcements[0].id]);
});

test('the event pages offer the Announcements tab and load the model first', () => {
    const root = path.join(__dirname, '..', 'public');
    const event = fs.readFileSync(path.join(root, 'calendar-event.html'), 'utf8');
    const series = fs.readFileSync(path.join(root, 'recurring-events.html'), 'utf8');
    for (const html of [event, series]) {
        assert.match(html, />Announcements</);
        assert.match(html, /announcementTab\(\)/);
        assert.match(html, /saveAnnouncement\(\)/);
        assert.match(html, /x-show="!announcementTab\(\)\.showsGoingOut"/);
        const core = html.indexOf('src="event-announcement-core.js"');
        const store = html.indexOf('src="event-announcement-store.js"');
        const panel = html.indexOf('src="event-announcement-panel.js"');
        assert.ok(core !== -1 && core < store && store < panel);
    }
    assert.ok(event.indexOf('src="event-announcement-panel.js"') < event.indexOf('src="calendar-event.js"'));
    assert.ok(series.indexOf('src="event-announcement-panel.js"') < series.indexOf('src="recurring-events.js"'));
});
