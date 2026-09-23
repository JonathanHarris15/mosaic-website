/**
 * @fileoverview MS-669 — Person name-parts backfill (ADR 0074, MS-659).
 *
 * One-shot, idempotent backfill that remembers parts beside a full name
 * when those parts say that same name. It writes `nameParts` only. It does
 * not change the full name and it does not write a Household.
 *
 * People who already have parts are skipped. People the reading refuses
 * are skipped. A second pass is a skip.
 *
 * Usage:
 *   node scripts/backfill-name-parts.js --project mosaic-hymn-database --i-mean-prod
 *   node scripts/backfill-name-parts.js --project mosaic-hymn-database --i-mean-prod --commit
 *
 * Dry run is the default. Applying `--commit` against the church directory
 * is MS-670: a person with the service account, not a cloud agent.
 */

const PersonName = require('../public/person-name.js');

function planPerson(person) {
    if (person && person.nameParts) return { write: false, reason: 'already' };
    const parts = PersonName.partsToRemember(person);
    if (!parts) return { write: false, reason: 'not-taken-apart' };
    return { write: true, update: { nameParts: parts } };
}

function committing(argv) {
    return argv.includes('--commit');
}

function allowedProject(argv) {
    return require('./firebase-project').requireProject(argv, {
        hardcoded: 'mosaic-hymn-database',
    });
}

module.exports = { planPerson, committing, allowedProject };

if (require.main === module) {
    const admin = require('firebase-admin');
    const path = require('path');
    const fs = require('fs');

    const projectId = allowedProject(process.argv);
    const COMMIT = committing(process.argv);

    function resolveServiceAccount() {
        const root = path.join(__dirname, '..');
        const match = fs.readdirSync(root).find(
            f => f.startsWith(projectId + '-firebase-adminsdk') && f.endsWith('.json')
        );
        if (!match) {
            throw new Error(
                'No ' + projectId + '-firebase-adminsdk-*.json found in project root.');
        }
        return require(path.join(root, match));
    }

    admin.initializeApp({
        credential: admin.credential.cert(resolveServiceAccount()),
        projectId: projectId,
    });
    const db = admin.firestore();

    async function backfillPeople() {
        const snap = await db.collection('people').get();
        let written = 0;
        let already = 0;
        let notTakenApart = 0;
        for (const doc of snap.docs) {
            const person = doc.data() || {};
            const plan = planPerson(person);
            if (!plan.write) {
                if (plan.reason === 'already') already += 1;
                else notTakenApart += 1;
                continue;
            }
            written += 1;
            const label = person.name || doc.id;
            console.log(`  ${COMMIT ? 'update' : 'would update'} ${label}`);
            if (COMMIT) {
                await doc.ref.update(plan.update);
            }
        }
        return { written, already, notTakenApart };
    }

    (async () => {
        console.log(
            '\nName-parts backfill (MS-659 / MS-669) — ' +
            (COMMIT ? 'COMMIT' : 'DRY RUN (use --commit to apply)') + '\n');
        const counts = await backfillPeople();
        console.log(
            '\nDone. ' + (COMMIT ? 'Wrote' : 'Would write') + ' ' + counts.written +
            ', already had parts ' + counts.already +
            ', not taken apart ' + counts.notTakenApart + '.'
        );
        if (!COMMIT) console.log('No changes were written. Re-run with --commit.\n');
        process.exit(0);
    })().catch(err => {
        console.error('Backfill failed:', err);
        process.exit(1);
    });
}
