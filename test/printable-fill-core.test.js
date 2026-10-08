const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const Fill = require('../public/printable-fill-core.js');
const Typed = require('../public/sunday-typed-core.js');

function guide(nodes, inputs) {
    return { id: 'guide', name: 'Sunday Service Guide', inputs: inputs || [], pages: [{ nodes: nodes }] };
}

test('Sunday booklet text on the page is a blank, and live Sunday data is not', () => {
    const project = guide([
        { id: 'cap', tag: 'p', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'prayerCapital' } } },
        { id: 'who', tag: 'p', bind: { text: { scope: 'global', source: 'sunday', field: 'preacher' } } },
        { id: 'ann', tag: 'p', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'announcements' } } },
        { id: 'n', tag: 'p', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'announcementCount' } } },
    ]);
    const index = Fill.indexProject(project);
    const capital = Fill.slotFor(project.pages[0].nodes[0], index);
    assert.equal(capital.store, 'sunday');
    assert.equal(capital.field, 'prayerCapital');
    assert.equal(capital.label, 'Capital');
    assert.equal(Fill.slotFor(project.pages[0].nodes[1], index), null);
    assert.equal(Fill.slotFor(project.pages[0].nodes[2], index), null);
    assert.equal(Fill.slotFor(project.pages[0].nodes[3], index), null);
});

test('the same blank placed twice counts once, and an empty one is left to fill', () => {
    const project = guide([
        { id: 'a', tag: 'p', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'prayerCapital' } } },
        { id: 'b', tag: 'p', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'prayerCapital' } } },
        { id: 'c', tag: 'p', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'prayerNation' } } },
    ]);
    const slots = Fill.slotsOn(project, [project.pages[0].nodes]);
    assert.equal(slots.length, 3);
    const draft = { prayerCapital: 'Lima', prayerNation: '' };
    const tally = Fill.tally(slots, slot => Fill.sundayValue(draft, slot));
    assert.equal(tally.total, 2);
    assert.equal(tally.left, 1);
});

test('a field filled on the event is a blank, including one cell of a list', () => {
    const project = guide([
        { id: 't', tag: 'p', bind: { text: { scope: 'global', source: 'event_field', field: 'title' } } },
        {
            id: 'box', tag: 'div', repeat: { source: 'event_list', params: { inputId: 'players' } },
            children: [
                { id: 'name', tag: 'p', bind: { text: { scope: 'item', field: 'name' } } },
            ],
        },
    ], [
        { id: 'title', label: 'Text 1', kind: 'text' },
        { id: 'players', label: 'Players', kind: 'list', fields: [{ id: 'name', label: 'Name', kind: 'text' }] },
    ]);
    const expanded = [
        { id: 't', tag: 'p', bind: project.pages[0].nodes[0].bind },
        {
            id: 'box~list', tag: 'div', attrs: { 'data-list-of': 'box' },
            children: [
                { id: 'name', tag: 'p', bind: { text: { scope: 'item', field: 'name' } } },
                { id: 'name~1', tag: 'p', bind: { text: { scope: 'item', field: 'name' } } },
            ],
        },
    ];
    const slots = Fill.slotsOn(project, [expanded]);
    const tally = Fill.tally(slots, slot => Fill.eventValue({
        title: '',
        players: [{ name: 'Ada' }, { name: '' }],
    }, slot));
    assert.equal(tally.total, 3);
    assert.equal(tally.left, 2);
    const empty = Fill.slotsOn(project, [[{
        id: 'box~list', tag: 'div', attrs: { 'data-list-of': 'box' }, children: [],
    }]]);
    assert.equal(empty[0].store, 'empty-list');
    assert.equal(Fill.tally(empty, () => '').left, 1);
});

test('a kids question row is a blank and an announcement list is not', () => {
    const project = guide([
        {
            id: 'qs', tag: 'div', repeat: { source: 'sunday_kids_questions', params: { when: { mode: 'this' } } },
            children: [
                { id: 'q', tag: 'p', bind: { text: { scope: 'item', field: 'text' } } },
            ],
        },
        {
            id: 'news', tag: 'div', repeat: { source: 'sunday_announcements', params: {} },
            children: [
                { id: 'line', tag: 'p', bind: { text: { scope: 'item', field: 'text' } } },
            ],
        },
    ]);
    const expanded = [
        {
            id: 'qs~list', tag: 'div', attrs: { 'data-list-of': 'qs' },
            children: [{ id: 'q', tag: 'p', bind: { text: { scope: 'item', field: 'text' } } }],
        },
        {
            id: 'news~list', tag: 'div', attrs: { 'data-list-of': 'news' },
            children: [{ id: 'line', tag: 'p', bind: { text: { scope: 'item', field: 'text' } } }],
        },
    ];
    const slots = Fill.slotsOn(project, [expanded]);
    assert.equal(slots.length, 1);
    assert.equal(slots[0].store, 'kids');
    assert.equal(Fill.listSpec(project, 'qs').label, 'Add a question');
    assert.equal(Fill.listSpec(project, 'news'), null);
});

test('writing one Sunday blank keeps the rest of the Sunday', () => {
    const content = Typed.fromDraft({
        prayerNation: 'Peru',
        prayerCapital: '',
        kidsLessonTitle: 'Jonah',
        announcements: [{ title: 'Picnic', content: 'After church' }],
    });
    const draft = Typed.toDraft(content);
    const next = Fill.setSundayField(draft, 'prayerCapital', 'Lima');
    const saved = Typed.fromDraft(next);
    assert.equal(saved.pastoralPrayer.capital, 'Lima');
    assert.equal(saved.pastoralPrayer.nation, 'Peru');
    assert.equal(saved.mosaicKids.lessonTitle, 'Jonah');
    assert.equal(saved.announcements[0].title, 'Picnic');
});

test('what is left to go stays in page order, and a step walks that list', () => {
    const slots = [
        { id: 'a', store: 'event' },
        { id: 'a', store: 'event' },
        { id: 'b', store: 'event' },
        { id: 'c', store: 'empty-list' },
        { id: 'd', store: 'sunday' },
    ];
    const values = { a: 'Yes', b: '  ', d: '' };
    const left = Fill.remaining(slots, slot => values[slot.id]);
    assert.deepEqual(left.map(s => s.id), ['b', 'c', 'd']);
    assert.equal(Fill.leftToGoText(16), '16 left to go');
    assert.equal(Fill.leftToGoText(1), '1 left to go');
    const ids = left.map(s => s.id);
    assert.equal(Fill.stepBlank(ids, '', 1), 'b');
    assert.equal(Fill.stepBlank(ids, '', -1), 'd');
    assert.equal(Fill.stepBlank(ids, 'b', 1), 'c');
    assert.equal(Fill.stepBlank(ids, 'b', -1), 'd');
    assert.equal(Fill.stepBlank(ids, 'd', 1), 'b');
    // b was filled; c slid into its place. Forward lands on c, back on the new last.
    assert.equal(Fill.stepBlank(['c', 'd'], 'b', 1, 0), 'c');
    assert.equal(Fill.stepBlank(['c', 'd'], 'b', -1, 0), 'd');
    // The last blank was filled. Forward wraps to the first.
    assert.equal(Fill.stepBlank(['b', 'c'], 'd', 1, 2), 'b');
    assert.equal(Fill.stepBlank(['b', 'c'], 'd', -1, 2), 'c');
    assert.equal(Fill.stepBlank([], 'b', 1, 0), '');
});

test('the preview is where an editor fills blanks, and the link place does not list them', () => {
    const viewJs = fs.readFileSync(path.join(__dirname, '../public/printable-view.js'), 'utf8');
    const viewHtml = fs.readFileSync(path.join(__dirname, '../public/printable-view.html'), 'utf8');
    const eventHtml = fs.readFileSync(path.join(__dirname, '../public/calendar-event.html'), 'utf8');
    const sundayHtml = fs.readFileSync(path.join(__dirname, '../public/service-builder.html'), 'utf8');
    assert.match(viewJs, /canFill/);
    assert.match(viewJs, /get canFill\(\) \{ return this\.canEdit; \}/);
    assert.match(viewHtml, /fillLeftText/);
    assert.match(viewHtml, /role="status"/);
    assert.match(viewHtml, /m-header--sticky/);
    assert.match(viewHtml, /class="pv-zoom"/);
    assert.match(viewHtml, /class="pv-go"/);
    assert.match(viewHtml, /Zoom in/);
    assert.match(viewHtml, /Zoom out/);
    assert.match(viewHtml, /Previous blank/);
    assert.match(viewHtml, /Next blank/);
    assert.match(viewJs, /leftToGoText/);
    assert.match(viewJs, /goBlank/);
    assert.match(viewJs, /ctrlKey \|\| e\.metaKey/);
    assert.equal(viewHtml.includes('pv-left'), false);
    const printFn = viewJs.slice(viewJs.indexOf('printPrintable()'), viewJs.indexOf('printFolio()'));
    const folioFn = viewJs.slice(viewJs.indexOf('printFolio()'));
    assert.equal(printFn.includes('fillFor'), false);
    assert.equal(folioFn.includes('fillFor'), false);
    [eventHtml, sundayHtml].forEach(html => {
        assert.equal(html.includes('For the linked printable'), false);
        assert.equal(html.includes('Save for this date'), false);
    });
});
