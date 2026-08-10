// Talking to a real Firestore (MS-217).
//
// Everything else in test/ is pure: modules in, values out, no I/O. These are
// the exception, and they exist because the thing being proved cannot be proved
// any other way. "Three writes land together or not at all" is a claim about
// Firestore's transaction, not about our code — a hand-written fake would only
// prove the fake agrees with itself.
//
// So: the Firestore emulator, driven through firebase-admin, on a throwaway
// project id. `npm run test:emulator` starts it and sets FIRESTORE_EMULATOR_HOST
// for the run. Without that variable these tests skip rather than fail, so a
// plain `npm test` stays honest about what it did and did not check.

'use strict';

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';

// `demo-` tells the SDK and the emulator that no credentials exist and none are
// wanted. A real project id here would be one typo away from writing test data
// into the church's actual database.
const PROJECT_ID = 'demo-mosaic-ms20';

// Why the suite is skipping, or false when it is not.
//
// ⚠ FALSE, NOT NULL. node:test skips on any `skip` value that is not
// `undefined`, so a `null` here silently skips the whole suite while looking
// like it ran.
const skipReason = HOST ? false :
    'no FIRESTORE_EMULATOR_HOST — run `npm run test:emulator`';

let cached = null;

/**
 * A Firestore handle pointed at the emulator.
 * @return {object} the db
 */
function connect() {
    if (cached) return cached;
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
    cached = admin.firestore();
    return cached;
}

/** A timestamp the writes can stamp with, without importing admin twice. */
function now() {
    return require('firebase-admin').firestore.Timestamp.now();
}

/**
 * Empty the whole database. Between tests, not after — a failed test that
 * leaves its data behind is worth looking at.
 * @return {Promise<void>}
 */
async function wipe() {
    const url = `http://${HOST}/emulator/v1/projects/${PROJECT_ID}` +
        '/databases/(default)/documents';

    // 409 means a write from the test before this one is still settling — the
    // race tests leave transactions unwinding for a moment after they return.
    // Retried rather than thrown, or every test that follows a race fails for a
    // reason that has nothing to do with it.
    for (let attempt = 0; attempt < 10; attempt++) {
        const res = await fetch(url, { method: 'DELETE' });
        if (res.ok) return;
        if (res.status !== 409) {
            throw new Error('could not wipe the emulator: ' + res.status);
        }
        await new Promise(done => setTimeout(done, 100));
    }
    throw new Error('the emulator would not settle enough to be wiped');
}

// ── Seeding ─────────────────────────────────────────────────────────────────
//
// Deliberately writes the SAME derived fields the callables maintain, so a test
// starts from a consistent Event rather than from one that was already drifting.

/**
 * One Event occurrence and its roster.
 * @param {object} db the Firestore handle
 * @param {object} spec the Event
 * @param {string} spec.id the occurrence id
 * @param {string} spec.date YYYY-MM-DD
 * @param {string} spec.visibility which rung it sits on
 * @param {Array<object>} spec.roster the Assignments
 * @param {string} [spec.name] the Event's name
 * @return {Promise<void>}
 */
async function seedOccurrence(db, spec) {
    const roster = spec.roster || [];
    await db.collection('event_occurrences').doc(spec.id).set({
        date: spec.date,
        visibility: spec.visibility || 'member',
        name: spec.name || 'Morning Service',
        seriesId: null,
        participantIds: roster.map(a => a.personId),
        needsAttention: roster.some(a => a.state === 'declined'),
        outForCover: false,
    });
    await Promise.all(roster.map(a => db
        .collection('event_occurrences').doc(spec.id)
        .collection('roster')
        .doc(rosterIdFor(a))
        .set(a)));
}

/**
 * The roster document id, as events-store.js builds it. Restated rather than
 * imported: if this drifts from the real one, the tests should notice.
 * @param {object} a the Assignment
 * @return {string} its document id
 */
function rosterIdFor(a) {
    return [a.roleSlug, a.oneOffId || a.slotId || 'x', a.personId].join('__');
}

/**
 * One Person in the directory.
 * @param {object} db the Firestore handle
 * @param {string} id their Person id
 * @param {object} [fields] anything else about them
 * @return {Promise<void>}
 */
function seedPerson(db, id, fields) {
    return db.collection('people').doc(id).set(
        // ⚠ ONE `name` FIELD. A Person has no firstName/lastName pair, and a
        // fixture that invented one let a screen read every name as "Somebody"
        // with every test still green.
        Object.assign({ name: id }, fields || {}));
}

/**
 * One Role definition. The collection is `roles` — named wrongly, every Role
 * rule silently stops being checked, which is a bug this project has already
 * shipped once.
 * @param {object} db the Firestore handle
 * @param {object} def the Role
 * @return {Promise<void>}
 */
function seedRole(db, def) {
    return db.collection('roles').doc(def.slug).set(Object.assign(
        { name: def.slug, slots: [], restrictions: [] }, def));
}

// ── Reading back ────────────────────────────────────────────────────────────

/**
 * Every Assignment on an Event, by document id.
 * @param {object} db the Firestore handle
 * @param {string} occurrenceId the occurrence
 * @return {Promise<Array<object>>} the rows, each with its own `id`
 */
async function rosterOf(db, occurrenceId) {
    const snap = await db.collection('event_occurrences').doc(occurrenceId)
        .collection('roster').get();
    return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
}

/**
 * One Event occurrence as it now stands.
 * @param {object} db the Firestore handle
 * @param {string} occurrenceId the occurrence
 * @return {Promise<?object>} the document, or null
 */
async function occurrenceOf(db, occurrenceId) {
    const snap = await db.collection('event_occurrences').doc(occurrenceId).get();
    return snap.exists ? snap.data() : null;
}

/**
 * One cover entry, if it is there.
 * @param {object} db the Firestore handle
 * @param {string} id the cover document id
 * @return {Promise<?object>} the entry, or null
 */
async function coverOf(db, id) {
    const snap = await db.collection('cover').doc(id).get();
    return snap.exists ? snap.data() : null;
}

// ── Bending the transaction ─────────────────────────────────────────────────
//
// Both of these wrap the `db` handle rather than reaching into the code being
// tested. That matters: the code under test has no idea it is being tested, so
// what these prove is a property of the real writes, not of a test hook
// somebody could delete without noticing.

/**
 * A db whose transactions always fail, AFTER the callback has queued every
 * write. Whatever lands despite this was not queued on the transaction.
 * @param {object} db the real handle
 * @param {string} [message] what to fail with
 * @return {object} the wrapped handle
 */
function failsAtCommit(db, message) {
    return wrapTransaction(db, async (run, fn) => run(async (tx) => {
        await fn(tx);
        throw new Error(message || 'the power went out mid-write');
    }));
}

/**
 * A db that lets somebody else write in the window between the caller's
 * un-transacted reads and the transaction opening — an editor refilling the
 * slot from the Roles tab while a member is on their way to pressing Take.
 *
 * ⚠ THE WINDOW IS BEFORE THE TRANSACTION, NOT INSIDE IT, and that is not a
 * simplification — it is where the window actually is. A Firestore read-write
 * transaction takes LOCKS on what it reads, so an outside write aimed at the
 * same document does not slip in between the read and the commit: it waits.
 * (Trying it the other way deadlocks: the write blocks on the transaction, the
 * transaction blocks on the write, and 65 seconds later the transaction expires
 * with "Transaction is invalid or closed.")
 *
 * `take` genuinely does read outside its transaction, though — the occurrence's
 * date, the Person, the Role, their Away — so this is the real stale-read
 * window, and what it proves is that the transaction re-reads the one thing the
 * race is about.
 *
 * @param {object} db the real handle
 * @param {function(): Promise<void>} intrude what the other person does
 * @return {object} the wrapped handle
 */
function interruptedBy(db, intrude) {
    let fired = false;
    return wrapTransaction(db, async (run, fn) => {
        if (!fired) {
            fired = true;
            await intrude();
        }
        return run(fn);
    });
}

/**
 * A db whose transactions fail with one particular error, before doing
 * anything. For pinning how a failure is REPORTED rather than what it writes.
 * @param {object} db the real handle
 * @param {Error} error what Firestore is pretending went wrong
 * @return {object} the wrapped handle
 */
function failsWith(db, error) {
    return wrapTransaction(db, async () => {
        throw error;
    });
}

/**
 * A handle identical to `db` except for `runTransaction`.
 * @param {object} db the real handle
 * @param {function} around given the real runTransaction and the callback
 * @return {object} the wrapped handle
 */
function wrapTransaction(db, around) {
    return new Proxy(db, {
        get(target, prop, receiver) {
            if (prop === 'runTransaction') {
                return (fn, opts) => around(
                    (inner) => target.runTransaction(inner, opts), fn);
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

module.exports = {
    HOST,
    PROJECT_ID,
    skipReason,
    connect,
    now,
    wipe,
    seedOccurrence,
    seedPerson,
    seedRole,
    rosterIdFor,
    rosterOf,
    occurrenceOf,
    coverOf,
    failsAtCommit,
    failsWith,
    interruptedBy,
};
