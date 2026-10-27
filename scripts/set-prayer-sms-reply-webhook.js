/**
 * Turn on Textbelt reply webhooks for live pastoral-prayer SMS.
 *
 * Merges includeReplyWebhookInSms: true into app_config/prayer_request_sms.
 * Does not write includeAnswerLinkInSms and does not replace the document.
 *
 * Run only after textbelt-test-send.js --with-reply-webhook is accepted.
 * See docs/ops/ms-prayer-sms-reply-webhook-flag.md.
 *
 *   node scripts/set-prayer-sms-reply-webhook.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/set-prayer-sms-reply-webhook.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const {executeSetReplyWebhookFlag} = require('./set-prayer-sms-reply-webhook-lib');

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
    await executeSetReplyWebhookFlag({commit, db, log: console.log});
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err.message || err);
        process.exit(1);
    });
}
