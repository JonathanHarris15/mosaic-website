const { test } = require('node:test');
const assert = require('node:assert');

// RoleEditorCore — the session that saves one Role as it is changed, and the
// pure pieces around it (what a draft is, what it stores as, whether a new
// name may be created). The page (roles-manager.js) only opens a session per
// Role and draws what it says, so the rules about what reaches /roles are
// pinned here, against a store that records every write.
//
// ⚠ The bug this module exists for: opening Role B, or creating one, wrote B
// over whichever Role was open — the old session was flushed with the page's
// draft after it had already become B's.

global.window = global;
const Roles = require('../public/roles-core.js');
const RoleEditor = require('../public/role-editor-core.js');

const def = (id, name, extra) => Object.assign({
    id, name, slug: Roles.slugify(name), family: 'servant',
    slots: [{ id: 's1', requirement: 'either' }], nextSlotSeq: 2,
    restrictions: [], intensity: 1, allowsAnotherRole: false, description: name + ' notes',
}, extra || {});

// A store that remembers every update, can be made to fail, and can hold a
// write open so a test can do things while it is in flight.
function recordingStore() {
    const writes = [];
    let fail = null;
    let hold = null;
    return {
        writes,
        failNext(e) { fail = e || new Error('network down'); },
        holdNext() { let release; hold = new Promise(r => { release = r; }); return () => release(); },
        async update(id, patch) {
            writes.push({ id, patch: JSON.parse(JSON.stringify(patch)) });
            if (hold) { const h = hold; hold = null; await h; }
            if (fail) { const e = fail; fail = null; throw e; }
        },
    };
}

// Timers the test runs by hand, so the debounce is deterministic.
function manualTimers() {
    let next = 1;
    const due = new Map();
    return {
        setTimeout: (fn) => { const id = next++; due.set(id, fn); return id; },
        clearTimeout: (id) => { due.delete(id); },
        runAll() { const fns = [...due.values()]; due.clear(); fns.forEach(fn => fn()); },
        get pending() { return due.size; },
    };
}

function open(role, extra) {
    const store = recordingStore();
    const timers = manualTimers();
    const states = [];
    const saved = [];
    const failed = [];
    const session = RoleEditor.openSession(Object.assign({
        role, store, timers,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        onState: st => states.push(st),
        onSaved: (id, w) => saved.push({ id, w }),
        onFailed: (id, e) => failed.push({ id, e }),
    }, extra || {}));
    return { session, store, timers, states, saved, failed };
}

const tick = () => new Promise(r => setImmediate(r));

// ── The session belongs to one Role ──────────────────────────────────────────

test('a session refuses values handed in for any other Role', async () => {
    const { session, store } = open(def('r1', 'Coffee'));
    const other = RoleEditor.draftFrom(def('r2', 'Setup'));
    assert.equal(session.edit('r2', other), false);
    assert.deepStrictEqual(session.state.dirty, []);
    await session.close();
    assert.deepStrictEqual(store.writes, [], 'nothing was written to Coffee');
});

test('a session writes only its own Role, from its own values', async () => {
    const { session, store } = open(def('r1', 'Coffee'));
    session.edit('r1', Object.assign(RoleEditor.draftFrom(def('r1', 'Coffee')), { name: 'Coffee Team' }));
    await session.flush();
    assert.deepStrictEqual(store.writes, [{ id: 'r1', patch: { name: 'Coffee Team' } }]);
});

test('closing sends what was waiting, then the session ignores everything', async () => {
    const { session, store, states } = open(def('r1', 'Coffee'));
    session.edit('r1', Object.assign(RoleEditor.draftFrom(def('r1', 'Coffee')), { description: 'Urns on by 9.' }));
    await session.close();
    assert.deepStrictEqual(store.writes, [{ id: 'r1', patch: { description: 'Urns on by 9.' } }]);
    const seen = states.length;
    assert.equal(session.edit('r1', RoleEditor.draftFrom(def('r1', 'Changed'))), false);
    session.remote({ name: 'Theirs' });
    assert.equal(await session.flush(), false);
    assert.equal(states.length, seen, 'a closed session says nothing');
    assert.equal(session.closed, true);
});

test('closing a session with nothing changed writes nothing', async () => {
    const { session, store } = open(def('r1', 'Coffee'));
    session.edit('r1', RoleEditor.draftFrom(def('r1', 'Coffee')));
    await session.close();
    assert.deepStrictEqual(store.writes, []);
});

test('discarding drops what was waiting — for a Role that is being deleted', async () => {
    const { session, store, timers } = open(def('r1', 'Coffee'));
    session.edit('r1', Object.assign(RoleEditor.draftFrom(def('r1', 'Coffee')), { name: 'Gone soon' }));
    session.discard();
    timers.runAll();
    await tick();
    assert.deepStrictEqual(store.writes, []);
});

test('the debounce sends the change on its own', async () => {
    const { session, store, timers } = open(def('r1', 'Coffee'));
    session.edit('r1', Object.assign(RoleEditor.draftFrom(def('r1', 'Coffee')), { name: 'Tea' }));
    assert.equal(timers.pending, 1);
    timers.runAll();
    await tick();
    assert.deepStrictEqual(store.writes, [{ id: 'r1', patch: { name: 'Tea' } }]);
    assert.equal(session.state.status, 'saved');
});

test('an invalid Role is checked from the session\'s own values and never written', async () => {
    const { session, store, states } = open(def('r1', 'Coffee'));
    session.edit('r1', Object.assign(RoleEditor.draftFrom(def('r1', 'Coffee')), { name: '   ' }));
    assert.equal(await session.flush(), false);
    assert.deepStrictEqual(store.writes, []);
    assert.equal(states[states.length - 1].showProblems, true);
    assert.equal(states[states.length - 1].status, 'unsaved');
});

test('a refused save keeps the change, reports it, and the retry sends it', async () => {
    const { session, store, failed } = open(def('r1', 'Coffee'));
    store.failNext();
    session.edit('r1', Object.assign(RoleEditor.draftFrom(def('r1', 'Coffee')), { name: 'Tea' }));
    assert.equal(await session.flush(), false);
    assert.equal(session.state.status, 'failed');
    assert.equal(failed.length, 1);
    assert.equal(failed[0].id, 'r1');
    assert.equal(await session.flush(), true);
    assert.equal(store.writes.length, 2);
    assert.equal(session.state.status, 'saved');
});

test('a slot change carries the slot counter, so a removed slot\'s id is never re-issued', async () => {
    const role = def('r1', 'Coffee', { slots: [{ id: 's1', requirement: 'either' }, { id: 's2', requirement: 'male' }], nextSlotSeq: 3 });
    const { session, store } = open(role);
    const removed = Roles.removeSlot(RoleEditor.draftFrom(role), 's2');
    session.edit('r1', removed);
    await session.flush();
    assert.deepStrictEqual(store.writes[0].patch, { slots: [{ id: 's1', requirement: 'either' }], nextSlotSeq: 3 });
    const added = Roles.addSlot(Object.assign(removed, session.state.values), 'female');
    assert.equal(added.slots[1].id, 's3');
});

// ── The slug never follows the name ──────────────────────────────────────────

test('renaming a Role stored without a slug keeps the slug it already reads as', async () => {
    const legacy = def('r1', 'Sound');
    delete legacy.slug;
    const { session, store } = open(legacy);
    session.edit('r1', Object.assign(RoleEditor.draftFrom(legacy), { name: 'Audio' }));
    await session.flush();
    assert.deepStrictEqual(store.writes[0].patch, { name: 'Audio', slug: 'sound' },
        'its serve history is under "sound" — the rename must not move it to "audio"');
});

test('renaming a slugless Role after a liturgical one cannot hand it the liturgical slug', async () => {
    const legacy = def('r1', 'Welcome');
    delete legacy.slug;
    const { session, store } = open(legacy);
    session.edit('r1', Object.assign(RoleEditor.draftFrom(legacy), { name: 'Prayer' }));
    await session.flush();
    assert.equal(store.writes[0].patch.slug, 'welcome');
});

test('a stored slug is never written again', async () => {
    const { session, store } = open(def('r1', 'Coffee'));
    session.edit('r1', Object.assign(RoleEditor.draftFrom(def('r1', 'Coffee')), { name: 'Tea' }));
    await session.flush();
    assert.ok(!('slug' in store.writes[0].patch));
});

// ── Another editor ───────────────────────────────────────────────────────────

test('another editor\'s change lands in fields this editor is not changing; our echo is ignored', async () => {
    const { session } = open(def('r1', 'Coffee'));
    session.edit('r1', Object.assign(RoleEditor.draftFrom(def('r1', 'Coffee')), { name: 'Mine' }));
    session.remote({ name: 'Theirs', description: 'From elsewhere' });
    assert.equal(session.state.values.name, 'Mine');
    assert.equal(session.state.values.description, 'From elsewhere');
    session.remote({ description: 'Echo' }, { pendingWrites: true });
    assert.equal(session.state.values.description, 'From elsewhere');
});

test('a slot counter another editor raised is never lowered by this session', async () => {
    const role = def('r1', 'Coffee');
    const { session, store } = open(role);
    session.remote({ nextSlotSeq: 9 });
    session.edit('r1', Roles.addSlot(RoleEditor.draftFrom(role), 'either'));
    await session.flush();
    assert.equal(store.writes[0].patch.nextSlotSeq, 9);
});

test('a locked liturgical Role cannot have a session at all', () => {
    const preacher = Roles.allRoles([]).find(r => r.slug === 'preacher');
    assert.throws(() => RoleEditor.openSession({ role: Object.assign({ id: 'x' }, preacher), store: recordingStore() }));
});

// ── Creating ─────────────────────────────────────────────────────────────────

test('a new name is refused when it slugs onto a Role stored without a slug', () => {
    const legacy = def('r1', 'Coffee');
    delete legacy.slug;
    const out = RoleEditor.proposeNew('coffee!', [legacy]);
    assert.equal(out.ok, false);
    assert.match(out.ok ? '' : out.error, /too close to the existing Role "Coffee"/);
});

test('a new name is refused when it is a liturgical Role, or empty', () => {
    assert.equal(RoleEditor.proposeNew('Preacher', []).ok, false);
    assert.equal(RoleEditor.proposeNew('   ', []).ok, false);
});

test('a free name becomes a valid new definition', () => {
    const out = RoleEditor.proposeNew('  Greeters ', [def('r1', 'Coffee')]);
    assert.ok(out.ok);
    assert.equal(out.ok && out.definition.name, 'Greeters');
    assert.equal(out.ok && out.definition.slug, 'greeters');
});

// ── The stored list ──────────────────────────────────────────────────────────

test('a stored definition taking a liturgical slug is held aside by name, not thrown', () => {
    const out = RoleEditor.partition([def('r1', 'Coffee'), Object.assign(def('r2', 'Prayers'), { slug: 'prayer' })]);
    assert.deepStrictEqual(out.definitions.map(d => d.id), ['r1']);
    assert.equal(out.conflicting[0].id, 'r2');
    assert.notEqual(out.conflicting[0].clashesWith, 'prayer', 'names the built-in Role, never its slug');
});

test('changing one stored definition touches only that one, by id, and keeps the list sorted', () => {
    const list = [def('a', 'Coffee'), def('b', 'Setup')];
    const out = RoleEditor.withStored(list, 'a', { name: 'Tea' });
    assert.deepStrictEqual(out.map(d => [d.id, d.name]), [['b', 'Setup'], ['a', 'Tea']]);
    assert.equal(list[0].name, 'Coffee', 'the input is not mutated');
});

test('a change made while a save is in flight still goes when the Role is left', async () => {
    const role = def('r1', 'Coffee');
    const { session, store } = open(role);
    const release = store.holdNext();
    session.edit('r1', Object.assign(RoleEditor.draftFrom(role), { name: 'Tea' }));
    const first = session.flush();
    session.edit('r1', Object.assign(RoleEditor.draftFrom(role), { name: 'Tea', description: 'Kettle on.' }));
    const closing = session.close();
    release();
    await first;
    assert.equal(await closing, true);
    assert.deepStrictEqual(store.writes.map(w => w.patch), [{ name: 'Tea' }, { description: 'Kettle on.' }]);
});

test('leaving stops at a refused save rather than retrying for ever', async () => {
    const role = def('r1', 'Coffee');
    const { session, store, failed } = open(role);
    store.failNext();
    session.edit('r1', Object.assign(RoleEditor.draftFrom(role), { name: 'Tea' }));
    assert.equal(await session.close(), false);
    assert.equal(store.writes.length, 1);
    assert.equal(failed.length, 1, 'and the page is told, so it can say which Role was not saved');
});

test('two stored Roles reading as one slug are both listed, and named as sharing it', () => {
    const coffee = def('r1', 'Coffee');
    const legacy = def('r2', 'coffee!');
    delete legacy.slug;
    const out = RoleEditor.partition([coffee, legacy, def('r3', 'Setup')]);
    assert.deepStrictEqual(out.definitions.map(d => d.id).sort(), ['r1', 'r2', 'r3'],
        'both stay, so one can be deleted');
    assert.deepStrictEqual(out.sharedSlugs, [{ slug: 'coffee', names: ['Coffee', 'coffee!'] }]);
});
