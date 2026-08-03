const { test } = require('node:test');
const assert = require('node:assert');

const Store = require('../public/events-store.js');
const Core = require('../public/events-occurrence-core.js');

// Accepting a draft (MS-18): the moment a proposal becomes a plan.
//
// Everything up to here has been held in a browser and is not an Assignment at
// all. This is the write, and three things about it are load-bearing:
//
//   • OCCURRENCES ARE SPARSE (ADR-0018 §3). A document exists only once
//     something has been said about a date, so most future dates in a range
//     have none. Accepting has to create them.
//   • ASSIGNMENTS ARE WRITTEN PENDING. Nobody has been asked yet, and silence
//     is never read as a yes. A seat the editor KEPT keeps whatever state it
//     already had — accepting must not quietly un-say somebody's Confirmed.
//   • NO INVOLVEMENT IS WRITTEN. Serve history does not move until the dates
//     pass; that conversion has its own scheduled job.

// ── A fake Firestore, recording what was written ─────────────────────────────

function fakeDb(seed) {
    const docs = Object.assign({}, seed || {});     // occurrenceId → data
    const rosters = {};                             // occurrenceId → { docId: assignment }
    const committed = [];

    const rosterOf = id => (rosters[id] || (rosters[id] = {}));

    function docRef(id) {
        return {
            path: id,
            async set(data, options) {
                docs[id] = (options && options.merge)
                    ? Object.assign({}, docs[id], data)
                    : data;
            },
            async get() {
                return { exists: !!docs[id], id: id, data: () => docs[id] };
            },
            collection() {
                return {
                    doc(rid) {
                        return { path: id + '/roster/' + rid, _occ: id, _rid: rid };
                    },
                    async get() {
                        const store = rosterOf(id);
                        return {
                            docs: Object.keys(store).map(rid => ({
                                id: rid,
                                data: () => store[rid],
                                ref: { path: id + '/roster/' + rid, _occ: id, _rid: rid },
                            })),
                        };
                    },
                };
            },
        };
    }

    return {
        collection() { return { doc: docRef }; },
        batch() {
            const ops = [];
            return {
                set(ref, data, options) { ops.push({ kind: 'set', ref, data, options }); },
                update(ref, data) { ops.push({ kind: 'update', ref, data }); },
                delete(ref) { ops.push({ kind: 'delete', ref }); },
                async commit() {
                    committed.push(ops.length);
                    ops.forEach(op => {
                        if (op.ref._occ) {
                            const store = rosterOf(op.ref._occ);
                            if (op.kind === 'delete') delete store[op.ref._rid];
                            else store[op.ref._rid] = op.data;
                            return;
                        }
                        if (op.kind === 'delete') delete docs[op.ref.path];
                        else docs[op.ref.path] = Object.assign({}, docs[op.ref.path], op.data);
                    });
                },
            };
        },
        _docs: docs,
        _rosters: rosters,
        _batches: committed,
    };
}

const SERIES = 'sunday_service';
const idFor = date => Core.occurrenceId(SERIES, date);

const seat = (roleSlug, slotId, personId, over) => Object.assign({
    roleSlug: roleSlug, slotId: slotId, personId: personId, held: false, state: null,
}, over || {});

const draftOf = days => ({
    dates: days.map(d => Object.assign({ skipped: false, gaps: [] }, d)),
});

const accept = (db, draft, over) => Store.acceptDraft(db, draft, Object.assign({
    seriesId: SERIES,
    roleSlugs: ['kids', 'setup'],
    actor: { actorUid: 'editor-1', at: '2026-08-03T10:00:00Z' },
}, over || {}));

const rosterFor = (db, date) => Object.values(db._rosters[idFor(date)] || {});

// ── What lands ───────────────────────────────────────────────────────────────

test('accepting writes one assignment per filled place', async () => {
    const db = fakeDb();
    await accept(db, draftOf([
        { date: '2026-10-04', seats: [seat('kids', 's1', 'ann'), seat('setup', 's1', 'ben')] },
        { date: '2026-10-11', seats: [seat('kids', 's1', 'cara')] },
    ]));

    assert.equal(rosterFor(db, '2026-10-04').length, 2);
    assert.equal(rosterFor(db, '2026-10-11').length, 1);
});

test('a drafted assignment is written Pending, never Confirmed', async () => {
    const db = fakeDb();
    await accept(db, draftOf([
        { date: '2026-10-04', seats: [seat('kids', 's1', 'ann')] },
    ]));

    const written = rosterFor(db, '2026-10-04')[0];
    assert.equal(written.state, Core.STATES.PENDING,
        'nobody has been asked yet, and silence is never read as a yes');
    assert.equal(written.personId, 'ann');
    assert.equal(written.roleSlug, 'kids');
});

test('a kept Confirmed seat stays Confirmed', async () => {
    const db = fakeDb();
    await accept(db, draftOf([{
        date: '2026-10-04',
        seats: [seat('kids', 's1', 'ann', { held: true, state: Core.STATES.CONFIRMED })],
    }]));

    assert.equal(rosterFor(db, '2026-10-04')[0].state, Core.STATES.CONFIRMED,
        'accepting a draft must not un-say somebody\'s yes');
});

test('an occurrence document is created for a date that had none', async () => {
    const db = fakeDb();
    assert.equal(db._docs[idFor('2026-10-04')], undefined);

    await accept(db, draftOf([
        { date: '2026-10-04', seats: [seat('kids', 's1', 'ann')] },
    ]));

    const doc = db._docs[idFor('2026-10-04')];
    assert.ok(doc, 'occurrences are sparse — most future dates have no document yet');
    assert.equal(doc.seriesId, SERIES);
    assert.equal(doc.date, '2026-10-04');
    assert.equal(doc.id, idFor('2026-10-04'),
        'the id is deterministic, so two editors cannot make a twin');
});

test('participantIds is derived from the roster that was written', async () => {
    const db = fakeDb();
    await accept(db, draftOf([{
        date: '2026-10-04',
        seats: [seat('kids', 's1', 'ann'), seat('setup', 's1', 'ben')],
    }]));

    assert.deepEqual(
        db._docs[idFor('2026-10-04')].participantIds.sort(),
        ['ann', 'ben'],
        'the security rule reads this — it can never be maintained by hand'
    );
});

test('an empty place writes nothing', async () => {
    const db = fakeDb();
    await accept(db, draftOf([{
        date: '2026-10-04',
        seats: [seat('kids', 's1', 'ann')],
        gaps: [{ roleSlug: 'kids', slotId: 's2', reason: 'nobody left' }],
    }]));

    assert.equal(rosterFor(db, '2026-10-04').length, 1,
        'leaving a place for nearer the day is a real answer, not a record');
});

test('no Involvement is written', async () => {
    const db = fakeDb();
    await accept(db, draftOf([
        { date: '2026-10-04', seats: [seat('kids', 's1', 'ann')] },
    ]));

    const touched = Object.keys(db._docs).concat(Object.keys(db._rosters));
    assert.ok(touched.every(path => !/involvement/i.test(path)),
        'serve history does not move until the date passes');
});

// ── What it leaves alone ─────────────────────────────────────────────────────

test('a date left out of the draft is not written at all', async () => {
    const db = fakeDb();
    await accept(db, draftOf([
        { date: '2026-10-04', skipped: true, seats: [seat('kids', 's1', 'ann', { held: true, state: 'pending' })] },
        { date: '2026-10-11', seats: [seat('kids', 's1', 'ben')] },
    ]));

    assert.equal(db._docs[idFor('2026-10-04')], undefined,
        '"leave out" means do not touch that date at all');
    assert.ok(db._docs[idFor('2026-10-11')]);
});

test('assignments in Roles the draft does not cover are left where they are', async () => {
    const db = fakeDb();
    // A one-off job already on the date, which auto-assign never fills.
    db._rosters[idFor('2026-10-04')] = {
        'oneoff_unlock_sam': {
            personId: 'sam', roleSlug: 'one_off', oneOffId: 'unlock',
            label: 'Unlock the hall', state: 'confirmed',
        },
    };

    await accept(db, draftOf([
        { date: '2026-10-04', seats: [seat('kids', 's1', 'ann')] },
    ]));

    const people = rosterFor(db, '2026-10-04').map(a => a.personId).sort();
    assert.deepEqual(people, ['ann', 'sam'],
        'the draft owns the Roles it drafted and nothing else');
});

test('a place the draft emptied is cleared', async () => {
    const db = fakeDb();
    db._rosters[idFor('2026-10-04')] = {
        'kids_s1_old': { personId: 'old', roleSlug: 'kids', slotId: 's1', state: 'pending' },
    };

    await accept(db, draftOf([
        { date: '2026-10-04', seats: [], gaps: [{ roleSlug: 'kids', slotId: 's1' }] },
    ]));

    assert.equal(rosterFor(db, '2026-10-04').length, 0,
        'a place the editor emptied is empty, not quietly still occupied');
});

// ── Reporting back ───────────────────────────────────────────────────────────

test('accepting reports which dates landed and how much was written', async () => {
    const db = fakeDb();
    const report = await accept(db, draftOf([
        { date: '2026-10-04', seats: [seat('kids', 's1', 'ann')] },
        { date: '2026-10-11', skipped: true, seats: [] },
        { date: '2026-10-18', seats: [seat('kids', 's1', 'ben'), seat('setup', 's1', 'cara')] },
    ]));

    assert.deepEqual(report.dates, ['2026-10-04', '2026-10-18']);
    assert.equal(report.assignments, 3);
    assert.equal(report.occurrences, 2);
});

test('a range too large for one batch is written in pieces and still lands', async () => {
    const db = fakeDb();
    const days = [];
    for (let i = 0; i < 60; i++) {
        const month = 10 + Math.floor(i / 28);
        const day = (i % 28) + 1;
        const date = '2026-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        days.push({ date: date, seats: [seat('kids', 's1', 'p' + i), seat('setup', 's1', 'q' + i)] });
    }

    const report = await accept(db, draftOf(days));

    assert.equal(report.assignments, 120);
    assert.equal(report.dates.length, 60);
    assert.ok(db._batches.length >= 1, 'the write chunks rather than exceeding a batch');
});
