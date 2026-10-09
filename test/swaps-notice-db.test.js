const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// MS-723: the dashboard swap line asked for window.db, which auth.js never
// sets — its `const db` is a global binding, not a window property. Played
// here the way a browser does it: two classic scripts in one realm, the
// first declaring `const db`, so the second can see the binding while
// window.db stays undefined.

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'swaps-notice.js'), 'utf8');

function realm() {
    const listeners = {};
    const seen = { dbArg: 'never called', mounted: null };
    const main = {
        querySelector: () => null,
        insertBefore: (el) => { seen.mounted = el; },
        firstChild: null,
    };
    const ctx = {
        console: { warn: () => {}, log: () => {}, error: () => {} },
        document: {
            querySelector: (s) => (s === 'main' ? main : null),
            createElement: () => ({}),
        },
        getUserData: async () => ({ personId: 'p1' }),
        auth: { onAuthStateChanged: (cb) => { listeners.auth = cb; } },
    };
    ctx.window = ctx;
    ctx.addEventListener = (name, cb) => { listeners[name] = cb; };
    ctx.TradesStore = {
        loadMine: async (db) => {
            seen.dbArg = db;
            if (!db) throw new Error('no db');
            return { all: [] };
        },
    };
    ctx.TradesView = { rowsFor: () => ({ yours: [1], ended: [] }) };
    vm.createContext(ctx);
    return { ctx, listeners, seen };
}

async function signIn(r) {
    r.listeners.DOMContentLoaded();
    await r.listeners.auth({ uid: 'u1' });
}

test('the swap count reads through auth.js\'s `const db`, not window.db', async () => {
    const r = realm();
    vm.runInContext("const db = { name: 'the-db' };", r.ctx);
    vm.runInContext(src, r.ctx);
    assert.equal(r.ctx.db, undefined, 'window.db really is undefined in a browser');
    await signIn(r);
    assert.equal(r.seen.dbArg && r.seen.dbArg.name, 'the-db');
    assert.ok(r.seen.mounted, 'the line is mounted');
    assert.match(r.seen.mounted.innerHTML, /A swap is waiting on your answer/);
});

test('with no Firestore at all it stays silent instead of throwing', async () => {
    const r = realm();
    vm.runInContext(src, r.ctx);
    await signIn(r);
    assert.equal(r.seen.dbArg, 'never called');
    assert.equal(r.seen.mounted, null);
});
