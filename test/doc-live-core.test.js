const { test } = require('node:test');
const assert = require('node:assert/strict');
const DocLive = require('../public/doc-live-core.js');

function rig() {
    const adopted = [];
    const states = [];
    const live = DocLive.create({
        fingerprint: d => JSON.stringify(d.body),
        onAdopt: d => adopted.push(d.body),
        onChange: s => states.push(s),
    });
    live.loaded({ body: 'a' });
    return { live, adopted, states };
}

test('a remote change is taken while nothing is unsaved', () => {
    const { live, adopted } = rig();
    assert.equal(live.remote({ body: 'b' }), 'adopted');
    assert.deepEqual(adopted, ['b']);
    assert.equal(live.state.changedElsewhere, false);
});

test('our own echo is ignored (pendingWrites, or the fingerprint we wrote)', () => {
    const { live, adopted } = rig();
    live.edited();
    const t = live.saving();
    assert.equal(live.remote({ body: 'mine' }, { pendingWrites: true }), 'ignored');
    live.saved(t, { body: 'mine' });
    assert.equal(live.remote({ body: 'mine' }), 'ignored');
    assert.deepEqual(adopted, []);
    assert.equal(live.state.status, 'saved');
});

test('with unsaved work a remote change is held and the page says so; the local edit stays', () => {
    const { live, adopted } = rig();
    live.edited();
    assert.equal(live.remote({ body: 'theirs' }), 'held');
    assert.deepEqual(adopted, []);
    assert.equal(live.state.changedElsewhere, true);
    assert.equal(live.state.status, 'unsaved');
});

test('held while saving and while failed too', () => {
    const { live } = rig();
    live.edited();
    const t = live.saving();
    assert.equal(live.remote({ body: 'x' }), 'held');
    live.failed(t, new Error('denied'));
    assert.equal(live.state.status, 'failed');
    assert.equal(live.state.error, 'denied');
    assert.equal(live.remote({ body: 'y' }), 'held');
});

test('Reload swaps in the newer copy and clears the notice', () => {
    const { live, adopted } = rig();
    live.edited();
    live.remote({ body: 'theirs' });
    assert.equal(live.reload(), true);
    assert.deepEqual(adopted, ['theirs']);
    assert.equal(live.state.status, 'saved');
    assert.equal(live.state.changedElsewhere, false);
    assert.equal(live.remote({ body: 'theirs' }), 'ignored');
    assert.equal(live.reload(), false);
});

test('an edit made while a save is in flight stays unsaved after it lands', () => {
    const { live } = rig();
    live.edited();
    const t = live.saving();
    live.edited();
    live.saved(t, { body: 'first' });
    assert.equal(live.state.status, 'unsaved');
    const t2 = live.saving();
    live.saved(t2, { body: 'second' });
    assert.equal(live.state.status, 'saved');
});

test('Retry after a failure: a good save clears Not saved', () => {
    const { live } = rig();
    live.edited();
    live.failed(live.saving(), new Error('offline'));
    const t = live.saving();
    live.saved(t, { body: 'z' });
    assert.equal(live.state.status, 'saved');
    assert.equal(DocLive.chipText('failed'), 'Not saved');
});
