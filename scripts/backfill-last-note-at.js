/**
 * @fileoverview MS-564 — Person.lastNoteAt backfill (MS-530).
 *
 * One-shot, idempotent backfill that writes `people.lastNoteAt` for every
 * Person from their newest Shepherding Note (`createdAt`). Writers on create
 * and delete keep the field in sync from here on, but existing People have
 * no cache until this pass (or their next note write).
 *
 * The notes remain the record. This script only projects the newest
 * `createdAt` (or clears the field when a Person has no notes).
 *
 * Delete-of-latest behaviour this matches: recompute from remaining notes;
 * clear when none remain. Same math as ShepherdingCore.planLastNoteAtWrite.
 *
 * Usage:
 *   node scripts/backfill-last-note-at.js            # dry run (default)
 *   node scripts/backfill-last-note-at.js --commit   # apply
 *
 * Do NOT run --commit from a cloud-agent box against production. Dry-run
 * is safe if a service account happens to be present; live apply is ops.
 * How to run and the proof shape: docs/ops/ms-530-last-note-at-backfill.md
 */

const Core = require('../public/shepherding-core.js');

/**
 * One Person's planned write, or null when the cache already matches.
 * Pure — notes are { createdAt } (or the timestamp itself).
 *
 * @param {*} stored the Person's current lastNoteAt
 * @param {Array} notes that Person's notes
 * @return {?{lastNoteAt: *}}
 */
function planForPerson(stored, notes) {
    return Core.planLastNoteAtWrite(stored, Core.latestNoteAt(notes));
}

/**
 * Group collection-group note docs by parent Person id.
 *
 * @param {Array<{ref: {parent: {parent: {id: string}}}, data: Function}>} docs
 * @return {Object<string, Array>}
 */
function notesByPersonFromDocs(docs) {
    const byPerson = {};
    (docs || []).forEach((doc) => {
        const personId = doc.ref && doc.ref.parent && doc.ref.parent.parent &&
            doc.ref.parent.parent.id;
        if (!personId) return;
        const data = typeof doc.data === 'function' ? doc.data() : (doc.data || {});
        (byPerson[personId] = byPerson[personId] || []).push(data);
    });
    return byPerson;
}

/**
 * Proof row for one planned write. Shape ops paste onto the ticket.
 *
 * @param {object} args
 * @return {object}
 */
function proofRow({ personId, name, stored, next, action }) {
    return {
        personId,
        name: name || personId,
        stored: stored == null ? null : stored,
        next: next == null ? null : next,
        action,
    };
}

module.exports = { planForPerson, notesByPersonFromDocs, proofRow };

if (require.main === module) {
    const admin = require('firebase-admin');
    const path = require('path');
    const fs = require('fs');

    const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
    const COMMIT = process.argv.includes('--commit');

    function resolveServiceAccount() {
        const root = path.join(__dirname, '..');
        const match = fs.readdirSync(root).find(
            (f) => f.startsWith('mosaic-hymn-database-firebase-adminsdk') &&
                f.endsWith('.json')
        );
        if (!match) {
            throw new Error(
                'No mosaic-hymn-database-firebase-adminsdk-*.json ' +
                'found in project root.');
        }
        return require(path.join(root, match));
    }

    admin.initializeApp({
        credential: admin.credential.cert(resolveServiceAccount()),
        projectId: FIREBASE_PROJECT_ID,
    });
    const db = admin.firestore();

    function describeTs(value) {
        const ms = Core.noteCreatedAtMs(value);
        if (ms == null) return '(none)';
        return new Date(ms).toISOString();
    }

    async function backfillPeople() {
        const notesSnap = await db.collectionGroup('shepherding_notes').get();
        const notesByPerson = notesByPersonFromDocs(notesSnap.docs);
        console.log(
            `Read ${notesSnap.size} shepherding notes for ` +
            `${Object.keys(notesByPerson).length} people.`);

        const snap = await db.collection('people').get();
        let changed = 0;
        let unchanged = 0;
        const proof = [];
        for (const doc of snap.docs) {
            const person = doc.data() || {};
            const notes = notesByPerson[doc.id] || [];
            const plan = planForPerson(person.lastNoteAt, notes);
            if (!plan) {
                unchanged++;
                continue;
            }
            changed++;
            const action = plan.lastNoteAt == null ? 'clear' : 'set';
            const row = proofRow({
                personId: doc.id,
                name: person.name,
                stored: person.lastNoteAt,
                next: plan.lastNoteAt,
                action,
            });
            proof.push(row);
            const label = person.name || doc.id;
            console.log(
                `  ${COMMIT ? 'update' : 'would update'} ${label}: ` +
                `${describeTs(person.lastNoteAt)} -> ${describeTs(plan.lastNoteAt)}` +
                ` (${action})`);
            if (COMMIT) {
                await doc.ref.update({ lastNoteAt: plan.lastNoteAt });
            }
        }
        return { changed, unchanged, proof, people: snap.size };
    }

    (async () => {
        console.log(
            `\nlastNoteAt backfill (MS-530 / MS-564) — ` +
            `${COMMIT ? 'COMMIT' : 'DRY RUN (use --commit to apply)'}\n`);
        const { changed, unchanged, proof, people } = await backfillPeople();
        console.log(
            `\nDone. People checked: ${people}. ` +
            `${COMMIT ? 'Updated' : 'To update'}: ${changed}, ` +
            `unchanged: ${unchanged}.`);
        console.log(
            `Proof: ${proof.length} row(s) with ` +
            `{ personId, name, stored, next, action }.`);
        if (!COMMIT) {
            console.log('No changes were written. Re-run with --commit.\n');
        }
        process.exit(0);
    })().catch((err) => {
        console.error('Backfill failed:', err);
        process.exit(1);
    });
}
