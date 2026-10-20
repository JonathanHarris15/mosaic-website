/**
 * Send one Textbelt SMS to Jonathan Harris's phone only — no replyWebhookUrl.
 *
 * Dry-run prints target and body. Commit sends and prints the full Textbelt JSON.
 *
 *   node scripts/textbelt-test-send.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/textbelt-test-send.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 *
 * On --commit, reads TEXTBELT_KEY from the environment when set, otherwise
 * Secret Manager in the target project (same secret id as Cloud Functions).
 */

const admin = require('firebase-admin');
const {interpretSend} = require('../functions/sms');
const {
    resolveTextbeltKey,
    fetchTextbeltKeyFromSecretManager,
} = require('./textbelt-key-lib');
const {
    JONATHAN_HARRIS_NAME,
    DEFAULT_MESSAGE,
    phoneFromPerson,
    isJonathanHarris,
    textbeltPayload,
} = require('./textbelt-test-send-lib');

function initAdmin(projectId) {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(require(require('./service-account').serviceAccountPath())),
            projectId,
        });
    }
    return admin.firestore();
}

async function resolveJonathanPerson(db) {
    const snap = await db.collection('people')
        .where('name', '==', JONATHAN_HARRIS_NAME)
        .limit(2)
        .get();
    if (snap.size !== 1) {
        throw new Error(
            `Expected exactly one people doc named ${JSON.stringify(JONATHAN_HARRIS_NAME)}; ` +
            `found ${snap.size}.`);
    }
    const doc = snap.docs[0];
    const data = doc.data() || {};
    if (!isJonathanHarris(data.name)) {
        throw new Error('Resolved person failed the Jonathan Harris name check.');
    }
    return {id: doc.id, data};
}

async function main() {
    const commit = process.argv.includes('--commit');
    const projectId = require('./firebase-project').requireProject(process.argv);
    const db = initAdmin(projectId);

    const {id, data} = await resolveJonathanPerson(db);
    const to = phoneFromPerson(data);
    const body = DEFAULT_MESSAGE;

    console.log(`${commit ? 'SEND' : 'DRY RUN'} — people/${id} (${JONATHAN_HARRIS_NAME})`);
    console.log(`to: ${to}`);
    console.log(`body: ${body}`);
    console.log('replyWebhookUrl: (omitted)');

    if (!commit) return;

    let key;
    let source;
    try {
        const resolved = await resolveTextbeltKey(
            projectId,
            process.env.TEXTBELT_KEY,
            fetchTextbeltKeyFromSecretManager);
        key = resolved.key;
        source = resolved.source;
    } catch (err) {
        const detail = err && err.message ? err.message : String(err);
        throw new Error(
            'Could not load TEXTBELT_KEY from env or Secret Manager. ' +
            detail);
    }
    console.log(`textbelt key source: ${source}`);

    const resp = await fetch('https://textbelt.com/text', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(textbeltPayload(to, body, key)),
    });
    const json = await resp.json();
    console.log('Textbelt response:');
    console.log(JSON.stringify(json, null, 2));
    const shaped = interpretSend(json);
    if (!shaped.success) {
        throw new Error(shaped.error || 'Textbelt send failed.');
    }
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
