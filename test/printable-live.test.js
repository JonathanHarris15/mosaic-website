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
