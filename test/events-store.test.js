const { test } = require('node:test');
const assert = require('node:assert');

// MS-150 / MS-153 — the Firestore adapter, and the one bug this ticket is most
// likely to ship.
//
// Firestore evaluates security rules PER RETURNED DOCUMENT and fails the WHOLE
// query if any document would fail. So an unconstrained visibility query does
// not return fewer rows — it errors outright, and the error looks exactly like
// "this church has no events". Nobody notices by eye.
//
// The fake Firestore below therefore does what the real one does: it RECORDS
// every filter, and it THROWS when a query would return a document the viewer
// is not allowed to read. A test that only checked the returned rows would pass
// against the broken code.

const Store = require('../public/events-store.js');
const Core = require('../public/events-occurrence-core.js');

// ── A fake Firestore that enforces rules the way the real one does ────────────

function fakeDb(collections, viewer) {
    const committed = [];
    const queriesRun = [];

    // The rule from firestore.rules, restated: rank, or the participant rung
    // answered against the document's own participant list.
    function mayRead(doc) {
        return Core.canSee(viewer && viewer.rank, doc, viewer && viewer.personId);
    }

    function makeQuery(name, filters) {
        return {
            where(field, op, value) {
                return makeQuery(name, filters.concat([{ field, op, value }]));
            },
            async get() {
                queriesRun.push({ collection: name, filters: filters });

                const all = Object.keys(collections[name] || {})
                    .map(id => Object.assign({ id }, collections[name][id]));

                const matches = all.filter(doc => filters.every(f => {
                    const v = doc[f.field];
                    if (f.op === '==') return v === f.value;
                    if (f.op === '>=') return v >= f.value;
                    if (f.op === '<=') return v <= f.value;
                    if (f.op === 'in') return f.value.indexOf(v) !== -1;
                    if (f.op === 'array-contains') return (v || []).indexOf(f.value) !== -1;
                    throw new Error('unsupported operator ' + f.op);
                }));

                // THIS is the behaviour that makes the bug real. One unreadable
                // row fails the entire read.
                if (name === Store.OCCURRENCES || name === Store.SERIES) {
                    const blocked = matches.find(doc => !mayRead(doc));
                    if (blocked) {
                        const err = new Error(
                            'Missing or insufficient permissions. (query on ' + name +
                            ' returned ' + blocked.id + ', which the viewer may not read)'
                        );
                        err.code = 'permission-denied';
                        throw err;
                    }
                }

                return { docs: matches.map(d => ({ id: d.id, data: () => d, ref: { path: name + '/' + d.id } })) };
            },
        };
    }

    function collection(name) {
        const api = makeQuery(name, []);
        api.doc = id => ({
            id: id,
            path: name + '/' + id,
            async get() {
                const d = (collections[name] || {})[id];
                return { exists: !!d, id: id, data: () => d, ref: { path: name + '/' + id } };
            },
            collection: sub => collection(name + '/' + id + '/' + sub),
        });
        return api;
    }

    return {
        collection,
        batch() {
            const ops = [];
            return {
                set: (ref, data, options) => ops.push({ kind: 'set', path: ref.path, data, options }),
                update: (ref, data) => ops.push({ kind: 'update', path: ref.path, data }),
                delete: ref => ops.push({ kind: 'delete', path: ref.path }),
                async commit() { committed.push(ops); },
            };
        },
        _committed: committed,
        _queriesRun: queriesRun,
        _flatWrites: () => committed.flat(),
    };
}

// ── The data ──────────────────────────────────────────────────────────────────
//
// One of each rung, so any unconstrained query trips over something.

const OCCURRENCES = {
    'picnic_2026-07-11': { seriesId: 'picnic', date: '2026-07-11', name: 'Church picnic', visibility: 'public', participantIds: [] },
    'midweek_2026-07-15': { seriesId: 'midweek', date: '2026-07-15', name: 'Midweek Gathering', visibility: 'member', participantIds: [] },
    'setup_2026-07-18': { seriesId: 'setup', date: '2026-07-18', name: 'Workday', visibility: 'participant', participantIds: ['p1'] },
    'setup_2026-07-25': { seriesId: 'setup', date: '2026-07-25', name: 'Workday', visibility: 'participant', participantIds: ['p9'] },
    'planning_2026-07-20': { seriesId: 'planning', date: '2026-07-20', name: 'Planning', visibility: 'editor', participantIds: [] },
    // The trap: a member holds a Role here, but the Event is elder-level. An
    // array-contains query that does not ALSO pin the rung returns this row.
    'elders_2026-07-22': { seriesId: 'elders', date: '2026-07-22', name: "Elders' Meeting", visibility: 'elder', participantIds: ['p1'] },
};

const RANGE = { from: '2026-07-01', to: '2026-07-31' };

// ── The failure mode itself ───────────────────────────────────────────────────

test('a signed-out visitor loads the Calendar without error, and sees public Events only', async () => {
    const db = fakeDb({ event_occurrences: OCCURRENCES }, { rank: null, personId: null });
    const rows = await Store.loadVisibleOccurrences(db, Object.assign({ rank: null, personId: null }, RANGE));

    assert.deepStrictEqual(rows.map(o => o.id), ['picnic_2026-07-11']);
});

test('a member loads the Calendar without error, even though restricted Events exist', async () => {
    const db = fakeDb({ event_occurrences: OCCURRENCES }, { rank: 'member', personId: 'p1' });
    const rows = await Store.loadVisibleOccurrences(db, Object.assign({ rank: 'member', personId: 'p1' }, RANGE));

    // Public, member-level, and the participant Event they hold a Role at.
    // Not the other Workday, not Planning, not the Elders' Meeting.
    assert.deepStrictEqual(rows.map(o => o.id).sort(), [
        'midweek_2026-07-15', 'picnic_2026-07-11', 'setup_2026-07-18',
    ]);
});

test('an elder loads the Calendar without error, and sees everything', async () => {
    const db = fakeDb({ event_occurrences: OCCURRENCES }, { rank: 'elder', personId: 'p4' });
    const rows = await Store.loadVisibleOccurrences(db, Object.assign({ rank: 'elder', personId: 'p4' }, RANGE));

    assert.strictEqual(rows.length, Object.keys(OCCURRENCES).length);
});

test('an unconstrained query is caught — it errors outright rather than returning fewer rows', async () => {
    const db = fakeDb({ event_occurrences: OCCURRENCES }, { rank: 'member', personId: 'p1' });

    // What a well-meaning "just fetch the month and filter in JS" refactor looks
    // like. It does NOT quietly return the three readable rows.
    await assert.rejects(
        () => db.collection('event_occurrences')
            .where('date', '>=', RANGE.from).where('date', '<=', RANGE.to).get(),
        err => err.code === 'permission-denied',
        'an unconstrained read must fail loudly, because in production it does'
    );
});

test('the participant query pins the rung, so an elder-level Event never enters the read', async () => {
    const db = fakeDb({ event_occurrences: OCCURRENCES }, { rank: 'member', personId: 'p1' });
    await Store.loadVisibleOccurrences(db, Object.assign({ rank: 'member', personId: 'p1' }, RANGE));

    const participantQuery = db._queriesRun.find(q =>
        q.filters.some(f => f.op === 'array-contains'));
    assert.ok(participantQuery, 'a member must run the participation query');
    assert.ok(
        participantQuery.filters.some(f => f.field === 'visibility' && f.op === '==' && f.value === 'participant'),
        'without this clause the query returns the Elders\' Meeting and the whole read fails'
    );
});

test('every Calendar query names its visibility — none is ever left open', async () => {
    const db = fakeDb({ event_occurrences: OCCURRENCES }, { rank: 'member', personId: 'p1' });
    await Store.loadVisibleOccurrences(db, Object.assign({ rank: 'member', personId: 'p1' }, RANGE));

    assert.ok(db._queriesRun.length >= 2, 'Firestore cannot express this as one filter');
    db._queriesRun.forEach(q => {
        assert.ok(
            q.filters.some(f => f.field === 'visibility'),
            'a query on ' + q.collection + ' left visibility unconstrained'
        );
    });
});

test('a member who declines keeps sight of the Event until somebody else takes the slot', async () => {
    // p1 declined the Workday but still holds the slot, so they are still in
    // participantIds and still see it.
    const viewer = { rank: 'member', personId: 'p1' };
    let db = fakeDb({ event_occurrences: OCCURRENCES }, viewer);
    let rows = await Store.loadVisibleOccurrences(db, Object.assign({}, viewer, RANGE));
    assert.ok(rows.some(o => o.id === 'setup_2026-07-18'));

    // Somebody replaces them: one write, and they are gone from the list.
    const replaced = Object.assign({}, OCCURRENCES, {
        'setup_2026-07-18': Object.assign({}, OCCURRENCES['setup_2026-07-18'], { participantIds: ['p7'] }),
    });
    db = fakeDb({ event_occurrences: replaced }, viewer);
    rows = await Store.loadVisibleOccurrences(db, Object.assign({}, viewer, RANGE));
    assert.ok(!rows.some(o => o.id === 'setup_2026-07-18'), 'sight follows the slot');
});

// ── Sparse occurrences reach the Calendar ─────────────────────────────────────

const SERIES = {
    midweek: {
        name: 'Midweek Gathering', visibility: 'member',
        recurrence: { freq: 'weekly', startDate: '2026-07-01', weekday: 3 },
    },
};

test('a date with no stored record still appears in the Calendar', async () => {
    const stored = {
        'midweek_2026-07-15': {
            seriesId: 'midweek', date: '2026-07-15', visibility: 'member',
            participantIds: [], location: 'The hall',
        },
    };
    const viewer = { rank: 'member', personId: 'p1' };
    const db = fakeDb({ events: SERIES, event_occurrences: stored }, viewer);

    const rows = await Store.loadCalendar(db, Object.assign({}, viewer, RANGE));

    assert.deepStrictEqual(rows.map(o => o.date), [
        '2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22', '2026-07-29',
    ]);
    assert.strictEqual(rows.filter(o => o.stored).length, 1, 'exactly one document exists');
    assert.strictEqual(rows.find(o => o.date === '2026-07-15').location, 'The hall');
});

test('a stored occurrence the pattern no longer produces still appears, rather than vanishing', async () => {
    // Somebody put people on this date. Moving the pattern must not make the
    // roster disappear from the Calendar.
    const stored = {
        'midweek_2026-07-02': {
            seriesId: 'midweek', date: '2026-07-02', visibility: 'member',
            participantIds: ['p1'], assignments: [{ personId: 'p1' }],
        },
    };
    const viewer = { rank: 'member', personId: 'p1' };
    const db = fakeDb({ events: SERIES, event_occurrences: stored }, viewer);

    const rows = await Store.loadCalendar(db, Object.assign({}, viewer, RANGE));
    assert.ok(rows.some(o => o.date === '2026-07-02'), 'the orphan is still shown');
});

// ── Restamping ────────────────────────────────────────────────────────────────

test('changing a series’ visibility restamps every occurrence, past ones included', async () => {
    const stored = {
        'midweek_2020-01-01': { seriesId: 'midweek', date: '2020-01-01', visibility: 'public', participantIds: [] },
        'midweek_2030-01-01': { seriesId: 'midweek', date: '2030-01-01', visibility: 'public', participantIds: [] },
        'other_2030-01-01': { seriesId: 'other', date: '2030-01-01', visibility: 'public', participantIds: [] },
    };
    const db = fakeDb({ event_occurrences: stored }, { rank: 'elder', personId: 'p1' });

    const result = await Store.restampSeriesVisibility(db, 'midweek', 'elder', false);

    assert.strictEqual(result.occurrences, 2);
    const writes = db._flatWrites();
    assert.ok(writes.some(w => w.path === 'event_occurrences/midweek_2020-01-01'),
        'the past occurrence must be restamped too — otherwise its history stays public');
    assert.ok(writes.some(w => w.path === 'event_occurrences/midweek_2030-01-01'));
    assert.ok(writes.some(w => w.path === 'events/midweek'), 'the series itself is restamped');
    assert.ok(!writes.some(w => w.path === 'event_occurrences/other_2030-01-01'),
        'another series is not touched');
    writes.forEach(w => assert.strictEqual(w.data.visibility, 'elder'));
});

test('the restamp is not bounded by a date range — that would be the bug', async () => {
    const db = fakeDb({ event_occurrences: {} }, { rank: 'elder' });
    await Store.restampSeriesVisibility(db, 'midweek', 'member', true);

    const q = db._queriesRun.find(x => x.collection === 'event_occurrences');
    assert.ok(!q.filters.some(f => f.field === 'date'),
        'a date filter here would leave past occurrences at their old visibility');
});

test('the Sunday Service’s visibility cannot be changed', async () => {
    const db = fakeDb({ event_occurrences: {} }, { rank: 'elder' });
    await assert.rejects(
        () => Store.restampSeriesVisibility(db, Core.SUNDAY_SERVICE_ID, 'elder', false),
        /permanently public/
    );
});

test('an unknown visibility is refused rather than stamped', async () => {
    const db = fakeDb({ event_occurrences: {} }, { rank: 'elder' });
    await assert.rejects(() => Store.restampSeriesVisibility(db, 'midweek', 'everyone', false), /Unknown visibility/);
});

// ── Derived fields are derived, never hand-maintained ─────────────────────────

test('saving an occurrence derives its participant list from its assignments', () => {
    const assignments = [
        { personId: 'p1', roleSlug: 'kids', slotId: 's1', state: 'declined' },
        { personId: 'p2', roleSlug: 'kids', slotId: 's2', state: 'confirmed' },
    ];
    const payload = Store.occurrencePayload({ seriesId: 'midweek', date: '2026-07-01', assignments });

    assert.deepStrictEqual(payload.participantIds, ['p1', 'p2'],
        'the decliner is still a participant — security depends on this list being the truth');
    assert.strictEqual(payload.needsAttention, true);
});

test('an occurrence with no assignments derives an empty participant list, not a missing one', () => {
    const payload = Store.occurrencePayload({ seriesId: 'midweek', date: '2026-07-01' });
    assert.deepStrictEqual(payload.participantIds, []);
    assert.strictEqual(payload.needsAttention, false);
});

// ── Changing a pattern moves nothing without a choice ─────────────────────────

test('an orphan with no choice made is left exactly as it was', async () => {
    const db = fakeDb({ event_occurrences: {} }, { rank: 'editor' });
    const orphans = [{ id: 'midweek_2026-07-01', date: '2026-07-01', assignments: [{ personId: 'p1' }] }];

    const result = await Store.applyOrphanChoices(db, 'midweek', orphans, {}, ['2026-07-02']);

    assert.deepStrictEqual(result, { moved: [], deleted: [] });
    assert.deepStrictEqual(db._flatWrites(), [], 'nothing is migrated or deleted silently');
});

test('moving an orphan writes the new date before deleting the old one', async () => {
    const db = fakeDb({ event_occurrences: {} }, { rank: 'editor' });
    const orphans = [{ id: 'midweek_2026-07-01', date: '2026-07-01', assignments: [{ personId: 'p1' }] }];

    const result = await Store.applyOrphanChoices(db, 'midweek', orphans, { '2026-07-01': 'move' }, ['2026-07-02']);

    assert.deepStrictEqual(result.moved, [{ from: '2026-07-01', to: '2026-07-02' }]);
    const writes = db._flatWrites();
    const setAt = writes.findIndex(w => w.kind === 'set');
    const deleteAt = writes.findIndex(w => w.kind === 'delete');
    assert.ok(setAt < deleteAt,
        'an interrupted run must leave a stale duplicate, never a lost roster');
    assert.strictEqual(writes[setAt].data.date, '2026-07-02');
    assert.deepStrictEqual(writes[setAt].data.participantIds, ['p1'], 'the roster travels with it');
});

test('deleting an orphan takes its assignments with it and writes nothing new', async () => {
    const db = fakeDb({ event_occurrences: {} }, { rank: 'editor' });
    const orphans = [{ id: 'midweek_2026-07-01', date: '2026-07-01', assignments: [{ personId: 'p1' }] }];

    const result = await Store.applyOrphanChoices(db, 'midweek', orphans, { '2026-07-01': 'delete' }, ['2026-07-02']);

    assert.deepStrictEqual(result.deleted, ['2026-07-01']);
    assert.deepStrictEqual(db._flatWrites().map(w => w.kind), ['delete']);
});

test('two orphans moving never collide onto one date', async () => {
    const db = fakeDb({ event_occurrences: {} }, { rank: 'editor' });
    const orphans = [
        { id: 'midweek_2026-07-01', date: '2026-07-01', assignments: [{ personId: 'p1' }] },
        { id: 'midweek_2026-07-08', date: '2026-07-08', assignments: [{ personId: 'p2' }] },
    ];

    const result = await Store.applyOrphanChoices(
        db, 'midweek', orphans,
        { '2026-07-01': 'move', '2026-07-08': 'move' },
        ['2026-07-02', '2026-07-09']
    );

    assert.deepStrictEqual(result.moved, [
        { from: '2026-07-01', to: '2026-07-02' },
        { from: '2026-07-08', to: '2026-07-09' },
    ]);
});

// ── The roster subcollection ──────────────────────────────────────────────────

test('the roster is one document per assignment, so a rule can gate them separately', async () => {
    const db = fakeDb({ event_occurrences: {} }, { rank: 'editor' });
    await Store.saveRoster(db, 'midweek_2026-07-01', [
        { personId: 'p1', roleSlug: 'kids', slotId: 's1', state: 'pending' },
        { personId: 'p2', roleSlug: 'kids', slotId: 's2', state: 'confirmed' },
    ]);

    const writes = db._flatWrites();
    assert.strictEqual(writes.length, 2);
    writes.forEach(w => assert.match(w.path, /event_occurrences\/midweek_2026-07-01\/roster\//));
});

test('a roster document id is stable for the same person in the same slot', () => {
    const a = { personId: 'p1', roleSlug: 'kids', slotId: 's1' };
    assert.strictEqual(Store.rosterId(a), Store.rosterId(Object.assign({}, a)));
    assert.notStrictEqual(Store.rosterId(a), Store.rosterId({ personId: 'p1', roleSlug: 'kids', slotId: 's2' }));
});

test('one person on two Roles gets two roster documents, not one', () => {
    assert.notStrictEqual(
        Store.rosterId({ personId: 'p1', roleSlug: 'kids', slotId: 's1' }),
        Store.rosterId({ personId: 'p1', roleSlug: 'setup', slotId: 's1' })
    );
});
