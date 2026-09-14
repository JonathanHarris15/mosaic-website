// MS-489 — Presence and the Box lock, lifted out of the Order of Service.
//
// The Order of Service taught us the rules (ADR-0035) and the tests for those
// stay in service-presence.test.js, running against the adapter. This file is
// what Shepherding adds on top, and what every later page consumes:
//
//   - a hold is a SCOPE plus a BOX, naming the record, never the page;
//   - a Shepherding hold lets go after a minute without typing (ADR-0062),
//     checked from BOTH ends — the holder's own store gives it up, and every
//     reader treats a quiet hold as free, so a sleeping tab still beating
//     cannot keep one;
//   - coming back after that, you get the box back if nobody took it, and are
//     told plainly if somebody did.

const { test } = require('node:test');
const assert = require('node:assert');

const { PresenceCore, createPresenceStore } = require('../public/presence-core.js');

const NOW = 1_700_000_000_000;
const ME = 'uid-me';
const MINUTE = 60000;

function ts(ms) { return { toMillis: () => ms }; }

function entry(overrides = {}) {
    return Object.assign({
        uid: 'uid-ann',
        personId: 'p-ann',
        name: 'Ann Lee',
        surface: 'shepherding-profile',
        pageKey: 'p-bob',
        scopeKey: 'person:p-bob',
        boxKey: 'note:n1',
        activeAt: ts(NOW - 1000),
        updatedAt: ts(NOW - 1000),
    }, overrides);
}

const SHEP = { idleMs: MINUTE };

// ── The rules ────────────────────────────────────────────────────────────────

test('the stored field names are scope and box', () => {
    const r = PresenceCore.claimRecord({ id: 'p-me', name: 'Bill' }, 'shepherding-profile', 'p-bob',
        'person:p-bob', 'details', ts(NOW));
    assert.strictEqual(r.scopeKey, 'person:p-bob');
    assert.strictEqual(r.boxKey, 'details');
    assert.ok(!('dateKey' in r) && !('fieldKey' in r));
});

test('a hold that has been quiet for over a minute is free — when the page says holds go quiet', () => {
    const quiet = entry({ activeAt: ts(NOW - MINUTE - 1) });
    assert.strictEqual(
        PresenceCore.holderOf([quiet], ME, 'person:p-bob', 'note:n1', NOW, SHEP), null,
        'a tab asleep but still beating must not keep a Shepherding box');
});

test('a hold typed into within the minute is kept', () => {
    const typing = entry({ activeAt: ts(NOW - 50000) });
    assert.ok(PresenceCore.holderOf([typing], ME, 'person:p-bob', 'note:n1', NOW, SHEP));
});

test('without an idle rule a hold never goes quiet', () => {
    // The Order of Service men are in one room and can ask (ADR-0062). Its
    // holds last as long as the heartbeat does.
    const quiet = entry({ activeAt: ts(NOW - 10 * MINUTE) });
    assert.ok(PresenceCore.holderOf([quiet], ME, 'person:p-bob', 'note:n1', NOW));
    assert.strictEqual(PresenceCore.isIdle(quiet, NOW), false);
});

test('a hold whose typing has not reached the server yet counts as typing now', () => {
    const justTaken = entry({ activeAt: null });
    assert.strictEqual(PresenceCore.isIdle(justTaken, NOW, MINUTE), false);
});

test('a record written before holds could go quiet is never treated as quiet', () => {
    const old = entry();
    delete old.activeAt;
    assert.strictEqual(PresenceCore.isIdle(old, NOW, MINUTE), false);
});

test('the same scope and box collide across surfaces', () => {
    // A Task held on the profile is held on the Tasks page.
    const fromTasksPage = entry({
        surface: 'shepherding-tasks', pageKey: null, scopeKey: 'task:t9', boxKey: 'editor',
    });
    assert.ok(PresenceCore.holderOf([fromTasksPage], ME, 'task:t9', 'editor', NOW, SHEP));
});

test('faces stay scoped to the surface and the page', () => {
    const here = entry();
    const otherPerson = entry({ uid: 'uid-cy', personId: 'p-cy', pageKey: 'p-dee' });
    const otherSurface = entry({ uid: 'uid-di', personId: 'p-di', surface: 'order-of-service' });
    const people = PresenceCore.peopleHere(
        [here, otherPerson, otherSurface], ME, 'shepherding-profile', 'p-bob', NOW, SHEP);
    assert.deepStrictEqual(people.map(p => p.name), ['Ann Lee']);
});

test('a quiet holder is still here, just not holding', () => {
    const quiet = entry({ activeAt: ts(NOW - 5 * MINUTE) });
    assert.strictEqual(
        PresenceCore.peopleHere([quiet], ME, 'shepherding-profile', 'p-bob', NOW, SHEP).length, 1);
});

test('a record written by the old Order of Service still reads as a hold', () => {
    // During a deploy, an open tab running yesterday's code still writes
    // dateKey / fieldKey. Its lock must still hold.
    const old = { uid: 'uid-ann', personId: 'p-ann', name: 'Ann', surface: 'order-of-service',
        pageKey: '2026-08-16', dateKey: '2026-08-16', fieldKey: 'liturgy.hymn1',
        updatedAt: ts(NOW - 1000) };
    assert.ok(PresenceCore.holderOf([old], ME, '2026-08-16', 'liturgy.hymn1', NOW));
});

// ── The store ────────────────────────────────────────────────────────────────

function fakeDb() {
    const writes = [];
    const deletes = [];
    let onNext = null;
    let collectionName = null;
    const db = {
        collection(name) {
            collectionName = name;
            return {
                doc() {
                    return {
                        set(record, opts) { writes.push({ record, merge: !!(opts && opts.merge) }); return Promise.resolve(); },
                        delete() { deletes.push(true); return Promise.resolve(); },
                    };
                },
                onSnapshot(next) { onNext = next; return () => {}; },
            };
        },
    };
    return {
        db, writes, deletes,
        name: () => collectionName,
        deliver(entries) {
            onNext({ forEach(fn) { entries.forEach(e => fn({ id: e.uid, data: () => e })); } });
        },
    };
}

function shepherdStore(opts = {}) {
    let now = NOW;
    const beats = [];
    const changes = [];
    const fake = fakeDb();
    const store = createPresenceStore({ collection: 'shepherding_presence', idleMs: MINUTE });
    store.start(Object.assign({
        db: fake.db,
        uid: ME,
        identity: { id: 'p-me', name: 'Bill Smith' },
        surface: 'shepherding-profile',
        pageKey: 'p-bob',
        stamp: () => 'STAMP',
        now: () => now,
        onChange: e => changes.push(e),
        setInterval: fn => { beats.push(fn); return beats.length; },
        clearInterval: () => {},
    }, opts));
    return {
        store, fake, changes,
        last: () => fake.writes[fake.writes.length - 1],
        advance(ms) { now += ms; },
        beat() { beats.forEach(fn => fn()); },
        tick(ms) { // advance in heartbeat steps, beating at each
            const step = PresenceCore.HEARTBEAT_MS;
            for (let t = 0; t < ms; t += step) { now += step; beats.forEach(fn => fn()); }
        },
    };
}

test('a store writes to the collection it was made for', () => {
    const s = shepherdStore();
    assert.strictEqual(s.fake.name(), 'shepherding_presence');
    s.store.stop();
});

test('taking a box stamps when it was last typed in', () => {
    const s = shepherdStore();
    s.fake.deliver([]);
    assert.strictEqual(s.store.claim('person:p-bob', 'note:n1'), true);
    assert.strictEqual(s.last().record.scopeKey, 'person:p-bob');
    assert.strictEqual(s.last().record.boxKey, 'note:n1');
    assert.strictEqual(s.last().record.activeAt, 'STAMP');
    assert.ok(s.store.isHolding('person:p-bob', 'note:n1'));
    s.store.stop();
});

test('a beat with no typing since the last one leaves the typing time alone', () => {
    const s = shepherdStore();
    s.fake.deliver([]);
    s.store.claim('person:p-bob', 'note:n1');
    s.tick(10000);
    assert.ok(!('activeAt' in s.last().record), 'no typing, so no new typing time');
    assert.strictEqual(s.last().merge, true, 'and the stored one is kept, not wiped');
    s.store.stop();
});

test('a beat after typing refreshes the typing time', () => {
    const s = shepherdStore();
    s.fake.deliver([]);
    s.store.claim('person:p-bob', 'note:n1');
    s.advance(3000);
    assert.strictEqual(s.store.touch(), true);
    s.beat();
    assert.strictEqual(s.last().record.activeAt, 'STAMP');
    s.beat();
    assert.ok(!('activeAt' in s.last().record), 'once per beat, only when typed since');
    s.store.stop();
});

test('a hold lets go on the first beat after a minute without typing', () => {
    const s = shepherdStore();
    s.fake.deliver([]);
    s.store.claim('person:p-bob', 'note:n1');

    s.tick(50000);
    assert.ok(s.store.isHolding('person:p-bob', 'note:n1'), 'still held at fifty seconds');

    const before = s.changes.length;
    s.tick(10000);
    assert.strictEqual(s.store.isHolding('person:p-bob', 'note:n1'), false, 'let go at the minute');
    assert.strictEqual(s.last().record.boxKey, null);
    assert.strictEqual(s.last().record.activeAt, null);
    assert.ok(s.changes.length > before, 'and the page is told, so it can redraw');
    s.store.stop();
});

test('typing keeps a hold past the minute', () => {
    const s = shepherdStore();
    s.fake.deliver([]);
    s.store.claim('person:p-bob', 'note:n1');
    for (let i = 0; i < 12; i++) { s.store.touch(); s.tick(10000); }
    assert.ok(s.store.isHolding('person:p-bob', 'note:n1'));
    s.store.stop();
});

test('coming back to a box nobody took takes it back', () => {
    const s = shepherdStore();
    s.fake.deliver([]);
    s.store.claim('person:p-bob', 'note:n1');
    s.tick(MINUTE);
    assert.strictEqual(s.store.isHolding('person:p-bob', 'note:n1'), false);

    assert.strictEqual(s.store.touch(), true);
    assert.ok(s.store.isHolding('person:p-bob', 'note:n1'));
    assert.strictEqual(s.last().record.boxKey, 'note:n1');
    assert.strictEqual(s.last().record.activeAt, 'STAMP');
    s.store.stop();
});

test('coming back to a box somebody else took is refused', () => {
    const s = shepherdStore();
    s.fake.deliver([]);
    s.store.claim('person:p-bob', 'note:n1');
    s.tick(MINUTE);
    s.fake.deliver([entry({ updatedAt: ts(NOW + MINUTE), activeAt: ts(NOW + MINUTE) })]);
    const writes = s.fake.writes.length;

    assert.strictEqual(s.store.touch(), false);
    assert.strictEqual(s.store.isHolding('person:p-bob', 'note:n1'), false);
    assert.strictEqual(s.fake.writes.length, writes, 'nothing is written over the new holder');
    s.store.stop();
});

test('typing in something that was never a box is always fine', () => {
    const s = shepherdStore();
    s.fake.deliver([]);
    assert.strictEqual(s.store.touch(), true, 'a brand-new note is not a box');
    s.store.stop();
});

test('a box another elder is quietly holding can be taken', () => {
    const s = shepherdStore();
    s.fake.deliver([entry({ activeAt: ts(NOW - 2 * MINUTE) })]);
    assert.strictEqual(s.store.claim('person:p-bob', 'note:n1'), true);
    s.store.stop();
});

test('a box another elder is typing in is refused', () => {
    const s = shepherdStore();
    s.fake.deliver([entry()]);
    assert.strictEqual(s.store.claim('person:p-bob', 'note:n1'), false);
    assert.ok(s.store.holder('person:p-bob', 'note:n1'));
    s.store.stop();
});

test('two stores do not share a hold', () => {
    // The Order of Service and Shepherding each get their own. One person may
    // hold a hymn and a note at once; the areas never share a box.
    const a = createPresenceStore({ collection: 'presence' });
    const b = createPresenceStore({ collection: 'shepherding_presence', idleMs: MINUTE });
    const common = { uid: ME, identity: null, surface: 'x', stamp: () => null, now: () => NOW,
        setInterval: () => 1, clearInterval: () => {} };
    a.start(Object.assign({ db: fakeDb().db }, common));
    b.start(Object.assign({ db: fakeDb().db }, common));
    a.claim('2026-08-16', 'liturgy.hymn1');
    b.claim('person:p-bob', 'details');
    assert.ok(a.isHolding('2026-08-16', 'liturgy.hymn1'));
    assert.ok(b.isHolding('person:p-bob', 'details'));
    a.stop(); b.stop();
});

test('without an idle rule a store never gives up a hold on its own', () => {
    let now = NOW;
    const beats = [];
    const fake = fakeDb();
    const store = createPresenceStore({ collection: 'presence' });
    store.start({ db: fake.db, uid: ME, identity: null, surface: 'order-of-service',
        stamp: () => null, now: () => now, setInterval: fn => { beats.push(fn); return 1; }, clearInterval: () => {} });
    fake.deliver([]);
    store.claim('2026-08-16', 'liturgy.hymn1');
    for (let i = 0; i < 30; i++) { now += 10000; beats.forEach(fn => fn()); }
    assert.ok(store.isHolding('2026-08-16', 'liturgy.hymn1'));
    assert.ok(!('activeAt' in fake.writes[fake.writes.length - 1].record),
        'the Order of Service record does not grow a typing time');
    store.stop();
});

// ── Presence may remove a lock, never an editor ──────────────────────────────

test('a store that is not running allows every claim and every keystroke', () => {
    const store = createPresenceStore({ collection: 'shepherding_presence', idleMs: MINUTE });
    assert.strictEqual(store.claim('person:p-bob', 'note:n1'), true);
    assert.strictEqual(store.touch(), true);
    assert.strictEqual(store.holder('person:p-bob', 'note:n1'), null);
    assert.deepStrictEqual(store.here(), []);
    assert.doesNotThrow(() => { store.release(); store.leave(); });
});

test('starting can never throw at its caller', () => {
    const store = createPresenceStore({ collection: 'shepherding_presence', idleMs: MINUTE });
    assert.doesNotThrow(() => store.start({
        db: { collection() { throw new Error('rules refused'); } },
        uid: ME, identity: null, surface: 'shepherding-profile',
        stamp: () => null, now: () => NOW,
    }));
    assert.strictEqual(store.claim('person:p-bob', 'note:n1'), true);
    store.stop();
});

test('presence is read through the live-read helper when one is given', () => {
    // So faces and locks keep working when the phone falls back to re-reading.
    const watched = [];
    const store = createPresenceStore({ collection: 'shepherding_presence', idleMs: MINUTE });
    store.start({
        db: fakeDb().db, uid: ME, identity: null, surface: 'shepherding-profile', pageKey: 'p-bob',
        stamp: () => null, now: () => NOW, setInterval: () => 1, clearInterval: () => {},
        watch: (ref, onNext, opts) => { watched.push(opts); return () => {}; },
    });
    assert.strictEqual(watched.length, 1);
    assert.ok(watched[0].fallbackEveryMs <= 3000, 'presence is person-scoped and re-reads fast');
    store.stop();
});
