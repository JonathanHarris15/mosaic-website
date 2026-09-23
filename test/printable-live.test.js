const { test } = require('node:test');
const assert = require('node:assert');

// MS-396 / MS-397 — a project joined to its data.
//
// What is pinned: a project's needs are the union of what its bindings and
// lists ask for; a resolver answers item and global bindings and remembers
// each source; and without a browser to measure with, a list stays on its
// own page rather than guessing.

const Live = require('../public/printable-live.js');
const Core = require('../public/printable-core.js');

function project() {
    return Core.buildPrintable({
        name: 'Directory',
        template: { paper: 'letter', orientation: 'landscape', dpi: 96 },
        pages: [{ id: 'pg1', nodes: [
            { id: 'ttl', tag: 'h1', text: 'Directory', bind: { text: { scope: 'global', source: 'sunday', params: { when: { mode: 'next' } }, field: 'theme' } } },
            { id: 'card', tag: 'div', repeat: { source: 'people', params: { membership: 'members' }, overflow: 'new-page' }, children: [
                { id: 'nm', tag: 'p', text: 'Jane', bind: { text: { scope: 'item', field: 'name' } } },
            ] },
        ] }],
    });
}

test('a project\'s needs are the union of what its bindings and lists ask for', () => {
    const needs = Live.collectNeeds(project(), '2026-09-03');
    assert.equal(needs.people, true);
    assert.deepEqual(needs.services, ['2026-09-13']);
});

test('the resolver answers rows for a list and values for both kinds of binding', () => {
    const bundle = {
        people: [{ id: 'a', name: 'Anna Baker', tags: ['Member'] }, { id: 'b', name: 'Ben', tags: [] }],
        services: { '2026-09-13': { theme: 'Hope' } },
    };
    const res = Live.resolver(project(), bundle, { today: '2026-09-03', level: 'editor' });
    const card = Core.findNode(project().pages[0], 'card');
    assert.deepEqual(res.rowsFor(card).map(r => r.name), ['Anna Baker']);
    assert.deepEqual(res.valueFor({ scope: 'item', field: 'name' }, { name: 'Anna Baker' }), { ok: true, value: 'Anna Baker' });
    assert.deepEqual(res.valueFor({ scope: 'global', source: 'sunday', params: { when: { mode: 'next' } }, field: 'theme' }, null), { ok: true, value: 'Hope' });
    const miss = res.valueFor({ scope: 'global', source: 'sunday', params: { when: { mode: 'next' } }, field: 'preacher' }, null);
    assert.equal(miss.ok, false);
    assert.match(miss.why, /preacher/);
    assert.equal(res.sourceWarnings().length, 0);
});

test('an empty field on a dated row is named by its date in words', () => {
    const res = Live.resolver(project(), { people: [], services: {} }, { today: '2026-09-03', level: 'editor' });
    const miss = res.valueFor({ scope: 'item', field: 'theme' }, { _id: '2026-09-20', date: 'Sunday 20 September 2026', theme: '' });
    assert.equal(miss.ok, false);
    assert.match(miss.why, /Sunday 20 September 2026/);
    assert.doesNotMatch(miss.why, /2026-09-20/);
});

test('an empty field on an event date names the event and the date, so a rota says which week', () => {
    const res = Live.resolver(project(), { people: [], services: {} }, { today: '2026-09-03', level: 'editor' });
    const miss = res.valueFor({ scope: 'item', field: 'holder' }, { _id: 'mm_2026-10-22', name: 'Members\' meeting', date: 'Thursday 22 October 2026', holder: '' });
    assert.equal(miss.ok, false);
    assert.match(miss.why, /Members' meeting on Thursday 22 October 2026\.$/);
    const person = res.valueFor({ scope: 'item', field: 'email' }, { _id: 'a', name: 'Anna Baker', email: '' });
    assert.match(person.why, /for Anna Baker\.$/, 'a row with no date is named as before');
});

test('a preaching schedule is a Repeat over Sundays: five rows, TBA where nobody is down', () => {
    const p = Core.buildPrintable({
        name: 'Preaching schedule',
        template: { paper: 'letter', orientation: 'portrait', dpi: 96 },
        pages: [{ id: 'pg1', nodes: [
            { id: 'row', tag: 'div', repeat: { source: 'sundays', params: {} }, children: [
                { id: 'when', tag: 'span', text: 'Jul 27', bind: { text: { scope: 'item', field: 'shortDate' } } },
                { id: 'who', tag: 'span', text: 'Preacher', bind: { text: { scope: 'item', field: 'preacher' } } },
                { id: 'what', tag: 'span', text: 'Text', bind: { text: { scope: 'item', field: 'sermon' } } },
            ] },
        ] }],
    });
    const bundle = { services: { '2026-09-06': { preacher: 'Pastor Sam', liturgy: { sermon: 'Romans 8' } } } };
    assert.deepEqual(Live.collectNeeds(p, '2026-09-03').serviceRange, { from: '2026-09-06', to: '2026-10-10' });
    const res = Live.resolver(p, bundle, { today: '2026-09-03', level: 'member' });
    const pages = Live.layoutPages(p, res, null);
    const rows = pages[0].nodes[0].children.map(c => c.children.map(x => x.text));
    assert.deepEqual(rows, [
        ['Sep 6', 'Pastor Sam', 'Romans 8'],
        ['Sep 13', 'TBA', 'TBA'],
        ['Sep 20', 'TBA', 'TBA'],
        ['Sep 27', 'TBA', 'TBA'],
        ['Oct 4', 'TBA', 'TBA'],
    ]);
    assert.deepEqual(Live.warningsFor(pages, res, p), [], 'nothing to chase: an unplanned Sunday is not missing data');
    assert.equal(JSON.stringify(p).includes('Pastor Sam'), false, 'the Printable holds the wires, never the values');
});

test('a source that has nothing warns once at source level', () => {
    const res = Live.resolver(project(), { people: [], services: {} }, { today: '2026-09-03', level: 'editor' });
    const w = res.sourceWarnings();
    assert.ok(w.some(x => /Nothing is planned yet/.test(x.message)));
    assert.ok(w.some(x => /No people match/.test(x.message)));
});

test('without a browser to measure with, every list stays on its own page', () => {
    const bundle = { people: Array.from({ length: 50 }, (_, i) => ({ id: 'p' + i, name: 'Person ' + i, tags: ['Member'] })), services: {} };
    const res = Live.resolver(project(), bundle, { today: '2026-09-03', level: 'editor' });
    const pages = Live.layoutPages(project(), res, null);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].nodes[1].children.length, 50);
});

test('with no resolver the stand-ins are drawn, once per list', () => {
    const pages = Live.layoutPages(project(), null, null);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].nodes[1].children.length, 1);
    assert.equal(pages[0].nodes[1].children[0].children[0].text, 'Jane');
});

function peopleBundle(n) {
    return {
        people: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Person ' + i, tags: ['Member'] })),
        services: {},
    };
}

test('overflow continuation pages keep their own design and take the next rows of the same list', () => {
    const t = Core.buildTemplate({ paper: 'letter', dpi: 96 });
    const origin = Core.buildPage(t, { id: 'pg1', name: 'Directory', nodes: [
        { id: 'ttl', tag: 'h1', text: 'Directory' },
        { id: 'card', tag: 'div', repeat: { source: 'people', params: { membership: 'members' }, overflow: 'new-page' }, children: [
            { id: 'nm', tag: 'p', text: 'Jane', bind: { text: { scope: 'item', field: 'name' } } },
        ] },
        { id: 'num', tag: 'p', text: '1' },
    ] });
    const next = Core.buildPage(t, {
        id: 'pg2',
        name: 'Directory 2',
        continues: { from: 'pg1', repeat: 'card' },
        nodes: [
            { id: 'ttl2', tag: 'h1', text: 'More members' },
            { id: 'card2', tag: 'div', repeat: { source: 'people', params: { membership: 'members' }, overflow: 'new-page' }, children: [
                { id: 'nm2', tag: 'p', text: 'Jane', bind: { text: { scope: 'item', field: 'name' } } },
            ] },
            { id: 'num2', tag: 'p', text: '2' },
        ],
    });
    const p = Core.buildPrintable({ name: 'Directory', template: t, pages: [origin, next] });
    const res = Live.resolver(p, peopleBundle(5), { today: '2026-09-03', level: 'editor' });
    const pages = Live.layoutPages(p, res, true, {
        fitsOn: (pageIndex, start, n) => n <= 2,
    });
    assert.equal(pages.length, 3);
    assert.equal(pages[0].page.id, 'pg1');
    assert.equal(pages[0].generated, false);
    assert.equal(pages[0].nodes.find(n => n.tag === 'h1').text, 'Directory');
    assert.equal(pages[0].nodes.find(n => n.tag === 'p').text, '1');
    assert.deepEqual(pages[0].nodes[1].children.map(c => c.children[0].text), ['Person 0', 'Person 1']);

    assert.equal(pages[1].page.id, 'pg2');
    assert.equal(pages[1].generated, false);
    assert.equal(pages[1].page.name, 'Directory 2');
    assert.equal(pages[1].nodes.find(n => n.tag === 'h1').text, 'More members');
    assert.equal(pages[1].nodes.find(n => n.tag === 'p').text, '2');
    assert.deepEqual(pages[1].nodes[1].children.map(c => c.children[0].text), ['Person 2', 'Person 3']);
    assert.equal(pages[1].nodes[1].children[0].id, 'card2~2', 'the first card on a continuation is not the seed');
    assert.equal(pages[1].nodes[1].children[0].children[0].id, 'nm2~2');
    assert.equal(pages[0].nodes[1].children[0].id, 'card', 'the first page still keeps the seed');

    assert.equal(pages[2].needsPersist, true, 'a further page is a real page waiting to be kept');
    assert.ok(pages[2].page.id && pages[2].page.id !== 'pg1' && pages[2].page.id !== 'pg2');
    assert.deepEqual(pages[2].page.continues, { from: 'pg1', repeat: 'card' });
    assert.deepEqual(pages[2].nodes[1].children.map(c => c.children[0].text), ['Person 4']);
    assert.notEqual(pages[2].page.nodes[0].id, origin.nodes[0].id);
});

test('a leftover continuation page stays in the document when the list shrinks', () => {
    const t = Core.buildTemplate({ paper: 'letter', dpi: 96 });
    const origin = Core.buildPage(t, { id: 'pg1', nodes: [
        { id: 'card', tag: 'div', repeat: { source: 'people', params: { membership: 'members' }, overflow: 'new-page' }, children: [
            { id: 'nm', tag: 'p', text: 'Jane', bind: { text: { scope: 'item', field: 'name' } } },
        ] },
    ] });
    const extra = Core.buildPage(t, {
        id: 'pg2',
        continues: { from: 'pg1', repeat: 'card' },
        nodes: [
            { id: 'note', tag: 'p', text: 'Page two footer' },
            { id: 'card2', tag: 'div', repeat: { source: 'people', params: { membership: 'members' }, overflow: 'new-page' }, children: [
                { id: 'nm2', tag: 'p', text: 'Jane', bind: { text: { scope: 'item', field: 'name' } } },
            ] },
        ],
    });
    const p = Core.buildPrintable({ name: 'Directory', template: t, pages: [origin, extra] });
    const res = Live.resolver(p, peopleBundle(1), { today: '2026-09-03', level: 'editor' });
    const pages = Live.layoutPages(p, res, true, { fitsOn: () => true });
    assert.equal(pages.length, 2);
    assert.equal(pages[0].nodes[0].children.length, 1);
    assert.equal(pages[1].page.id, 'pg2');
    assert.equal(pages[1].nodes.find(n => n.id === 'note' || (n.tag === 'p' && n.text === 'Page two footer')).text, 'Page two footer');
    assert.equal(pages[1].nodes[1].children.length, 0);
});

test('warnings name the element and the page it is on', () => {
    const p = project();
    const res = Live.resolver(p, { people: [{ id: 'a', name: 'Anna', tags: ['Member'] }], services: {} }, { today: '2026-09-03', level: 'editor' });
    const pages = Live.layoutPages(p, res, null);
    const w = Live.warningsFor(pages, res, p);
    const elementWarning = w.find(x => x.kind === 'element' && x.nodeId === 'ttl');
    assert.ok(elementWarning, 'the title could not resolve and should be listed');
    assert.equal(elementWarning.pageId, 'pg1');
});

test('a nested children list is of the household card it sits in', () => {
    const p = Core.buildPrintable({
        name: 'Homes',
        template: { paper: 'letter', orientation: 'portrait', dpi: 96 },
        pages: [{ id: 'pg1', nodes: [
            { id: 'home', tag: 'div', repeat: { source: 'households', params: { membership: 'everyone', hasChildren: 'yes' } }, children: [
                { id: 'hn', tag: 'p', bind: { text: { scope: 'item', field: 'name' } } },
                { id: 'kid', tag: 'div', repeat: { source: 'household_children', params: {} }, children: [
                    { id: 'kn', tag: 'p', bind: { text: { scope: 'item', field: 'name' } } },
                ] },
            ] },
        ] }],
    });
    const bundle = {
        people: [
            { id: 'a', name: 'Anna Baker', tags: ['Member'] },
            { id: 'd', name: 'Dan Baker', tags: ['Member'] },
            { id: 'e', name: 'Eve Baker', tags: ['Member'] },
            { id: 'b', name: 'Ben Carter', tags: ['Visitor'] },
        ],
        families: [{ id: 'fam1', husbandId: 'd', wifeId: 'a', childIds: ['e'] }],
    };
    const res = Live.resolver(p, bundle, { today: '2026-09-03', level: 'member' });
    const home = Core.findNode(p.pages[0], 'home');
    const kid = Core.findNode(p.pages[0], 'kid');
    assert.deepEqual(res.rowsFor(home).map(r => r.name), ['The Baker household']);
    const baker = res.rowsFor(home)[0];
    assert.deepEqual(res.rowsFor(kid, baker).map(r => r.name), ['Eve Baker']);
    assert.deepEqual(res.rowsFor(kid).map(r => r.name), ['Eve Baker'], 'without a parent the related list flattens');
    const pages = Live.layoutPages(p, res, null);
    const homes = pages[0].nodes[0].children;
    assert.equal(homes.length, 1);
    assert.equal(homes[0].children[0].text, 'The Baker household');
    assert.equal(homes[0].children[1].children[0].children[0].text, 'Eve Baker');
});
