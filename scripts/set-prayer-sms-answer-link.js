/**
 * Turn on Answer links in live pastoral-prayer SMS.
 *
 * Merges includeAnswerLinkInSms: true into app_config/prayer_request_sms.
 * Does not write includeReplyWebhookInSms and does not replace the document.
 *
 *   node scripts/set-prayer-sms-answer-link.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/set-prayer-sms-answer-link.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const {executeSetAnswerLinkFlag} = require('./set-prayer-sms-answer-link-lib');

/**
 * @param {string} projectId
 * @return {*}
 */
function initAdmin(projectId) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(
                require(require('./service-account').serviceAccountPath())),
            projectId,
        });
    }
    return admin.firestore();
}

async function main() {
    const commit = process.argv.includes('--commit');
    const projectId = require('./firebase-project').requireProject(process.argv);
    const db = initAdmin(projectId);
    await executeSetAnswerLinkFlag({commit, db, log: console.log});
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err.message || err);
        process.exit(1);
    });
}
