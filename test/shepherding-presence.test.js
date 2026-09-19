// MS-491 — Shepherding presence: one store per page, its own collection, and
// the three boxes on a Shepherding Profile.
//
// ⚠ The failure this file exists for is quiet: a store writes ONE record per
// person, named after them, so two stores on one page would each overwrite the
// other's claim and neither lock would hold. The profile and the Tasks tab
// inside it therefore share this one, and every component subscribes to it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { PresenceCore } = require('../public/presence-core.js');
const { ShepherdingPresence } = require('../public/shepherding-presence.js');

const NOW = 1_700_000_000_000;
const ME = 'uid-me';
function ts(ms) { return { toMillis: () => ms }; }

function fakeDb() {
    const names = [];
    const writes = [];
    let deliver = null;
    return {
        names, writes,
        deliver: (entries) => deliver({ forEach(fn) { entries.forEach(e => fn({ id: e.uid, data: () => e })); } }),
        db: {
            collection(name) {
                names.push(name);
                return {
                    doc: () => ({ set(r) { writes.push(r); return Promise.resolve(); }, delete: () => Promise.resolve() }),
                    onSnapshot(next) { deliver = next; return () => {}; },
                };
            },
        },
    };
}

function start(fake, extra = {}) {
    ShepherdingPresence.start(Object.assign({
        db: fake.db, uid: ME, identity: { id: 'p-me', name: 'Bill Smith' },
        surface: 'shepherding-profile', pageKey: 'p-bob',
        stamp: () => 'STAMP', now: () => NOW,
        setInterval: () => 1, clearInterval: () => {},
    }, extra));
}

test('the boxes name the record, never the page', () => {
    assert.deepStrictEqual(PresenceCore.shepherdingBox.note('p-bob', 'n1'),
        { scopeKey: 'person:p-bob', boxKey: 'note:n1' });
    assert.deepStrictEqual(PresenceCore.shepherdingBox.details('p-bob'),
        { scopeKey: 'person:p-bob', boxKey: 'details' });
    assert.deepStrictEqual(PresenceCore.shepherdingBox.task('t9'),
        { scopeKey: 'task:t9', boxKey: 'editor' });
});

test('Shepherding presence is written to its own collection, not the Order of Service\'s', () => {
    const fake = fakeDb();
    start(fake);
    assert.ok(fake.names.every(n => n === 'shepherding_presence'), fake.names.join(','));
    ShepherdingPresence.stop();
});

test('every component on the page hears the same presence', () => {
    const fake = fakeDb();
    start(fake);
    const profile = [];
    const tasksTab = [];
    const stopProfile = ShepherdingPresence.subscribe(e => profile.push(e.length));
    ShepherdingPresence.subscribe(e => tasksTab.push(e.length));

    fake.deliver([{ uid: 'uid-ann', personId: 'p-ann', name: 'Ann', surface: 'shepherding-profile', pageKey: 'p-bob', updatedAt: ts(NOW) }]);
    assert.strictEqual(profile[profile.length - 1], 1);
    assert.strictEqual(tasksTab[tasksTab.length - 1], 1);

    stopProfile();
    fake.deliver([]);
    assert.strictEqual(profile[profile.length - 1], 1, 'an unsubscribed component hears nothing more');
    assert.strictEqual(tasksTab[tasksTab.length - 1], 0);
    ShepherdingPresence.stop();
});

test('a note held on the page is found by any component asking, with the idle rule', () => {
    const box = PresenceCore.shepherdingBox.note('p-bob', 'n1');
    const typing = { uid: 'uid-ann', name: 'Ann Lee', scopeKey: box.scopeKey, boxKey: box.boxKey,
        updatedAt: ts(NOW - 1000), activeAt: ts(NOW - 1000) };
    const quiet = Object.assign({}, typing, { activeAt: ts(NOW - 61000) });
    assert.strictEqual(ShepherdingPresence.holderIn([typing], ME, box, NOW).name, 'Ann Lee');
    assert.strictEqual(ShepherdingPresence.holderIn([quiet], ME, box, NOW), null);
});

test('with presence not running, every Shepherding editor still opens', () => {
    ShepherdingPresence.stop();
    assert.strictEqual(ShepherdingPresence.claimBox(PresenceCore.shepherdingBox.details('p-bob')), true);
    assert.strictEqual(ShepherdingPresence.touch(), true);
});

// ── The rule ─────────────────────────────────────────────────────────────────

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

function block(name) {
    const m = rules.match(new RegExp('match \\/' + name + '\\/\\{uid\\}\\s*\\{([\\s\\S]*?)\\n    \\}'));
    assert.ok(m, name + ' rules are missing');
    return m[1];
}

test('only elders can read Shepherding presence', () => {
    const b = block('shepherding_presence');
    assert.match(b, /allow read: if readsAsElder\(\);/,
        'a Shepherding claim says which person an elder is looking at');
    assert.doesNotMatch(b, /readsAsEditor\(\)|isEditor\(\)/, 'editors must not learn where elders are looking');
});

test('nobody can write somebody else\'s Shepherding presence', () => {
    const b = block('shepherding_presence');
    assert.match(b, /allow write, delete: if isElder\(\) && request\.auth\.uid == uid;/);
});

test('the Order of Service presence rule is unchanged', () => {
    const b = block('presence');
    assert.match(b, /allow read: if readsAsEditor\(\);/);
    assert.match(b, /allow write, delete: if isEditor\(\) && request\.auth\.uid == uid;/);
});
