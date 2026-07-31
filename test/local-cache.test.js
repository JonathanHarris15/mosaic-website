const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The on-device cache (public/local-cache.js) — why the phone app stopped
// re-fetching everything on every screen.
//
// The behaviour here is easy to undo without noticing, because undoing it
// breaks nothing visible: the app still works, it is just slow again. Two of
// these in particular have no other alarm.

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (...p) => fs.readFileSync(path.join(PUBLIC, ...p), 'utf8');

// Rebuild the module in isolation with a fake `window`, so the pure parts can
// be exercised without Firebase.
//
// The cache ships OFF (see CACHE_ENABLED in local-cache.js — it hangs the
// WebView). The behaviour it gates still has to be right for the day it goes
// back on, so tests that exercise it flip the flag in the source they load.
// Nothing else can reach it: it is a local inside the module's closure.
function load(win, opts) {
    let src = read('local-cache.js');
    if (opts && opts.cacheOn) {
        const flag = 'var CACHE_ENABLED = false;';
        assert.ok(src.includes(flag), 'the CACHE_ENABLED switch has been renamed or reshaped');
        src = src.replace(flag, 'var CACHE_ENABLED = true;');
    }
    // The read deadline is six seconds in production, which is six seconds too
    // long for a test suite. Same trick as CACHE_ENABLED above: it is a local
    // in the module's closure, so the source is where it can be reached.
    if (opts && opts.deadlineMs) {
        const line = 'var DEADLINE_MS = 6000;';
        assert.ok(src.includes(line), 'the read deadline has been renamed or reshaped');
        src = src.replace(line, `var DEADLINE_MS = ${opts.deadlineMs};`);
    }
    const globals = Object.assign({ localStorage: mockStorage() }, win);
    const module = { exports: {} };
    const fn = new Function('window', 'module', src + '\nreturn window.MosaicLocalCache;');
    return fn(globals, module);
}

function mockStorage() {
    const map = new Map();
    return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k),
    };
}

test('the cache only ever engages on the phone, never on the web', () => {
    // The whole trade — a screen may show data a few seconds old — was accepted
    // for the phone alone. A desktop tab is left open on a real connection and
    // has nothing to gain, so if this leaks to the web it is a behaviour change
    // nobody agreed to.
    assert.equal(load({}).isMobile(), false, 'a plain browser is treated as mobile');
    assert.equal(load({ MOSAIC_MOBILE_APP: true }).isMobile(), true);
    assert.equal(load({ MOSAIC_SHELL: 'mobile' }).isMobile(), true);
    assert.equal(load({ Capacitor: {} }).isMobile(), true);
    assert.equal(load({ MOSAIC_SHELL: 'web' }).isMobile(), false);
});

test('signing out forgets who you were', () => {
    // Otherwise the next person to open the app on this phone starts their
    // first page holding the last person's rank — which decides what the
    // Calendar even queries for.
    const Cache = load({ MOSAIC_MOBILE_APP: true });
    Cache.writeIdentity('uid-1', { personId: 'p1', permissionLevel: 'elder' });
    assert.equal(Cache.readIdentity('uid-1').permissionLevel, 'elder');

    Cache.clearIdentity();
    assert.equal(Cache.readIdentity('uid-1'), null, 'the old rank survived a sign-out');

    // And it is never handed to a different account even if it is still there.
    Cache.writeIdentity('uid-1', { personId: 'p1', permissionLevel: 'elder' });
    assert.equal(Cache.readIdentity('uid-2'), null, 'one account read another account rank');

    // The mobile-only rule holds here too.
    const web = load({});
    web.writeIdentity('uid-1', { personId: 'p1', permissionLevel: 'elder' });
    assert.equal(web.readIdentity('uid-1'), null, 'the web is remembering a rank');

    assert.match(read('mobile', 'data.js'), /Cache\.clearIdentity\(\);\s*\n\s*return auth\.signOut\(\)/,
        'signOut no longer clears the remembered identity');
});

test('persistence is switched on before anything else touches Firestore', () => {
    // Firestore REQUIRES enablePersistence to precede every other call on the
    // handle. Slide one read above it and persistence throws for the whole
    // session — silently, since the app falls back to working-but-slow.
    for (const file of [['auth.js'], ['mobile', 'data.js']]) {
        const src = read(...file);
        const handle = src.search(/(const|var) db = firebase\.firestore\(\);/);
        const enable = src.search(/MosaicLocalCache[\s\S]{0,40}?\.enable\(db\)|Cache\.enable\(db\)/);
        assert.ok(handle >= 0, `${file.join('/')}: no Firestore handle found`);
        assert.ok(enable > handle, `${file.join('/')}: enable(db) does not follow firebase.firestore()`);

        const between = src.slice(handle, enable);
        assert.ok(!/db\.collection\(|db\.doc\(/.test(between),
            `${file.join('/')}: a read sneaks in before persistence is enabled`);
    }
});

test('the transport is forced to long polling before the cache is switched on', () => {
    // Regression, and an expensive one to diagnose: turning the cache on makes
    // Firestore open a listen stream to keep it in sync. No page here uses
    // onSnapshot, so nothing had ever opened one — and inside the Capacitor
    // WebView (origin capacitor://localhost) that stream is refused by CORS.
    // It does not fail, it HANGS, so the read never settles and the page spins
    // forever. Long polling is the transport the WebView will actually make.
    const src = read('local-cache.js');
    assert.match(src, /experimentalForceLongPolling: true/,
        'the WebChannel transport is back, and it hangs inside the WebView');
    assert.ok(!/experimentalAutoDetectLongPolling/.test(src),
        'auto-detect tries the WebChannel first, and here it hangs rather than failing fast');

    const transport = src.search(/configureTransport\(db\);/);
    const persist = src.search(/db\.enablePersistence\(/);
    assert.ok(transport >= 0 && transport < persist,
        'the transport must be set before persistence, or the first sync uses the blocked one');
});

test('a cache-first read still asks the server in the background', () => {
    // This is the half that is easy to lose. Reading from the cache and NOT
    // refreshing means the app gets fast and then never updates again — the
    // failure mode is stale data that outlives the app being reopened.
    const src = read('local-cache.js');
    assert.match(src, /source: "cache"/, 'reads no longer prefer the device');
    assert.match(src, /source: "server"/, 'nothing refreshes the cache afterwards');
    assert.match(src, /refresh\(call\);\s*\n\s*return snap;/,
        'a cache hit is returned without kicking off a refresh');
});

test('an empty cache result is a miss, not an answer', () => {
    // Firestore cannot distinguish "this query has no results" from "this query
    // has never run" when reading from cache. Trusting the empty one shows an
    // empty People directory to somebody who simply has not opened it yet.
    assert.match(read('local-cache.js'), /if \(empty\) return call\(\);/,
        'an empty cache result is being served as though it were the answer');
});

// Rebuild the module and patch a pair of fake Firestore prototypes, so the
// interception can be exercised without the SDK.
function fakeFirebase() {
    function Query() {}
    Query.prototype.get = function (options) {
        this.calls.push(options ? options.source : 'plain');
        return Promise.resolve({ empty: false, size: 1 });
    };
    function CollectionReference() {}
    CollectionReference.prototype = Object.create(Query.prototype); // inherits get
    function DocumentReference() {}
    DocumentReference.prototype.get = Query.prototype.get;
    return { firestore: { Query, CollectionReference, DocumentReference } };
}

test('a read that states what it wants is never intercepted', () => {
    // This is the whole safety valve. Every read whose result decides a write
    // opts out by passing { source: 'server' }; if the patch stopped honouring
    // that, those reads would silently start planning writes from cached data.
    const Cache = load({ MOSAIC_MOBILE_APP: true }, { cacheOn: true });
    const fb = fakeFirebase();
    assert.equal(Cache.interceptReads(fb), true, 'nothing was patched');

    const q = new fb.firestore.Query();
    q.calls = [];
    return q.get({ source: 'server' }).then(() => {
        assert.deepEqual(q.calls, ['server'],
            'an explicit source was rewritten by the cache layer');
    });
});

test('the interception is phone-only and never double-wraps', () => {
    const web = fakeFirebase();
    assert.equal(load({}, { cacheOn: true }).interceptReads(web), false, 'the web got patched');

    // A collection reference INHERITS Query.get. Patching the inherited copy as
    // though it were its own would wrap every collection read twice.
    const fb = fakeFirebase();
    const Cache = load({ MOSAIC_MOBILE_APP: true }, { cacheOn: true });
    Cache.interceptReads(fb);
    Cache.interceptReads(fb); // a second page load must be a no-op
    assert.ok(fb.firestore.Query.prototype.get.__mosaicCacheFirst);
    assert.ok(!Object.prototype.hasOwnProperty.call(fb.firestore.CollectionReference.prototype, 'get'),
        'the inherited get was patched separately, double-wrapping collection reads');
});

test('every read that decides a write asks the server', () => {
    // Found by hand once (grep for a .get() feeding a batch). If a new one is
    // added without FRESH_READ it plans a write from data that may be a minute
    // old — deletes computed from a stale list, a merge that drops whoever was
    // added in between. Nothing else in the codebase would notice.
    const sites = [
        ['profile.js', 3],                 // user↔person link: old + new person, and the user doc
        ['service-builder.js', 2],         // clearing involvements, and a baptism date
        ['service-calendar.js', 1],        // clearing involvements
        ['shepherding-profile.js', 3],     // deleting notes, activity, and status/tag history
        ['shepherding-relationships.js', 1], // re-projecting a shared type
        ['shepherding-tags.js', 4],        // merge carriers + their activity, and both hide-people sweeps
        ['peoples-page.js', 2],            // merging two people's sub-collections
    ];
    for (const [file, expected] of sites) {
        const src = read(file);
        assert.match(src, /var FRESH_READ = \{ source: 'server' \};/,
            `${file}: FRESH_READ is used but never declared`);
        const used = (src.match(/\.get\(FRESH_READ\)/g) || []).length;
        assert.equal(used, expected,
            `${file}: expected ${expected} write-feeding reads pinned to the server, found ${used}`);
    }
});

test('FRESH_READ is declared with var, because these pages share a global scope', () => {
    // shepherding-tags.html loads shepherding-tags.js AND
    // shepherding-relationships.js, neither of which is wrapped in a function.
    // Two `const FRESH_READ` declarations in that shared scope is not a subtle
    // bug — it is a SyntaxError that stops the whole page dead.
    for (const file of ['shepherding-tags.js', 'shepherding-relationships.js']) {
        assert.ok(!/(const|let) FRESH_READ/.test(read(file)),
            `${file}: a block-scoped FRESH_READ collides with the other script on the page`);
    }
});

test('launch warms the cache, and never blocks the app on it', () => {
    // The whole point: spend the wait once, at launch, where it is expected.
    const data = read('mobile', 'data.js');
    assert.match(data, /function warmCache/, 'nothing warms the cache at launch');
    assert.match(data, /warmed = true;/, 'the warm can run more than once per launch');
    assert.match(data, /\.catch\(function \(\) \{\}\);\s*\n\s*\}/,
        'a failed warm can reject and take the launch with it');

    const app = read('mobile', 'app.js');
    assert.match(app, /if \(u && data\.warmCache\) data\.warmCache\(u\);/,
        'signing in no longer warms the cache');
    assert.ok(!/await data\.warmCache|warmCache\(u\)\.then/.test(app),
        'the UI waits on the warm instead of letting it run behind the app');
});

test('the cache ships off, and nothing touches Firestore while it is', () => {
    // It hangs the WebView (see CACHE_ENABLED). Until that is solved and
    // verified in the native app, the CACHE half must stay inert: persistence
    // unset, the Firestore handle unconfigured, and no read ever answered from
    // the device.
    //
    // The prototypes ARE patched now, which they were not before — the read
    // deadline below rides on the same interception. So the thing to hold is
    // no longer "nothing is patched", it is "nothing is CACHED": a read must
    // still go to the server exactly as it did before any of this existed.
    const src = read('local-cache.js');
    assert.match(src, /var CACHE_ENABLED = false;/,
        'the cache is on again — it must be verified on the Roles Manager in the native app first');

    const Cache = load({ MOSAIC_MOBILE_APP: true });
    const fb = fakeFirebase();
    Cache.interceptReads(fb);

    const q = new fb.firestore.Query();
    q.calls = [];
    return q.get().then(() => {
        assert.deepEqual(q.calls, ['plain'],
            'a read was answered from the device while the cache is supposed to be off');

        let touched = false;
        const db = { enablePersistence: () => { touched = true; return Promise.resolve(); },
                     settings: () => { touched = true; } };
        return Cache.enable(db).then(on => {
            assert.equal(on, false, 'persistence was switched on');
            assert.equal(touched, false, 'the Firestore handle was configured anyway');
        });
    });
});

// ── The read that never answers ─────────────────────────────────────────────
//
// Measured on a phone: a query started and had still not answered 25 seconds
// later, while the same query took 94ms a minute earlier and the page's own
// timers kept firing throughout. It did not fail. It never settled — so the
// screen waited on a promise that was never going to resolve, which is the
// "sometimes it takes 15+ seconds to load".
//
// auth.js already retries a read that REJECTS. Nothing could retry this one:
// there is no event to hang a retry on.

function hangs() { return new Promise(() => {}); }

test('a read that never answers is asked again', () => {
    const Cache = load({ MOSAIC_MOBILE_APP: true }, { deadlineMs: 30 });
    let attempt = 0;
    return Cache.guardRead(() => (++attempt === 1 ? hangs() : Promise.resolve('answer')))
        .then(v => {
            assert.equal(v, 'answer', 'the retry never happened, so the screen waits forever');
            assert.equal(attempt, 2);
        });
});

test('a read that never answers AT ALL gives up rather than hanging', () => {
    // Giving up is not defeat — `deadline-exceeded` is already in auth.js's
    // retryable list and already caught by its boot guard, so the page recovers
    // or says it could not load. Both beat a spinner with no end.
    const Cache = load({ MOSAIC_MOBILE_APP: true }, { deadlineMs: 20 });
    return Cache.guardRead(hangs).then(
        () => assert.fail('a read that never answered resolved anyway'),
        err => assert.equal(err.code, 'deadline-exceeded',
            'the failure does not carry a code the existing retry machinery knows'));
});

test('a slow read is never cancelled — whoever answers first wins', () => {
    // The deadline cannot tell a DROPPED read from a merely slow one, and
    // cancelling would turn every slow read on a bad connection into a failure.
    // So passing the deadline starts a SECOND read alongside the first rather
    // than replacing it, and the first one to answer is the answer.
    //
    // Here the retry is the one that hangs, and the original — already past its
    // deadline — still wins. The total wait is still bounded: answer nothing by
    // deadline × attempts and it gives up (see the test above).
    const Cache = load({ MOSAIC_MOBILE_APP: true }, { deadlineMs: 20 });
    let attempt = 0;
    return Cache.guardRead(() => {
        return ++attempt === 1
            ? new Promise(r => setTimeout(() => r('the slow one'), 30))
            : hangs();
    }).then(v => assert.equal(v, 'the slow one', 'a slow read was abandoned instead of awaited'));
});

test('a read that FAILS is passed straight through, not retried here', () => {
    // Rejection is the old, handled path — auth.js retries the transient ones
    // and refuses to retry permission-denied, which means the same thing on the
    // third attempt as the first. Retrying here too would double every one of
    // those waits and make being refused slower.
    const Cache = load({ MOSAIC_MOBILE_APP: true }, { deadlineMs: 30 });
    let attempt = 0;
    const denied = Object.assign(new Error('nope'), { code: 'permission-denied' });
    return Cache.guardRead(() => { attempt++; return Promise.reject(denied); }).then(
        () => assert.fail('a refused read resolved'),
        err => {
            assert.equal(err.code, 'permission-denied', 'the original failure was swallowed');
            assert.equal(attempt, 1, 'a refusal was retried');
        });
});

test('a healthy read is not doubled', () => {
    // The guard costs a duplicate read when it fires, so it must not fire for
    // reads that are simply working.
    const Cache = load({ MOSAIC_MOBILE_APP: true }, { deadlineMs: 30 });
    let attempt = 0;
    return Cache.guardRead(() => { attempt++; return Promise.resolve('quick'); })
        .then(v => {
            assert.equal(v, 'quick');
            assert.equal(attempt, 1, 'a working read was issued twice');
        });
});

test('the deadline reaches every read site, including the ones passing options', () => {
    // The ~130 read sites across the shell pages were written before any of
    // this existed and none of them opt in. The patch is how they are covered —
    // and a read that states { source: 'server' } can hang exactly like any
    // other, so the deadline applies there too even though the CACHE steps
    // aside for it.
    const Cache = load({ MOSAIC_MOBILE_APP: true }, { deadlineMs: 20 });
    const fb = fakeFirebase();

    // The real read underneath: hangs the first time it is asked, whatever the
    // caller stated it wanted.
    let attempts = 0;
    fb.firestore.DocumentReference.prototype.get = function (options) {
        this.calls.push(options ? options.source : 'plain');
        return ++attempts === 1 ? hangs() : Promise.resolve({ exists: true });
    };
    assert.equal(Cache.interceptReads(fb), true, 'nothing was patched, so nothing is guarded');

    const doc = new fb.firestore.DocumentReference();
    doc.calls = [];
    return doc.get({ source: 'server' }).then(snap => {
        assert.ok(snap.exists, 'the read never recovered');
        assert.equal(attempts, 2, 'a hung read that stated its source was left to hang');
        assert.deepEqual(doc.calls, ['server', 'server'],
            'the retry asked for something different from what the caller wanted');
    });
});
