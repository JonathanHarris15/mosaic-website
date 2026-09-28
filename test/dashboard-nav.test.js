const test = require('node:test');
const assert = require('node:assert');
const AccessCore = require('../public/access-core.js');
const DashboardNav = require('../public/dashboard-nav.js');

function account(level, pastoralAssistant) {
    return AccessCore.accountOf({ permissionLevel: level, pastoralAssistant: !!pastoralAssistant });
}

test('visible tiles match the dashboard gates for a member', () => {
    const tiles = DashboardNav.visibleTiles(account('member'));
    const keys = tiles.map((t) => t.key);
    assert.ok(keys.includes('hymn-directory'));
    assert.ok(keys.includes('directory'));
    assert.ok(!keys.includes('service-analytics'));
    assert.ok(!keys.includes('admin-dashboard'));
});

test('visible tiles include editor-only cards for an editor', () => {
    const tiles = DashboardNav.visibleTiles(account('editor'));
    const keys = tiles.map((t) => t.key);
    assert.ok(keys.includes('forms'));
    assert.ok(keys.includes('roles-manager'));
    assert.ok(!keys.includes('shepherding'));
});

test('saved order is applied and unknown keys append at the end', () => {
    const tiles = DashboardNav.visibleTiles(account('editor'));
    const ordered = DashboardNav.applyOrder(tiles, ['forms', 'hymn-directory', 'calendar']);
    assert.deepStrictEqual(ordered.map((t) => t.key).slice(0, 3),
        ['forms', 'hymn-directory', 'calendar']);
    assert.ok(ordered.length === tiles.length);
});

test('drawer destinations are exactly the registry hrefs plus home', () => {
    assert.ok(DashboardNav.isDrawerDestination('hymns.html'));
    assert.ok(DashboardNav.isDrawerDestination('index.html'));
    assert.ok(!DashboardNav.isDrawerDestination('commitments.html'));
    assert.ok(!DashboardNav.isDrawerDestination('calendar-event.html'));
});

test('classifyPage picks drawer vs back from the registry', () => {
    assert.deepStrictEqual(DashboardNav.classifyPage('calendar.html'), { mode: 'drawer' });
    const back = DashboardNav.classifyPage('commitments.html');
    assert.equal(back.mode, 'back');
    assert.equal(back.back.href, 'calendar.html');
});
