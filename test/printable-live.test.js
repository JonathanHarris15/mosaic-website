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

test('warnings name the element and the page it is on', () => {
    const p = project();
    const res = Live.resolver(p, { people: [{ id: 'a', name: 'Anna', tags: ['Member'] }], services: {} }, { today: '2026-09-03', level: 'editor' });
    const pages = Live.layoutPages(p, res, null);
    const w = Live.warningsFor(pages, res, p);
    const elementWarning = w.find(x => x.kind === 'element' && x.nodeId === 'ttl');
    assert.ok(elementWarning, 'the title could not resolve and should be listed');
    assert.equal(elementWarning.pageId, 'pg1');
});
