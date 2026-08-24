const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const admin = require('firebase-admin');
const H = require('./harness.js');
const sr = require('../../functions/service-read.js');
const hi = require('../../functions/hymn-index.js');
const sh = require('../../functions/scripture-heatmap.js');

// The reads an assistant makes before it proposes anything (MS-262).
//
// ⚠ WHAT ONLY A REAL FIRESTORE CAN SHOW HERE. Every one of these is a claim
// about query semantics, not about our arithmetic:
//
//   1. A range over Sundays is a DOCUMENT ID range, because the id is the
//      date. A stub would happily "work" while the real query needed an
//      index, or ordered lexically in a way dates do not survive.
//   2. `in` queries cap at 30 values and must be chunked.
//   3. A prefix range with the  sentinel really does bound a prefix.
//   4. Legacy dotted field names — 'liturgy.sermon' stored as a top-level
//      field NAME with a dot in it — are folded back in. This one matters
//      most: without it a read reports an EMPTY slot on an older Sunday that
//      plainly has one filled, confidently and silently.

// ⚠ From the SAME firebase-admin the harness loaded. A FieldPath from a
// different copy of the package is rejected outright — which is exactly
// what caught the module reaching for its own.
const DOCID = admin.firestore.FieldPath.documentId();

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('reading Sundays and looking things up', () => {
    let db;

    before(() => {
        db = H.connect();
    });

    beforeEach(async () => {
        await H.wipe();
        hi._resetCache();
    });

    // ── One Sunday ───────────────────────────────────────────────────────

    test('a Sunday reads back in the order the service runs, not alphabetically', async () => {
        await db.collection('services').doc('2026-08-17').set({
            theme: 'The God Who Rescues',
            keyVerse: 'Exodus 14:14',
            liturgy: {
                benediction: 'Numbers 6:24',
                hymn1: {id: 'h-1', name: 'Holy Holy Holy'},
                callToWorship: 'Psalm 100',
            },
        });

        const s = await sr.getService(db, '2026-08-17');
        assert.strictEqual(s.exists, true);
        assert.strictEqual(s.theme, 'The God Who Rescues');

        const order = s.liturgy.map(r => r.field);
        assert.ok(order.indexOf('callToWorship') < order.indexOf('hymn1'),
            'Call to Worship comes before Hymn 1 in a service');
        assert.ok(order.indexOf('hymn1') < order.indexOf('benediction'),
            'the Benediction is at the end');

        const filled = s.liturgy.filter(r => r.filled).map(r => r.field);
        assert.deepStrictEqual(filled.sort(),
            ['benediction', 'callToWorship', 'hymn1']);
    });

    test('⚠ a legacy dotted field is folded in, not reported as empty', async () => {
        // How older saves stored it: a top-level field NAME containing a dot.
        await db.collection('services').doc('2026-08-17').set({
            'theme': 'Older Sunday',
            'liturgy.sermon': 'Romans 8:28',
        });

        const s = await sr.getService(db, '2026-08-17');
        const sermon = s.liturgy.find(r => r.field === 'sermon');
        assert.strictEqual(sermon.filled, true,
            'an older Sunday would read as having no sermon reading at all');
        assert.strictEqual(sermon.value, 'Romans 8:28');
    });

    test('a nested value beats a legacy dotted one for the same slot', async () => {
        await db.collection('services').doc('2026-08-17').set({
            'liturgy': {sermon: 'The current one'},
            'liturgy.sermon': 'The stale one',
        });
        const s = await sr.getService(db, '2026-08-17');
        assert.strictEqual(
            s.liturgy.find(r => r.field === 'sermon').value, 'The current one');
    });

    test('a Sunday with nothing planned says so rather than failing', async () => {
        const s = await sr.getService(db, '2030-01-06');
        assert.strictEqual(s.exists, false);
        assert.deepStrictEqual(s.liturgy, []);
    });

    test('people come back by their readable role, and who chose what is carried', async () => {
        await db.collection('services').doc('2026-08-17').set({
            preacher: 'Alice Smith',
            serviceLeader: 'Bob Jones',
            musicHelpers: [{id: 'p-3', name: 'Cara Bell'}, {id: null, name: ''}],
            liturgy: {hymn1: {id: 'h-1', name: 'Holy Holy Holy'}},
            decidedBy: {hymn1: {id: 'p-1', name: 'Alice Smith', at: null}},
        });

        const s = await sr.getService(db, '2026-08-17');
        assert.strictEqual(s.people['Preacher'], 'Alice Smith');
        assert.strictEqual(s.people['Service Leader'], 'Bob Jones');
        assert.deepStrictEqual(s.people['Music Helpers'], ['Cara Bell']);
        assert.strictEqual(
            s.liturgy.find(r => r.field === 'hymn1').decidedBy, 'Alice Smith');
    });

    // ── A span of Sundays ────────────────────────────────────────────────

    test('a range returns only the Sundays that have something planned', async () => {
        await db.collection('services').doc('2026-08-02').set({theme: 'A'});
        await db.collection('services').doc('2026-08-17').set({theme: 'B'});
        await db.collection('services').doc('2026-09-20').set({theme: 'C'});

        const r = await sr.getServiceRange(db, '2026-08-01', '2026-08-31', {documentId: DOCID});
        assert.deepStrictEqual(r.services.map(s => s.date),
            ['2026-08-02', '2026-08-17']);
        assert.strictEqual(r.truncated, false);
    });

    test('a range comes back in date order', async () => {
        for (const d of ['2026-08-30', '2026-08-02', '2026-08-17']) {
            await db.collection('services').doc(d).set({theme: d});
        }
        const r = await sr.getServiceRange(db, '2026-08-01', '2026-08-31', {documentId: DOCID});
        assert.deepStrictEqual(r.services.map(s => s.date),
            ['2026-08-02', '2026-08-17', '2026-08-30']);
    });

    test('a range wider than the cap reports itself as truncated', async () => {
        for (let i = 1; i <= 5; i++) {
            await db.collection('services').doc(`2026-08-0${i}`).set({theme: 'x'});
        }
        const r = await sr.getServiceRange(db, '2026-08-01', '2026-08-31', {documentId: DOCID, limit: 3});
        assert.strictEqual(r.services.length, 3);
        assert.strictEqual(r.truncated, true,
            'a silently short list reads as "that is all there is"');
    });

    test('a range exactly the size of the cap is NOT flagged as truncated', async () => {
        for (let i = 1; i <= 3; i++) {
            await db.collection('services').doc(`2026-08-0${i}`).set({theme: 'x'});
        }
        const r = await sr.getServiceRange(db, '2026-08-01', '2026-08-31', {documentId: DOCID, limit: 3});
        assert.strictEqual(r.services.length, 3);
        assert.strictEqual(r.truncated, false);
    });

    // ── Looking up particular hymns ──────────────────────────────────────

    test('named hymns come back, and names that do not exist are reported', async () => {
        await db.collection('hymns').doc('h-1').set(
            {hymn_name: 'Holy Holy Holy', times_played: 4, last_played_date: '2026-01-04'});
        await db.collection('hymns').doc('h-2').set(
            {hymn_name: 'Be Thou My Vision', times_played: 1});

        const r = await hi.lookupHymns(db,
            {names: ['Holy Holy Holy', 'A Hymn We Do Not Have']});

        assert.deepStrictEqual(r.hymns.map(h => h.hymn_name), ['Holy Holy Holy']);
        assert.strictEqual(r.hymns[0].times_played, 4);
        assert.deepStrictEqual(r.notFound, ['A Hymn We Do Not Have'],
            'an assistant cannot otherwise tell a miss from "never sung"');
    });

    test('a search prefix bounds the match rather than running away', async () => {
        await db.collection('hymns').doc('h-1').set({hymn_name: 'Holy Holy Holy'});
        await db.collection('hymns').doc('h-2').set({hymn_name: 'Holy Spirit Come'});
        await db.collection('hymns').doc('h-3').set({hymn_name: 'O Holy Night'});
        await db.collection('hymns').doc('h-4').set({hymn_name: 'Immortal Invisible'});

        const r = await hi.lookupHymns(db, {search: 'Holy'});
        const names = r.hymns.map(h => h.hymn_name).sort();
        assert.deepStrictEqual(names, ['Holy Holy Holy', 'Holy Spirit Come'],
            'a prefix match must not sweep up every hymn containing the word');
    });

    test('more than 30 names still works — the in query has to be chunked', async () => {
        const names = [];
        for (let i = 0; i < 35; i++) {
            const name = `Hymn Number ${String(i).padStart(2, '0')}`;
            names.push(name);
            await db.collection('hymns').doc(`h-${i}`).set({hymn_name: name});
        }
        const r = await hi.lookupHymns(db, {names, limit: 200});
        assert.strictEqual(r.hymns.length, 35,
            'Firestore caps an `in` query at 30 values');
        assert.deepStrictEqual(r.notFound, []);
    });

    test('the targeted lookup never serves the cached whole index', async () => {
        await db.collection('hymns').doc('h-1').set(
            {hymn_name: 'Holy Holy Holy', times_played: 1});
        await hi.getHymnIndex(db); // warms the cache at times_played 1

        await db.collection('hymns').doc('h-1').update({times_played: 2});

        const r = await hi.lookupHymns(db, {names: ['Holy Holy Holy']});
        assert.strictEqual(r.hymns[0].times_played, 2,
            'an assistant would plan against a count that predates its own write');
    });

    test('asking the whole index for a fresh read bypasses the cache', async () => {
        await db.collection('hymns').doc('h-1').set(
            {hymn_name: 'Holy Holy Holy', times_played: 1});
        await hi.getHymnIndex(db);
        await db.collection('hymns').doc('h-1').update({times_played: 9});

        const cached = await hi.getHymnIndex(db);
        assert.strictEqual(cached[0].times_played, 1, 'the cache is doing its job');

        const fresh = await hi.getHymnIndex(db, null, {fresh: true});
        assert.strictEqual(fresh[0].times_played, 9);
    });

    // ── Looking up particular scripture ──────────────────────────────────

    test('named references come back, and unused ones are named as unused', async () => {
        await db.collection('scripture_usage').doc('John 3:16').set(
            {reference: 'John 3:16', count: 4, lastUsed: '2026-01-04'});

        const r = await sh.lookupScripture(db,
            {references: ['John 3:16', 'Obadiah 1:1']});

        assert.deepStrictEqual(r.scripture.map(x => x.reference), ['John 3:16']);
        assert.strictEqual(r.scripture[0].count, 4);
        assert.deepStrictEqual(r.neverUsed, ['Obadiah 1:1'],
            'never preached is a useful answer, not a failed lookup');
    });

    test('a book prefix catches that book and not the numbered one beside it', async () => {
        await db.collection('scripture_usage').doc('John 3:16').set(
            {reference: 'John 3:16', count: 1});
        await db.collection('scripture_usage').doc('John 1:1').set(
            {reference: 'John 1:1', count: 1});
        await db.collection('scripture_usage').doc('1 John 4:8').set(
            {reference: '1 John 4:8', count: 1});

        const r = await sh.lookupScripture(db, {book: 'John'});
        const refs = r.scripture.map(x => x.reference).sort();
        assert.deepStrictEqual(refs, ['John 1:1', 'John 3:16'],
            '1 John is a different book and must not be swept in');
    });
});
