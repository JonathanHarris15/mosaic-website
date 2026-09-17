const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const door = require('../functions/app-check-door');
const AppCheck = require('../public/app-check-client.js');

// MS-536 — the three live checks, as far as the repo can run them without
// Firebase secrets. Web + phone token paths (MS-535) plus the door's
// allow/deny (MS-534). The manual proof template is
// docs/ops/ms-508-manual-verify.md.

const CFG = {
    mode: 'monitor',
    enabled: true,
    siteKey: '6Le-test',
    provider: 'enterprise',
    liveOrigin: 'https://mosaic-hymn-database.web.app',
};

const validApp = {appId: '1:1004095249066:web:0dcbf3cbbcd0be2ff4bbdd'};

test('web happy-path: live origin collects via reCAPTCHA, enforce would allow', () => {
    const loc = {
        protocol: 'https:',
        hostname: 'mosaic-hymn-database.web.app',
        origin: 'https://mosaic-hymn-database.web.app',
        pathname: '/f/7bQm2xK9vRt4Lp8sYw3NcF',
        search: '',
    };
    const described = AppCheck.describePath(loc, CFG, {});
    assert.strictEqual(described.client, 'web');
    assert.strictEqual(described.path, 'recaptcha-enterprise');
    assert.strictEqual(described.collecting, true);
    const allowed = door.verdict('enforce', validApp);
    assert.strictEqual(allowed.reject, false);
});

test('phone-shell happy-path: hop to hosted origin, then the same door', () => {
    const loc = {
        protocol: 'capacitor:',
        hostname: 'localhost',
        origin: 'capacitor://localhost',
        pathname: '/form-answer.html',
        search: '?f=7bQm2xK9vRt4Lp8sYw3NcF',
    };
    const described = AppCheck.describePath(loc, CFG, {Capacitor: {}});
    assert.strictEqual(described.client, 'phone-shell');
    assert.strictEqual(described.path, 'hop-to-hosted-origin');
    assert.strictEqual(
        AppCheck.hostedFormUrl(loc, CFG),
        'https://mosaic-hymn-database.web.app/f/7bQm2xK9vRt4Lp8sYw3NcF');
    assert.strictEqual(door.verdict('enforce', validApp).reject, false);
});

test('bare request: monitor allows, enforce rejects', () => {
    const monitor = door.verdict('monitor', undefined);
    assert.strictEqual(monitor.reject, false, 'monitor must not brick a merge');
    assert.strictEqual(monitor.log, true);

    const enforce = door.verdict('enforce', undefined);
    assert.strictEqual(enforce.reject, true);
    assert.strictEqual(enforce.code, 'unauthenticated');
});

test('the manual proof template is in the repo for MS-508 comments', () => {
    const doc = fs.readFileSync(
        path.join(__dirname, '..', 'docs/ops/ms-508-manual-verify.md'), 'utf8');
    assert.match(doc, /MS-536 proof/);
    assert.match(doc, /Phase A — after merge, still \*\*monitor\*\*/);
    assert.match(doc, /Phase B — after Atlas-escalated \*\*enforce\*\* flip/);
    assert.match(doc, /Bare request rejected/);
    assert.match(doc, /request id/);
    assert.match(doc, /HITL remainder after this PR merges/);
});
