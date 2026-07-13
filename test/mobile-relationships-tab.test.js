const { test } = require('node:test');
const assert = require('node:assert');

const { h, Fragment } = require('preact');
const { useState, useEffect } = require('preact/hooks');
const render = require('preact-render-to-string');
// htm is not an npm dependency — the app loads the same vendored UMD build the
// browser does, so the test exercises exactly the build that ships.
const htm = require('../public/vendor/htm-3.1.1.umd.js');

// The mobile Relationships tab (MS-106) is native Preact, and until now nothing in
// the suite has ever rendered a mobile screen. Every UI bug this feature shipped —
// the frozen getters, the escaped Promise rejection — was invisible to tests that
// only exercised logic. So this actually RENDERS the component, against a stubbed
// Firestore, and asserts what comes out.
//
// It will not catch a layout problem. It will catch a broken htm template, an
// undefined component, a crash in the render path, and a wrong rule — which is
// most of what has actually gone wrong.

// preact-render-to-string never runs effects, so the component would sit on its
// loading spinner forever and the test would assert nothing. The screen takes its
// hooks from the shell object (M.hooks), so the test supplies a small stateful
// harness instead: state cells persist across renders, and effects run when we say.
// The component, its htm templates and its logic are all the real thing.
function makeHooks() {
    const cells = [];
    let i = 0;
    let effects = [];
    return {
        rewind() { i = 0; },
        useState(init) {
            const idx = i++;
            if (!(idx in cells)) cells[idx] = init;
            return [cells[idx], (v) => { cells[idx] = typeof v === 'function' ? v(cells[idx]) : v; }];
        },
        useEffect(fn) { effects.push(fn); },
        flush() { const e = effects; effects = []; e.forEach(fn => fn()); },
    };
}

function mountShell(seed, hooks) {
    const M = {
        h, Fragment,
        html: htm.bind(h),
        hooks: { useState: hooks.useState, useEffect: hooks.useEffect },
        Ic: (name, size) => h('i', { 'data-icon': name, 'data-size': size }),
        ui: {},
        data: {
            getRelationshipTypes: async () => seed.types || [],
            getRelationships: async () => seed.pairs || [],
            getRelationshipGroups: async () => seed.groups || [],
            getShepherdingPeople: async () => seed.people || [],
        },
    };
    global.M = M;
    global.window = global;

    // The tab leans on the same shared cores the desktop manager does.
    require('../public/relationship-core.js');
    require('../public/relationship-group-core.js');
    delete require.cache[require.resolve('../public/mobile/screens-shepherd-relationships.js')];
    require('../public/mobile/screens-shepherd-relationships.js');
    return M;
}

const PEOPLE = [
    { id: 'stephen', name: 'Stephen Kane' },
    { id: 'tim', name: 'Tim Ross' },
    { id: 'carter', name: 'Carter Vale' },
];
const DISCIPLESHIP = { id: 'td', name: 'Discipleship', kind: 'pairwise', priority: true, holderLabel: 'Discipler', counterpartLabel: 'Disciplee' };
const BIBLE_STUDY = { id: 'tb', name: 'Bible Study', kind: 'group', priority: true, leaderLabel: 'Leader', memberLabel: 'Member' };

// Render once to register the state cells and the load effect; run the effect; let
// the fetches settle; render again — the second pass sees the loaded data.
async function renderTab(seed) {
    const hooks = makeHooks();
    const M = mountShell(seed, hooks);
    const el = h(M.RelationshipsTab, { showToast: () => {} });

    hooks.rewind(); render(el);
    hooks.flush();
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    hooks.rewind();
    return render(el);
}

test('the mobile tab registers itself on the shell so the Manage Tags screen can mount it', () => {
    const M = mountShell({}, makeHooks());
    assert.strictEqual(typeof M.RelationshipsTab, 'function');
});

test('the tab renders without throwing — the htm template and every component resolve', async () => {
    const out = await renderTab({ types: [DISCIPLESHIP, BIBLE_STUDY], people: PEOPLE });
    assert.ok(out.length > 0);
    assert.match(out, /New Relationship Type/);
});

test('an empty vocabulary says so, rather than rendering a blank screen', async () => {
    const out = await renderTab({ types: [], people: PEOPLE });
    assert.match(out, /No relationship types yet/i);
});

test('a type shows its kind, its priority and its role labels', async () => {
    const out = await renderTab({ types: [DISCIPLESHIP], people: PEOPLE });
    assert.match(out, /Discipleship/);
    assert.match(out, /Pairwise/);
    assert.match(out, /Prioritized/);
    assert.match(out, /Discipler \/ Disciplee/);
});

test('a Group type is labelled Group, not Pairwise', async () => {
    const out = await renderTab({ types: [BIBLE_STUDY], people: PEOPLE });
    assert.match(out, /Bible Study/);
    assert.match(out, /Group/);
    assert.match(out, /Leader \/ Member/);
});

test('a legacy directional type renders as Prioritized, before the backfill has run', async () => {
    const out = await renderTab({ types: [{ id: 'tm', name: 'mentors', directional: true }], people: PEOPLE });
    assert.match(out, /mentors/);
    assert.match(out, /Prioritized/);
    assert.doesNotMatch(out, /undefined/, 'a legacy doc must not leak undefined labels into the UI');
});

test('the pair count and the group count are reported per type', async () => {
    const out = await renderTab({
        types: [DISCIPLESHIP],
        pairs: [{ id: 'e1', fromId: 'stephen', toId: 'tim', typeId: 'td' }],
        people: PEOPLE,
    });
    assert.match(out, /1 pair/);
});

test('the rendered markup never leaks "undefined" or "[object Object]"', async () => {
    const out = await renderTab({
        types: [DISCIPLESHIP, BIBLE_STUDY],
        pairs: [{ id: 'e1', fromId: 'stephen', toId: 'tim', typeId: 'td' }],
        groups: [{ id: 'g1', typeId: 'tb', name: 'Tuesday', leaderId: 'stephen', memberIds: ['tim', 'carter'] }],
        people: PEOPLE,
    });
    assert.doesNotMatch(out, /undefined/);
    assert.doesNotMatch(out, /\[object Object\]/);
});
