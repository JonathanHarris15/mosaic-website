// Drawer list parity — one registry, every surface (MS-697).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Levels = require('../public/account-levels-core.js');
const DashboardNav = require('../public/dashboard-nav.js');
const Drawer = require('../public/desktop-drawer.js');
const Destinations = require('../public/mobile/destinations.js');

function account(preset, extra) {
    const id = Levels.BUILTIN_LEVEL_IDS[preset];
    if (!id) return Object.assign({ accountLevelId: null, permissions: {} }, extra || {});
    return Object.assign({}, Levels.userWriteFromLevel(id), extra || {});
}

const DRAWER_PAGES = [
    'index.html',
    'service-calendar.html',
    'calendar.html',
    'hymns.html',
    'peoples-page.html',
];

function drawerKeysFor(account, savedOrder) {
    return Drawer.entriesFor(DashboardNav.drawerTiles(account, savedOrder))
        .map((e) => DashboardNav.normalizePage(e.href));
}

test('home and other drawer pages build the same item set for a given user', () => {
    const presets = ['viewer', 'member', 'editor', 'elder', 'super_admin'];
    for (const preset of presets) {
        const acct = account(preset);
        const savedOrder = ['forms', 'hymn-directory', 'calendar'];
        const expected = drawerKeysFor(acct, savedOrder);
        for (const page of DRAWER_PAGES) {
            const keys = drawerKeysFor(acct, savedOrder);
            assert.deepStrictEqual(keys, expected,
                preset + ' on ' + page + ' disagrees with the registry drawer list');
        }
    }
});

test('Resources is in the drawer for members when the home grid would have shown it', () => {
    const member = account('member');
    const hrefs = DashboardNav.drawerTiles(member, null).map((t) => t.href);
    assert.ok(hrefs.includes('resources.html'),
        'resources must not be home-only via a second list');
    assert.equal(DashboardNav.classifyPage('resources.html').mode, 'drawer');
});

test('mobile destinations match desktop drawer keys for the same account', () => {
    const editor = account('editor');
    const desktopKeys = DashboardNav.drawerTiles(editor, null).map((t) => t.key);
    const mobileKeys = Destinations.DESTINATIONS
        .filter((d) => Destinations.canSee(d, editor))
        .map((d) => d.key);
    assert.deepStrictEqual(mobileKeys, ['home'].concat(desktopKeys));
});

test('index.html mounts the drawer from drawerTiles, not the grid', () => {
    const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.match(index, /entries:\s*DashboardNav\.drawerTiles/);
    assert.doesNotMatch(index, /grid:\s*document\.getElementById\('nav-cards-grid'\)/);
});

test('mobile.html loads dashboard-nav before destinations', () => {
    const mobile = fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile.html'), 'utf8');
    const navAt = mobile.indexOf('dashboard-nav.js');
    const destAt = mobile.indexOf('mobile/destinations.js');
    assert.ok(navAt >= 0 && destAt >= 0);
    assert.ok(navAt < destAt);
});
