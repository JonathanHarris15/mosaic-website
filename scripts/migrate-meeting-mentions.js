/**
 * Rewrite TipTap mention nodes that still use kind: 'meeting' (MS-792).
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 * Scans shepherding_notes contentJson and elder_documents contentJson.
 *
 *   node scripts/migrate-meeting-mentions.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/migrate-meeting-mentions.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const path = require('path');
const Migrate = require('../public/migrate-meeting-mentions-core.js');
const {loadProject} = require('./firebase-project.js');

function committing(argv) {
    return argv.includes('--commit');
}

function willWrite(argv) {
    return committing(argv) && argv.includes('--i-mean-prod');
}

/**
 * @param {FirebaseFirestore.QueryDocumentSnapshot[]} docs
 * @param {boolean} commit
 */
async function rewriteDocs(docs, commit) {
    let scanned = 0;
    let changed = 0;
    let mentions = 0;
    for (const doc of docs) {
        scanned += 1;
        const data = doc.data() || {};
        if (!data.contentJson) continue;
        const before = Migrate.countLegacyMentions(data.contentJson);
        if (!before) continue;
        const {doc: next, changed: did} = Migrate.rewriteContentJson(data.contentJson);
        if (!did) continue;
        mentions += before;
        changed += 1;
        if (commit) {
            await doc.ref.update({contentJson: next});
        }
    }
    return {scanned, changed, mentions};
}

async function scanNotesUnderPeople(db, commit) {
    const people = await db.collection('people').get();
    let scanned = 0;
    let changed = 0;
    let mentions = 0;
    for (const person of people.docs) {
        const notes = await person.ref.collection('shepherding_notes').get();
        for (const doc of notes.docs) {
            scanned += 1;
            const data = doc.data() || {};
            if (!data.contentJson) continue;
            const before = Migrate.countLegacyMentions(data.contentJson);
            if (!before) continue;
            const {doc: next, changed: did} = Migrate.rewriteContentJson(data.contentJson);
            if (!did) continue;
            mentions += before;
            changed += 1;
            if (commit) {
                await doc.ref.update({contentJson: next});
            }
        }
    }
    return {scanned, changed, mentions};
}

async function main() {
    const argv = process.argv;
    const projectId = require('./firebase-project').requireProject(argv);
    const COMMIT = willWrite(argv);
    if (committing(argv) && !COMMIT) {
        throw new Error('--commit against the church project also needs --i-mean-prod.');
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

    console.log(`\nMigrate meeting mentions (MS-792) — ${COMMIT ? 'COMMIT' : 'DRY RUN'}\n`);

    const notes = await scanNotesUnderPeople(db, COMMIT);
    const docs = await db.collection('elder_documents').get();
    const elderDocs = await rewriteDocs(docs.docs, COMMIT);

    const totals = {
        scanned: notes.scanned + elderDocs.scanned,
        changed: notes.changed + elderDocs.changed,
        mentions: notes.mentions + elderDocs.mentions,
    };

    console.log(`  notes scanned:     ${notes.scanned}`);
    console.log(`  elder_docs scanned: ${elderDocs.scanned}`);
    console.log(`  documents updated: ${totals.changed}`);
    console.log(`  mentions rewritten: ${totals.mentions}`);
    if (!COMMIT && totals.changed) {
        console.log('  (dry run — pass --commit with --i-mean-prod to apply)');
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {main};
