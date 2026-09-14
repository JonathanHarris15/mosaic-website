// MS-482 — one way to read data live, that still works where live can't.
//
// A Firestore listener is the obvious way to keep a page current, and on the
// web it is the whole story. Inside the phone app it may not be: local-cache.js
// records the listen stream hanging in the Capacitor WebView — no error, just
// silence. A page that waits on that silence shows nothing, forever.
//
// So the phone gives a listener five seconds to answer. If it does not, the
// page re-reads instead, every few seconds, and nobody has to know which one
// they got. The property this file exists to protect: A PAGE IS NEVER LEFT
// BLANK WAITING ON A STREAM THAT WILL NOT ANSWER.

const { test } = require('node:test');
const assert = require('node:assert');

const LiveRead = require('../public/live-read.js');

// ── A fake clock, a fake page, a fake query ──────────────────────────────────

function clock() {
    let now = 0;
    let seq = 0;
    const timers = new Map();
    return {
        setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
        clearTimeout(id) { timers.delete(id); },
        now: () => now,
        pending: () => timers.size,
        advance(ms) {
            const until = now + ms;
            for (;;) {
                let next = null;
                for (const [id, t] of timers) {
                    if (t.at <= until && (!next || t.at < next[1].at)) next = [id, t];
                }
                if (!next) break;
                timers.delete(next[0]);
                now = next[1].at;
                next[1].fn();
            }
            now = until;
        },
    };
}

function page() {
    const listeners = [];
    const store = new Map();
    return {
        hidden: false,
        addEventListener(type, fn) { if (type === 'visibilitychange') listeners.push(fn); },
        removeEventListener(type, fn) {
            const i = listeners.indexOf(fn);
            if (i !== -1) listeners.splice(i, 1);
        },
        setHidden(h) { this.hidden = h; listeners.slice().forEach(fn => fn()); },
        listenerCount: () => listeners.length,
        storage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k),
        },
    };
}

// A document-shaped snapshot. Everything the helper needs from one is its data.
function snap(value) {
    return { exists: true, id: 'doc', data: () => value };
}

function query(opts = {}) {
    const q = {
        listening: 0,
        unsubscribed: 0,
        reads: 0,
        next: null,
        error: null,
        value: opts.value || { n: 1 },
        onSnapshot(onNext, onError) {
            q.listening++;
            q.next = onNext;
            q.error = onError;
            return () => { q.unsubscribed++; q.next = null; };
        },
        get() {
            q.reads++;
            return Promise.resolve(snap(q.value));
        },
    };
    return q;
}

function helper(env = {}) {
    const c = clock();
    const p = page();
    const logs = [];
    const live = LiveRead.create(Object.assign({
        isNativeApp: () => false,
        setTimeout: c.setTimeout,
        clearTimeout: c.clearTimeout,
        document: p,
        storage: p.storage,
        log: (line) => logs.push(line),
    }, env));
    return { live, clock: c, page: p, logs };
}

const settle = () => new Promise(r => setImmediate(r));

// ── The web ──────────────────────────────────────────────────────────────────

test('on the web a watch is a listener, and nothing else', async () => {
    const { live, clock: c } = helper();
    const q = query();
    const seen = [];
    live.watch(q, s => seen.push(s.data()), { fallbackEveryMs: 3000 });

    c.advance(60000);
    await settle();

    assert.strictEqual(q.listening, 1);
    assert.strictEqual(q.reads, 0, 'a browser must never fall back to re-reading on a timer');
    q.next(snap({ n: 2 }));
    assert.deepStrictEqual(seen, [{ n: 2 }]);
});

test('the setting cannot move the web off a listener', async () => {
    const { live, clock: c, page: p } = helper();
    p.storage.setItem(LiveRead.MODE_KEY, 'reread');
    const q = query();
    live.watch(q, () => {}, { fallbackEveryMs: 3000 });
    c.advance(10000);
    await settle();
    assert.strictEqual(q.reads, 0);
});

// ── The phone ────────────────────────────────────────────────────────────────

test('in the app, a listener that answers is kept', async () => {
    const { live, clock: c } = helper({ isNativeApp: () => true });
    const q = query();
    live.watch(q, () => {}, { fallbackEveryMs: 3000 });

    c.advance(1000);
    q.next(snap({ n: 1 }));
    c.advance(30000);
    await settle();

    assert.strictEqual(q.unsubscribed, 0);
    assert.strictEqual(q.reads, 0);
    assert.strictEqual(live.status().mode, 'live');
});

test('in the app, a listener silent for five seconds is replaced by re-reading', async () => {
    const { live, clock: c } = helper({ isNativeApp: () => true });
    const q = query();
    const seen = [];
    live.watch(q, s => seen.push(s.data()), { fallbackEveryMs: 3000 });

    c.advance(4999);
    await settle();
    assert.strictEqual(q.reads, 0, 'five seconds is the wait, not less');

    c.advance(1);
    await settle();
    assert.strictEqual(q.unsubscribed, 1, 'the silent listener is dropped');
    assert.strictEqual(q.reads, 1, 'and the page is answered straight away');
    assert.deepStrictEqual(seen, [{ n: 1 }]);

    q.value = { n: 2 };
    c.advance(3000);
    await settle();
    assert.strictEqual(q.reads, 2, 'then again at the interval the caller asked for');
    assert.deepStrictEqual(seen, [{ n: 1 }, { n: 2 }]);
    assert.strictEqual(live.status().mode, 'reread');
});

test('a roster list re-reads at its own slower pace', async () => {
    const { live, clock: c } = helper({ isNativeApp: () => true });
    const q = query();
    live.watch(q, () => {}, { fallbackEveryMs: LiveRead.ROSTER_EVERY_MS });
    c.advance(5000);
    await settle();
    c.advance(29000);
    await settle();
    assert.strictEqual(q.reads, 1);
    c.advance(1000);
    await settle();
    assert.strictEqual(q.reads, 2);
});

test('an unchanged re-read does not redraw the page', async () => {
    // Re-reading every three seconds must not re-render a profile every three
    // seconds — that would close menus and jump scroll for no reason.
    const { live, clock: c } = helper({ isNativeApp: () => true });
    const q = query();
    let calls = 0;
    live.watch(q, () => { calls++; }, { fallbackEveryMs: 3000 });
    c.advance(5000);
    await settle();
    for (let i = 0; i < 3; i++) { c.advance(3000); await settle(); }
    assert.ok(q.reads >= 3);
    assert.strictEqual(calls, 1);
});

test('re-reading pauses while the app is in the background, and catches up on return', async () => {
    const { live, clock: c, page: p } = helper({ isNativeApp: () => true });
    const q = query();
    live.watch(q, () => {}, { fallbackEveryMs: 3000 });
    c.advance(5000);
    await settle();
    const before = q.reads;

    p.setHidden(true);
    c.advance(30000);
    await settle();
    assert.strictEqual(q.reads, before, 'nothing is read while nobody can see it');

    p.setHidden(false);
    await settle();
    assert.strictEqual(q.reads, before + 1, 'coming back reads at once');
});

test('unsubscribing stops the listener and the re-reading both', async () => {
    const { live, clock: c, page: p } = helper({ isNativeApp: () => true });
    const listening = query();
    const stopListening = live.watch(listening, () => {}, { fallbackEveryMs: 3000 });
    stopListening();
    assert.strictEqual(listening.unsubscribed, 1);
    c.advance(10000);
    await settle();
    assert.strictEqual(listening.reads, 0, 'a stopped watch must not fall back later');

    const rereading = query();
    const stopRereading = live.watch(rereading, () => {}, { fallbackEveryMs: 3000 });
    c.advance(5000);
    await settle();
    const before = rereading.reads;
    stopRereading();
    c.advance(30000);
    await settle();
    assert.strictEqual(rereading.reads, before);
    assert.strictEqual(p.listenerCount(), 0, 'and it stops watching the page too');
    assert.strictEqual(c.pending(), 0);
});

test('the setting can send the app straight to re-reading', async () => {
    const { live, clock: c, page: p } = helper({ isNativeApp: () => true });
    p.storage.setItem(LiveRead.MODE_KEY, 'reread');
    const q = query();
    live.watch(q, () => {}, { fallbackEveryMs: 3000 });
    await settle();
    assert.strictEqual(q.listening, 0, 'no five-second wait once the answer is known');
    assert.strictEqual(q.reads, 1);
});

test('the setting can hold the app on a listener however long it takes', async () => {
    const { live, clock: c, page: p } = helper({ isNativeApp: () => true });
    p.storage.setItem(LiveRead.MODE_KEY, 'live');
    const q = query();
    live.watch(q, () => {}, { fallbackEveryMs: 3000 });
    c.advance(60000);
    await settle();
    assert.strictEqual(q.reads, 0);
    assert.strictEqual(q.unsubscribed, 0);
});

// ── When the listener fails outright ─────────────────────────────────────────

test('a listener error falls back to re-reading rather than leaving the page blank', async () => {
    const { live, clock: c } = helper();
    const q = query();
    const errors = [];
    const seen = [];
    live.watch(q, s => seen.push(s.data()), {
        fallbackEveryMs: 3000,
        onError: e => errors.push(e.code),
    });
    q.error(Object.assign(new Error('stream broke'), { code: 'unavailable' }));
    await settle();

    assert.deepStrictEqual(errors, ['unavailable'], 'the caller still hears about it');
    assert.strictEqual(q.reads, 1);
    assert.deepStrictEqual(seen, [{ n: 1 }]);
});

test('being refused is reported, not retried every three seconds', async () => {
    const { live, clock: c } = helper();
    const q = query();
    const errors = [];
    live.watch(q, () => {}, { fallbackEveryMs: 3000, onError: e => errors.push(e.code) });
    q.error(Object.assign(new Error('no'), { code: 'permission-denied' }));
    c.advance(30000);
    await settle();
    assert.deepStrictEqual(errors, ['permission-denied']);
    assert.strictEqual(q.reads, 0);
});

// ── Saying which one it got ──────────────────────────────────────────────────

test('the mode chosen is said out loud, once', async () => {
    const { live, clock: c, logs } = helper({ isNativeApp: () => true });
    const a = query();
    const b = query();
    live.watch(a, () => {}, { fallbackEveryMs: 3000 });
    live.watch(b, () => {}, { fallbackEveryMs: 3000 });
    c.advance(5000);
    await settle();
    assert.strictEqual(logs.filter(l => /re-read/.test(l)).length, 1);
    assert.strictEqual(live.status().mode, 'reread');
    assert.strictEqual(live.status().native, true);
    assert.strictEqual(live.status().setting, 'auto');
});

test('the helper waits to be asked before deciding anything', () => {
    const { live } = helper({ isNativeApp: () => true });
    assert.strictEqual(live.status().mode, 'pending');
});

// ── The transport ────────────────────────────────────────────────────────────

test('the phone app moves the stream off fetch; a browser keeps its transport', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'local-cache.js'), 'utf8');

    function loadCache(win) {
        const module = { exports: {} };
        return new Function('window', 'module', src + '\nreturn window.MosaicLocalCache;')(
            Object.assign({ localStorage: page().storage }, win), module);
    }
    function fakeDb() {
        const calls = [];
        return { calls, settings(s) { calls.push(s); }, enablePersistence: () => Promise.resolve() };
    }

    const phone = fakeDb();
    loadCache({ MOSAIC_MOBILE_APP: true }).enable(phone);
    assert.deepStrictEqual(phone.calls, [{ useFetchStreams: false, merge: true }]);

    const browser = fakeDb();
    loadCache({}).enable(browser);
    assert.deepStrictEqual(browser.calls, []);
});
