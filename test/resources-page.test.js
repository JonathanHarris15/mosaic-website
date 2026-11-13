// The bits of the Resources page that are logic rather than markup (MS-693).
//
// ⚠ WHY THE MENU DIRECTION IS TESTED AT ALL. The shelf scrolls its own list,
// which is what lets it be dense — and an absolutely positioned menu inside a
// clipping box is INVISIBLE when it does not fit, not merely awkward. The
// first build shipped that: the bottom row's ⋯ opened a menu nobody could
// see, which reads as a dead button rather than as a bug, so it would never
// have been reported. This pins the fix.

const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

// The page reads its cores off the window, the way the script tags give them
// to it. Requiring resources-core.js is enough to put it there; filing-core.js
// only publishes itself to a real window, so it is placed by hand.
global.ResourcesCore = require('../public/resources-core.js');
global.FilingCore = require('../public/filing-core.js');

const {resourcesPage, MENU_HEIGHT, placeFloatingMenu, TREE_MENU_WIDTH} = require('../public/resources.js');

/**
 * A ⋯ button inside a clipping box, at a given distance from each edge.
 * The list menu looks for `.fm-list` / `.fm-pin-card`. A closest() that
 * answers every selector would be read as the folder tree.
 * @param {{above: number, below: number}} room pixels of space each way
 * @return {object} something shaped like a click event
 */
function clickAt({above, below}) {
    const button = {
        closest: (sel) => String(sel).includes('fm-list') || String(sel).includes('fm-pin-card') ? box : null,
        getBoundingClientRect: () => ({top: above, bottom: 1000 - below}),
    };
    const box = {getBoundingClientRect: () => ({top: 0, bottom: 1000})};
    return {currentTarget: button};
}

describe('which way a row menu opens', () => {
    const page = () => resourcesPage();

    test('downward when there is room below, which is nearly always', () => {
        assert.equal(
            page().opensUpward(clickAt({above: 100, below: MENU_HEIGHT + 50})),
            false);
    });

    test('upward when the menu would be cut off by the bottom of the list', () => {
        assert.equal(
            page().opensUpward(clickAt({above: MENU_HEIGHT + 50, below: 10})),
            true);
    });

    test('downward in a box too short for either way — keep the familiar direction', () => {
        // Flipping into a second clipped position buys nothing and surprises.
        assert.equal(page().opensUpward(clickAt({above: 10, below: 10})), false);
    });

    test('downward when there is nothing to measure against', () => {
        assert.equal(page().opensUpward(undefined), false);
        assert.equal(page().opensUpward({currentTarget: null}), false);
        assert.equal(page().opensUpward({currentTarget: {}}), false);
        assert.equal(page().opensUpward({
            currentTarget: {closest: () => null, getBoundingClientRect: () => ({})},
        }), false);
    });

    test('opening a menu records the direction; closing it is still one click', () => {
        const p = page();
        const item = {id: 'r1'};
        p.toggleMenu(item, clickAt({above: MENU_HEIGHT + 50, below: 10}));
        assert.equal(p.menuOpen(item), true);
        assert.equal(p.menuUp, true);
        assert.equal(p.menuFixed, false, 'a list menu stays in the row');

        p.toggleMenu(item, clickAt({above: MENU_HEIGHT + 50, below: 10}));
        assert.equal(p.menuOpen(item), false);
    });

    test('a folder and a file with the same id are different rows', () => {
        // The key carries the collection, because `resources` and
        // `resource_folders` number their ids independently.
        const p = page();
        const file = {id: 'same'};
        const folder = {id: 'same', isFolder: true};
        p.toggleMenu(file, clickAt({above: 100, below: 400}));
        assert.equal(p.menuOpen(file), true);
        assert.equal(p.menuOpen(folder), false);
    });
});

describe('what the page shows before anything is loaded', () => {
    test('it starts closed: loading, no edit controls, nothing pinned', () => {
        const p = page0();
        assert.equal(p.loading, true);
        assert.equal(p.canEdit, false, 'an edit control must never flash before the gate answers');
        assert.equal(p.showPinCard, false);
        assert.equal(p.atRoot, true);
        assert.equal(p.searching, false);
    });

    function page0() {
        const p = resourcesPage();
        p.folders = [];
        p.resources = [];
        return p;
    }
});

describe('the folder tree collapses', () => {
    function shelf() {
        const p = resourcesPage();
        p.folders = [
            {id: 'a', name: 'Alpha', parentId: null, isFolder: true},
            {id: 'b', name: 'Beta', parentId: 'a', isFolder: true},
            {id: 'c', name: 'Gamma', parentId: 'b', isFolder: true},
            {id: 'd', name: 'Delta', parentId: null, isFolder: true},
        ];
        p.resources = [];
        return p;
    }

    test('starts open, every folder in depth order', () => {
        const nodes = shelf().treeNodes;
        assert.deepEqual(nodes.map(n => n.id), ['a', 'b', 'c', 'd']);
        assert.equal(nodes[0].hasChildren, true);
        assert.equal(nodes[1].depth, 1);
        assert.equal(nodes[2].depth, 2);
        assert.equal(nodes[2].hasChildren, false);
        assert.equal(nodes[3].hasChildren, false);
    });

    test('a tree row is the folder record, so rename and delete reach it', () => {
        const p = shelf();
        assert.equal(p.treeNodes[0].folder, p.folders[0]);
    });

    test('collapsing a folder hides its descendants and keeps its siblings', () => {
        const p = shelf();
        p.toggleCollapsed('a');
        assert.equal(p.isCollapsed('a'), true);
        assert.deepEqual(p.treeNodes.map(n => n.id), ['a', 'd']);
        p.toggleCollapsed('a');
        assert.equal(p.isCollapsed('a'), false);
        assert.deepEqual(p.treeNodes.map(n => n.id), ['a', 'b', 'c', 'd']);
    });

    test('collapsing a middle folder hides only what is inside it', () => {
        const p = shelf();
        p.toggleCollapsed('b');
        assert.deepEqual(p.treeNodes.map(n => n.id), ['a', 'b', 'd']);
    });

    test('folding a branch does not leave the folder you had open', () => {
        const p = shelf();
        p.openFolder('c');
        p.toggleCollapsed('a');
        assert.equal(p.currentFolderId, 'c');
        assert.deepEqual(p.treeNodes.map(n => n.id), ['a', 'd']);
    });

    test('opening a nested folder clears the search and unfolds the path to it', () => {
        const p = shelf();
        p.search = 'romans';
        p.toggleCollapsed('a');
        p.toggleCollapsed('b');
        p.openFolder('c');
        assert.equal(p.search, '');
        assert.equal(p.currentFolderId, 'c');
        assert.equal(p.isCollapsed('a'), false);
        assert.equal(p.isCollapsed('b'), false);
        assert.deepEqual(p.treeNodes.map(n => n.id), ['a', 'b', 'c', 'd']);
    });
});

describe('a menu opened from the folder tree', () => {
    test('sits on the window beside the button, downward when there is room', () => {
        const placed = placeFloatingMenu(
            {top: 100, bottom: 132, left: 180, right: 212},
            {height: 800, width: 1280},
            MENU_HEIGHT);
        assert.equal(placed.openUp, false);
        assert.equal(placed.style.top, '136px');
        assert.equal(placed.style.bottom, 'auto');
        assert.equal(placed.style.left, '184px');
    });

    test('opens upward when downward would leave the window', () => {
        const placed = placeFloatingMenu(
            {top: 700, bottom: 732, left: 180, right: 212},
            {height: 800, width: 1280},
            MENU_HEIGHT);
        assert.equal(placed.openUp, true);
        assert.equal(placed.style.top, 'auto');
        assert.equal(placed.style.bottom, '104px');
    });

    test('stays downward when the window is too short for either way', () => {
        const placed = placeFloatingMenu(
            {top: 20, bottom: 52, left: 10, right: 40},
            {height: 100, width: 320},
            MENU_HEIGHT);
        assert.equal(placed.openUp, false);
    });

    test('keeps the menu on the window when the button is at the right edge', () => {
        const placed = placeFloatingMenu(
            {top: 100, bottom: 132, left: 1200, right: 1240},
            {height: 800, width: 1280},
            MENU_HEIGHT);
        assert.equal(placed.style.left, (1280 - TREE_MENU_WIDTH - 8) + 'px');
    });

    test('the page records that placement, and scrolling the tree dismisses it', () => {
        global.innerHeight = 800;
        global.innerWidth = 1280;
        const button = {
            closest: (sel) => String(sel).includes('fm-tree') ? {} : null,
            getBoundingClientRect: () => ({top: 100, bottom: 132, left: 180, right: 212}),
        };
        const p = resourcesPage();
        const folder = {id: 'f1', isFolder: true, name: 'Alpha'};
        p.toggleMenu(folder, {currentTarget: button, target: button});
        assert.equal(p.menuFixed, true);
        assert.equal(p.menuOpen(folder), true);
        assert.equal(p.menuStyle.top, '136px');

        p.onTreeScroll();
        assert.equal(p.menuOpen(folder), false);
        assert.equal(p.menuFixed, false);
    });
});

describe('the shelf markup', () => {
    const html = require('fs').readFileSync(
        require('path').join(__dirname, '../public/resources.html'), 'utf8');

    test('fills the window, and the tree can fold and carry the folder menu', () => {
        assert.match(html, /m-page--tool fm-page/);
        assert.match(html, /fm-tree__twist/);
        assert.match(html, /toggleCollapsed\(node\.id\)/);
        assert.match(html, /fm-tree__more/);
        assert.match(html, /fm-menu--fixed/);
        assert.match(html, /max-width:\s*none/);
        assert.match(html, /menuFixed && menuOpen\(node\.folder\)/);
    });
});
