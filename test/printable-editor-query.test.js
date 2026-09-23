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
    assert.match(js, /Of this household/, 'the query picker groups related lists');
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

test('the query builder is the catalog of every iterable list', () => {
    const Data = require('../public/printable-data-core.js');
    const { PrintableEditorWires } = require('../public/printable-editor-data.js');
    assert.ok(PrintableEditorWires && typeof PrintableEditorWires.groupQueryLists === 'function');
    const lists = Data.SOURCES.filter(s => s.shape === 'list' && !s.of);
    const regions = PrintableEditorWires.groupQueryLists(lists, '');
    const keys = regions.flatMap(r => r.sources.map(s => s.key));
    lists.forEach(s => assert.ok(keys.includes(s.key), s.key + ' belongs in the query builder'));
    assert.ok(!keys.includes('sunday'), 'a single Sunday is not a list');
    assert.ok(!keys.includes('sunday_typed'), 'booklet text is not a list');
    assert.ok(!keys.includes('role_holder'), 'who holds a role is not a list');
    assert.ok(!keys.includes('household_children'), 'Children is related — only inside a household card');
    const inside = PrintableEditorWires.groupQueryLists(
        Data.SOURCES.filter(s => s.shape === 'list' && (!s.of || s.of === 'households')), '');
    assert.ok(inside.some(r => r.name === 'Of this household' && r.sources.some(s => s.key === 'household_children')));
    assert.match(html, /queryCatalogRegions/, 'the builder draws those lists, not a hidden catalog');
    assert.match(html, /class="m-dropdown pe-query__pick"/, 'the lists are a dropdown, not a stack of cards');
    assert.match(html, /m-dropdown__group/, 'regions stay as groups inside the menu');
    assert.match(html, /Find a list/, 'search is inside the menu, not a second drawer strip');
    assert.match(js, /querySourceLabel/, 'the closed button says which list is picked');
});

test('Not all data could be pulled can be folded', () => {
    assert.match(html, /data\.warningsOpen/, 'the warnings list opens and shuts');
    assert.match(html, /pe-drawer__title--toggle/, 'the heading is the fold');
    assert.match(js, /warningsOpen: true/, 'they start open so a gap is seen');
    const warnAt = html.indexOf('pe-drawer__section--warn');
    const listAt = html.indexOf('x-show="data.warningsOpen"', warnAt);
    assert.ok(listAt > warnAt, 'the messages sit under the fold');
});

test('a range in the query counts Sundays or weeks from a Sunday, not days', () => {
    assert.match(html, /rangeMode\(repeatParam\(spec\.key\)\) === 'weeks'/, 'the builder has a way to count in Sundays or weeks');
    assert.match(html, /setRangeMode\(spec, 'weeks'\)/, 'switching to it starts from the catalog default');
    assert.match(html, /x-text="rangeUnitLabel\(spec\)"/, 'the Sundays list says Sundays, event dates say weeks');
    assert.match(html, /How many/, 'how many is a number of Sundays or weeks');
    assert.match(html, /setRangePart\(spec, 'start', \{ mode: 'this' \}\)/, 'starting this Sunday, next Sunday or a date');
    assert.match(js, /setRangeMode\(spec, mode\)[\s\S]*Data\.rangeForMode/, 'the editor asks the catalog what a fresh range looks like');
    assert.match(html, /setRangeMode\(spec, 'count'\)/, 'event dates can count the next few dates');
    assert.match(html, />Next dates</, 'that way of counting is said in church words');
    assert.match(html, /rangeMode\(repeatParam\(spec\.key\)\) === 'count'/, 'how many dates is its own panel');
    const Data = require('../public/printable-data-core.js');
    const { PrintableEditorData } = require('../public/printable-editor-data.js');
    const ed = PrintableEditorData({});
    assert.equal(ed.rangeUnitLabel(Data.sourceByKey('sundays').params[0]), 'Sundays');
    assert.equal(ed.rangeUnitLabel(Data.sourceByKey('event_dates').params[0]), 'Weeks');
});

test('a rota: the query offers the roles of the event it is kept to', () => {
    assert.match(html, /x-show="spec\.kind === 'role'"[\s\S]*?rolesFor\(repeatParam\('seriesId'\)\)/, 'the role picker lists the roles that event carries');
});

test('a text option in the query says what leaving it empty means', () => {
    assert.match(html, /:placeholder="spec\.placeholder \|\| 'any'"/, 'not planned yet reads as… is not "any"');
});

test('the query preview names a row in words, not by its id', () => {
    const { PrintableEditorWires } = require('../public/printable-editor-data.js');
    assert.equal(PrintableEditorWires.previewName({ _id: '2026-09-20', date: 'Sunday 20 September 2026', preacher: 'TBA' }), 'Sunday 20 September 2026');
    assert.equal(PrintableEditorWires.previewName({ _id: 'p1', name: 'Anna Baker', date: '' }), 'Anna Baker');
    assert.equal(PrintableEditorWires.previewName({ _id: 'preparatoryHymn', label: 'Preparatory hymn' }), 'Preparatory hymn');
    assert.equal(PrintableEditorWires.previewName({}), 'A row');
    assert.match(js, /names: rows\.slice\(0, 8\)\.map\(previewName\)/, 'the builder\'s preview uses it');
});

test('what could not be pulled stays in the drawer while the catalog is hidden', () => {
    const catalogAt = html.indexOf('<div x-show="showCatalog">');
    const warnAt = html.indexOf('pe-drawer__section--warn');
    const okAt = html.indexOf('Every wired field has a value today.');
    assert.ok(catalogAt > 0 && warnAt > 0 && okAt > 0);
    assert.ok(warnAt < catalogAt, 'Not all data could be pulled is not inside the hidden catalog');
    assert.ok(okAt < catalogAt, 'nor is the all-clear');
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
