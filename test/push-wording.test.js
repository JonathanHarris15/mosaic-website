const {test} = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const pr = require('../functions/prayer-request.js');
const nc = require('../functions/notification-core.js');

test('a blank push field falls back on its own, and {name} is in every default', () => {
    const resolved = pr.resolvePushWording({
        pushInitialTitle: 'Custom {name}',
        pushInitialBody: '   ',
    });
    assert.strictEqual(resolved.initial.title, 'Custom {name}');
    assert.strictEqual(resolved.initial.body, pr.DEFAULT_PUSH_WORDING.initial.body);
    assert.strictEqual(resolved.reminder.title, pr.DEFAULT_PUSH_WORDING.reminder.title);
    assert.strictEqual(resolved.thankyou.body, pr.DEFAULT_PUSH_WORDING.thankyou.body);
    for (const kind of pr.PUSH_WORDING_KINDS) {
        assert.ok(pr.DEFAULT_PUSH_WORDING[kind].title.length <= nc.PUSH_TITLE_LIMIT, kind);
        assert.ok(pr.DEFAULT_PUSH_WORDING[kind].body.includes('{name}'), kind);
    }
});

test('resolvePushWording with no config returns the defaults', () => {
    assert.deepStrictEqual(pr.resolvePushWording(null), pr.DEFAULT_PUSH_WORDING);
});

test('the admin dashboard and the phone admin mirror the server defaults', () => {
    const root = path.join(__dirname, '..');
    const dash = fs.readFileSync(path.join(root, 'public/admin-dashboard.js'), 'utf8');
    const mobile = fs.readFileSync(path.join(root, 'public/mobile/data.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'public/admin-dashboard.html'), 'utf8');
    assert.match(dash, /const PUSH_TITLE_LIMIT = 40/);
    assert.strictEqual(nc.PUSH_TITLE_LIMIT, 40);
    for (const kind of pr.PUSH_WORDING_KINDS) {
        const piece = pr.DEFAULT_PUSH_WORDING[kind];
        assert.ok(dash.includes(piece.title), kind + ' title missing from the dashboard');
        assert.ok(dash.includes(piece.body), kind + ' body missing from the dashboard');
        assert.ok(mobile.includes(piece.title), kind + ' title missing from the phone admin');
        assert.ok(mobile.includes(piece.body), kind + ' body missing from the phone admin');
    }
    assert.match(html, /pushTitleLimit/);
    assert.match(html, /pushWording\[kind\.key\]\.title/);
});
