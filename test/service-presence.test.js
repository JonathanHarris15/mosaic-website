// MS-246 — seeing each other, and staying out of each other's boxes.
//
// One person per box: a box somebody else holds cannot be opened, and the
// value only lands when they leave. That trade is what makes this small — no
// merging, no operational transform, and never a question put to a user about
// whose version to keep.
//
// ⚠ The property this file exists to protect is EXPIRY. A lock that outlives
// its holder is worse than no lock: somebody shuts a laptop mid-hymn and that
// hymn is uneditable until a developer clears it by hand — on the one evening
// of the year the whole church is in a room to get the work done. A claim is a
// heartbeat, not a flag. Releasing on unload is a courtesy; expiry is what
// makes it correct.

const { test } = require('node:test');
const assert = require('node:assert');

const { ServicePresence, PresenceStore } = require('../public/service-presence.js');

const NOW = 1_700_000_000_000;
const ME = 'uid-me';

// Firestore hands timestamps back as objects with toMillis().
function ts(ms) {
    return { toMillis: () => ms };
}

function entry(overrides = {}) {
    return Object.assign({
        uid: 'uid-ann',
        personId: 'p-ann',
        name: 'Ann Lee',
        photoUrl: null,
        photoCrop: null,
        surface: 'order-of-service',
        dateKey: '2026-08-16',
        fieldKey: 'liturgy.hymn1',
        updatedAt: ts(NOW - 1000),
    }, overrides);
}

// ── A held box ─────────────────────────────────────────────────────────────

test('a box somebody else is in reports them as its holder', () => {
    const holder = ServicePresence.holderOf(
        [entry()], ME, '2026-08-16', 'liturgy.hymn1', NOW);

    assert.strictEqual(holder.name, 'Ann Lee');
});

test('a box nobody is in is free', () => {
    assert.strictEqual(
        ServicePresence.holderOf([entry()], ME, '2026-08-16', 'liturgy.hymn2', NOW), null);
});

test('the same box on a different Sunday is a different box', () => {
    // Twelve rows of Hymn 1 in the Planning view are twelve separate boxes.
    assert.strictEqual(
        ServicePresence.holderOf([entry()], ME, '2026-08-23', 'liturgy.hymn1', NOW), null);
});

test('your own claim never locks you out', () => {
    // Not even from a second tab: a lock whose holder you cannot see is just a
    // bug, and the likelier reading is that you meant to come back to it.
    const mine = entry({ uid: ME, personId: 'p-me', name: 'Bill Smith' });
    assert.strictEqual(
        ServicePresence.holderOf([mine], ME, '2026-08-16', 'liturgy.hymn1', NOW), null);
});

test('somebody present but not in any box holds nothing', () => {
    const idle = entry({ fieldKey: null, dateKey: null });
    assert.deepStrictEqual(ServicePresence.claimsByBox([idle], ME, NOW), {});
});

// ── Expiry: the part that must not break ───────────────────────────────────

test('a claim from a closed laptop stops holding the box', () => {
    const abandoned = entry({ updatedAt: ts(NOW - 31000) });
    assert.strictEqual(
        ServicePresence.holderOf([abandoned], ME, '2026-08-16', 'liturgy.hymn1', NOW), null,
        'a stale claim must not lock a box for the rest of the evening');
});

test('a claim still beating keeps its box', () => {
    const alive = entry({ updatedAt: ts(NOW - 12000) });
    assert.ok(ServicePresence.holderOf([alive], ME, '2026-08-16', 'liturgy.hymn1', NOW));
});

test('three missed beats are tolerated before somebody is treated as gone', () => {
    // The gap between the beat and the timeout is what stops a lock flickering
    // on a poor connection while its holder is still typing into it.
    assert.ok(ServicePresence.HEARTBEAT_MS * 3 <= ServicePresence.TTL_MS,
        'the timeout must outlast several missed heartbeats');
});

test('a write that has not reached the server yet counts as fresh', () => {
    // Firestore echoes our own write back with a null serverTimestamp before
    // it lands. Reading that as "very old" would make us release the box we
    // just took.
    const justWritten = entry({ updatedAt: null });
    assert.strictEqual(ServicePresence.isStale(justWritten, NOW), false);
});

test('timestamps in any of the shapes Firestore returns are understood', () => {
    assert.strictEqual(ServicePresence.isStale(entry({ updatedAt: ts(NOW - 1000) }), NOW), false);
    assert.strictEqual(ServicePresence.isStale(entry({ updatedAt: new Date(NOW - 1000) }), NOW), false);
    assert.strictEqual(ServicePresence.isStale(entry({ updatedAt: NOW - 1000 }), NOW), false);
    assert.strictEqual(ServicePresence.isStale(entry({ updatedAt: ts(NOW - 60000) }), NOW), true);
});

// ── Who is here ────────────────────────────────────────────────────────────

test('everybody here is listed, whether or not they hold a box', () => {
    const people = ServicePresence.peopleHere([
        entry({ uid: 'uid-ann', personId: 'p-ann', name: 'Ann Lee' }),
        entry({ uid: 'uid-ben', personId: 'p-ben', name: 'Ben Ross', fieldKey: null }),
    ], ME, NOW);

    assert.deepStrictEqual(people.map(p => p.name), ['Ann Lee', 'Ben Ross']);
});

test('you are not in your own list of who else is here', () => {
    const people = ServicePresence.peopleHere([entry({ uid: ME })], ME, NOW);
    assert.deepStrictEqual(people, []);
});

test('somebody gone is no longer here', () => {
    const people = ServicePresence.peopleHere([entry({ updatedAt: ts(NOW - 60000) })], ME, NOW);
    assert.deepStrictEqual(people, []);
});

test('one person with two tabs is one face', () => {
    const people = ServicePresence.peopleHere([
        entry({ uid: 'uid-ann-1', personId: 'p-ann' }),
        entry({ uid: 'uid-ann-2', personId: 'p-ann' }),
    ], ME, NOW);

    assert.strictEqual(people.length, 1);
});

// ── What the badge says ────────────────────────────────────────────────────

test('the badge is a first name, the whole one on hover', () => {
    assert.strictEqual(ServicePresence.holderLabel(entry()), 'Ann');
    assert.strictEqual(ServicePresence.holderTitle(entry()), 'Ann Lee is editing this');
});

test('somebody whose name we never got still reads as somebody', () => {
    const nameless = entry({ name: '' });
    assert.strictEqual(ServicePresence.holderLabel(nameless), 'Someone');
    assert.strictEqual(ServicePresence.holderTitle(nameless), 'Someone is editing this');
});

// ── Taking and letting go ──────────────────────────────────────────────────

function fakeStore() {
    const writes = [];
    const timers = [];
    let snapshotCb = null;

    const db = {
        collection() {
            return {
                doc() {
                    return { set(record) { writes.push(record); return Promise.resolve(); } };
                },
                onSnapshot(onNext) { snapshotCb = onNext; return () => {}; }
            };
        }
    };

    PresenceStore.start({
        db,
        uid: ME,
        identity: { id: 'p-me', name: 'Bill Smith', photoUrl: null, photoCrop: null },
        surface: 'order-of-service',
        stamp: () => ts(NOW),
        now: () => NOW,
        setInterval: (fn) => { timers.push(fn); return timers.length; },
        clearInterval: () => {},
    });

    return {
        writes,
        beat: () => timers.forEach(fn => fn()),
        deliver(entries) {
            snapshotCb({
                forEach(fn) {
                    entries.forEach(e => fn({ id: e.uid, data: () => e }));
                }
            });
        }
    };
}

test('arriving on a page announces you before you touch anything', () => {
    // Otherwise the first thing anybody knows about you is that you took a box
    // out from under them.
    const store = fakeStore();
    assert.strictEqual(store.writes.length, 1);
    assert.strictEqual(store.writes[0].fieldKey, null);
    assert.strictEqual(store.writes[0].name, 'Bill Smith');
    PresenceStore.stop();
});

test('taking a free box succeeds and records the claim', () => {
    const store = fakeStore();
    store.deliver([]);

    assert.strictEqual(PresenceStore.claim('2026-08-16', 'liturgy.hymn1'), true);
    const last = store.writes[store.writes.length - 1];
    assert.strictEqual(last.fieldKey, 'liturgy.hymn1');
    assert.strictEqual(last.dateKey, '2026-08-16');
    PresenceStore.stop();
});

test('a box somebody else holds is refused, and nothing is written', () => {
    const store = fakeStore();
    store.deliver([entry()]);
    const before = store.writes.length;

    assert.strictEqual(PresenceStore.claim('2026-08-16', 'liturgy.hymn1'), false);
    assert.strictEqual(store.writes.length, before,
        'a refused claim must not overwrite the holder');
    PresenceStore.stop();
});

test('a box whose holder has gone quiet can be taken', () => {
    const store = fakeStore();
    store.deliver([entry({ updatedAt: ts(NOW - 60000) })]);

    assert.strictEqual(PresenceStore.claim('2026-08-16', 'liturgy.hymn1'), true);
    PresenceStore.stop();
});

test('letting go frees the box', () => {
    const store = fakeStore();
    store.deliver([]);
    PresenceStore.claim('2026-08-16', 'liturgy.hymn1');

    PresenceStore.release();
    const last = store.writes[store.writes.length - 1];
    assert.strictEqual(last.fieldKey, null);
    assert.strictEqual(last.dateKey, null);
    PresenceStore.stop();
});

test('the beat keeps the box you are holding', () => {
    const store = fakeStore();
    store.deliver([]);
    PresenceStore.claim('2026-08-16', 'liturgy.hymn1');

    store.beat();
    const last = store.writes[store.writes.length - 1];
    assert.strictEqual(last.fieldKey, 'liturgy.hymn1',
        'the beat must re-assert the claim, not drop it');
    PresenceStore.stop();
});

test('the beat carries on when you hold nothing, so your face stays up', () => {
    const store = fakeStore();
    store.deliver([]);
    const before = store.writes.length;

    store.beat();
    assert.ok(store.writes.length > before);
    assert.strictEqual(store.writes[store.writes.length - 1].fieldKey, null);
    PresenceStore.stop();
});

test('moving to another box lets the first one go', () => {
    // One document per person is what makes this true without any extra work:
    // there is nowhere to hold two boxes at once.
    const store = fakeStore();
    store.deliver([]);
    PresenceStore.claim('2026-08-16', 'liturgy.hymn1');
    PresenceStore.claim('2026-08-16', 'liturgy.hymn2');

    const last = store.writes[store.writes.length - 1];
    assert.strictEqual(last.fieldKey, 'liturgy.hymn2');
    assert.deepStrictEqual(
        Object.keys(ServicePresence.claimsByBox([
            Object.assign({}, last, { uid: ME })
        ], 'someone-else', NOW)),
        ['2026-08-16|liturgy.hymn2'], 'only the new box is held');
    PresenceStore.stop();
});

test('presence failing does not take the page down', () => {
    // Without presence you simply cannot see the others. The editing still
    // works, which is the part that matters.
    let errorCb = null;
    const db = {
        collection() {
            return {
                doc() { return { set: () => Promise.resolve() }; },
                onSnapshot(onNext, onError) { errorCb = onError; return () => {}; }
            };
        }
    };
    let latest = 'untouched';
    PresenceStore.start({
        db, uid: ME, identity: { id: 'p-me', name: 'Bill' }, surface: 'calendar',
        stamp: () => ts(NOW), now: () => NOW,
        onChange: (e) => { latest = e; },
        setInterval: () => 1, clearInterval: () => {},
    });

    assert.doesNotThrow(() => errorCb(new Error('permission-denied')));
    assert.deepStrictEqual(latest, []);
    PresenceStore.stop();
});

// ── Presence must never be the reason a page stops working ────────────────
//
// It starts late: it waits on auth, and it used to wait on the signed-in user
// resolving to a Person. The editors wait for none of that. `state.now` began
// as null, the first cell to ask "is anyone in this box?" hit state.now(), and
// the TypeError took out the loop that attaches every edit handler — nothing
// editable, on both surfaces, with no visible error.
//
// The rule these pin: presence may remove a LOCK, never an EDITOR.

test('asking who holds a box before presence starts does not throw', () => {
    PresenceStore.stop();
    assert.doesNotThrow(() => PresenceStore.holder('2026-08-16', 'liturgy.hymn1'));
    assert.strictEqual(PresenceStore.holder('2026-08-16', 'liturgy.hymn1'), null);
});

test('with presence not running, every box opens', () => {
    // A claim that cannot be recorded is not a claim that should be denied.
    // The page simply has no locking — which is how it worked before this
    // feature, and infinitely better than a screen where nothing opens.
    PresenceStore.stop();
    assert.strictEqual(PresenceStore.claim('2026-08-16', 'liturgy.hymn1'), true);
});

test('letting go before presence starts is harmless', () => {
    PresenceStore.stop();
    assert.doesNotThrow(() => PresenceStore.release());
});

test('the other readers are safe before presence starts too', () => {
    PresenceStore.stop();
    assert.deepStrictEqual(PresenceStore.here(), []);
    assert.deepStrictEqual(PresenceStore.claims(), {});
});

test('an account with no Person record still gets presence', () => {
    // Gating the start on a resolved Person is what stopped it running at all
    // for such an account. A uid is all a claim needs; the name is cosmetic.
    const writes = [];
    PresenceStore.start({
        db: {
            collection: () => ({
                doc: () => ({ set(r) { writes.push(r); return Promise.resolve(); } }),
                onSnapshot: () => () => {},
            })
        },
        uid: ME,
        identity: null,
        surface: 'order-of-service',
        stamp: () => ts(NOW), now: () => NOW,
        setInterval: () => 1, clearInterval: () => {},
    });

    assert.strictEqual(writes.length, 1, 'it should still announce itself');
    assert.strictEqual(writes[0].personId, null);
    assert.strictEqual(PresenceStore.claim('2026-08-16', 'liturgy.hymn1'), true);
    assert.strictEqual(ServicePresence.holderLabel(writes[0]), 'Someone',
        'and read as somebody rather than as blank');
    PresenceStore.stop();
});

test('the Order of Service starts presence without waiting for a Person', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'service-builder.js'), 'utf8');
    const body = src.slice(src.indexOf('watchPresence() {'),
                           src.indexOf('watchPresence() {') + 700);

    assert.ok(!/if \(!this\.me/.test(body),
        'gating the start on a resolved Person is the bug this file records');
});

// ── Presence must not be able to make a page read-only ────────────────────
//
// It did, twice, and neither time looked like an error. Both callers start
// presence from inside the auth handler that also grants editing rights, and
// both of those handlers catch — so a throw in here skipped `can-edit` on the
// calendar and actively set `canEdit = false` on the Order of Service page.
// The symptom was "I cannot click into any input box".

test('the browser refusing a bare timer reference does not break the page', () => {
    // `state.setInterval = setInterval` then `state.setInterval(fn, ms)` is a
    // METHOD call, so `this` is the state object rather than the window — and
    // the browser's timers are WebIDL operations on Window that refuse a
    // foreign `this` with "Illegal invocation". Node's timers are plain
    // functions and do not care, which is exactly why every test here passed
    // while both pages were dead. This stands in for the browser.
    const hostile = function () {
        if (this !== globalThis) throw new TypeError('Illegal invocation');
        return 1;
    };

    assert.doesNotThrow(() => PresenceStore.start({
        db: {
            collection: () => ({
                doc: () => ({ set: () => Promise.resolve() }),
                onSnapshot: () => () => {},
            })
        },
        uid: ME,
        identity: { id: 'p-me', name: 'Bill Smith' },
        surface: 'calendar',
        stamp: () => ts(NOW), now: () => NOW,
        setInterval: hostile,
        clearInterval: () => {},
    }), 'starting presence must never throw at its caller');

    // And having failed, it must leave editing alone.
    assert.strictEqual(PresenceStore.claim('2026-08-16', 'liturgy.hymn1'), true);
    PresenceStore.stop();
});

test('the timers are wrapped rather than referenced', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'service-presence.js'), 'utf8');

    assert.ok(!/deps\.setInterval \|\| setInterval;/.test(src),
        'a bare reference is called with the wrong `this` in a browser');
    assert.match(src, /deps\.setInterval \|\|\s*\n?\s*function \(fn, ms\) \{ return setInterval\(fn, ms\); \}/);
});

test('anything else going wrong in start is contained too', () => {
    assert.doesNotThrow(() => PresenceStore.start({
        db: { collection() { throw new Error('rules refused'); } },
        uid: ME,
        identity: null,
        surface: 'calendar',
        stamp: () => ts(NOW), now: () => NOW,
    }));
    assert.strictEqual(PresenceStore.claim('2026-08-16', 'liturgy.hymn1'), true,
        'a failed start must leave every box open');
    PresenceStore.stop();
});

test('editing rights are granted before presence is started', () => {
    // Both blocks sit inside a try/catch, so anything above the grant that
    // throws is swallowed and the grant never lands — which does not look like
    // an error, it looks like a page where nothing can be clicked into.
    const fs = require('node:fs');
    const path = require('node:path');

    const calendar = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'service-calendar.js'), 'utf8');
    assert.ok(calendar.indexOf("document.body.classList.add('can-edit')")
              < calendar.indexOf('PresenceStore.start('),
        'the calendar must grant editing before it starts presence');

    const builder = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'service-builder.js'), 'utf8');
    const guard = builder.indexOf('this.canEdit = false;');
    const watch = builder.indexOf('if (this.canEdit) this.watchPresence();');
    assert.ok(watch > guard,
        'the Order of Service must start presence outside the catch that revokes editing');
});
