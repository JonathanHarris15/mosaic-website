// @ts-nocheck
const admin = require('firebase-admin');
const liturgyCatalog = require('../functions/liturgy-catalog');
const pr = require('../functions/prayer-request');
const preview = require('./prayer-request-send-preview-lib');

const PRAYER_CONFIG_DOC = 'app_config/prayer_request_sms';

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? null : process.argv[i + 1];
}

function initAdmin(projectId) {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(require(require('./service-account').serviceAccountPath())),
            projectId,
        });
    }
    return admin.firestore();
}

async function loadPrayerConfig(db) {
    const snap = await db.doc(PRAYER_CONFIG_DOC).get();
    const data = snap.exists ? snap.data() : {};
    return {
        templates: pr.resolveTemplates(data),
        autoSendEnabled: !!data.autoSendEnabled,
        includeAnswerLinkInSms: pr.prayerSmsIncludeAnswerLink(data),
        includeReplyWebhookInSms: pr.prayerSmsIncludeReplyWebhook(data),
    };
}

async function pickServiceDate(db, today, explicit) {
    if (explicit) return explicit;
    const snap = await db.collection('services')
        .where(admin.firestore.FieldPath.documentId(), '>=', today)
        .limit(5).get();
    const ids = snap.docs.map((d) => d.id).filter((id) =>
        /^\d{4}-\d{2}-\d{2}$/.test(id)).sort();
    if (!ids.length) throw new Error('No upcoming service documents found.');
    return ids[0];
}

async function main() {
    const projectId = require('./firebase-project').requireProject(process.argv);
    const db = initAdmin(projectId);
    const now = new Date();
    const {date: today, hour: localHour} = pr.churchDateParts(now);
    const serviceDate = await pickServiceDate(db, today, arg('--service-date'));
    const cfg = await loadPrayerConfig(db);
    const {templates, includeLink} = preview.resolvedSmsTemplates(cfg);
    const svcSnap = await db.collection('services').doc(serviceDate).get();
    if (!svcSnap.exists) throw new Error(`services/${serviceDate} missing.`);
    const plan = preview.prayerPlanForService(svcSnap.data() || {}, await liturgyCatalog.loadLiturgyCatalog(db));

    console.log('DRY RUN — pastoral-prayer SMS preview (no sends, no writes)');
    console.log(`today: ${today} hour ${localHour} | service: ${serviceDate}`);
    console.log(`includeAnswerLinkInSms: ${cfg.includeAnswerLinkInSms}`);
    console.log(`includeReplyWebhookInSms: ${cfg.includeReplyWebhookInSms}`);
    console.log('live send: sendPrayerRequestTexts when flags on');
    console.log('Jonathan URL test: textbelt-test-send.js --with-url commit=true\n');

    const wouldSend = [];
    for (const subject of plan.subjects) {
        if (!(subject.noticeDays > 0)) continue;
        const personSnap = await db.collection('people').doc(subject.id).get();
        const person = personSnap.exists ? personSnap.data() : {};
        const req = (await db.collection('people').doc(subject.id)
            .collection('prayer_requests').doc(serviceDate).get()).data() || {};
        const phone = preview.phoneE164Of(person);
        const tokens = person.userId ?
            await db.collection('users').doc(person.userId)
                .collection('push_tokens').limit(1).get() : {size: 0};
        const row = {
            noticeDays: subject.noticeDays,
            noticeList: subject.noticeList,
            phoneE164: phone,
            hasDeviceToken: tokens.size > 0,
        };
        if (preview.skipReasonForSubject(row, req, today, localHour, serviceDate)) {
            continue;
        }
        const askPlan = pr.prayerAskPlan(Object.assign({}, row, {
            daysUntilService: pr.daysUntil(serviceDate, today),
            localHour,
            hasPhone: !!phone,
            requestFilled: !!(req.prayerRequest || '').trim(),
            initialSentDate: req.initialSentDate || null,
            reminderSent: !!req.reminderSent,
            reminderSentDate: req.reminderSentDate || null,
            lastSendAttemptDate: req.lastSendAttemptDate || null,
            sentDays: req.sentDays || [],
            today,
            reminderDays: pr.reminderDaysFor(subject.noticeDays),
        }));
        const body = preview.previewBodyForAsk({
            kind: askPlan.action,
            firstName: person.name || subject.name,
            templates,
            includeLink,
            customMessage: subject.message || '',
        });
        wouldSend.push({
            name: person.name || subject.name || '',
            personId: subject.id,
            kind: askPlan.action,
            body: body.body,
        });
    }
    console.log(`Recipients that would be sent now: ${wouldSend.length}`);
    wouldSend.forEach((r, i) => {
        console.log(`\n[${i + 1}] ${r.name} (${r.kind}) people/${r.personId}`);
        console.log(r.body);
    });
}

main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
