const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Access = require('../public/access-core.js');
const Destinations = require('../public/mobile/destinations.js');
const Catalog = require('../public/permission-catalog.js');

const adminDest = () => {
    const d = Destinations.DESTINATIONS.find((x) => x.key === 'admin');
    assert.ok(d, 'admin destination missing');
    return d;
};

test('custom account level with admin.dashboard.access opens Admin', () => {
    const perms = Object.assign(Catalog.emptyPermissions(), {
        'admin.dashboard.access': true,
    });
    const user = {
        permissionLevel: 'viewer',
        accountLevelId: 'custom-admin',
        permissions: perms,
    };
    assert.equal(Access.accessesAdminDashboard(user), true);
    assert.equal(Destinations.canSee(adminDest(), user), true);
});

test('legacy admin string still opens Admin without permissions object', () => {
    assert.equal(Destinations.canSee(adminDest(), { permissionLevel: 'admin' }), true);
    assert.equal(Destinations.canSee(adminDest(), { permissionLevel: 'viewer' }), false);
});

test('directory.view permission grants Membership Directory without member level string', () => {
    const directory = Destinations.DESTINATIONS.find((x) => x.key === 'directory');
    const perms = Object.assign(Catalog.emptyPermissions(), { 'directory.view': true });
    const user = {
        permissionLevel: 'viewer',
        accountLevelId: 'custom',
        permissions: perms,
    };
    assert.equal(Destinations.canSee(directory, user), true);
});

test('admin route is a shell page, not a stale native screen', () => {
    assert.equal(Destinations.SHELL_PAGES.admin, 'admin-dashboard.html');
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile', 'app.js'), 'utf8');
    assert.match(app, /route === "admin"/);
    const mobileHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile.html'), 'utf8');
    assert.doesNotMatch(mobileHtml, /screens-admin\.js/);
});

test('native Shepherd links Service Analytics in the shell', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'mobile', 'screens-shepherd.js'),
        'utf8',
    );
    assert.match(src, /analytics\.html\?shell=mobile/);
    assert.match(src, /canReadEditor/);
});
