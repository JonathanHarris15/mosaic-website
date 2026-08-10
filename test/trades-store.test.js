const { test } = require('node:test');
const assert = require('node:assert');

const Store = require('../public/trades-store.js');
const Core = require('../public/trade-core.js');

// The Trade collection's Firestore adapter (MS-190, MS-210).
//
// ⚠ THE BUG THIS FILE EXISTS TO CATCH, again. Firestore evaluates rules PER
// RETURNED DOCUMENT and fails the WHOLE query if one row would fail. So a read
// that forgets to filter on the field the rule checks does not quietly return
// less — it errors, and the error reads exactly like "you have no Trades going".
// Nobody spots that by eye, and the fake below therefore throws the way the real
// one does.
//
// It is why `loadMine` is two queries and not one: Firestore cannot express
// "holderId == me OR counterpartyId == me", and the rule reads both fields.

const TODAY = '2026-03-01';
const BOB = 'person-bob';
const SARAH = 'person-sarah';
const RAY = 'person-ray';

const KIDS = { occurrenceId: 'occ-14', roleSlug: 'kids', slotId: 's1', date: '2026-03-14' };
const COFFEE = { occurrenceId: 'occ-28', roleSlug: 'coffee', slotId: 's1', date: '2026-03-28' };
const LAST_YEAR = { occurrenceId: 'occ-old', roleSlug: 'kids', slotId: 's1', date: '2025-12-07' };

const trade = over => Object.assign({
    origin: Core.ORIGINS.INVITATION,
    state: Core.STATES.INVITED,
    assignment: KIDS,
    holderId: BOB,
    counterpartyId: SARAH,
    partyIds: [BOB, SARAH],
    offered: [],
    chosen: null,
}, over || {});

function fakeDb(docs, viewerPersonId) {
    const queriesRun = [];

    // firestore.rules, restated: a member reads a Trade they are party to, and
    // nothing else reads it at all.
    const mayRead = doc =>
        !!viewerPersonId &&
        (doc.holderId === viewerPersonId || doc.counterpartyId === viewerPersonId);

    function makeQuery(filters) {
        return {
            where(field, op, value) {
                return makeQuery(filters.concat([{ field, op, value }]));
            },
            async get() {
                queriesRun.push(filters);

                const all = Object.keys(docs)
                    .map(id => Object.assign({ id }, docs[id]));

                const matches = all.filter(doc => filters.every(f => {
                    // Nested paths, as Firestore addresses them.
                    const v = f.field.split('.')
                        .reduce((o, k) => (o == null ? o : o[k]), doc);
                    if (f.op === '==') return v === f.value;
                    if (f.op === '>=') return v >= f.value;
                    if (f.op === 'array-contains') {
                        return (v || []).indexOf(f.value) !== -1;
                    }
                    throw new Error('unsupported operator ' + f.op);
                }));

                const blocked = matches.find(doc => !mayRead(doc));
                if (blocked) {
                    const err = new Error(
                        'Missing or insufficient permissions. (query on trades ' +
                        'returned ' + blocked.id + ', which the viewer may not read)');
                    err.code = 'permission-denied';
                    throw err;
                }

                return { docs: matches.map(d => ({ id: d.id, data: () => d })) };
            },
        };
    }

    return {
        queriesRun,
        collection(name) {
            assert.equal(name, Store.TRADES);
            return makeQuery([]);
        },
    };
}

// ── The shape ───────────────────────────────────────────────────────────────

test('a Trade carries both parties, what is sought and what is offered', () => {
    const doc = Store.tradeFor({
        origin: Core.ORIGINS.OFFER,
        state: Core.STATES.OFFERED,
        assignment: KIDS,
        holderId: BOB,
        counterpartyId: SARAH,
        offered: [COFFEE],
        eventName: 'Morning Service',
        roleName: 'Kids Ministry',
    });

    assert.equal(doc.holderId, BOB);
    assert.equal(doc.counterpartyId, SARAH);
    assert.deepEqual(doc.assignment, KIDS);
    assert.deepEqual(doc.offered, [COFFEE]);
    assert.equal(doc.state, Core.STATES.OFFERED);
    assert.equal(doc.chosen, null);
});

test('a row renders without opening the Event, which a reader may not be able ' +
    'to do', () => {
    // An invitation can name a QUIET Assignment — one on no list the invited
    // person could look up. If the row did not carry its own words there would
    // be nothing to show them.
    const doc = Store.tradeFor({
        assignment: KIDS, holderId: BOB, counterpartyId: SARAH,
        eventName: 'Morning Service', roleName: 'Kids Ministry',
    });

    assert.equal(doc.eventName, 'Morning Service');
    assert.equal(doc.roleName, 'Kids Ministry');
    assert.equal(doc.assignment.date, KIDS.date);
});

test('it keeps no record of who was asked before', () => {
    // ADR-0018 §5: a refilled slot keeps no history, and "who keeps saying no"
    // stays unanswerable on purpose.
    const doc = Store.tradeFor({
        assignment: KIDS, holderId: BOB, counterpartyId: SARAH,
    });

    const fields = Object.keys(doc).join(' ');
    assert.doesNotMatch(fields, /declin|previous|history|attempts/i);
});

test('a Trade knows whether it is yours', () => {
    const t = trade();
    assert.equal(Store.isMine(t, BOB), true);
    assert.equal(Store.isMine(t, SARAH), true);
    assert.equal(Store.isMine(t, RAY), false);
    assert.equal(Store.isMine(t, null), false);
});

// ── The two queries ─────────────────────────────────────────────────────────

test('both directions come back, from two queries', async () => {
    const db = fakeDb({
        out: trade(),
        in: trade({
            origin: Core.ORIGINS.OFFER, state: Core.STATES.OFFERED,
            assignment: COFFEE, holderId: SARAH, counterpartyId: BOB,
            partyIds: [SARAH, BOB], offered: [KIDS],
        }),
    }, BOB);

    const result = await Store.loadMine(db, { personId: BOB, today: TODAY });

    assert.equal(result.all.length, 2);
    assert.equal(db.queriesRun.length, 2,
        'Firestore cannot express holderId == me OR counterpartyId == me');
    assert.deepEqual(
        db.queriesRun.map(f => f[0].field).sort(),
        ['counterpartyId', 'holderId']);
});

test('every query is filtered on the field its rule reads', async () => {
    // ⚠ Drop either `where` and the read does not narrow — it FAILS, and the
    // failure reads like an empty list.
    const db = fakeDb({ a: trade(), b: trade({ holderId: RAY, counterpartyId: 'x' }) },
        BOB);

    const result = await Store.loadMine(db, { personId: BOB, today: TODAY });

    assert.equal(result.all.length, 1,
        'somebody else’s conversation came back');
});

test('the split is by whose move it is, not by who opened it', async () => {
    // Bob invited Sarah — he is waiting on her, so it is outbound.
    // Sarah offered against Bob's other place — Bob is waiting, so inbound.
    const db = fakeDb({
        asked: trade(),
        offered: trade({
            origin: Core.ORIGINS.OFFER, state: Core.STATES.OFFERED,
            assignment: COFFEE, holderId: BOB, counterpartyId: RAY,
            partyIds: [BOB, RAY], offered: [KIDS],
        }),
    }, BOB);

    const result = await Store.loadMine(db, { personId: BOB, today: TODAY });

    assert.deepEqual(result.outbound.map(t => t.id), ['asked']);
    assert.deepEqual(result.inbound.map(t => t.id), ['offered']);
});

test('an invitation Bob received is his to answer, so it is inbound', async () => {
    const db = fakeDb({ ask: trade({ holderId: SARAH, counterpartyId: BOB }) }, BOB);

    const result = await Store.loadMine(db, { personId: BOB, today: TODAY });

    assert.deepEqual(result.inbound.map(t => t.id), ['ask']);
    assert.deepEqual(result.outbound, []);
});

test('anything whose date has passed is absent from both', async () => {
    const db = fakeDb({
        old: trade({ assignment: LAST_YEAR }),
        live: trade({ assignment: KIDS }),
    }, BOB);

    const result = await Store.loadMine(db, { personId: BOB, today: TODAY });

    assert.deepEqual(result.all.map(t => t.id), ['live'],
        'the date is the only clock, and nothing sweeps up after it');
});

// ⚠ THIS TEST USED TO ASSERT THE OPPOSITE, and the opposite was the bug
// (MS-212). An ended Trade is the only record of what happened to it, and
// dropping it here is what made a killed offer disappear off somebody's page
// with no explanation at all. It comes back — separately, as a notice — until
// the person it happened to has seen it.
test('one that has ended comes back as a notice, not as a live row', async () => {
    const db = fakeDb({
        done: trade({ state: Core.STATES.SETTLED }),
        no: trade({ state: Core.STATES.REFUSED, closedBy: BOB }),
        live: trade(),
    }, BOB);

    const result = await Store.loadMine(db, { personId: BOB, today: TODAY });

    assert.deepEqual(result.live.map(t => t.id), ['live']);
    assert.deepEqual(result.outbound.map(t => t.id), ['live']);
    assert.deepEqual(result.ended.map(t => t.id), ['done'],
        'Bob refused `no` himself — he does not need telling about it');
    assert.deepEqual(result.all.map(t => t.id).sort(), ['done', 'live']);
});

test('an ended one is in neither direction — there is no move left to make',
    async () => {
        const db = fakeDb({ done: trade({ state: Core.STATES.SETTLED }) }, BOB);

        const result = await Store.loadMine(db, { personId: BOB, today: TODAY });

        assert.deepEqual(result.outbound, []);
        assert.deepEqual(result.inbound, []);
        assert.equal(result.ended.length, 1);
    });

test('they come back soonest first', async () => {
    const db = fakeDb({
        later: trade({ assignment: COFFEE }),
        sooner: trade({ assignment: KIDS }),
    }, BOB);

    const result = await Store.loadMine(db, { personId: BOB, today: TODAY });

    assert.deepEqual(result.all.map(t => t.id), ['sooner', 'later']);
});

test('somebody with no linked Person is asked nothing at all', async () => {
    const db = fakeDb({ a: trade() }, null);

    const result = await Store.loadMine(db, { personId: null, today: TODAY });

    assert.deepEqual(result.all, []);
    assert.equal(db.queriesRun.length, 0,
        'a query that cannot be legal should not be sent');
});

// ── Everything on one Assignment ────────────────────────────────────────────

test('every live Trade on one Assignment comes back — the cap counts these',
    async () => {
        const db = fakeDb({
            a: trade({ counterpartyId: 'p1' }),
            b: trade({ counterpartyId: 'p2', state: Core.STATES.REFUSED }),
            c: trade({ assignment: COFFEE, counterpartyId: 'p3' }),
        }, BOB);

        const found = await Store.loadForAssignment(db, {
            occurrenceId: KIDS.occurrenceId,
            roleSlug: KIDS.roleSlug,
            slotId: KIDS.slotId,
            today: TODAY,
        });

        assert.deepEqual(found.map(t => t.id), ['a'],
            'a refused one still counts against the three, or a different slot ' +
            'was swept in');
    });
