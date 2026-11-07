const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The phone's Home tiles.
//
// Home used to keep its own hand-written tile list, each with a
// `permissionLevels` gate. When the drawer moved onto the shared registry
// (#316), `canSee` started gating on a registry `key` — and Home's tiles had
// none, so every one was filtered out and Home showed only the Sunday card.
//
// The tiles now come from the same list as the drawer, so a gate change in one
// place reaches both.

const Destinations = require('../public/mobile/destinations.js');
const Levels = require('../public/account-levels-core.js');

function account(preset) {
    return Levels.userWriteFromLevel(Levels.BUILTIN_LEVEL_IDS[preset]);
}

const keys = tiles => tiles.map(t => t.key);

test('a guest still gets the open tiles', () => {
    assert.deepEqual(keys(Destinations.homeTiles(null)),
        ['hymn-directory', 'calendar', 'service-calendar']);
});

test('a member gets the directory too, and never a tile back to Home', () => {
    const got = keys(Destinations.homeTiles(account('member')));
    assert.ok(got.includes('directory'), got.join(', '));
    assert.ok(!got.includes('home'));
    assert.ok(!got.includes('admin-dashboard'));
});

test('every tile carries what Home draws: an icon, a label and a route', () => {
    for (const t of Destinations.homeTiles(account('super_admin'))) {
        assert.ok(t.icon && t.label && t.route, JSON.stringify(t));
    }
});

test('Home reads its tiles from the shared list, not a list of its own', () => {
    const src = fs.readFileSync(path.join(__dirname, '../public/mobile/app.js'), 'utf8');
    assert.match(src, /homeTiles\(/);
    assert.doesNotMatch(src, /permissionLevels:\s*\[/,
        'Home has grown its own gated tile list again');
});
