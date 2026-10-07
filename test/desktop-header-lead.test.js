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

test('every drawer destination loads drawer-who and person-photo-core (MS-714)', () => {
    const destinations = Array.from(DashboardNav.DRAWER_HREFS);
    for (const file of destinations) {
        const html = read(file);
        assert.match(html, /drawer-who\.js/, file + ' is missing drawer-who.js');
        assert.match(html, /person-photo-core\.js/, file + ' is missing person-photo-core.js');
    }
});

test('every drawer destination loads access-core so gated tiles can appear (MS-698)', () => {
    // Without AccessCore, editor/elder gates are false and a signed-in
    // super_admin only sees Hymns, Calendar, Services, Directory, and Admin.
    const destinations = Array.from(DashboardNav.DRAWER_HREFS);
    for (const file of destinations) {
        const html = read(file);
        assert.match(html, /access-core\.js/, file + ' is missing access-core.js');
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

test('the header lead passes tiles to the drawer, not a list that already has Home (MS-698)', () => {
    const src = read('desktop-header-lead.js');
    assert.doesNotMatch(src, /entries:\s*global\.DesktopDrawer\.entriesFor/,
        'mount wraps entries in entriesFor; passing entriesFor(tiles) lists Home twice');
    assert.match(src, /entries:\s*tiles/);
});

test('desktop-header-lead does not read window.auth or window.db (MS-698)', () => {
    // auth.js declares `const auth` / `const db`. Those are lexical bindings,
    // not window properties — the same trap calendar-pages.test.js already
    // pins. Reading window.auth here is why every page except Home drew a
    // signed-out drawer.
    const src = read('desktop-header-lead.js');
    ['auth', 'db', 'getUserData'].forEach((name) => {
        assert.doesNotMatch(src, new RegExp('window\\.' + name + '\\b'),
            'uses window.' + name + ', which is undefined');
        assert.doesNotMatch(src, new RegExp('global\\.' + name + '\\b'),
            'uses global.' + name + ', which is window.' + name + ' in the browser');
    });
    assert.match(src, /firebase\.auth\(/,
        'the session must resolve auth the way auth.js created it');
});

test('resolveWho names a signed-in reader even without MosaicDestinations (MS-698)', () => {
    const who = DesktopHeaderLead.resolveWho(
        { permissionLevel: 'super_admin', pastoralAssistant: false },
        'Jonathan',
        true,
    );
    assert.ok(who, 'a signed-in account must have a who, or the drawer says Log in');
    assert.equal(who.name, 'Jonathan');
    assert.equal(who.initials, 'J');
    assert.equal(who.href, 'profile.html');
});

test('a signed-in viewer still has a who (MS-698)', () => {
    const who = DesktopHeaderLead.resolveWho(
        { permissionLevel: 'viewer', pastoralAssistant: false },
        'Sam',
        true,
    );
    assert.ok(who);
    assert.equal(who.name, 'Sam');
    assert.equal(who.initials, 'S');
});

test('resolveWho is empty when nobody is signed in (MS-698)', () => {
    assert.equal(DesktopHeaderLead.resolveWho(
        { permissionLevel: 'super_admin' }, 'Jonathan', false), null);
    assert.equal(DesktopHeaderLead.resolveWho(null, 'Friend', false), null);
});

test('loadSession can unsubscribe if auth answers in the same turn (MS-698)', () => {
    // `const unsub = auth.onAuthStateChanged(...)` throws if the callback
    // fires before the assignment finishes. A session that is already known
    // can do that, and the drawer then never mounts.
    const src = read('desktop-header-lead.js');
    assert.match(src, /let unsub/);
    assert.doesNotMatch(src, /const unsub = auth\.onAuthStateChanged/);
});
