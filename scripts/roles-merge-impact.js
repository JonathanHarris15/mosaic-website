#!/usr/bin/env node
/**
 * Read-only check of who the Roles fixes in PR 346 would change in production.
 *
 * Lists the accounts that lose an editor door on People (MS-821), the
 * accounts whose link to a Person no longer counts for the Roles callables
 * (MS-811), and the stored Roles the new shape check would refuse to save.
 *
 *   node scripts/roles-merge-impact.js --project mosaic-hymn-database --i-mean-prod
 *
 * --commit is ignored. This script never writes. Safe for the Prod ops
 * workflow with commit=false. A run log is public: uids are an 8-character
 * prefix, and no email or name is read or printed. People are read for
 * their userId field only.
 */

'use strict';

const admin = require('firebase-admin');
const Core = require('./roles-merge-impact-core.js');
const {requireProject, PROD_PROJECT_ID} = require('./firebase-project');

/**
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
function main(argv) {
    if (argv.includes('--commit')) {
        console.log('Note: --commit is ignored. This script never writes.');
    }
    const projectId = requireProject(argv);
    if (projectId !== PROD_PROJECT_ID) {
        throw new Error('This check reads ' + PROD_PROJECT_ID + ' only.');
    }
    const credPath = require('./service-account').serviceAccountPath();
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(require(credPath)),
            projectId,
        });
    }
    return run(admin.firestore()).then((report) => {
        console.log(Core.formatText(report));
    });
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @returns {Promise<import('./roles-merge-impact-core.js').ImpactReport>}
 */
async function run(db) {
    const [usersSnap, peopleSnap, rolesSnap] = await Promise.all([
        db.collection('users').select('accountLevelId', 'permissions', 'personId').get(),
        db.collection('people').select('userId').get(),
        db.collection('roles').get(),
    ]);
    /** @param {import('firebase-admin').firestore.QuerySnapshot} snap */
    const rows = (snap) => snap.docs.map((doc) => ({id: doc.id, data: doc.data() || {}}));
    return Core.report(rows(usersSnap), rows(peopleSnap), rows(rolesSnap));
}

main(process.argv).catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});
