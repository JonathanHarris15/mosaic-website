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
