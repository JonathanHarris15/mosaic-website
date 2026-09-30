/**
 * The two pastoral-prayer ask senders go through the one send path.
 * Thank-you and the elder digest stay on Textbelt directly.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const index = fs.readFileSync(
    path.join(__dirname, '../functions/index.js'), 'utf8');
const builder = fs.readFileSync(
    path.join(__dirname, '../public/service-builder.js'), 'utf8');

function sliceBetween(src, startMark, endMark) {
    const start = src.indexOf(startMark);
    assert.ok(start !== -1, startMark);
    const end = src.indexOf(endMark, start + startMark.length);
    assert.ok(end !== -1, endMark);
    return src.slice(start, end);
}

test('scheduler and manual ask go through dispatchPrayerAsk', () => {
    assert.doesNotMatch(index, /function dispatchPrayerText/);
    const subject = sliceBetween(
        index,
        'async function processPrayerSubject',
        'exports.sendPrayerRequestTexts');
    const manual = sliceBetween(
        index,
        'exports.sendPrayerRequestNow',
        'exports.notifyEldersOnPrayerComplete');
    assert.match(subject, /dispatchPrayerAsk/);
    assert.match(subject, /hasDeviceToken: tokens\.length > 0/);
    assert.match(subject, /previousChannel: req\.sentChannel/);
    assert.match(index, /sentChannel/);
    assert.doesNotMatch(subject, /sendViaTextbelt/);
    assert.match(manual, /dispatchPrayerAsk/);
    assert.match(manual, /manual:\s*true/);
    assert.doesNotMatch(manual, /request\.data && request\.data\.url/);
    assert.doesNotMatch(manual, /sendViaTextbelt/);
    assert.doesNotMatch(manual, /TEXTBELT_KEY\.value\(\)/);
});

test('dispatchPrayerAsk mints an Answer link for scheduler and send-now', () => {
    const ask = sliceBetween(
        index,
        'async function dispatchPrayerAsk',
        'async function processPrayerSubject');
    assert.match(ask, /mintAnswerLink/);
    assert.match(ask, /purpose:\s*["']prayer_request["']/);
    assert.match(ask, /url:\s*minted\.url/);
    assert.doesNotMatch(ask, /args\.url/);
});

test('answerLink is a v2 onCall door without App Check', () => {
    assert.match(index, /exports\.answerLink\s*=\s*onCall/);
    const door = sliceBetween(
        index, 'exports.answerLink = onCall', 'exports.publicForm');
    assert.match(door, /enforceAppCheck:\s*false/);
    assert.match(door, /handleAnswerLink/);
});

test('service builder does not hide Send Now for a missing phone', () => {
    const can = sliceBetween(
        builder, 'canSendPrayerText(which)', 'prayerSendTitle(which)');
    assert.match(can, /if\s*\(\s*!this\.canDecide\s*\)\s*return false/);
    assert.doesNotMatch(can, /phone/);
    assert.match(builder, /Tell this person — Mosaic picks how/);
    assert.doesNotMatch(builder, /text sent to/);
});
