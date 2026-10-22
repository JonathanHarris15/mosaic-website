// @ts-nocheck
const pr = require('../functions/prayer-request');
const al = require('../functions/answer-link');
const LiturgyOrders = require('../functions/shared/liturgy-order-core');
const {toE164US} = require('../functions/sms');

const PREVIEW_ANSWER_URL = al.buildAnswerUrl(
    al.mintAnswerToken(Buffer.alloc(16, 1)),
);

function resolvedSmsTemplates(config) {
    const includeLink = config.includeAnswerLinkInSms === true;
    return {
        templates: pr.preparePrayerSmsTextTemplates(config.templates, includeLink),
        includeLink,
    };
}

function previewBodyForAsk(args) {
    const {kind, firstName, templates, includeLink, customMessage} = args;
    const name = pr.firstNameOf(firstName) || 'there';
    let tpl = templates;
    if (customMessage && (kind === 'initial' || kind === 'reminder')) {
        const merged = Object.assign({}, templates);
        merged[kind] = pr.messageWithLink(customMessage, includeLink) || merged[kind];
        tpl = merged;
    }
    const url = includeLink ? PREVIEW_ANSWER_URL : null;
    return {
        body: pr.renderPrayerRequestMessage(kind, name, tpl, url, includeLink),
        previewAnswerUrl: url,
    };
}

function prayerPlanForService(service, catalog) {
    const liturgy = (service && service.liturgy) || {};
    const order = LiturgyOrders.orderFor(service || {}, catalog);
    return pr.prayerNoticePlan({liturgy, elements: order.elements});
}

function skipReasonForSubject(subject, req, today, localHour, serviceDate) {
    const plan = pr.prayerAskPlan({
        daysUntilService: pr.daysUntil(serviceDate, today),
        localHour,
        hasPhone: !!subject.phoneE164,
        hasDeviceToken: subject.hasDeviceToken,
        requestFilled: !!(req.prayerRequest || '').trim(),
        initialSentDate: req.initialSentDate || null,
        reminderSent: !!req.reminderSent,
        reminderSentDate: req.reminderSentDate || null,
        lastSendAttemptDate: req.lastSendAttemptDate || null,
        sentDays: req.sentDays || [],
        today,
        noticeDays: subject.noticeDays,
        noticeList: subject.noticeList,
        reminderDays: pr.reminderDaysFor(subject.noticeDays),
    });
    return plan.action === 'none' ?
        {reason: 'not_due_or_blocked', plan} : null;
}

function phoneE164Of(person) {
    return toE164US(person && person.contact && person.contact.phone) || '';
}

module.exports = {
    PREVIEW_ANSWER_URL,
    resolvedSmsTemplates,
    previewBodyForAsk,
    prayerPlanForService,
    skipReasonForSubject,
    phoneE164Of,
};
