/**
 * Send one Textbelt SMS to Jonathan Harris's phone only — no replyWebhookUrl.
 *
 *   node scripts/textbelt-test-send.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/textbelt-test-send.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 *
 * --with-url builds the pastoral-prayer initial SMS. Dry-run prints the body
 * and serviceDate and does not mint. --commit mints a real Answer link for
 * people/CErA3v4J4hVm0iLfdG9Y through answer-link-door.mintAnswerLink (the
 * same call dispatchPrayerAsk makes) and sends that URL. Commit refuses
 * unless includeAnswerLinkInSms is already true.
 */

const admin = require('firebase-admin');
const answerDoor = require('../functions/answer-link-door');
const liturgyCatalog = require('../functions/liturgy-catalog');
const {
    resolveTextbeltKey,
    fetchTextbeltKeyFromSecretManager,
} = require('./textbelt-key-lib');
const {executeTextbeltTestSend} = require('./textbelt-test-send-lib');

function initAdmin(projectId) {
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
    const withUrl = process.argv.includes('--with-url');
    const projectId = require('./firebase-project').requireProject(process.argv);
    const db = initAdmin(projectId);

    await executeTextbeltTestSend({
        commit,
        withUrl,
        db,
        now: () => new Date(),
        listServiceDocs: async (todayDate, horizon) => {
            const snap = await db.collection('services')
                .where(admin.firestore.FieldPath.documentId(), '>', todayDate)
                .where(admin.firestore.FieldPath.documentId(), '<=', horizon)
                .get();
            return snap.docs.map((doc) => ({id: doc.id, data: doc.data() || {}}));
        },
        loadCatalog: () => liturgyCatalog.loadLiturgyCatalog(db),
        mintAnswerLink: (args) => answerDoor.mintAnswerLink(db, args),
        resolveKey: () => resolveTextbeltKey(
            projectId,
            process.env.TEXTBELT_KEY,
            fetchTextbeltKeyFromSecretManager),
        postText: async (payload) => {
            const resp = await fetch('https://textbelt.com/text', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload),
            });
            return resp.json();
        },
        log: console.log,
    });
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err.message || err);
        process.exit(1);
    });
}
