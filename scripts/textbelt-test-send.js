/**
 * Send one Textbelt SMS to Jonathan Harris's phone only.
 *
 * The default payload omits replyWebhookUrl. --with-reply-webhook attaches
 * the church smsInbound URL and nothing else. It does not flip
 * includeReplyWebhookInSms. Prove that send before the flag script.
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
 *
 * The service date is the next Sunday in the 21-day window where he is a
 * pastoral-prayer subject. When none is, commit creates services/2099-06-08
 * (ops only, not a congregational Sunday) if that document is absent, naming
 * only him. It does not edit a live Sunday.
 */

const path = require('path');
const admin = require('firebase-admin');
const answerDoor = require('../functions/answer-link-door');
const liturgyCatalog = require('../functions/liturgy-catalog');
const {
    resolveTextbeltKey,
    fetchTextbeltKeyFromSecretManager,
} = require('./textbelt-key-lib');
const {executeTextbeltTestSend} = require('./textbelt-test-send-lib');
const {loadProject} = require('./firebase-project');

/**
 * @param {string} projectId
 * @return {*}
 */
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

/**
 * @param {*} doc
 * @return {{id: string, data: *}}
 */
function serviceDocRow(doc) {
    const id = doc && doc.id ? String(doc.id) : '';
    const data = doc && typeof doc.data === 'function' ? (doc.data() || {}) : {};
    return {id, data};
}

async function main() {
    const commit = process.argv.includes('--commit');
    const withUrl = process.argv.includes('--with-url');
    const withReplyWebhook = process.argv.includes('--with-reply-webhook');
    const projectId = require('./firebase-project').requireProject(process.argv);
    const project = loadProject(path.join(__dirname, '..'), projectId);
    const db = initAdmin(projectId);

    await executeTextbeltTestSend({
        commit,
        withUrl,
        withReplyWebhook,
        replyWebhookUrl: withReplyWebhook ? project.smsReplyWebhookUrl : '',
        db,
        now: () => new Date(),
        listServiceDocs: async (todayDate, horizon) => {
            const snap = await db.collection('services')
                .where(admin.firestore.FieldPath.documentId(), '>', todayDate)
                .where(admin.firestore.FieldPath.documentId(), '<=', horizon)
                .get();
            const docs = Array.isArray(snap.docs) ? snap.docs : [];
            return docs.map(serviceDocRow);
        },
        loadCatalog: () => liturgyCatalog.loadLiturgyCatalog(db),
        mintAnswerLink: (mintArgs) => answerDoor.mintAnswerLink(db, mintArgs),
        resolveKey: () => resolveTextbeltKey(
            projectId,
            process.env.TEXTBELT_KEY || null,
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
