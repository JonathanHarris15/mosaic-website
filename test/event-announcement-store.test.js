const { test } = require('node:test');
const assert = require('node:assert');

const Ann = require('../public/event-announcement-core.js');
const Store = require('../public/event-announcement-store.js');

// MS-631 — the words and the plan are two records, and a refused draft is
// not written. The fake applies the batch, so leaving and coming back is a
// second read of what the first write stored.

function memoryDb() {
    const docs = {};
    const reads = [];
    let n = 0;

    function ref(path) {
        return {
            path,
            id: path.split('/').pop(),
            collection(name) { return coll(path + '/' + name); },
            async get() {
                reads.push(path);
                const data = docs[path];
                return { exists: data != null, id: this.id, data: () => data && Object.assign({}, data) };
            },
        };
    }

    function coll(path) {
        const filters = [];
        const api = {
            where(field, op, value) {
                filters.push({ field, op, value });
                return api;
            },
            doc(id) {
                const minted = id || ('ann_' + (++n));
                return ref(path + '/' + minted);
            },
            async get() {
                reads.push(path);
                const prefix = path + '/';
                const found = Object.keys(docs).filter(key => {
                    if (!key.startsWith(prefix) || key.slice(prefix.length).indexOf('/') !== -1) return false;
                    return filters.every(filter => {
                        if (filter.op !== '==') return false;
                        return docs[key][filter.field] === filter.value;
                    });
                });
                return {
                    docs: found.map(key => ({
                        id: key.slice(prefix.length),
                        data: () => Object.assign({}, docs[key]),
                        ref: ref(key),
                    })),
                };
            },
        };
        return api;
    }

    return {
        collection(name) { return coll(name); },
        batch() {
            const ops = [];
            return {
                set(target, data) { ops.push(['set', target.path, Object.assign({}, data)]); },
                delete(target) { ops.push(['delete', target.path]); },
                async commit() {
                    ops.forEach(([kind, path, data]) => {
                        if (kind === 'delete') delete docs[path];
                        else docs[path] = data;
                    });
                },
            };
        },
        _docs: docs,
        _reads: reads,
    };
}

const oneOff = { kind: 'one-off', occurrenceId: 'supper' };
const series = { kind: 'repeating', seriesId: 'midweek' };
const dateOfSeries = { kind: 'repeating', seriesId: 'midweek', occurrenceId: 'midweek_2026-07-15', onDate: true };

const printed = {
    title: 'Membership Matters',
    prose: 'Meets in the hall after the service.',
    way: 'printed',
    weeks: 2,
};

test('saving a legal announcement and reading it back keeps the title, prose, way, and schedule', async () => {
    const db = memoryDb();
    const saved = await Store.saveAnnouncement(db, oneOff, printed, { existing: [] });
    assert.equal(saved.ok, true, saved.refusal);

    const back = await Store.loadAnnouncements(db, oneOff, { isEditor: true });
    assert.equal(back.length, 1);
    assert.equal(back[0].id, saved.id);
    assert.equal(back[0].title, 'Membership Matters');
    assert.equal(back[0].prose, 'Meets in the hall after the service.');
    assert.equal(back[0].way, 'printed');
    assert.equal(back[0].weeks, 2);
});

test('the words and how it goes out are stored as two records', async () => {
    const db = memoryDb();
    const saved = await Store.saveAnnouncement(db, oneOff, printed, { existing: [] });
    assert.ok(db._docs['event_occurrences/supper/announcements/' + saved.id]);
    assert.ok(db._docs['event_occurrences/supper/announcement_going_out/' + saved.id]);
    const words = db._docs['event_occurrences/supper/announcements/' + saved.id];
    const goingOut = db._docs['event_occurrences/supper/announcement_going_out/' + saved.id];
    assert.equal(words.title, 'Membership Matters');
    assert.equal(words.way, undefined);
    assert.equal(goingOut.way, 'printed');
    assert.equal(goingOut.weeks, 2);
    assert.equal(goingOut.title, undefined);
});

test('a repeating event stores both records on the series', async () => {
    const db = memoryDb();
    const saved = await Store.saveAnnouncement(db, series, Object.assign({}, printed, { weeks: 1 }), { existing: [] });
    assert.equal(saved.ok, true, saved.refusal);
    assert.ok(db._docs['events/midweek/announcements/' + saved.id]);
    assert.equal(db._docs['events/midweek/announcement_going_out/' + saved.id].weeks, 1);
});

test('a date of a repeating event has no announcement of its own', async () => {
    const db = memoryDb();
    const onSeries = await Store.saveAnnouncement(db, series, printed, { existing: [] });
    assert.equal(onSeries.ok, true, onSeries.refusal);

    const refused = await Store.saveAnnouncement(db, dateOfSeries, {
        title: 'Only this Sunday',
        prose: 'This date must not grow its own announcement.',
        way: 'printed',
        weeks: 1,
    }, { existing: [] });
    assert.equal(refused.ok, false);
    assert.equal(
        Object.keys(db._docs).some(path => path.startsWith('event_occurrences/')),
        false
    );

    const read = await Store.loadAnnouncements(db, dateOfSeries, { isEditor: false });
    assert.deepEqual(read.map(item => item.title), ['Membership Matters']);
});

test('deleting one announcement removes it and leaves the others in the same order', async () => {
    const db = memoryDb();
    const first = await Store.saveAnnouncement(db, oneOff, printed, { existing: [] });
    const second = await Store.saveAnnouncement(db, oneOff, {
        title: 'Choir practice',
        prose: 'Thursday, in the hall.',
        way: 'printed',
        weeks: 1,
    }, { existing: [{ id: first.id, order: 0 }] });
    assert.equal(second.ok, true, second.refusal);

    await Store.deleteAnnouncement(db, oneOff, first.id);
    const left = await Store.loadAnnouncements(db, oneOff, { isEditor: true });
    assert.deepEqual(left.map(item => item.title), ['Choir practice']);
    assert.equal(left[0].order, second.order);
    assert.equal(db._docs['event_occurrences/supper/announcements/' + first.id], undefined);
    assert.equal(db._docs['event_occurrences/supper/announcement_going_out/' + first.id], undefined);
});

test('someone who is not an editor is not handed how it goes out', async () => {
    const db = memoryDb();
    await Store.saveAnnouncement(db, oneOff, printed, { existing: [] });
    db._reads.length = 0;

    const member = await Store.loadAnnouncements(db, oneOff, { isEditor: false });
    assert.equal(member[0].title, 'Membership Matters');
    assert.equal(member[0].way, undefined);
    assert.equal(member[0].weeks, undefined);
    assert.equal(
        db._reads.some(path => path.indexOf('announcement_going_out') !== -1),
        false
    );
});

test('someone who can read the words can read a printed week count, and not a tell', async () => {
    const db = memoryDb();
    const printedSaved = await Store.saveAnnouncement(db, oneOff, printed, { existing: [] });
    const toldSaved = await Store.saveAnnouncement(db, oneOff, {
        title: 'Choir',
        prose: 'Rehearsal is moved.',
        way: 'told',
        dates: [{ date: '2026-05-03', time: '18:00' }],
        tagIds: ['choir'],
        savedTagIds: ['choir'],
        visibleTagIds: ['choir'],
    }, { existing: [{ id: printedSaved.id, order: 0 }] });
    assert.equal(toldSaved.ok, true, toldSaved.refusal);

    const lines = await Store.loadPrintedAnnouncements(db, oneOff);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].id, printedSaved.id);
    assert.equal(lines[0].weeks, 2);
    assert.equal(lines[0].way, 'printed');
    assert.equal(lines[0].tagIds, undefined);
    assert.equal(lines[0].dates, undefined);
    assert.equal(lines[0].time, undefined);
    assert.equal(
        db._docs['event_occurrences/supper/announcement_going_out/' + printedSaved.id].tagIds,
        undefined
    );
});

test('a refused draft is not written', async () => {
    const db = memoryDb();
    const cases = [
        { title: '  ', prose: 'Hello.', way: 'printed', weeks: 1 },
        { title: 'Night', prose: 'Too late.', way: 'told', eventKind: 'one-off', dates: [{ date: '2026-05-03', time: '20:00' }], tagIds: ['choir'], savedTagIds: [], visibleTagIds: ['choir'] },
        { title: 'Everyone', prose: 'No.', way: 'told', dates: [{ date: '2026-05-03', time: '08:00' }], tagIds: [], savedTagIds: [], visibleTagIds: ['choir'] },
    ];
    for (const draft of cases) {
        const result = await Store.saveAnnouncement(db, oneOff, draft, { existing: [] });
        assert.equal(result.ok, false, draft.title);
    }
    assert.deepEqual(db._docs, {});
});

test('a tell keeps its tags off the words', async () => {
    const db = memoryDb();
    const saved = await Store.saveAnnouncement(db, oneOff, {
        title: 'Choir',
        prose: 'Rehearsal is moved.',
        way: 'told',
        dates: [{ date: '2026-05-03', time: '18:00' }],
        tagIds: ['choir'],
        savedTagIds: ['choir', 'under_care'],
        visibleTagIds: ['choir'],
    }, { existing: [] });
    assert.equal(saved.ok, true, saved.refusal);
    const words = db._docs['event_occurrences/supper/announcements/' + saved.id];
    const goingOut = db._docs['event_occurrences/supper/announcement_going_out/' + saved.id];
    assert.equal(words.tagIds, undefined);
    assert.deepEqual(goingOut.tagIds, ['choir', 'under_care']);
    assert.equal(goingOut.weeks, undefined);
});

test('the collection names the one-off delete uses are the announcement records', () => {
    const eventsStore = require('../public/events-store.js');
    assert.equal(eventsStore.ANNOUNCEMENT_WORDS, Ann.WORDS);
    assert.equal(eventsStore.ANNOUNCEMENT_GOING_OUT, Ann.GOING_OUT);
});
