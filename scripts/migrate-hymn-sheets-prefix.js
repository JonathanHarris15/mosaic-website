/**
 * MS-769 — move hymn sheet objects from the bucket root to hymn-sheets/.
 *
 * Rewrites hymns/{id}.versions[].pages[] download URLs after copying bytes.
 * Dry-run by default. Prod needs --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/migrate-hymn-sheets-prefix.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/migrate-hymn-sheets-prefix.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 *
 * Run the dry run before deploying storage.rules without the catch-all.
 * Root objects are left in place until a follow-up cleanup (see docs/ops/).
 */

const crypto = require('crypto');

const Core = require('../public/hymn-sheets-core.js');
const {loadProject} = require('./firebase-project.js');

function committing(argv) {
    return argv.includes('--commit');
}

function willWrite(argv) {
    return committing(argv) && argv.includes('--i-mean-prod');
}

function pageUrl(page) {
    if (page == null) return '';
    if (typeof page === 'string') return page.trim();
    if (typeof page === 'object') return String(page.url || page.src || '').trim();
    return '';
}

/**
 * @param {string} url
 * @param {string} bucketName
 * @return {?{from: string, to: string, url: string}}
 */
function planUrl(url, bucketName) {
    const from = Core.pathFromDownloadUrl(url);
    if (!from) return null;
    const to = Core.destinationPathForLegacy(from);
    if (!to) return null;
    const token = crypto.randomUUID();
    return {
        from,
        to,
        url: Core.downloadUrlFor(bucketName, to, token),
        token,
    };
}

/**
 * Pure plan for one hymn document.
 * @param {object} hymn Firestore data
 * @param {string} bucketName
 * @return {{id: string, hymn_name: string, copies: Array, pages: Array}}
 */
function planHymn(hymn, bucketName) {
    const id = hymn.id;
    const versions = Array.isArray(hymn.versions) ? hymn.versions : [];
    const copies = [];
    const nextVersions = versions.map((version) => {
        const pages = Array.isArray(version.pages) ? version.pages : [];
        const nextPages = pages.map((page) => {
            const url = pageUrl(page);
            if (!url) return page;
            const move = planUrl(url, bucketName);
            if (!move) return page;
            copies.push(move);
            if (typeof page === 'string') return move.url;
            return Object.assign({}, page, {url: move.url});
        });
        return Object.assign({}, version, {pages: nextPages});
    });
    return {
        id,
        hymn_name: hymn.hymn_name || id,
        copies,
        versions: nextVersions,
    };
}

module.exports = {planHymn, planUrl, pageUrl, willWrite, committing};

if (require.main === module) {
    (async () => {
        const argv = process.argv;
        const projectId = require('./firebase-project').requireProject(argv);
        const COMMIT = willWrite(argv);
        if (committing(argv) && !COMMIT) {
            throw new Error('--commit against the church project also needs --i-mean-prod.');
        }

        const project = loadProject(require('path').join(__dirname, '..'), projectId);
        const bucketName = project.storageBucket;

        const admin = require('firebase-admin');
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.applicationDefault(),
                projectId,
                storageBucket: bucketName,
            });
        }
        const db = admin.firestore();
        const bucket = admin.storage().bucket();

        const snap = await db.collection('hymns').get();
        let hymnsTouched = 0;
        let copiesPlanned = 0;
        let copiesDone = 0;
        let hymnsUpdated = 0;

        console.log(`${COMMIT ? 'COMMIT' : 'DRY RUN'} — hymn-sheets migration on ${projectId}`);
        console.log(`hymns in Firestore: ${snap.size}\n`);

        for (const doc of snap.docs) {
            const plan = planHymn(Object.assign({id: doc.id}, doc.data()), bucketName);
            if (!plan.copies.length) continue;
            hymnsTouched++;
            copiesPlanned += plan.copies.length;
            console.log(`hymns/${plan.id} (${plan.hymn_name}): ${plan.copies.length} page(s)`);
            for (const copy of plan.copies) {
                console.log(`  ${copy.from} → ${copy.to}`);
            }

            if (!COMMIT) continue;

            for (const copy of plan.copies) {
                const src = bucket.file(copy.from);
                const dest = bucket.file(copy.to);
                const [exists] = await dest.exists();
                if (!exists) {
                    await src.copy(dest);
                }
                await dest.setMetadata({
                    metadata: {firebaseStorageDownloadTokens: copy.token},
                });
                copiesDone++;
            }
            await doc.ref.update({versions: plan.versions});
            hymnsUpdated++;
        }

        console.log('\nSummary:');
        console.log(`  hymns with legacy URLs: ${hymnsTouched}`);
        console.log(`  storage copies ${COMMIT ? 'done' : 'planned'}: ${COMMIT ? copiesDone : copiesPlanned}`);
        if (COMMIT) {
            console.log(`  hymns updated in Firestore: ${hymnsUpdated}`);
            console.log('\nRoot objects were not deleted. See docs/ops/ms-769-hymn-sheets-migration.md.');
        } else {
            console.log('\nNo changes written. Re-run with --commit after review.');
        }
    })().catch((err) => {
        console.error(err.message || err);
        process.exit(1);
    });
}
