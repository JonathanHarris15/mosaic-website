const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Core = require('../public/shepherding-core.js');

// MS-530 / MS-562 — lastNoteAt on Person.
//
// The People list used to collection-group every Shepherding Note to paint
// last-note dates. The date now lives on the Person. These tests pin the
// cache math and that every note create/delete path already touching notes
// writes the field.

const ts = (ms) => ({ toMillis: () => ms, seconds: Math.floor(ms / 1000) });

test('noteCreatedAtMs reads Timestamps, Dates, millis, and {seconds}', () => {
    assert.equal(Core.noteCreatedAtMs(null), null);
    assert.equal(Core.noteCreatedAtMs(undefined), null);
    assert.equal(Core.noteCreatedAtMs(''), null);
    assert.equal(Core.noteCreatedAtMs(1_700_000_000_000), 1_700_000_000_000);
    assert.equal(Core.noteCreatedAtMs(new Date(1_700_000_000_000)), 1_700_000_000_000);
    assert.equal(Core.noteCreatedAtMs({ toMillis: () => 50 }), 50);
    assert.equal(Core.noteCreatedAtMs({ toDate: () => new Date(80) }), 80);
    assert.equal(Core.noteCreatedAtMs({ seconds: 10, nanoseconds: 1_500_000 }), 10001);
});

test('latestNoteAt picks the newest createdAt and ignores empties', () => {
    assert.equal(Core.latestNoteAt([]), null);
    assert.equal(Core.latestNoteAt(null), null);
    const older = ts(100);
    const newer = ts(200);
    assert.equal(Core.latestNoteAt([
        { createdAt: older },
        { createdAt: newer },
        { createdAt: null },
    ]), newer);
});

test('lastNoteAtCreatePatch writes the timestamp the caller hands it', () => {
    const now = { sentinel: 'serverTimestamp' };
    assert.deepEqual(Core.lastNoteAtCreatePatch(now), { lastNoteAt: now });
});

test('lastNoteAtFromRemaining recomputes or clears', () => {
    const older = ts(100);
    const newer = ts(200);
    assert.equal(Core.lastNoteAtFromRemaining([{ createdAt: older }, { createdAt: newer }]), newer);
    assert.equal(Core.lastNoteAtFromRemaining([]), null);
});

test('shouldRefreshLastNoteAtOnDelete: older notes leave the cache; latest/missing refresh', () => {
    const stored = ts(200);
    assert.equal(Core.shouldRefreshLastNoteAtOnDelete(stored, ts(100)), false);
    assert.equal(Core.shouldRefreshLastNoteAtOnDelete(stored, ts(200)), true);
    assert.equal(Core.shouldRefreshLastNoteAtOnDelete(stored, ts(250)), true);
    assert.equal(Core.shouldRefreshLastNoteAtOnDelete(null, ts(100)), true);
    assert.equal(Core.shouldRefreshLastNoteAtOnDelete(stored, null), true);
});

test('planLastNoteAtWrite is idempotent and clears when no notes remain', () => {
    const latest = ts(200);
    assert.equal(Core.planLastNoteAtWrite(latest, latest), null);
    assert.equal(Core.planLastNoteAtWrite(undefined, null), null);
    assert.deepEqual(Core.planLastNoteAtWrite(latest, null), { lastNoteAt: null });
    assert.deepEqual(Core.planLastNoteAtWrite(null, latest), { lastNoteAt: latest });
    assert.deepEqual(Core.planLastNoteAtWrite(ts(100), latest), { lastNoteAt: latest });
});

test('touchLastNoteAt writes lastNoteAt on the Person', async () => {
    const updates = [];
    const db = {
        collection(name) {
            assert.equal(name, 'people');
            return {
                doc(id) {
                    return {
                        update(patch) {
                            updates.push({ id, patch });
                            return Promise.resolve();
                        },
                    };
                },
            };
        },
    };
    const now = { sentinel: true };
    await Core.touchLastNoteAt(db, 'p1', now);
    assert.deepEqual(updates, [{ id: 'p1', patch: { lastNoteAt: now } }]);
});

test('refreshLastNoteAt recomputes from remaining notes and asks the server', async () => {
    const remaining = { createdAt: ts(90) };
    const updates = [];
    let getOpts = null;
    const db = {
        collection(name) {
            assert.equal(name, 'people');
            return {
                doc(id) {
                    return {
                        collection(sub) {
                            assert.equal(sub, 'shepherding_notes');
                            return {
                                orderBy(field, dir) {
                                    assert.equal(field, 'createdAt');
                                    assert.equal(dir, 'desc');
                                    return this;
                                },
                                limit(n) {
                                    assert.equal(n, 1);
                                    return this;
                                },
                                get(opts) {
                                    getOpts = opts;
                                    return Promise.resolve({
                                        empty: false,
                                        docs: [{ data: () => remaining }],
                                    });
                                },
                            };
                        },
                        update(patch) {
                            updates.push({ id, patch });
                            return Promise.resolve();
                        },
                    };
                },
            };
        },
    };
    const wrote = await Core.refreshLastNoteAt(db, 'p1');
    assert.deepEqual(getOpts, { source: 'server' });
    assert.equal(wrote, remaining.createdAt);
    assert.deepEqual(updates, [{ id: 'p1', patch: { lastNoteAt: remaining.createdAt } }]);
});

test('refreshLastNoteAt clears when no notes remain', async () => {
    const updates = [];
    const db = {
        collection() {
            return {
                doc(id) {
                    return {
                        collection() {
                            return {
                                orderBy() { return this; },
                                limit() { return this; },
                                get() { return Promise.resolve({ empty: true, docs: [] }); },
                            };
                        },
                        update(patch) {
                            updates.push({ id, patch });
                            return Promise.resolve();
                        },
                    };
                },
            };
        },
    };
    const wrote = await Core.refreshLastNoteAt(db, 'p1');
    assert.equal(wrote, null);
    assert.deepEqual(updates, [{ id: 'p1', patch: { lastNoteAt: null } }]);
});

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const CREATE_PATHS = [
    'public/shepherding-profile.js',
    'public/shepherding-document.js',
    'public/mobile/data.js',
    'public/service-builder.js',
    'functions/shepherding-writes.js',
    'functions/shepherding-doc-writes.js',
    'functions/index.js',
];

const DELETE_PATHS = [
    'public/shepherding-profile.js',
    'public/shepherding-document.js',
    'public/mobile/data.js',
    'functions/shepherding-writes.js',
];

test('every note create path that already touches notes writes lastNoteAt', () => {
    for (const file of CREATE_PATHS) {
        const src = read(file);
        assert.match(
            src,
            /touchLastNoteAt|lastNoteAt/,
            file + ' creates a note but never writes lastNoteAt'
        );
    }
});

test('every note delete path that already touches notes refreshes lastNoteAt', () => {
    for (const file of DELETE_PATHS) {
        const src = read(file);
        assert.match(
            src,
            /refreshLastNoteAt/,
            file + ' deletes a note but never refreshes lastNoteAt'
        );
    }
});

test('CONTEXT.md names lastNoteAt on Person and the recompute-on-delete choice', () => {
    const src = read('CONTEXT.md');
    assert.match(src, /`lastNoteAt`/);
    assert.match(src, /recomputed from remaining notes/);
});
