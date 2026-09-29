// The desktop header's drawer (MS-691).
//
// One thing is worth testing here above all others: that the drawer does not
// answer the permission question a second time. The dashboard already answers it
// — eight gates, AccessCore, and a saved arrangement on top — and the moment the
// drawer has its own copy of that list, the two can disagree about who may see
// what. A member offered the Admin Dashboard in a drawer is the failure this
// file exists to prevent, and it would not show up in a screenshot.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const Drawer = require('../public/desktop-drawer.js');

// ── The list ─────────────────────────────────────────────────────────────────

test('the drawer is Home and then the tiles, in the order the tiles are in', () => {
    const tiles = [
        { key: 'hymn-directory', href: 'hymns.html', symbol: 'menu_book', label: 'Hymns' },
        { key: 'shepherding', href: 'shepherding-dashboard.html', symbol: 'shield_person', label: 'Shepherd Dashboard' },
    ];
    const entries = Drawer.entriesFor(tiles);

    assert.strictEqual(entries.length, 3, 'the drawer invented or dropped an entry');
    assert.strictEqual(entries[0].label, 'Home', 'Home is not first');
    assert.strictEqual(entries[0].href, 'index.html');
    assert.deepStrictEqual(entries.slice(1), tiles,
        'the drawer rewrote the tiles instead of mirroring them');
});

test('mount accepts a pre-built tile list without a dashboard grid (MS-697)', () => {
    const src = read('desktop-drawer.js');
    assert.match(src, /opts\.entries/,
        'the drawer can be built from entries the registry already filtered');
});

test('a reader with no tiles still gets Home', () => {
    // Nobody is signed in, so every gated tile is absent. The drawer is then the
    // dashboard's own door and nothing else, which is honest — it is not empty.
    assert.deepStrictEqual(Drawer.entriesFor([]).map((e) => e.label), ['Home']);
    assert.deepStrictEqual(Drawer.entriesFor(undefined).map((e) => e.label), ['Home']);
});

test('entriesFor does not prepend Home when Home is already first (MS-698)', () => {
    // The header lead once wrapped tiles in entriesFor and mount wrapped them
    // again, so every page except the dashboard listed Home twice.
    const tiles = [
        { key: 'hymn-directory', href: 'hymns.html', symbol: 'menu_book', label: 'Hymns' },
    ];
    const once = Drawer.entriesFor(tiles);
    const twice = Drawer.entriesFor(once);
    assert.deepStrictEqual(twice.map((e) => e.label), ['Home', 'Hymns']);
    assert.strictEqual(twice[0].href, 'index.html');
});

test('Home cannot be edited out from under a caller', () => {
    const first = Drawer.entriesFor([])[0];
    assert.throws(() => { 'use strict'; first.href = 'elsewhere.html'; },
        'the Home entry is shared between mounts and is not frozen');
});

// ── The rule it must not re-state ────────────────────────────────────────────

test('the drawer holds no permission rule of its own', () => {
    const src = read('desktop-drawer.js');
    // Everything below is a word that can only appear here if this file has
    // started deciding who may see what. It must not: it reads the tiles the
    // dashboard drew, and the dashboard's gates are the only answer.
    const code = src
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
    for (const word of ['permissionLevel', 'AccessCore', 'readsAsElder', 'readsAsEditor',
        'super_admin', "'admin'", "'elder'", "'editor'", "'member'"]) {
        assert.ok(code.indexOf(word) === -1,
            'desktop-drawer.js has started deciding permissions itself: ' + word);
    }
});

test('the dashboard builds the drawer from the grid it just drew', () => {
    const index = read('index.html');
    const call = index.match(/DesktopDrawer\.mount\(\{[\s\S]{0,400}?\}\);/);
    assert.ok(call, 'index.html no longer mounts the drawer');
    assert.match(call[0], /grid: document\.getElementById\('nav-cards-grid'\)/,
        'the drawer is built from something other than the dashboard tile grid');
    assert.match(read('index.html'), /dashboard-nav\.js/,
        'the dashboard shares the tile registry with other pages');

    // After the saved arrangement, so the drawer opens in the reader's own
    // order rather than the markup's.
    const at = index.indexOf('DesktopDrawer.mount');
    assert.ok(index.indexOf('applyDashboardOrder(grid, savedCardOrder)') < at,
        'the drawer is built before the saved card order is applied');
});

test('the hamburger says what it does, and says nothing until it works', () => {
    const index = read('index.html');
    const button = index.match(/<button[^>]*id="drawer-toggle"[\s\S]{0,400}?<\/button>/);
    assert.ok(button, 'the dashboard has no hamburger');
    assert.match(button[0], /aria-controls="app-drawer"/);
    assert.match(button[0], /aria-expanded="false"/);
    assert.match(button[0], /aria-label="Open menu"/);
    assert.match(button[0], /\shidden\s/,
        'the hamburger is in the page before anything can open it');
    assert.match(read('desktop-drawer.js'), /toggle\.hidden = false/,
        'nothing ever reveals the hamburger');
});

// ── Nothing behind an open drawer ────────────────────────────────────────────

test('the panel covers a page that cannot be reached behind it', () => {
    const src = read('desktop-drawer.js');
    assert.match(src, /node\.inert = on/, 'the page behind the drawer stays reachable');
    assert.match(src, /e\.key === 'Escape'/, 'Escape does not close the drawer');
    assert.match(src, /tabIndex = -1/, 'the scrim is in the tab order');
    assert.match(src, /setAttribute\('aria-hidden', 'true'\)/,
        'the scrim is in the accessibility tree');
    assert.match(src, /toggle\.focus\(\)/,
        'closing the drawer leaves the focus on an inert page');

    const index = read('index.html');
    assert.match(index, /behind: \[document\.querySelector\('main'\), document\.querySelector\('\.m-header'\)\]/,
        'the dashboard does not tell the drawer what to make inert');
});

test('mounting twice does not leave two listeners on one hamburger', () => {
    // A promotion that unlocks a tile re-mounts. With a second handler on the
    // same button, one click opened the drawer and closed it again: the
    // hamburger simply stopped working, with nothing in the console.
    const src = read('desktop-drawer.js');
    assert.match(src, /removeEventListener\('click', toggle\.mosaicDrawerToggle\)/);
    assert.match(src, /removeEventListener\('keydown', escaped\)/);
    assert.match(src, /if \(old\) old\.remove\(\)/,
        'a second mount leaves the first panel in the page');
});

// ── The component it draws with ──────────────────────────────────────────────

test('every class the drawer draws with is one the design system defines', () => {
    const { COMPONENTS } = require('../build/design-components.mjs');
    const defined = new Set();
    for (const c of COMPONENTS) {
        for (const m of c.css.matchAll(/\.(m-[a-z0-9_-]+)/g)) defined.add(m[1]);
    }
    const src = read('desktop-drawer.js');
    for (const m of src.matchAll(/'(m-[a-z-]+(?:__[a-z-]+)?(?:--[a-z-]+)?(?: [a-z0-9_ -]+)?)'/g)) {
        for (const cls of m[1].split(/\s+/)) {
            if (!cls.startsWith('m-')) continue;
            assert.ok(defined.has(cls), 'the drawer draws with a class nothing defines: ' + cls);
        }
    }
    assert.ok(defined.has('m-drawer__panel'), 'the Drawer component has gone missing');
});
