const { test } = require('node:test');
const assert = require('node:assert/strict');
const LiveFields = require('../public/live-fields-core.js');

// ADR 0081 / MS-720: the pure half of a form that saves itself.

function clock() {
    let next = 1;
    const timers = new Map();
    return {
        setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; },
        clearTimeout: (id) => { timers.delete(id); },
        pending: () => [...timers.values()],
        async fire() {
            const all = [...timers.entries()];
            timers.clear();
            for (const [, t] of all) await t.fn();
        },
    };
}

const tick = () => new Promise(r => setImmediate(r));

function make(over) {
    const c = clock();
    const saves = [];
    const states = [];
    let fail = null;
    const live = LiveFields.create(Object.assign({
        fields: ['name', 'location'],
        initial: { name: 'Supper', location: 'Hall' },
        save: async (patch) => {
            saves.push(patch);
            if (fail) { const e = fail; fail = null; throw e; }
            const out = {};
            Object.keys(patch).forEach(k => { out[k] = String(patch[k]).trim() || null; });
            return out;
        },
        onChange: (s) => states.push(s),
        setTimeout: c.setTimeout,
        clearTimeout: c.clearTimeout,
    }, over || {}));
    return { live, c, saves, states, failNext: (e) => { fail = e; } };
}

test('typing marks Unsaved and waits 1.5 s before saving only the changed field', async () => {
    const { live, c, saves } = make();
    live.edit('name', 'Harvest Supper');
    assert.equal(live.state.status, 'unsaved');
    assert.equal(c.pending().length, 1);
    assert.equal(c.pending()[0].ms, 1500);
    assert.equal(saves.length, 0);
    await c.fire(); await tick();
    assert.deepEqual(saves, [{ name: 'Harvest Supper' }]);
    assert.equal(live.state.status, 'saved');
});

test('more typing restarts the debounce; one save carries the last value', async () => {
    const { live, c, saves } = make();
    live.edit('name', 'H');
    live.edit('name', 'Ha');
    live.edit('name', 'Harvest');
    assert.equal(c.pending().length, 1);
    await c.fire(); await tick();
    assert.deepEqual(saves, [{ name: 'Harvest' }]);
});

test('blur/Enter flush saves at once', async () => {
    const { live, c, saves } = make();
    live.edit('location', 'Church hall');
    await live.flush();
    assert.deepEqual(saves, [{ location: 'Church hall' }]);
    assert.equal(c.pending().length, 0);
    assert.equal(live.state.status, 'saved');
});

test('the chip walks Unsaved changes → Saving… → Saved', async () => {
    const { live, states } = make();
    live.edit('name', 'X');
    await live.flush();
    const seq = states.map(s => s.status).filter((s, i, a) => s !== a[i - 1]);
    assert.deepEqual(seq, ['unsaved', 'saving', 'saved']);
    assert.equal(LiveFields.chipText('unsaved'), 'Unsaved changes');
    assert.equal(LiveFields.chipText('saving'), 'Saving…');
    assert.equal(LiveFields.chipText('saved'), 'Saved');
    assert.equal(LiveFields.chipText('failed'), 'Not saved');
});

test('typing back to the stored value is not a change (trimmed)', async () => {
    const { live, c, saves } = make();
    live.edit('name', 'Supper  ');
    assert.equal(live.state.status, 'saved');
    assert.equal(c.pending().length, 0);
    await live.flush();
    assert.equal(saves.length, 0);
});

test('a failed save keeps the change, says Not saved with the reason, and Retry tries again', async () => {
    const { live, saves, failNext } = make();
    failNext(new Error('Missing or insufficient permissions.'));
    live.edit('name', 'Harvest');
    await live.flush();
    assert.equal(live.state.status, 'failed');
    assert.match(live.state.error, /insufficient permissions/);
    assert.equal(live.state.draft.name, 'Harvest', 'the typing is kept');
    await live.retry();
    assert.equal(saves.length, 2);
    assert.equal(live.state.status, 'saved');
    assert.equal(live.state.error, '');
});

test('after a failure the next edit retries on its own', async () => {
    const { live, c, saves, failNext } = make();
    failNext(new Error('offline'));
    live.edit('name', 'Harvest');
    await live.flush();
    assert.equal(live.state.status, 'failed');
    live.edit('location', 'Barn');
    assert.equal(live.state.status, 'unsaved');
    await c.fire(); await tick();
    assert.deepEqual(saves[1], { name: 'Harvest', location: 'Barn' });
    assert.equal(live.state.status, 'saved');
});

test('an invalid value does not save; the field says why; fixing it saves', async () => {
    const { live, c, saves } = make({
        validate: (d) => (String(d.name).trim() ? null : { name: 'An event needs a name.' }),
    });
    live.edit('name', '   ');
    assert.deepEqual(live.state.invalid, { name: 'An event needs a name.' });
    await c.fire(); await tick();
    assert.equal(saves.length, 0);
    assert.equal(live.state.status, 'unsaved');
    live.edit('name', 'Supper night');
    assert.deepEqual(live.state.invalid, {});
    await c.fire(); await tick();
    assert.deepEqual(saves, [{ name: 'Supper night' }]);
});

test('Escape reverts an unsaved field and cancels its save', async () => {
    const { live, c, saves } = make();
    live.edit('name', 'Oops');
    live.revert('name');
    assert.equal(live.state.draft.name, 'Supper');
    assert.equal(live.state.status, 'saved');
    assert.equal(c.pending().length, 0);
    await c.fire(); await tick();
    assert.equal(saves.length, 0);
});

test('a remote change lands in a field this editor has not touched', () => {
    const { live } = make();
    live.remote({ name: 'Supper', location: 'Barn' });
    assert.equal(live.state.draft.location, 'Barn');
    assert.equal(live.state.status, 'saved');
});

test('a remote change does not overwrite a field this editor is changing', async () => {
    const { live, saves } = make();
    live.edit('name', 'Mine');
    live.remote({ name: 'Theirs', location: 'Barn' });
    assert.equal(live.state.draft.name, 'Mine');
    assert.equal(live.state.draft.location, 'Barn');
    await live.flush();
    assert.deepEqual(saves, [{ name: 'Mine' }], 'last write per field; location not re-sent');
});

test('our own write echoing back (pendingWrites) is ignored', () => {
    const { live } = make();
    live.remote({ name: 'Echo', location: 'Echo' }, { pendingWrites: true });
    assert.equal(live.state.draft.name, 'Supper');
});

test('typing during a save is saved after it, not lost', async () => {
    let release;
    const saves = [];
    const c = clock();
    const live = LiveFields.create({
        fields: ['name'], initial: { name: 'A' },
        save: (patch) => { saves.push(patch); return new Promise(r => { release = () => r(patch); }); },
        setTimeout: c.setTimeout, clearTimeout: c.clearTimeout,
    });
    live.edit('name', 'B');
    const first = live.flush();
    live.edit('name', 'BC');
    assert.equal(live.state.status, 'saving');
    release(); await first; await tick();
    assert.equal(live.state.status, 'unsaved');
    await c.fire(); await tick();
    release(); await tick(); await tick();
    assert.deepEqual(saves, [{ name: 'B' }, { name: 'BC' }]);
    assert.equal(live.state.status, 'saved');
});

test('the stored (trimmed) value replaces the box once saved', async () => {
    const { live } = make();
    live.edit('location', '  Barn  ');
    await live.flush();
    assert.equal(live.state.draft.location, 'Barn');
});

test('dispose stops a pending save', async () => {
    const { live, c, saves } = make();
    live.edit('name', 'Later');
    live.dispose();
    await c.fire(); await tick();
    assert.equal(saves.length, 0);
});
