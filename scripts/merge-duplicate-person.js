/**
 * Merge duplicate `people` records: repoint every reference from --from to --to,
 * move subcollections, then delete the source person when nothing references it.
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/merge-duplicate-person.js \
 *       --project mosaic-hymn-database --i-mean-prod \
 *       --from qBZMVskmS1CBJl8aCPcT --to Rqu2n9V9vRBLF8TKkEwg
 *
 * Optional: --attendance-conflict keep-target — when both people have an
 * attendance doc on the same occurrence, keep the target's and delete the source's.
 */

const path = require('path');
const Merge = require('../public/merge-duplicate-person-core.js');
const {loadProject} = require('./firebase-project.js');

// Pre-notifications archive; not named in shared cores (see test/notification-migration.test.js).
const LEGACY_PERSON_REF_COLLECTIONS = Object.freeze(['sms_messages']);

const PERSON_ROOT_PREFIX = 'people/';

function committing(argv) {
    return argv.includes('--commit');
}

function willWrite(argv) {
    return committing(argv) && argv.includes('--i-mean-prod');
}

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? null : process.argv[i + 1];
}

function attendanceConflictMode(argv) {
    const flag = '--attendance-conflict';
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
        throw new Error('Pass --attendance-conflict keep-target (or omit the flag).');
    }
    if (value !== 'keep-target') {
        throw new Error(`Unknown --attendance-conflict value "${value}" (only keep-target is supported).`);
    }
    return value;
}

function logChange(collection, change) {
    console.log(JSON.stringify({ collection, change }));
}

function toPathForPerson(fromPath, fromId, toId) {
    const prefix = `${PERSON_ROOT_PREFIX}${fromId}/`;
    if (!fromPath.startsWith(prefix)) {
        throw new Error(`Expected path under ${prefix}, got ${fromPath}`);
    }
    return `${PERSON_ROOT_PREFIX}${toId}/${fromPath.slice(prefix.length)}`;
}

/**
 * Post-order walk of every document under a person via listCollections() (recursive).
 * @param {FirebaseFirestore.DocumentReference} personRef
 * @return {Promise<Array<{ fromPath: string, data: object }>>}
 */
async function collectPersonSubtreeDocs(personRef) {
    const out = [];

    async function walk(ref) {
        const subcols = await ref.listCollections();
        for (const col of subcols) {
            const snap = await col.get();
            for (const doc of snap.docs) {
                await walk(doc.ref);
                out.push({
                    fromPath: doc.ref.path,
                    data: doc.data() || {},
                });
            }
        }
    }

    await walk(personRef);
    return out;
}

async function planPersonSubtreeMoves(db, fromId, toId, toName, plan) {
    const fromRef = db.collection('people').doc(fromId);
    const rows = await collectPersonSubtreeDocs(fromRef);
    for (const row of rows) {
        const toPath = toPathForPerson(row.fromPath, fromId, toId);
        const targetExists = (await db.doc(toPath).get()).exists;
        const move = Merge.planPersonSubdocMove(
            row.fromPath, toPath, row.data, targetExists, fromId, toId, toName);
        if (move.action === 'conflict') plan.conflicts.push(move);
        else plan.personMoves.push(move);
    }
}

async function scanTopLevel(db, collection, fromId, toId, toName, plan) {
    const snap = await db.collection(collection).get();
    for (const doc of snap.docs) {
        if (collection === 'people' && doc.id === fromId) continue;
        const data = doc.data() || {};
        const result = Merge.planDocumentRepoint(collection, doc.id, data, fromId, toId, toName);
        result.conflicts.forEach((c) => plan.conflicts.push(c));
        if (result.changed && result.patch) {
            plan.updates.push({
                collection,
                docId: doc.id,
                path: `${collection}/${doc.id}`,
                patch: result.patch,
            });
        }
    }
}

async function scanCollectionGroup(db, subcollection, fromId, toId, toName, plan, scanOptions) {
    const snap = await db.collectionGroup(subcollection).get();
    const fromPrefix = `${PERSON_ROOT_PREFIX}${fromId}/`;
    for (const doc of snap.docs) {
        if (doc.ref.path.startsWith(fromPrefix)) {
            continue;
        }
        const data = doc.data() || {};
        const docPath = doc.ref.path;
        const parentCollection = doc.ref.parent.parent ? doc.ref.parent.parent.id : null;

        if (subcollection === 'attendance' && doc.id === fromId) {
            const occId = doc.ref.parent.parent.id;
            const targetRef = doc.ref.parent.doc(toId);
            const targetSnap = await targetRef.get();
            const move = Merge.planAttendanceDocMove(
                occId, fromId, toId, data, targetSnap.exists, scanOptions);
            if (move.action === 'conflict') plan.conflicts.push(move);
            else if (move.action === 'attendance_keep_target') plan.attendanceKeepTarget.push(move);
            else plan.moves.push(move);
            continue;
        }

        if (subcollection === 'roster' && data.personId === fromId) {
            plan.updates.push({
                collection: 'roster',
                docId: doc.id,
                path: docPath,
                patch: Object.assign({}, data, { personId: toId }),
            });
            continue;
        }

        const result = Merge.planDocumentRepoint(parentCollection || subcollection, doc.id, data, fromId, toId, toName);
        result.conflicts.forEach((c) => plan.conflicts.push(Object.assign({ path: docPath }, c)));
        if (result.changed && result.patch) {
            plan.updates.push({
                collection: parentCollection || subcollection,
                docId: doc.id,
                path: docPath,
                patch: result.patch,
            });
        }
    }
}

async function countPersonSubtreeRemaining(db, fromId) {
    const fromRef = db.collection('people').doc(fromId);
    const rows = await collectPersonSubtreeDocs(fromRef);
    const samples = rows.map((r) => r.fromPath);
    let count = rows.length;
    const fromSnap = await fromRef.get();
    if (fromSnap.exists) {
        count += 1;
        if (samples.length < 20) samples.push(`${PERSON_ROOT_PREFIX}${fromId}`);
    }
    return { count, samples };
}

async function countRemainingReferences(db, fromId) {
    let count = 0;
    const samples = [];

    const subtree = await countPersonSubtreeRemaining(db, fromId);
    count += subtree.count;
    subtree.samples.forEach((p) => {
        if (samples.length < 20) samples.push(p);
    });

    const collections = Merge.TOP_LEVEL_COLLECTIONS.concat(LEGACY_PERSON_REF_COLLECTIONS);
    for (const collection of collections) {
        const snap = await db.collection(collection).get();
        for (const doc of snap.docs) {
            if (collection === 'people' && doc.id === fromId) continue;
            const data = doc.data() || {};
            if (Merge.documentContainsPersonId(data, fromId)) {
                count += 1;
                if (samples.length < 20) samples.push(`${collection}/${doc.id}`);
            }
        }
    }

    const fromPrefix = `${PERSON_ROOT_PREFIX}${fromId}/`;
    for (const sub of Merge.COLLECTION_GROUP_SUBCOLLECTIONS) {
        const snap = await db.collectionGroup(sub).get();
        for (const doc of snap.docs) {
            if (doc.ref.path.startsWith(fromPrefix)) continue;
            if (sub === 'attendance' && doc.id === fromId) {
                count += 1;
                if (samples.length < 20) samples.push(doc.ref.path);
                continue;
            }
            const data = doc.data() || {};
            if (Merge.documentContainsPersonId(data, fromId)) {
                count += 1;
                if (samples.length < 20) samples.push(doc.ref.path);
            }
        }
    }

    return { count, samples };
}

async function applyPlan(db, plan) {
    const batchSize = 200;
    let batch = db.batch();
    let batchCount = 0;

    const flush = async () => {
        if (batchCount > 0) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    };

    const personMoves = Merge.sortMovesByDepthDesc(plan.personMoves || []);
    const otherMoves = Merge.sortMovesByDepthDesc(plan.moves || []);

    for (const move of personMoves.concat(otherMoves)) {
        const fromRef = db.doc(move.fromPath);
        const toRef = db.doc(move.toPath);
        batch.set(toRef, move.data, { merge: true });
        batch.delete(fromRef);
        batchCount += 2;
        if (batchCount >= batchSize) await flush();
    }

    for (const upd of plan.updates) {
        const ref = db.doc(upd.path);
        batch.set(ref, upd.patch, { merge: true });
        batchCount += 1;
        if (batchCount >= batchSize) await flush();
    }

    for (const row of plan.attendanceKeepTarget || []) {
        batch.delete(db.doc(row.dropPath));
        batchCount += 1;
        if (batchCount >= batchSize) await flush();
    }

    await flush();
}

async function main() {
    const argv = process.argv;
    const projectId = require('./firebase-project').requireProject(argv);
    const COMMIT = willWrite(argv);
    if (committing(argv) && !COMMIT) {
        throw new Error('--commit against the church project also needs --i-mean-prod.');
    }

    const fromId = arg('--from');
    const toId = arg('--to');
    if (!fromId || !toId) {
        throw new Error('Pass --from <personId> and --to <personId>.');
    }
    if (fromId === toId) {
        throw new Error('--from and --to must differ.');
    }

    const project = loadProject(path.join(__dirname, '..'), projectId);
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(require(require('./service-account').serviceAccountPath())),
            projectId,
            storageBucket: project.storageBucket,
        });
    }
    const db = admin.firestore();

    const [fromSnap, toSnap] = await Promise.all([
        db.collection('people').doc(fromId).get(),
        db.collection('people').doc(toId).get(),
    ]);
    if (!fromSnap.exists) {
        throw new Error(`Source person ${fromId} does not exist.`);
    }
    if (!toSnap.exists) {
        throw new Error(`Target person ${toId} does not exist.`);
    }
    const toName = (toSnap.data() && toSnap.data().name) || '';
    const attendanceConflict = attendanceConflictMode(argv);

    const plan = {
        fromId,
        toId,
        updates: [],
        moves: [],
        personMoves: [],
        attendanceKeepTarget: [],
        conflicts: [],
        deleteFromPerson: false,
    };

    const scanOptions = attendanceConflict ? { attendanceConflict } : {};

    await planPersonSubtreeMoves(db, fromId, toId, toName, plan);

    const collections = Merge.TOP_LEVEL_COLLECTIONS.concat(LEGACY_PERSON_REF_COLLECTIONS);
    for (const collection of collections) {
        await scanTopLevel(db, collection, fromId, toId, toName, plan);
    }

    for (const sub of Merge.COLLECTION_GROUP_SUBCOLLECTIONS) {
        await scanCollectionGroup(db, sub, fromId, toId, toName, plan, scanOptions);
    }

    const fromData = fromSnap.data() || {};
    const toData = toSnap.data() || {};
    const fromUserId = fromData.userId || null;
    const toUserId = toData.userId || null;
    if (fromUserId && !toUserId) {
        plan.updates.push({
            collection: 'users',
            docId: fromUserId,
            path: `users/${fromUserId}`,
            patch: { personId: toId },
        });
        plan.updates.push({
            collection: 'people',
            docId: toId,
            path: `people/${toId}`,
            patch: { userId: fromUserId },
        });
    } else if (fromUserId && toUserId && fromUserId !== toUserId) {
        plan.conflicts.push({
            reason: 'both_people_linked_to_different_users',
            fromUserId,
            toUserId,
        });
    }

    const byCollection = {};
    plan.updates.forEach((u) => {
        const key = u.collection;
        byCollection[key] = (byCollection[key] || 0) + 1;
        logChange(key, { action: 'update', path: u.path });
    });
    plan.personMoves.forEach((m) => {
        byCollection.people = (byCollection.people || 0) + 1;
        logChange('people', {
            action: 'move_subcollection',
            fromPath: m.fromPath,
            toPath: m.toPath,
        });
    });
    plan.moves.forEach((m) => {
        const key = m.fromPath.split('/')[0];
        byCollection[key] = (byCollection[key] || 0) + 1;
        logChange(key, m);
    });
    plan.attendanceKeepTarget.forEach((row) => {
        byCollection.event_occurrences = (byCollection.event_occurrences || 0) + 1;
        logChange('event_occurrences', {
            action: 'attendance_keep_target',
            occurrenceId: row.occurrenceId,
            keepPath: row.keepPath,
            dropPath: row.dropPath,
        });
    });
    plan.conflicts.forEach((c) => logChange('conflicts', c));

    if (plan.conflicts.length) {
        console.error(`Abort: ${plan.conflicts.length} conflict(s). Resolve manually before --commit.`);
        process.exit(1);
    }

    if (COMMIT) {
        await applyPlan(db, plan);
        const remaining = await countRemainingReferences(db, fromId);
        if (remaining.count > 0) {
            console.error(JSON.stringify({ remaining }, null, 2));
            throw new Error(
                `Source person still has ${remaining.count} reference(s); not deleting people/${fromId}.`);
        }
        await db.collection('people').doc(fromId).delete();
        plan.deleteFromPerson = true;
    } else {
        const remaining = await countRemainingReferences(db, fromId);
        plan.deleteFromPerson = remaining.count <= 1;
    }

    console.log(JSON.stringify({
        mode: COMMIT ? 'commit' : 'dry-run',
        projectId,
        fromId,
        toId,
        attendanceConflict: attendanceConflict || null,
        counts: {
            updates: plan.updates.length,
            personMoves: plan.personMoves.length,
            moves: plan.moves.length,
            attendanceKeepTarget: plan.attendanceKeepTarget.length,
            conflicts: plan.conflicts.length,
            byCollection,
        },
        wouldDeleteFromPerson: plan.deleteFromPerson,
    }, null, 2));
}

module.exports = {
    scanTopLevel,
    countRemainingReferences,
    collectPersonSubtreeDocs,
    planPersonSubtreeMoves,
    toPathForPerson,
};

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
