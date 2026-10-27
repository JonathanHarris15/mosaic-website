// @ts-nocheck — the fixture is a document map, not a Firestore client.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const writes = require('../functions/prayer-request-writes');

const SERVICE = '2026-11-01';
const TODAY = '2026-10-27';
const JANE = 'person-jane';
const NOW = new Date('2026-10-27T15:00:00.000Z');
const LATER = new Date('2026-10-27T18:00:00.000Z');

function memoryDb() {
    const docs = new Map();
    let seq = 0;

    function snap(path) {
        const data = docs.get(path);
        return {
            exists: data !== undefined,
            id: path.split('/').pop(),
            data() {
                return data === undefined ? undefined : Object.assign({}, data);
            },
        };
    }

    function ref(path) {
        return {
            id: path.split('/').pop(),
            path,
            collection(name) {
                return coll(`${path}/${name}`);
            },
            async get() {
                return snap(path);
            },
            async set(data, opts) {
                const prev = docs.get(path) || {};
                const next = opts && opts.merge ?
                    Object.assign({}, prev, data) :
                    Object.assign({}, data);
                docs.set(path, next);
            },
            async update(patch) {
                if (!docs.has(path)) throw new Error(`missing ${path}`);
                docs.set(path, Object.assign({}, docs.get(path), patch));
            },
        };
    }

    function coll(path) {
        return {
            doc(id) {
                const minted = id || `n${++seq}`;
                return ref(`${path}/${minted}`);
            },
            async get() {
                const prefix = `${path}/`;
                const found = [];
                for (const key of docs.keys()) {
                    if (!key.startsWith(prefix)) continue;
                    const rest = key.slice(prefix.length);
                    if (rest.includes('/')) continue;
                    found.push(snap(key));
                }
                return {docs: found, empty: found.length === 0, size: found.length};
            },
        };
    }

    return {
        collection(name) {
            return coll(name);
        },
    };
}

async function seed(db) {
    await db.collection('people').doc(JANE).set({name: 'Jane Doe'});
    await db.collection('liturgy_orders').doc('standard').set({
        id: 'standard',
        name: 'Standard',
        elements: [{
            id: 'pastoral',
            name: 'Pastoral Prayer',
            kind: 'prayer',
            requests: {count: 1, who: 'either'},
        }],
    });
    await db.collection('services').doc(SERVICE).set({
        liturgyOrderId: 'standard',
        liturgy: {pastoral: [{id: JANE, name: 'Jane Doe'}]},
    });
}

function request(db) {
    return db.collection('people').doc(JANE)
        .collection('prayer_requests').doc(SERVICE);
}

function notes(db) {
    return db.collection('people').doc(JANE).collection('shepherding_notes');
}

test('reply then form keeps one note and the form text wins', async () => {
    const db = memoryDb();
    await seed(db);
    const reply = await writes.applyReply(db, {
        personId: JANE, serviceDate: SERVICE, replyText: 'From the phone', now: NOW,
    });
    assert.equal(reply.filled, true);
    assert.equal(reply.replaced, false);
    const form = await writes.saveFormAnswer(db, {
        personId: JANE,
        serviceDate: SERVICE,
        todayDate: TODAY,
        answerText: 'From the link',
        now: LATER,
    });
    assert.equal(form.ok, true);
    assert.equal(form.noteId, reply.noteId);
    const req = (await request(db).get()).data();
    assert.equal(req.prayerRequest, 'From the link');
    assert.equal(req.prayerRequestSource, 'form');
    const stored = await notes(db).get();
    assert.equal(stored.size, 1);
    assert.equal(stored.docs[0].data().content, 'From the link');
    assert.equal(stored.docs[0].data().authorName, 'Prayer Request (texted)');
});

test('form then reply keeps one note and the reply text wins', async () => {
    const db = memoryDb();
    await seed(db);
    const form = await writes.saveFormAnswer(db, {
        personId: JANE,
        serviceDate: SERVICE,
        todayDate: TODAY,
        answerText: 'From the link',
        now: NOW,
    });
    assert.equal(form.ok, true);
    const reply = await writes.applyReply(db, {
        personId: JANE, serviceDate: SERVICE, replyText: 'From the phone', now: LATER,
    });
    assert.equal(reply.filled, true);
    assert.equal(reply.replaced, true);
    assert.equal(reply.noteId, form.noteId);
    const req = (await request(db).get()).data();
    assert.equal(req.prayerRequest, 'From the phone');
    assert.equal(req.prayerRequestSource, 'reply');
    const stored = await notes(db).get();
    assert.equal(stored.size, 1);
    assert.equal(stored.docs[0].data().content, 'From the phone');
    assert.equal(stored.docs[0].data().authorName, 'Prayer Request (form)');
});

test('the same reply text on the same channel is not a new fill', async () => {
    const db = memoryDb();
    await seed(db);
    const first = await writes.applyReply(db, {
        personId: JANE, serviceDate: SERVICE, replyText: 'First', now: NOW,
    });
    const second = await writes.applyReply(db, {
        personId: JANE, serviceDate: SERVICE, replyText: 'First', now: LATER,
    });
    assert.equal(first.filled, true);
    assert.equal(second.filled, false);
    assert.equal(second.replaced, false);
    assert.equal(second.noteId, first.noteId);
    const req = (await request(db).get()).data();
    assert.equal(req.prayerRequest, 'First');
    assert.equal(req.prayerRequestSource, 'reply');
    assert.equal(req.requestFilledAt, NOW);
    assert.equal(req.changedAt, NOW);
    assert.equal((await notes(db).get()).size, 1);
    assert.equal((await notes(db).get()).docs[0].data().content, 'First');
});

test('the same words from the other channel still replace the source', async () => {
    const db = memoryDb();
    await seed(db);
    await writes.applyReply(db, {
        personId: JANE, serviceDate: SERVICE, replyText: 'Same words', now: NOW,
    });
    const form = await writes.saveFormAnswer(db, {
        personId: JANE,
        serviceDate: SERVICE,
        todayDate: TODAY,
        answerText: 'Same words',
        now: LATER,
    });
    assert.equal(form.ok, true);
    const req = (await request(db).get()).data();
    assert.equal(req.prayerRequest, 'Same words');
    assert.equal(req.prayerRequestSource, 'form');
    assert.equal(req.requestFilledAt, NOW);
    assert.equal(req.changedAt, LATER);
    assert.equal((await notes(db).get()).size, 1);
});

test('a second reply updates the generated note instead of adding one', async () => {
    const db = memoryDb();
    await seed(db);
    const first = await writes.applyReply(db, {
        personId: JANE, serviceDate: SERVICE, replyText: 'First', now: NOW,
    });
    const second = await writes.applyReply(db, {
        personId: JANE, serviceDate: SERVICE, replyText: 'Second', now: LATER,
    });
    assert.equal(second.filled, true);
    assert.equal(second.replaced, true);
    assert.equal(second.noteId, first.noteId);
    const stored = await notes(db).get();
    assert.equal(stored.size, 1);
    assert.equal(stored.docs[0].data().content, 'Second');
    const req = (await request(db).get()).data();
    assert.equal(req.noteGeneratedText, 'Second');
    assert.equal(req.requestFilledAt, NOW);
});

test('a hand-edited note stays while the request text updates', async () => {
    const db = memoryDb();
    await seed(db);
    const first = await writes.applyReply(db, {
        personId: JANE, serviceDate: SERVICE, replyText: 'First', now: NOW,
    });
    await notes(db).doc(first.noteId).update({content: 'An elder reworded this.'});
    const second = await writes.applyReply(db, {
        personId: JANE, serviceDate: SERVICE, replyText: 'Second', now: LATER,
    });
    assert.equal(second.filled, true);
    assert.equal(second.noteId, first.noteId);
    const stored = await notes(db).get();
    assert.equal(stored.size, 1);
    assert.equal(stored.docs[0].data().content, 'An elder reworded this.');
    const req = (await request(db).get()).data();
    assert.equal(req.prayerRequest, 'Second');
    assert.equal(req.noteGeneratedText, 'First');
});

test('an elder-typed request is not replaced by a reply or a form', async () => {
    const db = memoryDb();
    await seed(db);
    await request(db).set({
        serviceDate: SERVICE,
        prayerRequest: 'Elder words',
        prayerRequestSource: 'elder',
    });
    const reply = await writes.applyReply(db, {
        personId: JANE, serviceDate: SERVICE, replyText: 'From the phone', now: NOW,
    });
    assert.equal(reply.filled, false);
    const form = await writes.saveFormAnswer(db, {
        personId: JANE,
        serviceDate: SERVICE,
        todayDate: TODAY,
        answerText: 'From the link',
        now: LATER,
    });
    assert.equal(form.ok, false);
    assert.equal(form.code, 'already-have-it');
    const req = (await request(db).get()).data();
    assert.equal(req.prayerRequest, 'Elder words');
    assert.equal(req.prayerRequestSource, 'elder');
    assert.equal((await notes(db).get()).size, 0);
});
