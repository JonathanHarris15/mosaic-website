const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const aw = require('../functions/assignment-writes.js');
const aa = require('../functions/assignment-answer.js');

// "I cleared the role roster completely and there are still some stale declined
// roles on the 'something needing somebody' page."
//
// ⚠ THE COVER LIST IS DERIVED FROM THE ROSTER AND HAD NO WAY TO KNOW WHEN THE
// ROSTER CHANGED BY A DOOR IT DID NOT OWN.
//
// The entry is a denormalised document written alongside a decline, so the list
// can render without opening the occurrence. Every path that SETTLES a place
// deleted it by hand — taking one, settling a Trade, going quiet. Nothing
// deleted it when an editor simply removed the roster row, and "empty the
// ticked dates" removes hundreds at once. The place was gone, the decline was
// gone, and the advertisement was still up.
//
// It now hangs off the roster write, beside the Trade sweep that was already
// there for exactly the same reason.

// A Firestore small enough to answer the two questions this asks of it.
function fakeDb(seed) {
    const data = Object.assign({}, seed || {});
    const deleted = [];
    return {
        _data: data,
        _deleted: deleted,
        collection(name) {
            return {
                doc(id) {
                    const key = name + '/' + id;
                    return {
                        get: async () => ({
                            exists: data[key] !== undefined,
                            data: () => data[key],
                        }),
                        delete: async () => { deleted.push(key); delete data[key]; },
                    };
                },
            };
        },
    };
}

const PLACE = { occurrenceId: 'sunday_2026-08-16', roleSlug: 'coffee', slotId: 's1' };
const ID = aa.coverId(PLACE.occurrenceId, PLACE.roleSlug, PLACE.slotId);
const KEY = 'cover/' + ID;

const withEntry = () => fakeDb({ [KEY]: { roleSlug: 'coffee', date: '2026-08-16' } });

// ── The report ───────────────────────────────────────────────────────────────

test('clearing the roster takes the advertisement down with it', () => {
    const db = withEntry();
    return aw.sweepCover(db, Object.assign({ row: null }, PLACE)).then(cleared => {
        assert.equal(cleared, true);
        assert.deepStrictEqual(db._deleted, [KEY]);
    });
});

test('somebody else being put in the place takes it down too', async () => {
    // The other door an editor uses: replacing the person rather than emptying
    // the date. The place is no longer looking for anybody either way.
    const db = withEntry();
    await aw.sweepCover(db, Object.assign({
        row: { personId: 'someone-else', state: aa.STATES.PENDING },
    }, PLACE));
    assert.deepStrictEqual(db._deleted, [KEY]);
});

test('the holder confirming after all takes it down', async () => {
    const db = withEntry();
    await aw.sweepCover(db, Object.assign({
        row: { personId: 'bob', state: aa.STATES.CONFIRMED },
    }, PLACE));
    assert.deepStrictEqual(db._deleted, [KEY]);
});

// ── What must NOT be swept ───────────────────────────────────────────────────

test('a place still declined keeps its advertisement', async () => {
    // The whole point of the list. Sweeping this would empty the cover list
    // every time anything on the roster moved.
    const db = withEntry();
    const cleared = await aw.sweepCover(db, Object.assign({
        row: { personId: 'bob', state: aa.STATES.DECLINED },
    }, PLACE));

    assert.equal(cleared, false);
    assert.deepStrictEqual(db._deleted, []);
});

test('a quiet place having no entry is correct, not a gap to fill', async () => {
    // ⚠ THIS SWEEP DELETES AND NEVER WRITES. A quiet Cover is deliberately on
    // no list, and `setReach` owns that document — a sweep that helpfully
    // recreated a missing entry would put a quiet place on the open list.
    const db = fakeDb({});
    const cleared = await aw.sweepCover(db, Object.assign({
        row: { personId: 'bob', state: aa.STATES.DECLINED, quiet: true },
    }, PLACE));

    assert.equal(cleared, false);
    assert.deepStrictEqual(Object.keys(db._data), [], 'the sweep wrote something');
});

test('a place with no entry to begin with is left alone', async () => {
    const db = fakeDb({});
    assert.equal(await aw.sweepCover(db, Object.assign({ row: null }, PLACE)), false);
    assert.deepStrictEqual(db._deleted, []);
});

test('a one-off Role sweeps under the same id its decline wrote', async () => {
    // A one-off has no slot, and the id scheme substitutes a constant. If the
    // two ever disagree the entry is unreachable and stays up for ever.
    const oneOff = { occurrenceId: 'x', roleSlug: 'one_off', slotId: null };
    const key = 'cover/' + aa.coverId(oneOff.occurrenceId, oneOff.roleSlug, null);
    const db = fakeDb({ [key]: {} });

    await aw.sweepCover(db, Object.assign({ row: null }, oneOff));
    assert.deepStrictEqual(db._deleted, [key]);
});

// ── It is wired to the roster, not to one door ───────────────────────────────

test('the sweep hangs off the roster write, beside the Trade sweep', () => {
    // The reason the bug existed: cleanup that lives in a callable only runs
    // for the doors that callable owns. An editor uses several.
    const index = fs.readFileSync(
        path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
    const trigger = index.match(
        /exports\.endTradesOnFilledPlace = onDocumentWritten\(([\s\S]*?)\n\);/);
    assert.ok(trigger, 'the roster trigger is gone');
    assert.match(trigger[1], /aw\.sweepCover\(db, \{/, 'nothing takes the advertisement down');
    assert.match(trigger[1], /tw\.sweepAssignment\(db, \{/, 'the Trade sweep has gone');
    assert.match(trigger[1], /row: after,/,
        'the sweep is not told what the place looks like now, so it cannot tell ' +
        'a decline from a deletion');
});

test('the cover collection still refuses every client write', () => {
    // Which is WHY this has to be a trigger: clearRosters is a client write and
    // could not delete these even if it tried.
    const rules = fs.readFileSync(
        path.join(__dirname, '..', 'firestore.rules'), 'utf8');
    const block = rules.match(/match \/cover\/\{coverId\}\s*\{([\s\S]*?)\n {4}\}/);
    assert.ok(block, 'the cover rules are gone');
    assert.match(block[1], /allow create, update, delete: if false;/,
        'the cover list has become client-writable, which is a bigger question');
});

// ── Clearing the ones already stranded ───────────────────────────────────────
//
// The trigger takes them down as they happen. It can do nothing about entries
// whose roster rows are ALREADY gone — no future write will ever fire about
// them. `scripts/clean-stale-cover.js` clears those, and this is the predicate
// the whole script turns on.

const { stillNeeded } = require('../scripts/clean-stale-cover.js');

const entry = { roleSlug: 'coffee', slotId: 's1' };

test('an advertisement for a place still declined is true', () => {
    assert.equal(stillNeeded(entry, [
        { roleSlug: 'coffee', slotId: 's1', state: aa.STATES.DECLINED },
    ]), true);
});

test('an advertisement for a place nobody is on any more is not', () => {
    // The reported case: the roster was cleared and the row is simply gone.
    assert.equal(stillNeeded(entry, []), false);
    assert.equal(stillNeeded(entry, [
        { roleSlug: 'setup', slotId: 's1', state: aa.STATES.DECLINED },
    ]), false, 'a different Role on the same date is not this place');
});

test('an advertisement for a place somebody has since taken is not', () => {
    assert.equal(stillNeeded(entry, [
        { roleSlug: 'coffee', slotId: 's1', personId: 'someone', state: aa.STATES.CONFIRMED },
    ]), false);
    assert.equal(stillNeeded(entry, [
        { roleSlug: 'coffee', slotId: 's1', personId: 'someone', state: null },
    ]), false);
});

test('a one-off place matches on a null slot rather than missing itself', () => {
    // ⚠ `slotId` is null on a one-off and absent on some rows. Comparing them
    // raw would find no match, and the script would delete every one-off
    // advertisement in the church on its first run.
    const oneOff = { roleSlug: 'one_off', slotId: null };
    assert.equal(stillNeeded(oneOff, [
        { roleSlug: 'one_off', state: aa.STATES.DECLINED },
    ]), true);
    assert.equal(stillNeeded(oneOff, [
        { roleSlug: 'one_off', slotId: null, state: aa.STATES.DECLINED },
    ]), true);
});

test('nonsense is not needed', () => {
    assert.equal(stillNeeded(null, []), false);
    assert.equal(stillNeeded(entry, null), false);
});
