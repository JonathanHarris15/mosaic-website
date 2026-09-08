/**
 * @fileoverview One-time migration: bring the old Follow-up Reminders across as
 * one-off Tasks (MS-79, sub-task MS-419).
 *
 * A Follow-up Reminder was a title, a due date and time, and who wrote it. It
 * disappeared the moment its date passed, which is the behaviour MS-79 replaces
 * — so the ones still sitting there are the ones nobody has reached yet, and
 * losing them when the panel changes shape would be losing live work.
 *
 * Each becomes a Task with the same title and date, no assignees, and no body.
 *
 * ⚠ WHAT DOES NOT COME ACROSS. Some rows carry a `mentions` list — the people
 * the reminder was "about", written only by the assistant's tools. That link no
 * longer exists in the model (ADR-0059): a Task names who must DO it and nobody
 * else. Carrying it over would leave a field nothing reads and every reader
 * misreads. It is dropped, deliberately, and the count is reported so the drop
 * is visible rather than silent.
 *
 * ⚠ THE OLD COLLECTION IS LEFT WHERE IT IS. Nothing is deleted here. The
 * migration can be checked — and re-run — before anybody throws the originals
 * away, and a migration that destroys its own source cannot be verified after
 * the fact.
 *
 * Idempotent: every Task written carries `migratedFrom`, and a reminder whose id
 * is already claimed is skipped, so a second run reports "nothing to do" and
 * writes nothing.
 *
 * Run:  node scripts/migrate-reminders-to-tasks.js [--dry-run]
 */

const REMINDERS = 'shepherding_reminders';
const TASKS = 'shepherding_tasks';

// A Firestore Timestamp, a Date, or nothing, as YYYY-MM-DD in local time — the
// same day an elder would have read off the old panel.
function dayOf(value) {
    const date = (value && typeof value.toDate === 'function') ? value.toDate()
        : (value instanceof Date) ? value
            : null;
    if (!date || isNaN(date.getTime())) return null;
    const pad = n => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

// The time of day, or null.
//
// The old reminder always had one because the form demanded it. A Task does
// not, and midnight was never a real choice — it is what a `datetime-local` box
// does when somebody leaves it alone, so carrying it over would invent a
// deadline nobody set.
function timeOf(value) {
    const date = (value && typeof value.toDate === 'function') ? value.toDate()
        : (value instanceof Date) ? value
            : null;
    if (!date || isNaN(date.getTime())) return null;
    if (date.getHours() === 0 && date.getMinutes() === 0) return null;
    const pad = n => String(n).padStart(2, '0');
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/**
 * The Task one old reminder becomes, or null when it cannot become one.
 *
 * Null means no readable due date. A Task must have one (ADR-0058) — without a
 * date nothing can ever read as overdue — and inventing one would be worse than
 * leaving the row behind and saying so.
 *
 * @param {string} reminderId the old document's id, kept so a second run can
 *   recognise its own work
 * @param {object} data the old document
 * @param {*} createdAtFallback a server-timestamp sentinel, for a row that has
 *   no createdAt of its own
 * @return {object|null} the Task to write, or null
 */
function taskFrom(reminderId, data, createdAtFallback) {
    const row = data || {};
    const dueDate = dayOf(row.dueDatetime);
    if (!dueDate) return null;

    return {
        title: String(row.title || '').trim() || '(untitled)',
        body: '',
        dueDate: dueDate,
        dueTime: timeOf(row.dueDatetime),
        assigneeIds: [],
        recurrence: null,
        completedAt: null,
        completedBy: null,
        createdBy: row.createdBy || null,
        createdByName: row.createdByName || '',
        createdAt: row.createdAt || createdAtFallback,
        migratedFrom: reminderId,
        writtenVia: 'migration',
    };
}

/** Whether this reminder has already been brought across. */
function isMigrated(reminderId, existingTasks) {
    return (existingTasks || []).some(t => (t || {}).migratedFrom === reminderId);
}

module.exports = { REMINDERS, TASKS, dayOf, timeOf, taskFrom, isMigrated };

if (require.main === module) {
    const admin = require('firebase-admin');
    const { serviceAccount } = require('./service-account.js');

    const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
    const BATCH_SIZE = 400;
    const DRY_RUN = process.argv.includes('--dry-run');

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount()),
        projectId: FIREBASE_PROJECT_ID,
    });
    const db = admin.firestore();

    (async () => {
        console.log('Bringing Follow-up Reminders across as Tasks' + (DRY_RUN ? ' (dry run)' : ''));

        const [snap, taskSnap] = await Promise.all([
            db.collection(REMINDERS).get(),
            db.collection(TASKS).get(),
        ]);
        const existing = taskSnap.docs.map(d => d.data() || {});

        let moved = 0; let skipped = 0; let undated = 0; let mentionsDropped = 0;
        let batch = db.batch(); let pending = 0;

        for (const doc of snap.docs) {
            const data = doc.data() || {};
            if (isMigrated(doc.id, existing)) { skipped += 1; continue; }

            const task = taskFrom(doc.id, data, admin.firestore.FieldValue.serverTimestamp());
            if (!task) {
                console.warn(`  ! "${data.title || doc.id}" has no readable due date — left behind`);
                undated += 1;
                continue;
            }
            if (Array.isArray(data.mentions) && data.mentions.length) mentionsDropped += 1;

            if (!DRY_RUN) {
                batch.set(db.collection(TASKS).doc(), task);
                pending += 1;
                if (pending >= BATCH_SIZE) { await batch.commit(); batch = db.batch(); pending = 0; }
            }
            moved += 1;
        }
        if (!DRY_RUN && pending) await batch.commit();

        console.log(`  moved   ${moved}`);
        console.log(`  skipped ${skipped} (already brought across)`);
        if (undated) console.log(`  left    ${undated} with no readable due date`);
        if (mentionsDropped) {
            console.log(
                `  dropped the "people it is about" list on ${mentionsDropped} of them ` +
                '— a Task names who must do it, never who it is about (ADR-0059)');
        }
        console.log(`  the ${REMINDERS} collection is untouched; delete it by hand once you are happy`);
    })().then(() => process.exit(0)).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
