/**
 * When the explainer is shown. Three dismissals, fourteen days apart,
 * is the judgment for MS-258.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const perm = require('../public/notification-permission.js');

const DAY = 24 * 60 * 60 * 1000;

function memory() {
    const box = {};
    return {
        getItem(key) { return Object.prototype.hasOwnProperty.call(box, key) ? box[key] : null; },
        setItem(key, value) { box[key] = String(value); },
    };
}

test('the explainer waits for a signed-in linked person', () => {
    const base = {permission: 'prompt', dismissals: 0, now: Date.now()};
    assert.equal(perm.shouldShowExplainer(Object.assign({signedIn: false, linked: false}, base)), false);
    assert.equal(perm.shouldShowExplainer(Object.assign({signedIn: true, linked: false}, base)), false);
    assert.equal(perm.shouldShowExplainer(Object.assign({signedIn: true, linked: true}, base)), true);
});

test('granted and denied skip the explainer; denied offers settings', () => {
    const ready = {signedIn: true, linked: true, dismissals: 0, now: Date.now()};
    assert.equal(perm.shouldShowExplainer(Object.assign({permission: 'granted'}, ready)), false);
    assert.equal(perm.shouldShowExplainer(Object.assign({permission: 'denied'}, ready)), false);
    assert.equal(perm.shouldOfferSettings('denied'), true);
    assert.equal(perm.shouldOfferSettings('prompt'), false);
});

test('three dismissals, fourteen days apart, end the explainer', () => {
    const storage = memory();
    const start = Date.UTC(2026, 0, 1);
    assert.equal(perm.shouldShowExplainer({
        signedIn: true, linked: true, permission: 'prompt',
        dismissals: 0, now: start,
    }), true);
    let recorded = perm.recordDismissal(storage, start);
    assert.equal(perm.shouldShowExplainer({
        signedIn: true, linked: true, permission: 'prompt',
        dismissals: recorded.dismissals,
        lastDismissedAt: recorded.lastDismissedAt,
        now: start + DAY,
    }), false);
    recorded = perm.recordDismissal(storage, start + 14 * DAY);
    recorded = perm.recordDismissal(storage, start + 28 * DAY);
    assert.equal(recorded.dismissals, 3);
    assert.equal(perm.shouldShowExplainer({
        signedIn: true, linked: true, permission: 'prompt',
        dismissals: recorded.dismissals,
        lastDismissedAt: recorded.lastDismissedAt,
        now: start + 90 * DAY,
    }), false);
    assert.equal(perm.shouldShowExplainer({
        signedIn: true, linked: true, permission: 'prompt',
        dismissals: 2,
        lastDismissedAt: start,
        now: start + 14 * DAY,
    }), true);
});
