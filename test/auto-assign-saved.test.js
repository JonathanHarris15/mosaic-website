// Keeping a draft between visits (MS-184).
//
// The part worth guarding is the re-check. A draft restored blindly shows a
// picture of a church that has moved on, and it looks completely normal — which
// is exactly what makes it dangerous.

const test = require('node:test');
const assert = require('node:assert');

const Saved = require('../public/auto-assign-saved-core.js');

const ROLES = [
    { slug: 'coffee', slots: [{ id: 's1' }, { id: 's2' }] },
    { slug: 'welcome', slots: [{ id: 's1' }] },
];
const PEOPLE = [{ id: 'p1' }, { id: 'p2' }];
const DATES = ['2026-10-04', '2026-10-11'];

const context = extra => Object.assign({
    seriesId: 'sunday_service', dates: DATES, roles: ROLES, people: PEOPLE,
}, extra || {});

const draftOf = seats => ({
    dates: [{ date: '2026-10-04', seats: seats || [], gaps: [] }],
});

// ── Where it is kept ────────────────────────────────────────────────────────

test('a draft is keyed by event AND range', () => {
    const september = Saved.keyFor('sunday_service', ['2026-09-06', '2026-09-27']);
    const october = Saved.keyFor('sunday_service', DATES);
    const midweek = Saved.keyFor('midweek', DATES);

    assert.notEqual(september, october, 'drafting October must not eat September');
    assert.notEqual(october, midweek);
});

// ── The re-check ────────────────────────────────────────────────────────────

test('a draft drawn against today is safe to restore', () => {
    const stored = Saved.pack(draftOf([{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }]), context());

    assert.deepEqual(Saved.staleReasons(stored, context()), []);
});

test('a set that came back in a different order is not a change', () => {
    const stored = Saved.pack(draftOf(), context());

    assert.deepEqual(
        Saved.staleReasons(stored, context({
            people: [{ id: 'p2' }, { id: 'p1' }],
            dates: ['2026-10-11', '2026-10-04'],
        })),
        []
    );
});

test('a cancelled date makes the stored draft stale', () => {
    const stored = Saved.pack(draftOf(), context());

    assert.deepEqual(
        Saved.staleReasons(stored, context({ dates: ['2026-10-04'] })),
        ['The dates in the range have changed.']
    );
});

test('a Role the event no longer carries makes it stale', () => {
    const stored = Saved.pack(draftOf(), context());

    assert.deepEqual(
        Saved.staleReasons(stored, context({ roles: [ROLES[0]] })),
        ['The roles this event carries have changed.']
    );
});

// ⚠ A Role that gained a third place leaves the draft with a hole in it that
// nothing else here would notice — the slugs still match exactly.
test('a Role that gained a place makes it stale', () => {
    const stored = Saved.pack(draftOf(), context());
    const wider = [{ slug: 'coffee', slots: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] }, ROLES[1]];

    assert.deepEqual(
        Saved.staleReasons(stored, context({ roles: wider })),
        ['A role has gained or lost a place.']
    );
});

// Somebody joining the church does not invalidate a rota. Somebody leaving does
// — if they are in it. So this is checked against the DRAFT, not the directory.
test('a new person in the church does not make a draft stale', () => {
    const stored = Saved.pack(draftOf([{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }]), context());

    assert.deepEqual(
        Saved.staleReasons(stored, context({ people: PEOPLE.concat([{ id: 'p9' }]) })),
        []
    );
});

test('somebody in the draft who may no longer be given a role makes it stale', () => {
    const stored = Saved.pack(draftOf([
        { roleSlug: 'coffee', slotId: 's1', personId: 'p1' },
        { roleSlug: 'coffee', slotId: 's2', personId: 'p2' },
    ]), context());

    assert.deepEqual(
        Saved.staleReasons(stored, context({ people: [] })),
        ['2 people in it can no longer be given a role.']
    );
    assert.deepEqual(
        Saved.staleReasons(stored, context({ people: [{ id: 'p1' }] })),
        ['Somebody in it can no longer be given a role.']
    );
});

test('a draft saved by an older page is not shown at all', () => {
    const stored = Saved.pack(draftOf(), context());
    stored.version = 0;

    assert.deepEqual(Saved.staleReasons(stored, context()),
        ['It was saved by an older version of this page.']);
});

test('nothing stored is not a stale draft — there is simply nothing to offer', () => {
    assert.deepEqual(Saved.staleReasons(null, context()).length, 1);
    assert.deepEqual(Saved.staleReasons({ version: 1 }, context()).length, 1);
});

// ── The browser side ────────────────────────────────────────────────────────

function fakeStorage(broken) {
    const box = {};
    return {
        setItem(k, v) { if (broken) throw new Error('quota'); box[k] = v; },
        getItem(k) { if (broken) throw new Error('denied'); return box[k] === undefined ? null : box[k]; },
        removeItem(k) { if (broken) throw new Error('denied'); delete box[k]; },
    };
}

test('a draft written comes back the same', () => {
    const store = fakeStorage();
    const key = Saved.keyFor('sunday_service', DATES);
    const payload = Saved.pack(draftOf([{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }]), context());

    assert.equal(Saved.save(store, key, payload), true);
    assert.deepEqual(Saved.read(store, key), payload);

    Saved.forget(store, key);
    assert.equal(Saved.read(store, key), null);
});

// A rota screen must not die because a browser refused to remember something.
test('a storage that refuses everything is survivable', () => {
    const store = fakeStorage(true);
    const key = Saved.keyFor('sunday_service', DATES);

    assert.equal(Saved.save(store, key, Saved.pack(draftOf(), context())), false);
    assert.equal(Saved.read(store, key), null);
    assert.doesNotThrow(() => Saved.forget(store, key));
});

test('no storage at all is survivable too', () => {
    assert.equal(Saved.save(null, 'k', {}), false);
    assert.equal(Saved.read(null, 'k'), null);
    assert.doesNotThrow(() => Saved.forget(null, 'k'));
});

test('rubbish in storage reads as nothing, not as a crash', () => {
    const store = fakeStorage();
    store.setItem('k', '{not json');

    assert.equal(Saved.read(store, 'k'), null);
});
