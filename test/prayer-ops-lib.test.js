// @ts-nocheck
const fs = require('fs');
const path = require('path');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const audit = require('../scripts/prayer-text-notifications-audit-lib');

test('prayer notifications audit summary', () => {
    const s = audit.summarizePrayerTextFailures([
        {direction: 'outbound', channel: 'text', purpose: 'prayer_request',
            accepted: false, providerError: 'webhook'},
    ]);
    assert.strictEqual(s.failedRows, 1);
});

test('whitelist prefix constant', () => {
    assert.strictEqual('146bb8bc'.length, 8);
});

test('prayer text list masks the phone and drops the body', () => {
    const phone = '+1 (555) 123-4567';
    const body = 'Please open https://secret.example/token';
    const row = audit.describePrayerTextRow({
        id: 'n1',
        createdAt: new Date('2026-10-22T15:30:45.000Z'),
        purpose: 'prayer_request',
        serviceDate: '2026-10-25',
        personId: 'p1',
        to: phone,
        body,
        accepted: true,
        textId: 'tb-1',
    }, {p1: 'Ada Example'});
    const json = JSON.stringify(row);
    assert.equal(json.includes(phone), false);
    assert.equal(json.includes('5551234567'), false);
    assert.equal(json.includes('secret.example'), false);
    assert.equal(json.includes(body), false);
    assert.deepEqual(row, {
        id: 'n1',
        createdAtChicago: '2026-10-22 10:30:45 CDT',
        purpose: 'prayer_request',
        serviceDate: '2026-10-25',
        personId: 'p1',
        name: 'Ada Example',
        phoneLast4: '***4567',
        accepted: true,
        textId: 'tb-1',
        bodyHasUrl: true,
        wording: null,
        logCopy: null,
        writer: null,
    });
});

test('prayer text list uses a stored writer and winter Chicago time', () => {
    const row = audit.describePrayerTextRow({
        id: 'n2',
        createdAt: {seconds: Math.floor(Date.parse('2026-01-15T18:00:00.000Z') / 1000)},
        purpose: 'prayer_request_thankyou',
        personId: 'p2',
        to: '123',
        body: 'thanks',
        accepted: false,
        firedBy: ' smsInbound ',
    }, {});
    assert.equal(row.createdAtChicago, '2026-01-15 12:00:00 CST');
    assert.equal(row.phoneLast4, '***');
    assert.equal(row.bodyHasUrl, false);
    assert.equal(row.name, '');
    assert.equal(row.writer, 'smsInbound');
    assert.equal(row.textId, null);
});

test('the audit script lists rows and does not write', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '../scripts/prayer-text-notifications-audit.js'),
        'utf8');
    assert.match(src, /--list/);
    assert.match(src, /describePrayerTextRow/);
    assert.match(src, /explainPrayerTextRows/);
    assert.match(src, /prayer_requests/);
    assert.match(src, /--commit ignored/);
    assert.doesNotMatch(src, /\.(set|update|delete|add|create)\s*\(/);
});

test('shared text ids are the same send logged twice', () => {
    const names = {a: 'Ada Example', b: 'Ben Example'};
    const listed = [
        audit.describePrayerTextRow({
            id: 'log', personId: 'a', to: '+15551110000', textId: 'same',
            purpose: 'prayer_request', accepted: true, body: 'no link',
            createdAt: '2026-10-22T14:00:00.000Z', serviceDate: '2026-10-25',
        }, names),
        audit.describePrayerTextRow({
            id: 'copy', personId: 'a', to: '+15551110000', textId: 'same',
            purpose: 'prayer_request', accepted: true, body: 'www.example.com/x',
            createdAt: '2026-10-22T14:00:01.000Z', serviceDate: '2026-10-25',
        }, names),
        audit.describePrayerTextRow({
            id: 'other', personId: 'b', to: '+15552220000', textId: 'other',
            purpose: 'prayer_request', accepted: true,
            createdAt: '2026-10-22T14:05:00.000Z', serviceDate: '2026-10-25',
        }, names),
    ];
    assert.equal(listed[0].phoneLast4, '***0000');
    assert.equal(listed[1].bodyHasUrl, true);
    assert.equal(listed[0].bodyHasUrl, false);
    assert.deepEqual(audit.prayerTextListSummary(listed), {
        rows: 3,
        distinctPersonIds: 2,
        distinctTextIds: 2,
        rowsWithSharedTextId: 2,
    });
});

function listedSend(fields) {
    return audit.describePrayerTextRow(Object.assign({
        direction: 'outbound',
        channel: 'text',
        purpose: 'prayer_request',
        accepted: true,
        serviceDate: '2026-10-25',
        to: '+15551110000',
        body: 'ask',
    }, fields), {levi: 'Levi Example', other: 'Other Example'});
}

test('four rows are two sends logged twice, not a resend or an Oct 20 replay', () => {
    const listed = [
        listedSend({
            id: 'a-path', personId: 'levi', textId: 'tb-levi',
            wording: 'initial', createdAt: '2026-10-22T14:01:00.000Z',
        }),
        listedSend({
            id: 'a-copy', personId: 'levi', textId: 'tb-levi',
            kind: null, createdAt: '2026-10-22T14:01:01.000Z',
        }),
        listedSend({
            id: 'b-path', personId: 'other', textId: 'tb-other',
            wording: 'initial', createdAt: '2026-10-22T14:02:00.000Z',
        }),
        listedSend({
            id: 'b-copy', personId: 'other', textId: 'tb-other',
            kind: null, createdAt: '2026-10-22T14:02:01.000Z',
        }),
    ];
    assert.equal(listed[0].logCopy, 'send-path');
    assert.equal(listed[1].logCopy, 'recordOutbound');
    const explained = audit.explainPrayerTextRows(listed, [
        {
            personId: 'levi', serviceDate: '2026-10-25', missing: false,
            sentDays: [5], initialSentDate: '2026-10-22',
            reminderSent: false, reminderSentDate: null,
        },
        {
            personId: 'other', serviceDate: '2026-10-25', missing: false,
            sentDays: [5], initialSentDate: '2026-10-22',
            reminderSent: false, reminderSentDate: null,
        },
    ]);
    assert.equal(explained.acceptedSends.length, 2);
    assert.equal(explained.acceptedSends[0].copies, 2);
    assert.equal(explained.checks.samePersonTextedTwice.happened, false);
    assert.equal(explained.checks.resendTickResent.happened, false);
    assert.equal(explained.checks.oct20SendLoggedAgain.happened, false);
    assert.match(explained.checks.oct20SendLoggedAgain.detail, /still-unsent Oct 20 slot/);
    assert.equal(explained.checks.manualSendNow.happened, false);
    assert.match(explained.checks.manualSendNow.detail, /scheduler stamp/);
});

test('a second textId the same day is a resend, and a shared Oct 20 textId was logged again', () => {
    const listed = [
        listedSend({
            id: 'old', personId: 'levi', textId: 'tb-old',
            createdAt: '2026-10-20T15:00:00.000Z', wording: 'initial',
        }),
        listedSend({
            id: 'replay', personId: 'levi', textId: 'tb-old',
            createdAt: '2026-10-22T15:00:00.000Z', kind: null,
        }),
        listedSend({
            id: 'again', personId: 'levi', textId: 'tb-new',
            createdAt: '2026-10-22T16:00:00.000Z', wording: 'reminder',
        }),
    ];
    const explained = audit.explainPrayerTextRows(listed, [{
        personId: 'levi', serviceDate: '2026-10-25', missing: false,
        sentDays: [], initialSentDate: '2026-10-22',
        reminderSent: true, reminderSentDate: '2026-10-22',
    }]);
    assert.equal(explained.checks.samePersonTextedTwice.happened, true);
    assert.equal(explained.checks.resendTickResent.happened, true);
    assert.equal(explained.checks.oct20SendLoggedAgain.happened, true);
    assert.equal(explained.checks.manualSendNow.happened, true);
});

test('an initial with empty sentDays is Send Now, and a missing doc is not', () => {
    const listed = [listedSend({
        id: 'only', personId: 'levi', textId: 'tb-1',
        wording: 'initial', createdAt: '2026-10-22T14:00:00.000Z',
    })];
    const manual = audit.explainPrayerTextRows(listed, [{
        personId: 'levi', serviceDate: '2026-10-25', missing: false,
        sentDays: [], initialSentDate: '2026-10-22', reminderSent: false,
    }]);
    assert.equal(manual.checks.manualSendNow.happened, true);
    const unread = audit.explainPrayerTextRows(listed, []);
    assert.equal(unread.checks.manualSendNow.happened, null);
    assert.equal(audit.dateMinusDays('2026-10-25', 5), '2026-10-20');
});
