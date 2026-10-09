const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/printable-editor.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../public/printable-editor-data.js'), 'utf8');

// The drawer markup, from its body to the end of the aside.
const drawerAt = html.indexOf('<aside class="pe-panel pe-panel--right pe-drawer"');
const drawer = html.slice(drawerAt, html.indexOf('</aside>', drawerAt));

function between(text, from, to) {
    const a = text.indexOf(from);
    const b = text.indexOf(to, a + 1);
    assert.ok(a >= 0, 'missing ' + from);
    assert.ok(b > a, 'missing ' + to + ' after ' + from);
    return text.slice(a, b);
}

test('iteration is queried in the data drawer, and a locked query cannot be rebuilt', () => {
    assert.match(drawer, /class="pe-drawer__section pe-query"/, 'the drawer has a query builder');
    assert.match(drawer, /This list is not yours to query/, 'a list above the viewer is closed');
    assert.match(js, /queryLocked/, 'the editor knows when the query is not theirs');
    assert.match(js, /querySpecsFor/, 'only filters this viewer may use are offered');
    assert.match(html, /Build the query in the data drawer/, 'the element panel does not carry the query');
});

test('a box inside a household card can query the children of that household', () => {
    const Data = require('../public/printable-data-core.js');
    const { PrintableEditorWires } = require('../public/printable-editor-data.js');
    const regions = PrintableEditorWires.groupQuerySources(
        Data.querySourcesFor('member', 'households'), '', Data.sourceByKey('households'));
    assert.equal(regions[0].name, 'Of this household', 'the related list is named for one row of its parent');
    assert.equal(regions[0].related, true);
    assert.deepEqual(regions[0].sources.map(s => s.key), ['household_children']);
    assert.match(js, /relatedListSources/, 'the editor knows which lists belong to the parent row');
    assert.match(js, /listSourcesFor/, 'related lists are offered only inside their parent');
});

test('the drawer is Wired, the query builder, the Fill-in library, General live data, then warnings', () => {
    const order = [
        'aria-label="Wired to this element"',
        'aria-label="Query builder"',
        '<span>Fill-in library</span>',
        '<span>General live data</span>',
        'pe-drawer__section--warn',
    ].map(mark => {
        const at = drawer.indexOf(mark);
        assert.ok(at > 0, mark + ' is in the drawer');
        return at;
    });
    order.reduce((prev, at) => { assert.ok(at > prev, 'the parts read top to bottom'); return at; }, -1);
    assert.match(drawer, /Live<\/button>[\s\S]*Stand-ins<\/button>[\s\S]*@click="reloadData\(\)"/, 'the head is Live | Stand-ins and refresh');
    assert.match(drawer, /<details class="pe-part pe-part--fill" open>/, 'the Fill-in library folds and starts open');
    assert.match(drawer, /<details class="pe-part pe-part--general">/, 'General live data folds');
    const queryAt = drawer.indexOf('aria-label="Query builder"');
    assert.ok(!drawer.slice(0, queryAt).includes('<details'), 'the query builder itself never folds');
});

test('one way to each source: no This Sunday card, no Repeat a box, no hidden catalog', () => {
    [
        /aria-label="This Sunday"/, /aria-label="Repeat a box"/, /showCatalog/, /showScalarInserts/,
        /showRepeatOffer/, /showQueryBuilder/, /showParentRowFields/, /startQuickList/, /toggleSource/,
        /fieldsOf\(src\)/, /data\.open\[/, /Single values/, /All lists…/,
    ].forEach(re => assert.doesNotMatch(drawer, re, re + ' is a second way to the same data'));
    [/get showCatalog\(/, /get regions\(/, /SUNDAY_QUICK_LISTS/, /data\.picking/, /groupQueryLists/].forEach(re => {
        assert.doesNotMatch(js, re, re + ' belonged to the old parallel paths');
    });
    assert.match(js, /get canStartIteration\(/, 'iteration is still offered from the selection');
});

test('an unbound box inside an iterated household card may become a sub-iteration', () => {
    assert.match(drawer, /Make this a sub-iteration/, 'an inner box is offered a related list, not a second directory');
    assert.match(js, /get canStartSubIteration\(/, 'sub-iteration is a first-class offer');
    assert.match(js, /selectedBindings\.length/, 'a child that already has a field wired is not offered a related list');
});

test('the query builder menu is every source this viewer may read, single or list', () => {
    const Data = require('../public/printable-data-core.js');
    const { PrintableEditorWires } = require('../public/printable-editor-data.js');
    const offered = Data.querySourcesFor('editor');
    const regions = PrintableEditorWires.groupQuerySources(offered, '');
    const keys = regions.flatMap(r => r.sources.map(s => s.key));
    offered.forEach(s => assert.ok(keys.includes(s.key), s.key + ' belongs in the query builder'));
    ['sunday', 'role_holder', 'people', 'households', 'sundays', 'event_dates', 'form_answers'].forEach(k => {
        assert.ok(keys.includes(k), k + ' is offered');
    });
    ['sunday_typed', 'insert_date', 'insert_page_number', 'household_children'].forEach(k => {
        assert.ok(!keys.includes(k), k + ' is not a top-level query');
    });
    assert.ok(!regions.some(r => r.related), 'no "Of this" group outside a card');
    const all = PrintableEditorWires.groupQuerySources(Data.SOURCES, '');
    assert.ok(!all.flatMap(r => r.sources).some(s => s.scalar || s.blank || s.noDrawer), 'an insert or noDrawer source never reaches the menu');
    const byField = PrintableEditorWires.groupQuerySources(offered, 'preacher').flatMap(r => r.sources.map(s => s.key));
    assert.ok(byField.includes('sunday'), 'searching a field label finds the source that carries it');
    assert.ok(!byField.includes('people'));
    assert.match(drawer, /queryCatalogRegions/, 'the builder draws its menu from the grouped sources');
    assert.match(drawer, /class="m-dropdown pe-query__pick"/, 'the sources are a dropdown, not a stack of cards');
    assert.match(drawer, /m-dropdown__group/, 'regions stay as groups inside the menu');
    assert.match(drawer, /src\.shape === 'list' \? 'List' : 'One'/, 'each option says whether it is a list or one record');
    assert.match(drawer, /Find data…/, 'search is inside the menu');
    assert.match(js, /querySourceLabel/, 'the closed button says what is picked');
});

test('Not all data could be pulled can be folded', () => {
    assert.match(drawer, /data\.warningsOpen/, 'the warnings list opens and shuts');
    assert.match(drawer, /pe-drawer__title--toggle/, 'the heading is the fold');
    assert.match(js, /warningsOpen: true/, 'they start open so a gap is seen');
    const warnAt = drawer.indexOf('pe-drawer__section--warn');
    const listAt = drawer.indexOf('x-show="data.warningsOpen"', warnAt);
    assert.ok(listAt > warnAt, 'the messages sit under the fold');
});

test('a range in the query counts Sundays or weeks from a Sunday, not days', () => {
    assert.match(drawer, /rangeMode\(queryParam\(spec\.key\)\) === 'weeks'/, 'the builder has a way to count in Sundays or weeks');
    assert.match(drawer, /setRangeMode\(spec, 'weeks'\)/, 'switching to it starts from the catalog default');
    assert.match(drawer, /x-text="rangeUnitLabel\(spec\)"/, 'the Sundays list says Sundays, event dates say weeks');
    assert.match(drawer, /How many/, 'how many is a number of Sundays or weeks');
    assert.match(drawer, /setRangePart\(spec, 'start', \{ mode: 'this' \}\)/, 'starting this Sunday, next Sunday or a date');
    assert.match(js, /setRangeMode\(spec, mode\)[\s\S]*Data\.rangeForMode/, 'the editor asks the catalog what a fresh range looks like');
    assert.match(drawer, /setRangeMode\(spec, 'count'\)/, 'event dates can count the next few dates');
    assert.match(drawer, />Next dates</, 'that way of counting is said in church words');
    assert.match(drawer, /rangeMode\(queryParam\(spec\.key\)\) === 'count'/, 'how many dates is its own panel');
    const Data = require('../public/printable-data-core.js');
    const { PrintableEditorData } = require('../public/printable-editor-data.js');
    const ed = PrintableEditorData({});
    assert.equal(ed.rangeUnitLabel(Data.sourceByKey('sundays').params[0]), 'Sundays');
    assert.equal(ed.rangeUnitLabel(Data.sourceByKey('event_dates').params[0]), 'Weeks');
});

test('a rota: the query offers the roles of the event it is kept to', () => {
    assert.match(drawer, /x-show="spec\.kind === 'role'"[\s\S]*?rolesFor\(queryParam\('seriesId'\)\)/, 'the role picker lists the roles that event carries');
});

test('a single\'s params sit in the same builder: who holds a role, on the next date or from a date', () => {
    const { PrintableEditorWires } = require('../public/printable-editor-data.js');
    assert.match(drawer, /x-show="spec\.kind === 'when-event'"/, 'the next date of an event is a param kind the builder draws');
    assert.match(drawer, /x-text="specEmptyLabel\(spec\)"/, 'an empty pick says what it means');
    assert.equal(PrintableEditorWires.specEmptyLabel({ kind: 'series', required: true }), 'Choose an event');
    assert.equal(PrintableEditorWires.specEmptyLabel({ kind: 'series' }), 'Every event');
    assert.equal(PrintableEditorWires.specEmptyLabel({ kind: 'role', required: true }), 'Choose a role');
    assert.equal(PrintableEditorWires.specEmptyLabel({ kind: 'role' }), 'No role');
    assert.equal(PrintableEditorWires.specEmptyLabel({ kind: 'form', required: true }), 'Choose a form');
    assert.equal(PrintableEditorWires.specEmptyLabel({ kind: 'choice' }), '');
});

test('a text option in the query says what leaving it empty means', () => {
    assert.match(drawer, /:placeholder="spec\.placeholder \|\| 'any'"/, 'not planned yet reads as… is not "any"');
});

test('a select in the query shows the value the query holds, even when its options draw after it', () => {
    const query = between(drawer, 'aria-label="Query builder"', 'pe-part pe-part--fill');
    const options = query.match(/<option :value="[^"]+"[^>]*>/g) || [];
    assert.ok(options.length >= 4, 'choice, series, role and form selects');
    options.forEach(o => assert.match(o, /:selected="[^"]+ === queryParam\(spec\.key\)"/, o));
});

test('the query preview names a row in words, not by its id', () => {
    const { PrintableEditorWires } = require('../public/printable-editor-data.js');
    assert.equal(PrintableEditorWires.previewName({ _id: '2026-09-20', date: 'Sunday 20 September 2026', preacher: 'TBA' }), 'Sunday 20 September 2026');
    assert.equal(PrintableEditorWires.previewName({ _id: 'p1', name: 'Anna Baker', date: '' }), 'Anna Baker');
    assert.equal(PrintableEditorWires.previewName({ _id: 'preparatoryHymn', label: 'Preparatory hymn' }), 'Preparatory hymn');
    assert.equal(PrintableEditorWires.previewName({}), 'A row');
    assert.match(js, /names: rows\.slice\(0, 8\)\.map\(previewName\)/, 'a box\'s preview uses it');
    assert.match(js, /names: isList \? out\.rows\.slice\(0, 8\)\.map\(previewName\)/, 'a browsed list\'s preview uses it');
});

test('the builder reads today\'s rows for what it is browsing, so chips say what they hold', () => {
    assert.match(drawer, /x-effect="ensureQueryPreview\(\)"/, 'the builder section asks for its own preview');
    assert.match(js, /Today\\'s values did not load\. The fields still wire\./, 'a failed preview does not stop wiring');
    assert.match(drawer, /queryResults\.warnings/, 'what the pick cannot read is said under it');
});

test('a wire lands on a chip that has a box, never on a hidden chip', () => {
    require('../public/scripture-passage.js');
    const Wires = require('../public/printable-editor-data.js').PrintableEditorWires;
    const hidden = { key: 'global|sunday|hymn2', rect: { width: 0, height: 0 } };
    const shown = { key: 'global|sunday|hymn2', rect: { width: 48, height: 22 } };
    assert.equal(Wires.firstLaidOutChip([hidden, shown], 'global|sunday|hymn2'), shown);
    assert.equal(Wires.firstLaidOutChip([hidden], 'global|sunday|hymn2'), null);
    assert.equal(Wires.wireKey({ source: 'sunday', field: 'keyVerse', reading: 'passage' }), 'global|sunday|keyVerse#passage');
    assert.equal(Wires.drawerScrollDelta(
        { top: 100, bottom: 400 },
        { top: 20, bottom: 48 }
    ) < 0, true, 'a chip above the drawer scrolls up');
    assert.match(drawer, /Wired to this element/);
    assert.match(drawer, /pe-chip--land/);
    assert.match(js, /laidOutChip/);
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
    assert.match(js, /syncWirePaths/, 'redrawing does not throw the path away');
    assert.doesNotMatch(js, /svg\.innerHTML\s*=\s*''/, 'wiping the svg kills the draw-on');
});

test('a chip off the drawer body is not a wire landing, and scroll never pins it back', () => {
    const Wires = require('../public/printable-editor-data.js').PrintableEditorWires;
    const view = { left: 0, top: 100, right: 280, bottom: 500 };
    const land = { key: 'global|sunday|theme', rect: { left: 8, top: -40, right: 120, bottom: -10, width: 112, height: 30 } };
    const builder = { key: 'global|sunday|theme', rect: { left: 8, top: 200, right: 120, bottom: 230, width: 112, height: 30 } };
    assert.equal(
        Wires.firstLaidOutChip([land, builder], 'global|sunday|theme', view),
        builder,
        'the land chip above the drawer is skipped for the one still in view'
    );
    assert.equal(
        Wires.firstLaidOutChip([land], 'global|sunday|theme', view),
        null,
        'nothing on screen means the wire breaks'
    );
    assert.match(js, /_wirePinnedFor/, 'pinning a chip is remembered per selection');
    assert.match(js, /addEventListener\('scroll',\s*\(\)\s*=>\s*this\.refreshWires\(\)/,
        'scroll redraws the wire without asking to pin');
    assert.doesNotMatch(js, /scrollChipIntoDrawer\(chip\);\s*\n\s*const a = this\.pointOf/,
        'every redraw must not scroll the chip back into the drawer');
});

test('a Sunday in the query builder shows Service, Hymns and Scripture; fill-ins are a list of blanks', () => {
    const Data = require('../public/printable-data-core.js');
    const Typed = require('../public/sunday-typed-core.js');
    require('../public/scripture-passage.js');
    const Wires = require('../public/printable-editor-data.js').PrintableEditorWires;
    const fields = Wires.sundayDrawerFields(Data, global.ScripturePassage, Typed.FIELDS);
    assert.ok(fields.hymns.some(f => f.key === 'hymn2'), 'a hymn name is a Sunday chip');
    assert.equal(fields.service.find(f => f.key === 'longDate').label, 'Date');
    assert.ok(fields.service.some(f => f.key === 'theme'));
    assert.ok(fields.service.some(f => f.key === 'preacher'));
    assert.ok(!fields.service.some(f => f.key === 'keyVerse'), 'scripture stays in its own group');
    assert.ok(!fields.service.some(f => f.key === 'sermon'));
    assert.ok(!fields.hymns.some(f => f.key === 'date'));
    assert.ok(fields.scripture.some(f => f.key === 'keyVerse'), 'key verse is a scripture chip');
    assert.ok(fields.scripture.some(f => f.key === 'sermon'), 'Standard\'s sermon is a scripture chip');
    assert.equal(Wires.chipPreview('text', 'How Rich a Treasure We Possess'), 'How Rich a Treasure We Possess');
    assert.equal(Wires.chipPreview('image', 'https://example.test/map.png'), 'Picture set');

    const query = between(drawer, 'aria-label="Query builder"', '<span>Fill-in library</span>');
    const fill = between(drawer, '<span>Fill-in library</span>', '<span>General live data</span>');
    const general = between(drawer, '<span>General live data</span>', 'pe-drawer__section--warn');
    assert.match(query, /<template x-if="queryIsSunday">/, 'the Sunday groups belong to the builder');
    assert.match(query, /querySundayGroups\.service/);
    assert.match(query, /querySundayGroups\.hymns/);
    assert.match(query, /onSundayChipDragStart\(\$event, 'sunday', f\)/);
    assert.match(query, /<p class="pe-sun__label">Scripture<\/p>/, 'scripture is a sub-area of the Sunday results');
    assert.match(query, /onScriptureChipDragStart\(\$event, ref, 'citation'\)[\s\S]*Reference/);
    assert.match(query, /onScriptureChipDragStart\(\$event, ref, 'passage'\)[\s\S]*Words/);
    assert.doesNotMatch(fill, /onScriptureChipDragStart/, 'scripture is not a blank');
    assert.doesNotMatch(general, /onScriptureChipDragStart/, 'scripture is not a page insert');
    assert.doesNotMatch(fill, /Sunday booklet|sundayTypedChips|pe-booklet/, 'no pamphlet-specific fill-in card');
    assert.match(fill, /onEventChipDragStart/, 'fill-in entries are in the Fill-in library');
    assert.match(fill, /addEventInput\('list'\)/);
    assert.doesNotMatch(query, /sundayTypedChips/);
    assert.match(general, /onScalarChipDragStart\(\$event, 'insert_date', 'value'\)/);
    assert.match(general, /onScalarChipDragStart\(\$event, 'insert_page_number', 'number'\)/);
    assert.match(general, /onAssetChipDragStart/);
    assert.match(js, /sundayDrawerFields\(Data,[\s\S]*\{[\s\S]*liturgy/,
        'the Sunday groups read the loaded liturgy, not only the seed fields');
});

test('This Sunday chips follow the order the Sunday uses, not the seed names', () => {
    const Data = require('../public/printable-data-core.js');
    const Typed = require('../public/sunday-typed-core.js');
    const Liturgy = require('../public/liturgy-order-core.js');
    require('../public/scripture-passage.js');
    const Wires = require('../public/printable-editor-data.js').PrintableEditorWires;
    const liturgy = Liturgy.catalogFrom({
        orders: [{
            id: 'standard',
            name: 'Standard',
            elements: [
                { id: 'preparatoryHymn', name: 'Preparatory Hymn', kind: 'hymn', hasNote: true },
                { id: 'callToWorship', name: 'Call to Worship', kind: 'scripture', hasNote: true },
                { id: 'hymn1', name: 'Hymn 1', kind: 'hymn', hasNote: true },
                { id: 'hymn2', name: 'Hymn 2', kind: 'hymn', hasNote: true },
                { id: 'prayerOfPraise', name: 'Prayer of Praise', kind: 'prayer', hasNote: true },
                { id: 'sermon', name: 'Sermon', kind: 'scripture', hasNote: true },
                { id: 'pastoralPrayer', name: 'Pastoral Prayer', kind: 'prayer', hasNote: true,
                    requests: { people: [{ who: 'either' }, { who: 'either' }], noticeDays: [5, 3, 1] } },
                { id: 'hymnEnd1', name: 'Hymn 5', kind: 'hymn', hasNote: true },
            ],
        }],
    });
    const fields = Wires.sundayDrawerFields(Data, global.ScripturePassage, Typed.FIELDS, { liturgy: liturgy });
    assert.equal(fields.hymns.find(f => f.key === 'hymn1').label, 'Hymn 1');
    assert.equal(fields.hymns.find(f => f.key === 'hymnEnd1').label, 'Hymn 5');
    assert.ok(fields.service.some(f => f.key === 'prayerOfPraise' && f.label === 'Prayer of Praise'));
    assert.ok(fields.service.some(f => f.key === 'pastoralPrayer'));
    assert.ok(!fields.service.some(f => f.key === 'baptism'), 'Baptism is not on this order');
    assert.ok(!fields.hymns.some(f => f.label === 'Hymn of Praise'), 'seed hymn names stay off');
    assert.ok(!fields.scripture.some(f => f.key === 'benediction'), 'scripture off the order stays off');
    assert.equal(fields.scripture.find(f => f.key === 'callToWorship').label, 'Call to Worship');
    assert.ok(Data.isScriptureField('sermon', liturgy));
    assert.ok(Data.isScriptureField('callToWorship', liturgy));
    assert.ok(!Data.isScriptureField('prayerOfPraise', liturgy));
});

test('every catalog source is query, general live data, or off the drawer', () => {
    const Data = require('../public/printable-data-core.js');
    const { PrintableEditorWires } = require('../public/printable-editor-data.js');
    const homes = {};
    Data.SOURCES.forEach(s => {
        const part = PrintableEditorWires.drawerPartOf(s);
        assert.ok(['query', 'general', ''].includes(part), s.key + ' has a drawer part (or none)');
        homes[s.key] = part;
    });
    assert.equal(homes.sunday_typed, '', 'legacy typed Sunday fields are not a drawer card');
    assert.equal(homes.insert_date, 'general');
    assert.equal(homes.insert_page_number, 'general');
    ['people', 'households', 'household_children', 'sunday', 'sunday_rows', 'sunday_hymns', 'sunday_announcements',
        'sunday_kids_questions', 'sundays', 'event_dates', 'role_holder', 'form_answers'].forEach(k => {
        assert.equal(homes[k], 'query', k + ' is queried');
    });
});
