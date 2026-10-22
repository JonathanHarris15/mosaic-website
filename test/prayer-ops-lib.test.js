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
    });
});

test('prayer text list uses winter Chicago time', () => {
    const row = audit.describePrayerTextRow({
        id: 'n2',
        createdAt: {seconds: Math.floor(Date.parse('2026-01-15T18:00:00.000Z') / 1000)},
        purpose: 'prayer_request_thankyou',
        personId: 'p2',
        to: '123',
        body: 'thanks',
        accepted: false,
    }, {});
    assert.equal(row.createdAtChicago, '2026-01-15 12:00:00 CST');
    assert.equal(row.phoneLast4, '***');
    assert.equal(row.bodyHasUrl, false);
    assert.equal(row.name, '');
    assert.equal(row.textId, null);
});

test('the audit script lists rows and does not write', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '../scripts/prayer-text-notifications-audit.js'),
        'utf8');
    assert.match(src, /--list/);
    assert.match(src, /describePrayerTextRow/);
    assert.match(src, /explainPrayerTextRows\(listed, requests\)/);
    assert.match(src, /prayer_requests/);
    assert.match(src, /namesForPeople/);
    assert.match(src, /data\.name/);
    assert.match(src, /missing: !snap\.exists/);
    assert.match(src, /sentDays: Array\.isArray\(data\.sentDays\)/);
    assert.match(src, /initialSentDate: data\.initialSentDate/);
    assert.match(src, /reminderSent: !!data\.reminderSent/);
    assert.match(src, /reminderSentDate: data\.reminderSentDate/);
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
    assert.equal(listed[0].wording, 'initial');
    assert.equal(listed[1].wording, null);
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
    assert.deepEqual(explained.acceptedSends[0].logCopies, ['send-path', 'recordOutbound']);
    assert.deepEqual(explained.acceptedSends[0].createdDays, ['2026-10-22']);
    assert.equal(explained.checks.samePersonTextedTwice.happened, false);
    assert.match(explained.checks.samePersonTextedTwice.detail, /one textId/);
    assert.equal(explained.checks.resendTickResent.happened, false);
    assert.match(explained.checks.resendTickResent.detail, /same church day/);
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
    assert.match(explained.checks.samePersonTextedTwice.detail, /tb-old/);
    assert.equal(explained.checks.resendTickResent.happened, true);
    assert.match(explained.checks.resendTickResent.detail, /tb-new/);
    assert.equal(explained.checks.oct20SendLoggedAgain.happened, true);
    assert.match(explained.checks.oct20SendLoggedAgain.detail, /tb-old/);
    assert.equal(explained.checks.manualSendNow.happened, true);
    assert.match(explained.checks.manualSendNow.detail, /same day/);
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
    const missing = audit.explainPrayerTextRows(listed, [{
        personId: 'levi', serviceDate: '2026-10-25', missing: true,
        sentDays: [], initialSentDate: '2026-10-22', reminderSent: false,
    }]);
    assert.equal(missing.checks.manualSendNow.happened, null);
    assert.equal(missing.checks.oct20SendLoggedAgain.happened, false);
    assert.doesNotMatch(missing.checks.oct20SendLoggedAgain.detail, /still-unsent/);
    assert.equal(audit.dateMinusDays('2026-10-25', 5), '2026-10-20');
});

test('two text ids on different days are not an hourly resend', () => {
    const listed = [
        listedSend({
            id: 'd1', personId: 'levi', textId: 'tb-mon',
            wording: 'initial', createdAt: '2026-10-21T15:00:00.000Z',
        }),
        listedSend({
            id: 'd2', personId: 'levi', textId: 'tb-tue',
            wording: 'reminder', createdAt: '2026-10-22T15:00:00.000Z',
        }),
    ];
    const explained = audit.explainPrayerTextRows(listed, [{
        personId: 'levi', serviceDate: '2026-10-25', missing: false,
        sentDays: [5, 3], initialSentDate: '2026-10-21',
        reminderSent: true, reminderSentDate: '2026-10-22',
    }]);
    assert.equal(explained.checks.samePersonTextedTwice.happened, true);
    assert.equal(explained.checks.resendTickResent.happened, false);
    assert.equal(explained.checks.manualSendNow.happened, false);
    assert.match(explained.checks.manualSendNow.detail, /hourly tick/);
});

test('thank-you rows and rows without a text id are not sends', () => {
    const listed = [
        listedSend({
            id: 'ask', personId: 'levi', textId: 'tb-1',
            wording: 'initial', createdAt: '2026-10-22T14:00:00.000Z',
        }),
        audit.describePrayerTextRow({
            id: 'thanks', personId: 'levi', purpose: 'prayer_request_thankyou',
            accepted: true, textId: 'tb-thanks', to: '+15551110000',
            createdAt: '2026-10-22T18:00:00.000Z', serviceDate: '2026-10-25',
        }, {levi: 'Levi Example'}),
        listedSend({
            id: 'failed', personId: 'levi', textId: null, accepted: false,
            wording: 'initial', createdAt: '2026-10-22T13:00:00.000Z',
        }),
        listedSend({
            id: 'notext', personId: 'other', textId: '',
            wording: 'initial', createdAt: '2026-10-22T14:30:00.000Z',
        }),
    ];
    const explained = audit.explainPrayerTextRows(listed, [{
        personId: 'levi', serviceDate: '2026-10-25', missing: false,
        sentDays: [5], initialSentDate: '2026-10-22', reminderSent: false,
    }]);
    assert.deepEqual(explained.acceptedSends.map((send) => send.textId), ['tb-1']);
    assert.equal(explained.checks.samePersonTextedTwice.happened, false);
    assert.equal(explained.checks.resendTickResent.happened, false);
});

test('wording is trimmed and a row with kind as well is still the send path', () => {
    const row = listedSend({
        id: 'both', personId: 'levi', textId: 'tb-1',
        wording: ' initial ', kind: null,
        createdAt: '2026-10-22T14:00:00.000Z',
    });
    assert.equal(row.wording, 'initial');
    assert.equal(row.logCopy, 'send-path');
    const blank = listedSend({
        id: 'blank', personId: 'levi', textId: 'tb-2',
        wording: '  ', createdAt: '2026-10-22T14:00:00.000Z',
    });
    assert.equal(blank.wording, null);
    assert.equal(blank.logCopy, 'send-path');
});

test('a later reminder that did not append a notice day is Send Now', () => {
    const listed = [
        listedSend({
            id: 'init', personId: 'levi', textId: 'tb-1',
            wording: 'initial', createdAt: '2026-10-20T15:00:00.000Z',
        }),
        listedSend({
            id: 'now', personId: 'levi', textId: 'tb-2',
            wording: 'reminder', createdAt: '2026-10-22T15:00:00.000Z',
        }),
    ];
    const afterScheduler = audit.explainPrayerTextRows(listed, [{
        personId: 'levi', serviceDate: '2026-10-25', missing: false,
        sentDays: [5], initialSentDate: '2026-10-20',
        reminderSent: true, reminderSentDate: '2026-10-22',
    }]);
    assert.equal(afterScheduler.checks.manualSendNow.happened, true);
    assert.match(afterScheduler.checks.manualSendNow.detail, /Send Now does not/);
    assert.equal(afterScheduler.checks.oct20SendLoggedAgain.happened, false);
    assert.doesNotMatch(afterScheduler.checks.oct20SendLoggedAgain.detail, /again later/);
    const bothManual = audit.explainPrayerTextRows(listed, [{
        personId: 'levi', serviceDate: '2026-10-25', missing: false,
        sentDays: [], initialSentDate: '2026-10-20',
        reminderSent: true, reminderSentDate: '2026-10-22',
    }]);
    assert.equal(bothManual.checks.manualSendNow.happened, true);
    const noDate = audit.explainPrayerTextRows(listed, [{
        personId: 'levi', serviceDate: '2026-10-25', missing: false,
        sentDays: [5], initialSentDate: '2026-10-20',
        reminderSent: true, reminderSentDate: null,
    }]);
    assert.match(noDate.checks.manualSendNow.detail, /\(unset\)/);
    const unstamped = audit.explainPrayerTextRows(listed, [{
        personId: 'levi', serviceDate: '2026-10-25', missing: false,
        sentDays: [], initialSentDate: null, reminderSent: false,
    }]);
    assert.equal(unstamped.checks.manualSendNow.happened, false);
    assert.match(unstamped.checks.manualSendNow.detail, /do not show a Send Now/);
});

test('a send created on Oct 20 is not a later copy of that slot', () => {
    const explained = audit.explainPrayerTextRows([
        listedSend({
            id: 'on-day', personId: 'levi', textId: 'tb-oct20',
            wording: 'initial', createdAt: '2026-10-20T15:00:00.000Z',
        }),
    ], [{
        personId: 'levi', serviceDate: '2026-10-25', missing: false,
        sentDays: [5], initialSentDate: '2026-10-20', reminderSent: false,
    }]);
    assert.equal(explained.checks.oct20SendLoggedAgain.happened, false);
    assert.doesNotMatch(explained.checks.oct20SendLoggedAgain.detail, /still-unsent/);
    assert.match(explained.checks.oct20SendLoggedAgain.detail, /2026-10-20/);
});

test('an Oct 20 slot is not filled by another person or another service', () => {
    const otherPerson = audit.explainPrayerTextRows([
        listedSend({
            id: 'other-later', personId: 'other', textId: 'tb-other',
            wording: 'initial', createdAt: '2026-10-22T15:00:00.000Z',
        }),
    ], [
        {
            personId: 'levi', serviceDate: '2026-10-25', missing: false,
            sentDays: [5], initialSentDate: '2026-10-22', reminderSent: false,
        },
        {
            personId: 'other', serviceDate: '2026-10-25', missing: false,
            sentDays: [3], initialSentDate: '2026-10-22', reminderSent: false,
        },
    ]);
    assert.equal(otherPerson.checks.oct20SendLoggedAgain.happened, false);
    assert.doesNotMatch(otherPerson.checks.oct20SendLoggedAgain.detail, /levi/);
    assert.doesNotMatch(otherPerson.checks.oct20SendLoggedAgain.detail, /still-unsent/);

    const otherService = audit.explainPrayerTextRows([
        listedSend({
            id: 'other-sunday', personId: 'levi', textId: 'tb-levi',
            wording: 'initial', serviceDate: '2026-11-01',
            createdAt: '2026-10-22T15:00:00.000Z',
        }),
    ], [{
        personId: 'levi', serviceDate: '2026-10-25', missing: false,
        sentDays: [5], initialSentDate: '2026-10-22', reminderSent: false,
    }]);
    assert.doesNotMatch(otherService.checks.oct20SendLoggedAgain.detail, /still-unsent/);
});

test('a row with no person id and a row with no created day are not extra sends', () => {
    const nameless = audit.explainPrayerTextRows([
        listedSend({
            id: 'a', personId: null, textId: 'tb-a',
            wording: 'initial', createdAt: '2026-10-22T14:00:00.000Z',
        }),
        listedSend({
            id: 'b', personId: null, textId: 'tb-b',
            wording: 'initial', createdAt: '2026-10-22T14:00:00.000Z',
        }),
    ], []);
    assert.equal(nameless.checks.samePersonTextedTwice.happened, false);
    assert.equal(nameless.checks.resendTickResent.happened, false);
    const undated = audit.explainPrayerTextRows([
        listedSend({
            id: 'bad', personId: 'levi', textId: 'tb-1',
            wording: 'initial', createdAt: 'not-a-date',
        }),
    ], []);
    assert.deepEqual(undated.acceptedSends[0].createdDays, []);
    const none = audit.explainPrayerTextRows([], []);
    assert.match(none.checks.oct20SendLoggedAgain.detail, /no accepted send/);
    assert.equal(none.checks.manualSendNow.happened, null);
    const noTextId = audit.explainPrayerTextRows([
        listedSend({
            id: 'old', personId: 'levi', textId: null,
            wording: 'initial', createdAt: '2026-10-20T15:00:00.000Z',
        }),
        listedSend({
            id: 'new', personId: 'levi', textId: null,
            wording: 'initial', createdAt: '2026-10-22T15:00:00.000Z',
        }),
        null,
    ], []);
    assert.equal(noTextId.checks.oct20SendLoggedAgain.happened, false);
});
