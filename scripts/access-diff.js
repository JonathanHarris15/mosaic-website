#!/usr/bin/env node
/**
 * Read-only diff of live account access against the canonical resolver.
 *
 * For every users/{uid} document, compares Firestore rules, Storage rules,
 * the client session, rankOf, and the publicForm rank with the single
 * resolver that reads only accountLevelId and permissions.
 *
 *   node scripts/access-diff.js --project mosaic-hymn-database --i-mean-prod
 *
 * --commit is ignored. This script never writes. Safe for the Prod ops
 * workflow with commit=false. Do not dispatch commit=true: there is
 * nothing to apply. A public run log is public: uids are an 8-character
 * prefix, and emails are not read.
 */

'use strict';

const admin = require('firebase-admin');
const Core = require('./access-diff-core.js');
const {requireProject, PROD_PROJECT_ID} = require('./firebase-project');

/**
 * @param {string[]} argv
 */
function main(argv) {
    if (argv.includes('--commit')) {
        console.log('Note: --commit is ignored. This script never writes.');
    }
    const projectId = requireProject(argv);
    if (projectId !== PROD_PROJECT_ID) {
        throw new Error('This diff reads ' + PROD_PROJECT_ID + ' only.');
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
 * @returns {Promise<import('./access-diff-core.js').DiffReport>}
 */
async function run(db) {
    const [usersSnap, levelsSnap] = await Promise.all([
        db.collection('users').get(),
        db.collection('account_levels').get(),
    ]);
    /** @type {Record<string, unknown>} */
    const levels = {};
    levelsSnap.docs.forEach((doc) => {
        levels[doc.id] = doc.data() || {};
    });
    /** @type {Array<{uid: string, user: unknown, levelDoc?: unknown}>} */
    const rows = usersSnap.docs.map((doc) => {
        const user = doc.data() || {};
        const levelId = user && typeof user.accountLevelId === 'string' ? user.accountLevelId : '';
        return {
            uid: doc.id,
            user,
            levelDoc: levelId ? levels[levelId] : undefined,
        };
    });
    return Core.report(rows);
}

main(process.argv).catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});
