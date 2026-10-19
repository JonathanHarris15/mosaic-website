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

const {resourcesPage, MENU_HEIGHT} = require('../public/resources.js');

/**
 * A ⋯ button inside a clipping box, at a given distance from each edge.
 * @param {{above: number, below: number}} room pixels of space each way
 * @return {object} something shaped like a click event
 */
function clickAt({above, below}) {
    const button = {
        closest: () => box,
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
