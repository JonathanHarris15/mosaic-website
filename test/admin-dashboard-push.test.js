const {test} = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/admin-dashboard.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/admin-dashboard.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8');

test('the admin dashboard has a Push notifications tab and keeps Tools', () => {
    assert.match(html, /role="tablist"/);
    assert.match(html, /Push notifications/);
    assert.match(html, /activeTab === 'tools'/);
    assert.match(html, /activeTab === 'push'/);
    assert.match(html, /How pushes are handled/);
    assert.match(html, /Notification types/);
    assert.match(html, /Sent log/);
    assert.match(html, /Devices &amp; tokens/);
    assert.match(html, /Service Guide Manager/);
    assert.match(html, /SMS \(Textbelt\)/);
});

test('revoke and test-send require a confirmation step in the client', () => {
    assert.match(js, /confirm\('Revoke this device token/);
    assert.match(js, /confirm\('Send a test push to your own signed-in devices only/);
    assert.match(js, /adminRevokePushToken/);
    assert.match(js, /adminSendTestPush/);
    assert.match(js, /confirm:\s*true/);
});

test('the test push callable is invoked without a client uid or token', () => {
    assert.match(js, /adminSendTestPush'\)\(\{\s*confirm:\s*true\s*\}\)/);
    assert.doesNotMatch(js, /adminSendTestPush'\)\(\{[^}]*uid:/);
});

test('there is no bulk-send or send-to-everyone control', () => {
    const haystack = html + '\n' + js;
    assert.doesNotMatch(haystack, /send to everyone/i);
    assert.doesNotMatch(haystack, /bulk[- ]send/i);
    assert.doesNotMatch(haystack, /broadcast/i);
    assert.match(html, /there is no send-to-everyone/);
});

test('the five admin notification callables are exported', () => {
    for (const name of [
        'adminNotificationOverview',
        'adminListNotifications',
        'adminListPushDevices',
        'adminRevokePushToken',
        'adminSendTestPush',
    ]) {
        assert.match(index, new RegExp('exports\\.' + name + '\\s*=\\s*onCall'));
    }
});
