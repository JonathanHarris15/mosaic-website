const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const aw = require('../functions/assignment-writes.js');
const aa = require('../functions/assignment-answer.js');
const Place = require('../functions/shared/place-core.js');

// "I cleared the role roster completely and there are still some stale declined
// roles on the 'something needing somebody' page."
//
// ⚠ THE COVER LIST IS A DERIVED VIEW of an occurrence and its roster
// (PlaceCore.desiredCover). It used to be written by the doors that settle a
// place and swept, delete-only, by the roster trigger — so a cleared roster
// was handled, but a MOVED date's declined places never came back onto the
// list, a CANCELLED date's never came off it, and a tightened Event's entries
// kept their old rung (which is all the cover rule reads). reconcileCover now
// makes the whole occurrence's list match, from both triggers.

// A Firestore small enough for reconcileCover: documents by path, a roster
// subcollection, the one `where` on /cover, and a transaction that applies its
// writes in order.
/**
 * @param {Record<string, any>} docs path → data
 * @returns {any} stands in for Firestore
 */
function fakeDb(docs) {
    const data = Object.assign({}, docs);
    const snapOf = (/** @type {string} */ key) => ({
        id: key.split('/').pop(), exists: data[key] !== undefined, data: () => data[key],
    });
    const listOf = (/** @type {(k: string) => boolean} */ match) => ({
        docs: Object.keys(data).filter(match).sort().map(snapOf),
    });
    /** @param {string} prefix */
    function collection(prefix) {
        return {
            get: async () => listOf(k => k.startsWith(prefix + '/') && k.split('/').length === prefix.split('/').length + 1),
            where: (/** @type {string} */ field, /** @type {string} */ _op, /** @type {any} */ value) => ({
                get: async () => listOf(k => k.startsWith(prefix + '/') &&
                    k.split('/').length === prefix.split('/').length + 1 && (data[k] || {})[field] === value),
            }),
            doc: (/** @type {string} */ id) => {
                const key = prefix + '/' + id;
                return {
                    _key: key,
                    get: async () => snapOf(key),
                    collection: (/** @type {string} */ sub) => collection(key + '/' + sub),
                };
            },
        };
    }
    return {
        _data: data,
        collection,
        /** @param {(tx: any) => Promise<any>} body */
        async runTransaction(body) {
            return body({
                get: (/** @type {any} */ q) => q.get(),
                set: (/** @type {any} */ ref, /** @type {any} */ v) => { data[ref._key] = JSON.parse(JSON.stringify(v)); },
                delete: (/** @type {any} */ ref) => { delete data[ref._key]; },
            });
        },
    };
}

const OCC = 'midweek_2026-08-16';
const occurrence = (/** @type {any=} */ extra) => Object.assign({
    date: '2026-08-16', seriesId: 'midweek', name: 'Midweek', visibility: 'member',
}, extra || {});
const declined = (/** @type {string} */ personId, /** @type {any=} */ extra) => Object.assign({
    roleSlug: 'coffee', slotId: 's1', personId, state: aa.STATES.DECLINED,
}, extra || {});
const ROLES = { 'roles/r1': { name: 'Coffee', slug: 'coffee', family: 'servant', slots: [{ id: 's1', requirement: 'either' }] } };
const coverDocs = (/** @type {any} */ db) => Object.keys(db._data).filter(k => k.startsWith('cover/')).sort();
const COFFEE = 'cover/' + Place.coverIdFor(OCC, { roleSlug: 'coffee', slotId: 's1' });

// ── The report ───────────────────────────────────────────────────────────────

test('clearing the roster takes the advertisement down with it', async () => {
    const db = fakeDb(Object.assign({}, ROLES, {
        ['event_occurrences/' + OCC]: occurrence(),
        [COFFEE]: { occurrenceId: OCC, roleSlug: 'coffee', slotId: 's1' },
    }));
    await aw.reconcileCover(db, OCC);
    assert.deepStrictEqual(coverDocs(db), []);
});

test('a declined place goes up with its Role\'s name, and a second reconcile writes nothing', async () => {
    const db = fakeDb(Object.assign({}, ROLES, {
        ['event_occurrences/' + OCC]: occurrence(),
        ['event_occurrences/' + OCC + '/roster/coffee__s1__bob']: declined('bob'),
    }));
    await aw.reconcileCover(db, OCC);
    assert.deepStrictEqual(coverDocs(db), [COFFEE]);
    assert.equal(db._data[COFFEE].roleName, 'Coffee');
    assert.equal(db._data[COFFEE].personId, undefined, 'never names who declined');
    const again = await aw.reconcileCover(db, OCC);
    assert.deepStrictEqual(again, { set: [], remove: [] });
});

test('a quiet decline, a participant-rung Event, and a confirmed place are not advertised', async () => {
    const db = fakeDb(Object.assign({}, ROLES, {
        ['event_occurrences/' + OCC]: occurrence(),
        ['event_occurrences/' + OCC + '/roster/coffee__s1__bob']: declined('bob', { quiet: true }),
        ['event_occurrences/' + OCC + '/roster/coffee__s2__ann']: declined('ann', { slotId: 's2', state: 'confirmed' }),
    }));
    await aw.reconcileCover(db, OCC);
    assert.deepStrictEqual(coverDocs(db), []);
    const closed = fakeDb(Object.assign({}, ROLES, {
        ['event_occurrences/' + OCC]: occurrence({ visibility: 'participant' }),
        ['event_occurrences/' + OCC + '/roster/coffee__s1__bob']: declined('bob'),
    }));
    await aw.reconcileCover(closed, OCC);
    assert.deepStrictEqual(coverDocs(closed), []);
});

test('cancelling a date takes its places off the list', async () => {
    const db = fakeDb(Object.assign({}, ROLES, {
        ['event_occurrences/' + OCC]: occurrence({ cancelled: true }),
        ['event_occurrences/' + OCC + '/roster/coffee__s1__bob']: declined('bob'),
        [COFFEE]: Place.coverEntryFor(Object.assign({ id: OCC }, occurrence()), declined('bob'), 'Coffee'),
    }));
    await aw.reconcileCover(db, OCC);
    assert.deepStrictEqual(coverDocs(db), []);
});

test('a moved date: off the list on the old day, back on it on the new one', async () => {
    const NEW = 'midweek_2026-08-23';
    const db = fakeDb(Object.assign({}, ROLES, {
        ['event_occurrences/' + OCC]: occurrence({ movedTo: '2026-08-23' }),
        [COFFEE]: Place.coverEntryFor(Object.assign({ id: OCC }, occurrence()), declined('bob'), 'Coffee'),
        ['event_occurrences/' + NEW]: occurrence({ date: '2026-08-23', movedFrom: '2026-08-16' }),
        ['event_occurrences/' + NEW + '/roster/coffee__s1__bob']: declined('bob'),
    }));
    await aw.reconcileCover(db, OCC);
    await aw.reconcileCover(db, NEW);
    const moved = 'cover/' + Place.coverIdFor(NEW, { roleSlug: 'coffee', slotId: 's1' });
    assert.deepStrictEqual(coverDocs(db), [moved]);
    assert.equal(db._data[moved].date, '2026-08-23');
});

test('making an Event more private re-stamps its entries, which is all the cover rule reads', async () => {
    const db = fakeDb(Object.assign({}, ROLES, {
        ['event_occurrences/' + OCC]: occurrence({ visibility: 'elder', name: 'Elders\' retreat' }),
        ['event_occurrences/' + OCC + '/roster/coffee__s1__bob']: declined('bob'),
        [COFFEE]: Place.coverEntryFor(Object.assign({ id: OCC }, occurrence()), declined('bob'), 'Coffee'),
    }));
    await aw.reconcileCover(db, OCC);
    assert.equal(db._data[COFFEE].visibility, 'elder');
    assert.equal(db._data[COFFEE].eventName, 'Elders\' retreat');
});

test('two declined one-offs are two entries; a legacy shared one is replaced', async () => {
    const legacy = 'cover/' + OCC + '__one_off__one_off';
    const db = fakeDb(Object.assign({}, ROLES, {
        ['event_occurrences/' + OCC]: occurrence(),
        ['event_occurrences/' + OCC + '/roster/one_off__setup__bob']:
            { roleSlug: 'one_off', slotId: null, oneOffId: 'setup', label: 'Setup', personId: 'bob', state: 'declined' },
        ['event_occurrences/' + OCC + '/roster/one_off__teardown__ann']:
            { roleSlug: 'one_off', slotId: null, oneOffId: 'teardown', label: 'Teardown', personId: 'ann', state: 'declined' },
        [legacy]: { occurrenceId: OCC, roleSlug: 'one_off', slotId: null },
    }));
    await aw.reconcileCover(db, OCC);
    assert.deepStrictEqual(coverDocs(db), [
        'cover/' + OCC + '__one_off__setup', 'cover/' + OCC + '__one_off__teardown',
    ]);
    assert.equal(db._data['cover/' + OCC + '__one_off__setup'].roleName, 'Setup');
});

test('an Event that has gone takes everything it advertised with it', async () => {
    const db = fakeDb(Object.assign({}, ROLES, {
        [COFFEE]: { occurrenceId: OCC, roleSlug: 'coffee', slotId: 's1' },
    }));
    await aw.reconcileCover(db, OCC);
    assert.deepStrictEqual(coverDocs(db), []);
});

// ── It is wired to both triggers, not to one door ────────────────────────────

test('the reconcile hangs off the roster write and the occurrence write', () => {
    // The reason the bug existed: cleanup that lives in a callable only runs
    // for the doors that callable owns. An editor uses several.
    const index = fs.readFileSync(
        path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
    const roster = index.match(
        /exports\.endTradesOnFilledPlace = onDocumentWritten\(([\s\S]*?)\n\);/);
    assert.ok(roster, 'the roster trigger is gone');
    assert.match(roster[1], /aw\.reconcileCover\(db, event\.params\.occurrenceId\)/);
    assert.match(roster[1], /tw\.sweepAssignment\(db, \{/, 'the Trade sweep has gone');
    assert.ok(roster[1].indexOf('reconcileCover') < roster[1].indexOf('before.personId === after.personId'),
        'a quiet toggle moves a place on or off the list, so the reconcile must run before that early return');
    const occ = index.match(
        /exports\.reconcileCoverOnOccurrence = onDocumentWritten\(([\s\S]*?)\n\);/);
    assert.ok(occ, 'nothing reconciles the list when the Event itself changes');
    assert.match(occ[1], /document: "event_occurrences\/\{occurrenceId\}"/);
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
// them. `scripts/reconcile-cover.js` reconciles those, and this is the predicate
// the whole script turns on.

const { stillNeeded } = require('../scripts/reconcile-cover.js');

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
