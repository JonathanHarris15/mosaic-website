const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const DashboardNav = require('../public/dashboard-nav.js');
const Drawer = require('../public/desktop-drawer.js');
const DesktopHeaderLead = require('../public/desktop-header-lead.js');

test('drawer pages load the shared desktop nav scripts', () => {
    for (const file of ['calendar.html', 'hymns.html', 'service-calendar.html']) {
        const html = read(file);
        assert.match(html, /dashboard-nav\.js/);
        assert.match(html, /desktop-header-lead\.js/);
        assert.match(html, /desktop-drawer\.js/);
    }
});

test('the header lead helper builds a hamburger on drawer destinations', () => {
    const src = read('desktop-header-lead.js');
    assert.match(src, /createHamburger/);
    assert.match(src, /DesktopDrawer\.mount/);
    assert.match(src, /DashboardNav\.orderedTiles/);
    assert.match(src, /aria-label/);
});

test('registry tiles become drawer entries on a non-dashboard page', () => {
    const AccessCore = require('../public/access-core.js');
    const account = AccessCore.accountOf({ permissionLevel: 'editor', pastoralAssistant: false });
    const tiles = DashboardNav.orderedTiles(account, null);
    const entries = Drawer.entriesFor(tiles);
    assert.ok(entries.some((e) => e.href === 'calendar.html'));
    assert.strictEqual(entries[0].href, 'index.html');
});

test('classifyPage marks hymn detail parent as back not drawer', () => {
    assert.equal(DashboardNav.classifyPage('hymns.html').mode, 'drawer');
    assert.equal(DashboardNav.classifyPage('service-guide-editor.html').mode, 'back');
});

test('desktop nav boot is wired on calendar but not on the dashboard', () => {
    assert.match(read('calendar.html'), /desktop-nav-boot\.js/);
    assert.doesNotMatch(read('index.html'), /desktop-nav-boot\.js/);
});

test('createBack is exported for tests and pages that manage their own lead', () => {
    assert.equal(typeof DesktopHeaderLead.createBack, 'function');
});
