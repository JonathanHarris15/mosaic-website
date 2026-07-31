const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Home shows one thing about one service: the next Sunday's theme and three
// names. It used to find it by downloading the WHOLE services collection —
// measured against the real database at 205 documents and 3.6 MB, of which
// Home uses 0.1 KB. The weight is the `guide` field, the printed service guide
// stored on the service document: 3.27 MB of the 3.54 MB, one document 425 KB.
//
// ⚠ SERVICES ARE KEYED BY DATE AND HAVE NO DATE FIELD. Every document id is
// "2026-08-02"; a where('date', '>=', …) query — the obvious way to write this
// — matches NOTHING, and Home would sit on "No upcoming service found" forever
// while looking perfectly correct in review. Checked against the live data:
// 205 of 205 ids are date-shaped, 0 of 205 carry a `date` field.

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'mobile', 'data.js'), 'utf8');

function memStorage() {
    const map = new Map();
    return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k),
    };
}

// A Firestore stand-in that records what was asked for, so the test can assert
// on the QUERY rather than on the answer. `answers` is consulted in order: each
// get() takes the next one.
function fakeFirestore(answers) {
    const asked = [];

    function snapshotOf(ids) {
        const docs = (ids || []).map(id => ({
            id,
            exists: true,
            data: () => ({ theme: 'Theme for ' + id, preacher: 'A Preacher', hasBaptism: false }),
        }));
        return { empty: docs.length === 0, size: docs.length, docs, forEach: fn => docs.forEach(fn) };
    }

    function query(collection, chain) {
        return {
            orderBy: (field, dir) => query(collection, chain.concat([['orderBy', String(field), dir || 'asc']])),
            startAt: v => query(collection, chain.concat([['startAt', v]])),
            where: (f, op, v) => query(collection, chain.concat([['where', f, op, v]])),
            limit: n => query(collection, chain.concat([['limit', n]])),
            get: () => {
                asked.push({ collection, chain });
                return Promise.resolve(snapshotOf(answers.shift()));
            },
        };
    }

    const db = { collection: name => query(name, []) };
    const firestore = () => db;
    firestore.FieldPath = { documentId: () => '__name__' };
    firestore.FieldValue = { serverTimestamp: () => 'now' };
    firestore.Timestamp = { now: () => 0 };

    return { asked, firebase: {
        apps: [], initializeApp: () => {}, firestore,
        auth: () => ({ onAuthStateChanged: () => () => {}, currentUser: null,
                       signInWithEmailAndPassword: () => Promise.resolve(), signOut: () => Promise.resolve() }),
    } };
}

function loadData(answers) {
    const fake = fakeFirestore(answers);
    const M = {};
    const window = {
        sessionStorage: memStorage(),
        MosaicDestinations: require(path.join(ROOT, 'public', 'mobile', 'destinations.js')),
        MosaicLocalCache: null,   // the cache is off; reads go straight through
    };
    const fn = new Function('window', 'firebase', 'M', 'console', SRC + '\nreturn M.data;');
    return { data: fn(window, fake.firebase, M, console), asked: fake.asked };
}

const today = new Date().toISOString().slice(0, 10);

test('Home asks for the one service it shows, not all of them', () => {
    const { data, asked } = loadData([['2026-08-02']]);
    return data.getNextService().then(svc => {
        assert.equal(asked.length, 1, 'Home made more than one read to name one Sunday');
        const q = asked[0];
        assert.equal(q.collection, 'services');

        const limit = q.chain.find(c => c[0] === 'limit');
        assert.ok(limit, 'the query is unbounded — this is the 3.6 MB read again');
        assert.equal(limit[1], 1, `Home asked for ${limit[1]} services to show one`);

        assert.ok(svc && svc.date === '2026-08-02', 'the service came back wrong');
    });
});

test('the query goes by document id, because there is no date field to go by', () => {
    // The trap: where('date', '>=', today) reads correctly, reviews correctly,
    // and returns nothing at all against the real data.
    const { data, asked } = loadData([['2026-08-02']]);
    return data.getNextService().then(() => {
        const chain = asked[0].chain;
        const byField = chain.find(c => c[0] === 'where' && c[1] === 'date');
        assert.ok(!byField, 'the query filters on a `date` field that no service document has');

        const order = chain.find(c => c[0] === 'orderBy');
        assert.ok(order, 'nothing orders the query, so "the next one" is whichever Firestore feels like');
        assert.equal(order[1], '__name__', 'the query orders by something other than the document id');

        const start = chain.find(c => c[0] === 'startAt');
        assert.ok(start, 'the query has no starting point, so it returns the oldest service ever held');
        assert.equal(start[1], today, 'the query does not start from today');
    });
});

test('nothing upcoming falls back to the most recent, as it always did', () => {
    // The church has services booked to 2027, but this must not break the day
    // the last one goes past — Home showed the most recent service before and
    // still should, rather than an empty card.
    const { data, asked } = loadData([[], ['2026-07-26']]);
    return data.getNextService().then(svc => {
        assert.equal(asked.length, 2, 'no fallback was attempted');
        const back = asked[1].chain;
        const order = back.find(c => c[0] === 'orderBy');
        assert.equal(order[2], 'desc', 'the fallback does not take the LAST service');
        assert.equal(back.find(c => c[0] === 'limit')[1], 1, 'the fallback is unbounded');
        assert.ok(svc && svc.date === '2026-07-26');
    });
});

test('editing a service forgets the one Home is showing', () => {
    // getNextService is memoised like everything else, so the editor's
    // forget('services') has to reach it — or you edit Sunday's theme, come
    // back to Home, and read the old one back for a minute.
    const { data, asked } = loadData([['2026-08-02'], ['2026-08-02'], ['2026-08-02']]);
    return data.getNextService()
        .then(() => data.getNextService())
        .then(() => {
            assert.equal(asked.length, 1, 'the memo is not holding the featured service at all');
            data.forget('services');
            return data.getNextService();
        })
        .then(() => {
            assert.equal(asked.length, 2,
                'forget("services") left Home showing the service you just edited away');
        });
});

test('the services list is still whole-collection, and still the big read', () => {
    // Not fixed here, and deliberately so: the list shows all 205 Sundays, so
    // it genuinely needs all 205 documents — it is the `guide` field riding
    // along on each one that makes that 3.6 MB. The fix is moving the guide off
    // the service document, which is a data migration and its own ticket.
    // This test exists so that stays a known cost rather than a surprise.
    const { data, asked } = loadData([['2026-08-02', '2026-07-26']]);
    return data.getServices().then(list => {
        assert.equal(list.length, 2);
        assert.equal(asked[0].chain.length, 0,
            'the services list has been narrowed — if that is deliberate, this test should say so');
    });
});
