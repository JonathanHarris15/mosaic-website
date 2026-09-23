const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/printable-editor.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../public/printable-editor-data.js'), 'utf8');

test('iteration is queried in the data drawer, and a locked query cannot be rebuilt', () => {
    assert.match(html, /class="pe-drawer__section pe-query"/, 'the drawer has a query builder');
    assert.match(html, /This list is not yours to query/, 'a list above the viewer is closed');
    assert.match(js, /queryLocked/, 'the editor knows when the query is not theirs');
    assert.match(js, /querySpecsFor/, 'only filters this viewer may use are offered');
    assert.match(html, /Build the query in the data drawer/, 'the element panel does not carry the query');
});

test('a box inside a household card can query the children of that household', () => {
    assert.match(html, /Of this household/, 'the query picker groups related lists');
    assert.match(js, /relatedListSources/, 'the editor knows which lists belong to the parent row');
    assert.match(js, /listSourcesFor/, 'related lists are offered only inside their parent');
    assert.match(js, /queryTarget/, 'a selected inner box is what the query writes, not the household card');
});

test('the data drawer stays empty until an element is chosen, then offers iteration not the catalog', () => {
    assert.match(js, /get showCatalog\(\)[\s\S]*return false/, 'the catalog of lists is not the drawer\'s start');
    assert.match(html, /x-show="showCatalog"/, 'People / Sunday / Events stay hidden until asked for');
    assert.match(html, /Make this element iterated/, 'a selected box gets a button in the drawer');
    assert.match(js, /get canStartIteration\(/, 'iteration is offered from the selection, not from a source row');
    assert.match(js, /get showQueryBuilder\(\)[\s\S]*selectedNode[\s\S]*repeat/, 'the query builder waits until the box is iterating');
    assert.doesNotMatch(js, /selectedKind === 'box'/, 'selecting a box no longer opens the query by itself');
});

test('an unbound box inside an iterated household card may become a sub-iteration', () => {
    assert.match(html, /Make this a sub-iteration/, 'an inner box is offered a related list, not a second directory');
    assert.match(js, /get canStartSubIteration\(/, 'sub-iteration is a first-class offer');
    assert.match(js, /selectedBindings\.length/, 'a child that already has a field wired is not offered a related list');
});

test('a wire hides when its element leaves the canvas and redraws as the drawer scrolls', () => {
    const Wires = require('../public/printable-editor-data.js').PrintableEditorWires
        || globalThis.PrintableEditorWires;
    assert.ok(Wires && typeof Wires.elementOnCanvas === 'function', 'clipping is a named rule');
    const view = { left: 0, top: 0, right: 400, bottom: 300 };
    assert.equal(Wires.elementOnCanvas({ left: 40, top: 40, right: 120, bottom: 80 }, view), true);
    assert.equal(Wires.elementOnCanvas({ left: 40, top: 800, right: 120, bottom: 860 }, view), false, 'off the canvas is off');
    assert.match(js, /pe-drawer__body/, 'the drawer body is watched');
    assert.match(js, /addEventListener\('scroll'/, 'scrolling the drawer moves the wire now');
    assert.match(html, /is-enter/, 'a returning wire is animated');
});
