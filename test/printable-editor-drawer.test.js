const { test } = require('node:test');
const assert = require('node:assert');

// MS-730 — the data drawer's query builder, driven through the editor mixin
// against a fake editor. The globals stand in for the scripts the page loads
// before printable-editor-data.js, which reads them once when it loads.

globalThis.PrintableDataCore = require('../public/printable-data-core.js');
globalThis.PrintableCore = require('../public/printable-core.js');
globalThis.SundayTypedCore = require('../public/sunday-typed-core.js');
globalThis.LiturgyOrderCore = require('../public/liturgy-order-core.js');
require('../public/scripture-passage.js');
require('../public/printable-link-core.js');

const Data = globalThis.PrintableDataCore;
const Core = globalThis.PrintableCore;
const Liturgy = globalThis.LiturgyOrderCore;
const { PrintableEditorData, PrintableEditorWires } = require('../public/printable-editor-data.js');

const TODAY = '2026-10-07';

function text(id, extra) {
    return Object.assign({ id: id, tag: 'p', text: 'Stand-in', style: {}, attrs: {} }, extra || {});
}

function box(id, children, extra) {
    return Object.assign({ id: id, tag: 'div', style: {}, attrs: {}, children: children || [] }, extra || {});
}

function repeat(source, params) {
    return { source: source, params: params || {}, layout: { direction: 'column', perLine: 1, gap: 12, maxPerPage: 0 }, overflow: 'clip' };
}

// The editor around the mixin: a project of pages, a selection, and the
// few page-level calls the drawer makes. Data reloads are counted, not run.
function editor(opts) {
    const o = opts || {};
    const ui = {};
    const ed = {};
    Object.defineProperties(ed, Object.getOwnPropertyDescriptors(PrintableEditorData(ui)));
    const project = { id: 'pr1', pages: [{ id: 'pg1', nodes: o.nodes || [] }], assets: [], inputs: o.inputs || [] };
    Object.defineProperties(ed, Object.getOwnPropertyDescriptors({
        project: project,
        template: {},
        permissionLevel: o.level || 'editor',
        canEdit: o.canEdit !== false,
        selection: { pageId: 'pg1', nodeId: o.select || null },
        viewDate: TODAY,
        flashed: '',
        refreshed: 0,
        get pages() { return this.project.pages; },
        get currentPage() { return this.project.pages[0]; },
        get selectedNode() { return this.selection.nodeId ? Core.findNode(this.currentPage, this.selection.nodeId) : null; },
        get selectedKind() { const n = this.selectedNode; return n ? Core.kindOf(n) : ''; },
        pageOfNode(id) { return this.project.pages.find(p => Core.findNode(p, id)) || null; },
        replacePage(page) { const i = this.project.pages.findIndex(p => p.id === page.id); this.project.pages[i] = page; },
        commit() {},
        renderAll() {},
        readProps() {},
        rebindData() {},
        refreshData() { this.refreshed += 1; },
        refreshWires() {},
        pointOf() { return { x: 0, y: 0 }; },
        flash(msg) { this.flashed = msg; },
        tagLabel() { return 'Box'; },
        select(pageId, nodeId) { this.selection.nodeId = nodeId; },
    }));
    if (o.options) ed.data.options = Object.assign({ series: [], roles: [], forms: [] }, o.options);
    return { ed: ed, ui: ui };
}

function dragEvent() {
    return { dataTransfer: { setData() {}, effectAllowed: '' }, currentTarget: null };
}

test('a text with nothing around it browses: pick a Sunday, set which one, and the chip carries it', () => {
    const { ed } = editor({ nodes: [text('title')], select: 'title' });
    assert.equal(ed.queryScope, 'browse');
    ed.setQuerySource('sunday');
    assert.equal(ed.querySourceKey, 'sunday');
    assert.equal(ed.queryChipScope, 'global', 'a single\'s fields wire straight onto the element');
    assert.ok(ed.queryIsSunday);
    assert.deepEqual(ed.querySpecs.map(s => s.key), ['when']);
    ed.setQueryParam('when', { mode: 'next' });
    assert.deepEqual(ed.browseParams('sunday').when, { mode: 'next' });
    const theme = ed.querySundayGroups.service.find(f => f.key === 'theme');
    assert.ok(theme, 'next Sunday\'s theme is a chip');
    ed.onSundayChipDragStart(dragEvent(), 'sunday', theme);
    assert.deepEqual(ed.dragField.params, { when: { mode: 'next' } }, 'the wire reads next Sunday, not this one');
    ed.bindField('pg1', 'title', ed.dragField);
    const bind = Core.findNode(ed.currentPage, 'title').bind.text;
    assert.deepEqual(bind, { scope: 'global', source: 'sunday', params: { when: { mode: 'next' } }, field: 'theme' });
    assert.equal(ed.refreshed, 1, 'a new wire reads today\'s data');
});

test('scripture sits with the Sunday results, and both chips carry the Sunday the builder is on', () => {
    const { ed } = editor({ nodes: [text('verse')], select: 'verse' });
    ed.setQuerySource('sunday');
    ed.setQueryParam('when', { mode: 'date', date: '2026-10-18' });
    const groups = ed.querySundayGroups;
    const sermon = groups.scripture.find(r => r.key === 'sermon');
    assert.ok(sermon && groups.scripture.some(r => r.key === 'keyVerse'));
    assert.ok(!groups.service.some(f => f.key === 'sermon'), 'a reading is not a service chip');
    ed.onScriptureChipDragStart(dragEvent(), sermon, 'citation');
    assert.deepEqual(ed.dragField.params, { when: { mode: 'date', date: '2026-10-18' } });
    assert.ok(!ed.dragField.reading, 'Reference is the citation');
    ed.onScriptureChipDragStart(dragEvent(), sermon, 'passage');
    assert.equal(ed.dragField.reading, 'passage', 'Words are the verses');
    ed.bindField('pg1', 'verse', ed.dragField);
    const bind = Core.findNode(ed.currentPage, 'verse').bind.text;
    assert.equal(bind.reading, 'passage');
    assert.ok(bind.passage && typeof bind.passage === 'object', 'the presentation is stored on the wire');
    assert.equal(ed.connectedChips[0].key, 'global|sunday|sermon#passage', 'the wire lands on its own chip');
});

test('a chip browsed with no pick does nothing, and the menu only offers what the viewer may read', () => {
    const { ed } = editor({ nodes: [text('t')], select: 't', level: 'viewer' });
    const offered = ed.queryOffered.map(s => s.key);
    assert.ok(!offered.includes('people'), 'the directory is above a viewer');
    assert.ok(offered.includes('sunday') && offered.includes('sundays'));
    ed.setQuerySource('people');
    assert.equal(ed.querySourceKey, '', 'a source above the viewer cannot be picked by hand');
    assert.deepEqual(ed.querySpecs, []);
    assert.deepEqual(ed.queryFields, []);
});

test('a directory: browse People, keep it to members, then iterate the selected box over it', () => {
    const { ed } = editor({ nodes: [box('card', [text('name')])], select: 'card', level: 'member' });
    ed.setQuerySource('people');
    assert.equal(ed.queryChipScope, 'inert', 'a list\'s fields show what a row carries before anything repeats');
    assert.equal(ed.queryIterateOffer, 'iterate');
    ed.setQueryParam('membership', 'members');
    ed.setQueryParam('stage', 'member');
    assert.equal(ed.browseParams('people').stage, '', 'an elder-only filter is not set by a member');
    ed.iterateSelectedBox();
    const card = Core.findNode(ed.currentPage, 'card');
    assert.equal(card.repeat.source, 'people');
    assert.equal(card.repeat.params.membership, 'members');
    assert.deepEqual(Object.keys(card.repeat).sort(), ['continueWith', 'layout', 'omitWhenEmpty', 'overflow', 'params', 'source']);
    assert.equal(ed.queryScope, 'own', 'the builder is now the box\'s own query');
    ed.setQueryParam('sort', 'first');
    assert.equal(Core.findNode(ed.currentPage, 'card').repeat.params.sort, 'first', 'a box\'s filter is saved on its Repeat');
    ed.selection.nodeId = 'name';
    assert.equal(ed.queryScope, 'row', 'inside the card the builder shows one row');
    assert.equal(ed.queryChipScope, 'item');
    assert.ok(ed.queryFields.some(f => f.key === 'name'));
    ed.onChipDragStart(dragEvent(), 'item', { key: ed.repeatContext.repeat.source }, ed.queryFields.find(f => f.key === 'name'));
    assert.equal(ed.dragField.scope, 'item');
    assert.equal(ed.dragField.params, null, 'a row field carries no params of its own');
});

test('household and children: a box in a household card browses its children and becomes a sub-iteration', () => {
    const nodes = [box('house', [text('hname'), box('kids', [])], { repeat: repeat('households') })];
    const { ed } = editor({ nodes: nodes, select: 'kids', level: 'member' });
    assert.equal(ed.queryScope, 'browse');
    assert.equal(ed.querySourceKey, 'household_children', 'the related list is the first thing offered');
    assert.equal(ed.queryCatalogRegions[0].name, 'Of this household');
    assert.equal(ed.queryIterateOffer, 'sub');
    ed.iterateSelectedBox();
    assert.equal(Core.findNode(ed.currentPage, 'kids').repeat.source, 'household_children');
    assert.equal(Core.findNode(ed.currentPage, 'house').repeat.source, 'households', 'the parent card is untouched');
    ed.selection.nodeId = 'hname';
    assert.equal(ed.queryScope, 'row', 'a wired-or-text child reads the household row');
    assert.equal(ed.querySourceKey, 'households');
});

test('a related list picked outside its parent card is not offered to iterate', () => {
    const { ed } = editor({ nodes: [box('lone', [])], select: 'lone', level: 'member' });
    assert.ok(!ed.queryOffered.some(s => s.key === 'household_children'));
    ed.data.query.source = 'household_children';
    ed.data.query.pickedFor = 'lone';
    assert.equal(ed.queryIterateOffer, 'needs-parent');
});

test('a five-Sunday preaching schedule: pick Sundays for a box, count five, and TBA stays the default', () => {
    const { ed } = editor({ nodes: [box('weeks', [text('when')])], select: 'weeks' });
    ed.makeIterated();
    assert.equal(ed.data.queryMenuOpen, true, 'making a box iterated opens the menu of lists');
    assert.equal(ed.queryScope, 'own');
    assert.equal(ed.querySourceLabel, 'Pick a list');
    assert.ok(ed.queryOffered.every(s => s.shape === 'list'), 'a repeating box picks among lists');
    ed.setQuerySource('sundays');
    assert.equal(Core.findNode(ed.currentPage, 'weeks').repeat.source, 'sundays');
    const range = ed.querySpecs.find(s => s.kind === 'range');
    ed.setRangeMode(range, 'weeks');
    ed.setRangePart(range, 'count', 5);
    const params = Core.findNode(ed.currentPage, 'weeks').repeat.params;
    assert.equal(params.range.mode, 'weeks');
    assert.equal(params.range.count, 5);
    assert.match(ed.rangeWords(range), /5 Sundays/);
    assert.equal(ed.queryParam('notPlanned'), 'TBA', 'a Sunday not planned yet still reads as TBA');
});

test('hymn overflow and order rows: the Sunday lists a box can repeat over are all in the builder', () => {
    const { ed } = editor({ nodes: [box('sheet', [])], select: 'sheet', level: 'viewer' });
    const keys = ed.queryOffered.map(s => s.key);
    ['sunday_hymns', 'sunday_rows', 'sunday_announcements', 'sunday_kids_questions', 'sundays'].forEach(k => {
        assert.ok(keys.includes(k), k + ' is offered');
    });
    ed.setQuerySource('sunday_hymns');
    assert.ok(ed.querySpecs.some(s => s.key === 'slot'), 'which hymn is a filter');
    ed.iterateSelectedBox();
    const node = Core.findNode(ed.currentPage, 'sheet');
    assert.equal(node.repeat.source, 'sunday_hymns');
    assert.equal(node.repeat.overflow, 'clip');
    ed.setRepeatOverflow('new-page');
    assert.equal(Core.findNode(ed.currentPage, 'sheet').repeat.overflow, 'new-page', 'a long hymn keeps real pages');
});

test('an editor-locked query still runs, and a member can neither change nor rebuild it', () => {
    const nodes = [box('answers', [text('a')], { repeat: repeat('form_answers', { formId: 'f1' }) })];
    const { ed } = editor({ nodes: nodes, select: 'answers', level: 'member' });
    assert.equal(ed.queryLocked, true);
    assert.deepEqual(ed.querySpecs, []);
    ed.setQueryParam('formId', 'f2');
    ed.setRepeatParam('formId', 'f2');
    assert.deepEqual(Core.findNode(ed.currentPage, 'answers').repeat.params, { formId: 'f1' }, 'the saved query is left alone');
    assert.equal(ed.queryIterateOffer, '');
});

test('a list filled on the event is not a locked query', () => {
    const inputs = [{ id: 'in1', kind: 'list', label: 'Players', fields: [{ id: 'c1', kind: 'text', label: 'Name' }] }];
    const nodes = [box('team', [text('player')], { repeat: repeat('event_list', { inputId: 'in1' }) })];
    const { ed } = editor({ nodes: nodes, select: 'team', inputs: inputs, level: 'member' });
    assert.equal(ed.queryLocked, false);
    assert.equal(ed.querySourceLabel, 'Players · filled on the event');
    ed.selection.nodeId = 'player';
    assert.deepEqual(ed.queryFields.map(f => f.key), ['c1'], 'its columns are the row\'s fields');
    ed.onChipDragStart(dragEvent(), 'item', { key: ed.repeatContext.repeat.source }, ed.queryFields[0]);
    assert.equal(ed.dragField.source, 'event_list');
});

test('who holds a role: a single with required params says what to choose', () => {
    const { ed } = editor({ nodes: [text('who')], select: 'who', options: { series: [{ id: 's1', name: 'Youth group', roleSlugs: [] }] } });
    ed.setQuerySource('role_holder');
    const specs = ed.querySpecs;
    assert.deepEqual(specs.map(s => s.kind), ['series', 'role', 'when-event']);
    assert.equal(ed.specEmptyLabel(specs[0]), 'Choose an event');
    assert.equal(ed.specEmptyLabel(specs[1]), 'Choose a role');
    ed.setQueryParam('seriesId', 's1');
    assert.equal(ed.queryParam('seriesId'), 's1');
});

test('another church\'s liturgy order: the Sunday chips are that order\'s names', () => {
    const liturgy = Liturgy.catalogFrom({
        orders: [{
            id: 'lessons',
            name: 'Lessons and Carols',
            elements: [
                { id: 'openingCarol', name: 'Opening Carol', kind: 'hymn' },
                { id: 'firstLesson', name: 'First Lesson', kind: 'scripture' },
                { id: 'bidding', name: 'Bidding Prayer', kind: 'prayer' },
            ],
        }],
    });
    const { ed } = editor({ nodes: [text('t')], select: 't', options: { liturgy: liturgy } });
    ed.setQuerySource('sunday');
    ed.data.query.preview = Object.assign({}, ed.data.query.preview, {
        key: 'sunday|{}|' + TODAY,
        service: { liturgyOrderId: 'lessons' },
        liturgy: liturgy,
        row: { openingCarol: 'O Come, All Ye Faithful', firstLesson: 'Genesis 3:8-15' },
    });
    const groups = ed.querySundayGroups;
    assert.deepEqual(groups.hymns.map(f => f.label), ['Opening Carol']);
    assert.equal(groups.hymns[0].value, 'O Come, All Ye Faithful', 'a chip says what it holds today');
    assert.deepEqual(groups.scripture.map(r => r.label), ['Key verse', 'First Lesson']);
    assert.equal(groups.scripture[1].citation, 'Genesis 3:8-15');
    assert.ok(groups.service.some(f => f.label === 'Bidding Prayer'));
    assert.ok(!groups.hymns.some(f => f.key === 'hymn1'), 'Standard\'s slots are not this order\'s');
});

test('the builder reads its own preview: a browsed single fills its chips, a list counts its rows', async () => {
    const fetched = [];
    globalThis.db = {};
    globalThis.PrintableDataStore = {
        async fetch(db, needs) {
            fetched.push(needs);
            const date = (needs.services || [])[0];
            return { services: date ? { [date]: { theme: 'Grace upon grace', preacher: 'Rev. Ada Lin' } } : {}, people: [], families: [], households: [], liturgy: null };
        },
    };
    try {
        const { ed } = editor({ nodes: [text('t'), box('b', [])], select: 't' });
        ed.setQuerySource('sunday');
        await ed.ensureQueryPreview();
        assert.equal(fetched.length, 1);
        assert.equal(ed.querySundayGroups.service.find(f => f.key === 'theme').value, 'Grace upon grace');
        await ed.ensureQueryPreview();
        assert.equal(fetched.length, 1, 'the same pick is not read twice');
        ed.setQueryParam('when', { mode: 'next' });
        await ed.ensureQueryPreview();
        assert.equal(fetched.length, 2, 'a new Sunday is a new read');
        ed.selection.nodeId = 'b';
        ed.setQuerySource('sundays');
        await ed.ensureQueryPreview();
        assert.equal(ed.queryResults.count, 5, 'five Sundays by default, planned or not');
        assert.equal(ed.queryResults.names.length, 5);
    } finally {
        delete globalThis.db;
        delete globalThis.PrintableDataStore;
    }
});

test('the builder opens on what the printable already reads most', () => {
    const nodes = [
        text('a', { bind: { text: { scope: 'global', source: 'sunday', params: {}, field: 'theme' } } }),
        text('b', { bind: { text: { scope: 'global', source: 'sunday', params: {}, field: 'preacher' } } }),
        box('c', [], { repeat: repeat('sundays') }),
    ];
    const keys = Data.querySourcesFor('editor').map(s => s.key);
    assert.equal(PrintableEditorWires.defaultQuerySource({ pages: [{ nodes: nodes }] }, keys), 'sunday');
    assert.equal(PrintableEditorWires.defaultQuerySource({ pages: [{ nodes: [] }] }, keys), '');
    assert.equal(PrintableEditorWires.defaultQuerySource({ pages: [{ nodes: [box('d', [], { repeat: repeat('people') })] }] }, ['sunday']), '',
        'a source the viewer may not query is never the default');
});

test('querySubject: a box\'s own query, a card\'s row, or a browsed pick remembered per selection', () => {
    const subject = PrintableEditorWires.querySubject;
    assert.deepEqual(subject({ ownRepeat: { source: 'people' }, pick: 'sunday' }), { scope: 'own', source: 'people' });
    assert.deepEqual(subject({
        ownRepeat: { source: 'people' }, pick: 'sunday', browseFor: 'box1', selectionId: 'box1',
    }), { scope: 'browse', source: 'sunday' }, 'Browse other data looks elsewhere without rewriting the Repeat');
    assert.deepEqual(subject({
        ownRepeat: { source: 'people' }, pick: 'sunday', browseFor: 'box1', selectionId: 'other',
    }), { scope: 'own', source: 'people' }, 'browse-other is only for the box it was opened on');
    assert.deepEqual(subject({ context: { source: 'households' }, pick: 'sunday', pickedFor: 'x', selectionId: 'y' }),
        { scope: 'row', source: 'households' }, 'a pick made elsewhere does not follow the selection into a card');
    assert.deepEqual(subject({ context: { source: 'households' }, pick: 'sunday', pickedFor: 'y', selectionId: 'y' }),
        { scope: 'browse', source: 'sunday' }, 'a pick made here wins over the card');
    assert.deepEqual(subject({ context: { source: 'households' }, pick: 'households', pickedFor: 'y', selectionId: 'y' }),
        { scope: 'row', source: 'households' });
    assert.deepEqual(subject({ context: { source: 'households' }, related: ['household_children'] }),
        { scope: 'browse', source: 'household_children' });
    assert.deepEqual(subject({ pick: 'sunday' }), { scope: 'browse', source: 'sunday' });
    assert.deepEqual(subject({}), { scope: 'browse', source: '' });
});

test('an event_list Repeat is not retargeted by the query menu', () => {
    const nodes = [box('row', [text('name')], { repeat: { source: 'event_list', params: { inputId: 'players' } } })];
    const { ed } = editor({
        nodes: nodes,
        select: 'row',
        inputs: [{ id: 'players', kind: 'list', label: 'Players', fields: [{ id: 'n', label: 'Name', kind: 'text' }] }],
    });
    assert.equal(ed.queryScope, 'own');
    assert.equal(ed.querySourceKey, 'event_list');
    assert.ok(ed.queryIsEventList);
    assert.deepEqual(ed.queryOffered, [], 'no catalog list is offered over an event blank list');
    ed.setQuerySource('people');
    assert.equal(ed.selectedNode.repeat.source, 'event_list', 'the menu cannot replace a fill-in list');
});

test('the Fill-in library\'s booklet text: which Sunday, its chips, and a chip that carries that Sunday', async () => {
    const { ed } = editor({ nodes: [text('country')], select: 'country' });
    const keys = ed.sundayTypedChips.map(f => f.key);
    assert.ok(keys.includes('prayerNation') && keys.includes('kidsLessonTitle'));
    assert.ok(!keys.includes('announcements') && !keys.includes('announcementCount'), 'announcements are a list in the builder');
    assert.equal(ed.typedSundayDate(), '2026-10-11', 'this Sunday by default');
    ed.setTypedWhen({ mode: 'next' });
    await Promise.resolve();
    assert.equal(ed.typedSundayDate(), '2026-10-18');
    assert.equal(ed.data.typed.date, '2026-10-18', 'the form opens on that Sunday');
    ed.onChipDragStart(dragEvent(), 'global', 'sunday_typed', ed.sundayTypedChips.find(f => f.key === 'prayerNation'));
    assert.deepEqual(ed.dragField.params, { when: { mode: 'next' } });
    assert.ok(!ed.queryOffered.some(s => s.key === 'sunday_typed'), 'booklet text has one home');
    const row = ed.typedRowFor('2026-10-18', { typedContent: { pastoralPrayer: { nation: 'Peru' }, mosaicKids: { lessonTitle: 'Noah builds' } } });
    assert.equal(row.prayerNation, 'Peru');
    assert.equal(row.kidsLessonTitle, 'Noah builds');
    assert.deepEqual(ed.typedRowFor('2026-10-18', null), {}, 'nothing planned shows no values');
    ed.data.typed.row = row;
    assert.equal(ed.sundayTypedChips.find(f => f.key === 'prayerNation').value, 'Peru', 'a chip says what was typed');
});

test('re-dragging a wired chip carries the wire\'s own params, not the builder\'s', () => {
    const nodes = [text('t', { bind: { text: { scope: 'global', source: 'sunday', params: { when: { mode: 'last' } }, field: 'theme' } } })];
    const { ed } = editor({ nodes: nodes, select: 't' });
    ed.setQuerySource('sunday');
    ed.setQueryParam('when', { mode: 'next' });
    ed.onConnectedChipDragStart(dragEvent(), ed.connectedChips[0]);
    assert.deepEqual(ed.dragField.params, { when: { mode: 'last' } });
});
