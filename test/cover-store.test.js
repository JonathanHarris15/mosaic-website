const { test } = require('node:test');
const assert = require('node:assert');

const Store = require('../public/cover-store.js');
const Core = require('../public/events-occurrence-core.js');

// The cover list's Firestore adapter (MS-20).
//
// ⚠ THE BUG THIS FILE EXISTS TO CATCH. Firestore evaluates rules PER RETURNED
// DOCUMENT and fails the WHOLE query if any row would fail. An unconstrained
// read does not quietly return fewer rows — it errors, and the error reads
// exactly like "nothing needs covering". Nobody spots that by eye.
//
// So the fake below does what the real one does: it throws when a query would
// return a row the viewer may not read. A test that only checked the returned
// rows would pass against the broken code.

function fakeDb(entries, viewer) {
    const queriesRun = [];

    // firestore.rules, restated: `rankCanSee(stampedVisibility())`, and nothing
    // else. There is no participant clause on this collection.
    //
    // ⚠ AN ENTRY WITH NO `visibility` FIELD IS DENIED TO EVERYONE. The rule's
    // stampedVisibility() answers 'none' for a document without one, and
    // rankCanSee('none') is false on every branch — so a write that forgot the
    // stamp produces a row nobody can ever see.
    function mayRead(doc) {
        const rank = viewer && viewer.rank;
        const visibility = ('visibility' in doc) ? doc.visibility : 'none';
        if (visibility === 'public') return true;
        if (visibility === 'member') {
            return ['member', 'editor', 'admin', 'elder', 'super_admin'].indexOf(rank) !== -1;
        }
        if (['member', 'participant', 'editor'].indexOf(visibility) !== -1) {
            return ['editor', 'admin', 'elder', 'super_admin'].indexOf(rank) !== -1;
        }
        if (visibility === 'elder') {
            return ['elder', 'super_admin'].indexOf(rank) !== -1;
        }
        return false;
    }

    function makeQuery(name, filters) {
        return {
            where(field, op, value) {
                return makeQuery(name, filters.concat([{ field, op, value }]));
            },
            async get() {
                queriesRun.push({ collection: name, filters: filters });

                const all = Object.keys(entries || {})
                    .map(id => Object.assign({ id }, entries[id]));

                const matches = all.filter(doc => filters.every(f => {
                    const v = doc[f.field];
                    if (f.op === '==') return v === f.value;
                    if (f.op === '>=') return v >= f.value;
                    if (f.op === 'in') return f.value.indexOf(v) !== -1;
                    throw new Error('unsupported operator ' + f.op);
                }));

                const blocked = matches.find(doc => !mayRead(doc));
                if (blocked) {
                    const err = new Error(
                        'Missing or insufficient permissions. (query on cover returned '
                        + blocked.id + ', which the viewer may not read)'
                    );
                    err.code = 'permission-denied';
                    throw err;
                }

                return {
                    empty: matches.length === 0,
                    docs: matches.map(d => ({ id: d.id, data: () => entries[d.id] })),
                };
            },
        };
    }

    return {
        collection: name => makeQuery(name, []),
        _queriesRun: queriesRun,
    };
}

const entry = (over) => Object.assign({
    occurrenceId: 'midweek_2026-08-14',
    seriesId: 'midweek',
    date: '2026-08-14',
    eventName: 'Midweek',
    roleSlug: 'kids',
    slotId: 's1',
    roleName: 'Kids Ministry',
    visibility: 'member',
}, over || {});

// ── The constraint ───────────────────────────────────────────────────────────

test('the read is constrained by the viewer’s rungs, or it would error', async () => {
    const db = fakeDb({ a: entry() }, { rank: 'member' });
    await Store.loadCoverList(db, { rank: 'member' });

    const q = db._queriesRun[0];
    const byVisibility = q.filters.find(f => f.field === 'visibility');
    assert.ok(byVisibility, 'the query must filter on visibility');
    assert.equal(byVisibility.op, 'in');
});

test('a member’s read does not error on an elder-level place it must not see', async () => {
    const db = fakeDb({
        mine: entry(),
        theirs: entry({ visibility: 'elder', eventName: 'Elders’ Meeting' }),
    }, { rank: 'member' });

    const rows = await Store.loadCoverList(db, { rank: 'member' });
    assert.deepEqual(rows.map(r => r.id), ['mine']);
});

test('an unstamped entry is returned to nobody — not even an elder', async () => {
    const db = fakeDb({ broken: entry({ visibility: undefined }) }, { rank: 'elder' });
    const rows = await Store.loadCoverList(db, { rank: 'elder' });
    assert.deepEqual(rows, []);
});

test('a signed-out visitor sees only public places', async () => {
    const db = fakeDb({
        pub: entry({ visibility: 'public', eventName: 'Sunday Service' }),
        mem: entry({ visibility: 'member' }),
    }, { rank: null });

    const rows = await Store.loadCoverList(db, { rank: null });
    assert.deepEqual(rows.map(r => r.id), ['pub']);
});

// ── What comes back ──────────────────────────────────────────────────────────

test('places come back soonest first', async () => {
    const db = fakeDb({
        c: entry({ date: '2026-09-04' }),
        a: entry({ date: '2026-08-14' }),
        b: entry({ date: '2026-08-28' }),
    }, { rank: 'member' });

    const rows = await Store.loadCoverList(db, { rank: 'member' });
    assert.deepEqual(rows.map(r => r.date),
        ['2026-08-14', '2026-08-28', '2026-09-04']);
});

test('anything already past is left behind', async () => {
    const db = fakeDb({
        gone: entry({ date: '2026-08-01' }),
        live: entry({ date: '2026-08-14' }),
    }, { rank: 'member' });

    const rows = await Store.loadCoverList(db, { rank: 'member', from: '2026-08-07' });
    assert.deepEqual(rows.map(r => r.id), ['live']);
});

test('a row renders without opening the occurrence it points at', async () => {
    const db = fakeDb({ a: entry() }, { rank: 'member' });
    const [row] = await Store.loadCoverList(db, { rank: 'member' });

    assert.equal(row.eventName, 'Midweek');
    assert.equal(row.roleName, 'Kids Ministry');
    assert.equal(row.date, '2026-08-14');
    assert.equal(row.occurrenceId, 'midweek_2026-08-14');
});

test('a row does not name who declined — the list does not need it', async () => {
    const built = Store.entryFor(
        { id: 'o1', date: '2026-08-14', name: 'Midweek', visibility: 'member' },
        { personId: 'carl', roleSlug: 'kids', slotId: 's1' },
        'Kids Ministry'
    );
    assert.equal(built.personId, undefined);
    assert.equal(built.declinedBy, undefined);
});

// ── Building an entry ────────────────────────────────────────────────────────

test('an entry is stamped with its occurrence’s visibility at write time', () => {
    const built = Store.entryFor(
        { id: 'o1', date: '2026-08-14', name: 'Midweek', visibility: 'elder' },
        { roleSlug: 'kids', slotId: 's1' },
        'Kids Ministry'
    );
    assert.equal(built.visibility, 'elder');
});

test('a Sunday is stamped public whatever the document happens to hold', () => {
    const built = Store.entryFor(
        {
            id: 'sunday_service_2026-08-16',
            seriesId: Core.SUNDAY_SERVICE_ID,
            date: '2026-08-16',
            name: 'Sunday Service',
        },
        { roleSlug: 'coffee', slotId: 's1' },
        'Coffee'
    );
    assert.equal(built.visibility, 'public');
});

test('the id is deterministic, so declining twice cannot ask twice', () => {
    const first = Store.coverId('o1', 'kids', 's1');
    const second = Store.coverId('o1', 'kids', 's1');
    assert.equal(first, second);
    assert.notEqual(first, Store.coverId('o1', 'kids', 's2'));
    assert.notEqual(first, Store.coverId('o1', 'coffee', 's1'));
});

// ── Which places belong on it at all ─────────────────────────────────────────

test('a participant-rung Event never reaches the list', () => {
    assert.equal(Store.belongsOnList({ visibility: 'participant' }), false);
});

test('every other rung does', () => {
    ['public', 'member', 'editor', 'elder'].forEach(rung => {
        assert.equal(Store.belongsOnList({ visibility: rung }), true, rung);
    });
});

test('an occurrence with no visibility belongs nowhere — fails closed', () => {
    assert.equal(Store.belongsOnList({ visibility: null }), false);
    assert.equal(Store.belongsOnList({}), false);
    assert.equal(Store.belongsOnList(null), false);
});
