/**
 * The Admin Dashboard's Push notifications tab, as a page (MS-682).
 *
 * The callables are tested where they are written. This file watches the two
 * things only the page can get wrong: that the tab bar did not take the old
 * sections away with it, and that the two actions on the tab — revoke, and
 * test-push — cannot be fired without a second press or aimed at anybody.
 */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('../public/notification-admin-core.js');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin-dashboard.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'public/admin-dashboard.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');

test('the page has two tabs, and the old sections are still on the first one', () => {
    assert.match(HTML, /class="m-tabs"/,
        'the tab bar is not the design system\u2019s own component');
    assert.match(HTML, /selectTab\('tools'\)/);
    assert.match(HTML, /selectTab\('push'\)/);
    assert.match(HTML, /x-show="tab === 'tools'"/);
    assert.match(HTML, /x-show="tab === 'push'"/);

    // Everything that was on the page before is still on the page.
    const kept = [
        'Service Guide Manager',
        'SMS (Textbelt)',
        'Credits Remaining',
        'Test &amp; Debug',
        'Prayer Request Messages',
        'Automatic sending',
        'Event announcement tells',
    ];
    kept.forEach((section) => {
        assert.ok(HTML.includes(section), section + ' fell off the page');
    });

    // …and inside the first tab, not orphaned between the two wrappers.
    const toolsAt = HTML.indexOf("x-show=\"tab === 'tools'\"");
    const pushAt = HTML.indexOf("x-show=\"tab === 'push'\"");
    assert.ok(toolsAt !== -1 && pushAt > toolsAt);
    const tools = HTML.slice(toolsAt, pushAt);
    kept.forEach((section) => {
        assert.ok(tools.includes(section), section + ' is no longer inside the tools tab');
    });
});

test('the push tab answers all four questions it was built to answer', () => {
    const tab = HTML.slice(HTML.indexOf("x-show=\"tab === 'push'\""));
    assert.match(tab, /How pushes are handled/);
    assert.match(tab, /What Mosaic sends/);
    assert.match(tab, /Sent history/);
    assert.match(tab, /Devices &amp; tokens/);

    // The flow is rendered from the payload, not typed into the markup.
    assert.match(tab, /x-for="\(step, index\) in \(pushFlow \? pushFlow\.steps : \[\]\)"/);
    assert.match(tab, /x-for="branch in step\.branches"/);
    assert.match(tab, /x-for="type in \(pushOverview \? pushOverview\.types : \[\]\)"/);
    assert.match(tab, /x-for="row in history"/);
    assert.match(tab, /x-for="person in devices"/);

    // Filters and paging.
    ['historyFilters.status', 'historyFilters.channel', 'historyFilters.typeId',
        'historyFilters.search'].forEach((model) => {
        assert.ok(tab.includes('x-model="' + model + '"'), model + ' has no control');
    });
    assert.match(tab, /x-show="historyCursor"/, 'there is no way to page further back');
});

test('the tab reads the server and never Firestore for a token', () => {
    const tab = HTML.slice(HTML.indexOf("x-show=\"tab === 'push'\""));
    assert.ok(!/push_tokens/.test(JS),
        'the page reads users/{uid}/push_tokens directly; the rules forbid it ' +
        'and the callables exist so it does not have to');
    assert.ok(!/push_tokens/.test(tab));
    ['notificationOverview', 'notificationHistory',
        'notificationRevokeToken', 'notificationTestPush'].forEach((name) => {
        assert.ok(JS.includes(name), 'the page never calls ' + name);
        assert.match(INDEX, new RegExp('exports\\.' + name + '\\s*=\\s*onCall'),
            name + ' is called by the page and exported by nothing');
    });
});

test('opening the tab is two calls, not four', () => {
    // The device list rides along with the overview because on the server it
    // is the same two reads. A second callable here meant the tab read every
    // Device token twice and thirty days of the log twice.
    const opening = JS.slice(JS.indexOf('async loadPush()'),
        JS.indexOf('showRegistryOffline(error)'));
    const called = (opening.match(/PUSH_TAB_CALLABLES\.(\w+)/g) || []);
    assert.deepEqual(called, ['PUSH_TAB_CALLABLES.overview'],
        'loadPush calls ' + called.join(', ') + ' directly');
    assert.match(opening, /this\.loadHistory\(\)/);
    assert.match(opening, /data\.devices\.people/,
        'the devices no longer arrive with the overview');
});

test('the page only ever shows a masked token, and says so', () => {
    const tab = HTML.slice(HTML.indexOf("x-show=\"tab === 'push'\""));
    assert.match(tab, /x-text="device\.masked"/);
    assert.ok(!/device\.token/.test(tab), 'the markup reaches for a whole token');
    assert.match(tab, /masked to their last six characters/i,
        'the tab does not say the tokens are masked');
    assert.equal(core.MASK_KEEP, 6, 'the sentence on the page says six');
});

test('revoking takes two presses, and the second one names the device', () => {
    const tab = HTML.slice(HTML.indexOf("x-show=\"tab === 'push'\""));
    assert.match(tab, /@click="revokeConfirming = person\.uid \+ '\/' \+ device\.id"/,
        'the Revoke button fires straight away instead of asking first');
    assert.match(tab, /x-if="revokeConfirming === person\.uid \+ '\/' \+ device\.id"/);
    assert.match(tab, /Stop pushing to this device\?/);
    assert.match(tab, /@click="revokeDevice\(person, device\)"/);
    assert.match(tab, /@click="revokeConfirming = null"/, 'there is no way to back out');
    assert.match(JS, /async revokeDevice\(person, device\)/);
});

test('the test push takes two presses, and sends nowhere but the caller', () => {
    const tab = HTML.slice(HTML.indexOf("x-show=\"tab === 'push'\""));
    assert.match(tab, /@click="testPushConfirming = true"/,
        'the test push fires straight away instead of asking first');
    assert.match(tab, /x-show="testPushConfirming"/);
    assert.match(tab, /@click="sendTestPush\(\)"/);
    assert.match(tab, /@click="testPushConfirming = false"/, 'there is no way to back out');

    // The call carries the second press and nothing else. A recipient is the
    // only thing that would make this dangerous, and the payload has none.
    const call = JS.slice(JS.indexOf('async sendTestPush()'),
        JS.indexOf('churchTime(iso)'));
    assert.match(call, /PUSH_TAB_CALLABLES\.testPush\)\(\{\s*\n\s*confirm: true,\s*\n\s*\}\)/,
        'sendTestPush must call with { confirm: true } and nothing else');
    ['uid', 'token', 'personId', 'phone', 'to'].forEach((field) => {
        assert.ok(!new RegExp('\\b' + field + ':').test(call),
            'sendTestPush puts ' + field + ' on the payload');
    });
});

test('an unreachable server leaves the registry standing and says one thing once', () => {
    const fallback = JS.slice(JS.indexOf('showRegistryOffline(error)'),
        JS.indexOf('async loadHistory('));
    assert.match(fallback, /NotificationAdminCore\.offlineTypes\(\)/,
        'the fallback does not render the registry this page already carries');
    assert.match(fallback, /this\.pushOffline = true/);
    // The counts, the window, the log and the devices are all server-read.
    // Offline they must be emptied, never guessed.
    assert.match(fallback, /recent: null/);
    assert.match(fallback, /this\.pushFlow = null/);
    assert.match(fallback, /this\.devices = \[\]/);
    assert.match(fallback, /this\.history = \[\]/);

    // …and one failure must not become three. loadPush returns before it
    // asks for the log.
    const opening = JS.slice(JS.indexOf('async loadPush()'),
        JS.indexOf('showRegistryOffline(error)'));
    const rescue = opening.slice(opening.indexOf('} catch'));
    assert.match(rescue, /this\.showRegistryOffline\(e\);[\s\S]*return;/,
        'loadPush carries on to the other reads after the overview failed');

    // One banner, and a way back.
    const tab = HTML.slice(HTML.indexOf("x-show=\"tab === 'push'\""));
    assert.match(tab, /x-show="pushError"/);
    assert.match(tab, /Live data is unavailable\./);
    assert.match(tab, /Try again/);
    assert.match(tab, /x-show="!pushOffline" class="grid grid-cols-2/,
        'the headline counts are still shown when there are no counts');
    assert.equal(
        (tab.match(/<section x-show="!pushOffline"/g) || []).length, 2,
        'the sent history and the device list must be hidden, not emptied, ' +
        'when the server could not be reached');
});

test('there is no bulk send anywhere on the tab', () => {
    const tab = HTML.slice(HTML.indexOf("x-show=\"tab === 'push'\""));
    const forbidden = [
        /send to (all|everyone|everybody)/i,
        /broadcast/i,
        /notify all/i,
        /push to all/i,
        /sendToAll/,
    ];
    forbidden.forEach((pattern) => {
        assert.ok(!pattern.test(tab), 'the tab offers a bulk send: ' + pattern);
        assert.ok(!pattern.test(JS), 'the page script offers a bulk send: ' + pattern);
    });
    // The only send on the tab says who it reaches, in the button itself.
    assert.match(tab, /Send a test push to myself/);
    assert.match(tab, /no send-to-everyone control anywhere on this tab/);
});

test('the shared vocabulary is loaded, and loaded before the page script', () => {
    const coreAt = HTML.indexOf('src="notification-admin-core.js"');
    const pageAt = HTML.indexOf('src="admin-dashboard.js"');
    assert.ok(coreAt !== -1, 'notification-admin-core.js is not on the page');
    assert.ok(coreAt < pageAt,
        'admin-dashboard.js loads before the module it reads');
    assert.match(JS, /NotificationAdminCore\./);
});

test('the authored module and the copy the functions deploy are the same file', () => {
    const sync = require('../scripts/sync-shared-to-functions.js');
    assert.ok(sync.MODULES.includes('notification-admin-core.js'),
        'notification-admin-core.js is not synced into functions/shared, so the ' +
        'callables would deploy without it');
});
