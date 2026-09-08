const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The MCP Manager's guidance box, and the one thing about it that cannot be
// seen by reading the page.
//
// ⚠ A PAGE RULE DOES NOT AUTOMATICALLY BEAT A COMPONENT RULE. The shared
// component sets `textarea.m-input { min-height: 96px }` — an element AND a
// class. A page style written as a single class loses to that however far
// down the file it sits, because specificity is settled before source order
// is ever consulted. That is exactly what happened here: the guidance box was
// given `min-height: 300px`, then a taller class on top of it, and it stayed
// nine lines tall through both. Nothing errored, nothing looked wrong in the
// stylesheet, and the only symptom was a box that would not open.
//
// So this does not check that the selector is SPELLED a particular way. It
// works out what both selectors are actually worth and insists the page wins.

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'mcp-manager.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public', 'mosaic.css'), 'utf8');

/**
 * CSS specificity as [ids, classes, elements]. Enough of the algorithm for
 * the simple compound selectors these two files use.
 */
function specificity(selector) {
    const s = selector.trim();
    const ids = (s.match(/#[\w-]+/g) || []).length;
    const classes = (s.match(/\.[\w-]+/g) || []).length +
        (s.match(/\[[^\]]+\]/g) || []).length +
        (s.match(/(^|[^:]):[\w-]+/g) || []).length;
    const elements = (s.match(/(^|[\s>+~])[a-z][\w-]*/g) || []).length;
    return [ids, classes, elements];
}

const beats = (a, b) => {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
};

/** Every selector in the page's own <style> that sets a min-height. */
function pageRulesSetting(prop, needle) {
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const rules = [];
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(style))) {
        const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (!selector.includes(needle)) continue;
        const value = new RegExp(prop + '\s*:\s*([^;]+)').exec(m[2]);
        if (value) rules.push({ selector, value: value[1].trim() });
    }
    return rules;
}

test('the guidance box is taller than the component would make it', () => {
    const component = 'textarea.m-input';
    const componentSpec = specificity(component);
    assert.ok(/textarea\.m-input\{[^}]*min-height/.test(css),
        'the component no longer sets a min-height on textareas — if that ' +
        'moved, this guard has to follow it there');

    const rules = pageRulesSetting('min-height', 'mcp-body-input');
    assert.ok(rules.length >= 2,
        'expected a resting height and an opened-out one, found: ' +
        rules.map(r => r.selector).join(' | '));

    rules.forEach(r => {
        assert.ok(beats(specificity(r.selector), componentSpec),
            `"${r.selector}" (${specificity(r.selector)}) does not beat ` +
            `"${component}" (${componentSpec}), so its min-height never ` +
            'applies and the box stays 96px whatever this file says');
    });
});

test('opening it out actually makes it bigger', () => {
    // A rule that wins and changes nothing is the same bug wearing a hat.
    const rules = pageRulesSetting('min-height', 'mcp-body-input');
    const resting = rules.find(r => !r.selector.includes('--tall'));
    const opened = rules.find(r => r.selector.includes('--tall'));

    assert.ok(resting && opened, 'one of the two heights is gone');
    assert.match(resting.value, /^\d+px$/);
    assert.match(opened.value, /min\(/,
        'the opened height should be capped against the viewport AND in px, ' +
        'so a tall monitor does not open a field longer than the screen');

    const restingPx = parseInt(resting.value, 10);
    const cap = parseInt(/,\s*(\d+)px/.exec(opened.value)[1], 10);
    assert.ok(cap > restingPx * 2,
        `opening it out only goes from ${restingPx}px to ${cap}px — that is ` +
        'not the "much taller" this is for');
});

test('it opens on writing in it, and is not tied to focus', () => {
    // Blur fires on mousedown, before a click completes. A box that shrank on
    // losing focus would pull the action bar out from under the pointer
    // between pressing Save and releasing it.
    assert.match(html, /@focus="bodyOpen = true"/,
        'nothing opens the box any more');
    assert.ok(!/\.mcp-body-input[^{,]*:focus/.test(html),
        'the height is back on :focus, which makes Save intermittently ' +
        'unclickable — see the note in the page');

    const js = fs.readFileSync(path.join(ROOT, 'public', 'mcp-manager.js'), 'utf8');
    assert.ok(js.includes('bodyOpen: false'), 'bodyOpen is not part of the state');
    // Picking a different file closes it again: a new piece of writing gets
    // read before it gets edited.
    assert.ok((js.match(/this\.bodyOpen = false/g) || []).length >= 2,
        'the box is never closed again, so it stays open across files');
});

// ── The tool list, once there were seventy-three of them (MS-278) ───────────
//
// The page's whole claim is that it tells an editor the truth about what their
// assistant can do. Two things stopped being true when the shepherding and
// calendar groups landed: the list became a wall, and it started showing an
// editor sixty-one tools that will refuse them by rank on the first call.

const {mcpManager} = require('../public/mcp-manager.js');

/** A manifest of the shape describeCapabilities now returns. */
function manifest() {
    return {tools: [
        {name: 'oos_update_liturgy', writes: true, group: 'oos', eldersOnly: false, description: 'a'},
        {name: 'oos_get_service', writes: false, group: 'oos', eldersOnly: false, description: 'b'},
        {name: 'shep_write_note', writes: true, group: 'shep', eldersOnly: true, description: 'c'},
        {name: 'shep_find_person', writes: false, group: 'shep', eldersOnly: true, description: 'd'},
        {name: 'cal_create_event', writes: true, group: 'cal', eldersOnly: true, description: 'e'},
    ]};
}

function page(level) {
    const m = mcpManager();
    m.capabilities = manifest();
    m.permissionLevel = level || 'editor';
    return m;
}

test('the tools are grouped by what part of the app they touch', () => {
    // As an elder: an editor is shown only the group they can use, which is
    // its own test below.
    const groups = page('elder').toolGroups;
    assert.deepStrictEqual(groups.map(g => g.key), ['oos', 'shep', 'cal']);
    assert.deepStrictEqual(groups.map(g => g.tools.length), [2, 2, 1]);
});

test('a group added later is listed, not lost', () => {
    // The groups are derived from the tool name, so the page must not depend
    // on somebody remembering to add one to a list in the browser.
    const m = page('elder');
    m.capabilities.tools.push({
        name: 'roles_do_something', writes: true, group: 'roles', eldersOnly: true,
    });
    const keys = m.toolGroups.map(g => g.key);
    assert.ok(keys.includes('roles'), keys.join(', '));
    assert.strictEqual(keys[keys.length - 1], 'roles', 'and after the known ones');
});

test('writes come first inside a group — the half worth reading', () => {
    const shep = page('elder').toolGroups.find(g => g.key === 'shep');
    assert.strictEqual(shep.tools[0].name, 'shep_write_note');
    assert.strictEqual(shep.writes, 1);
    assert.strictEqual(shep.reads, 1);
});

test('a group is elder-only when everything in it is', () => {
    const groups = page('elder').toolGroups;
    assert.strictEqual(groups.find(g => g.key === 'oos').eldersOnly, false);
    assert.strictEqual(groups.find(g => g.key === 'shep').eldersOnly, true);
    assert.strictEqual(groups.find(g => g.key === 'cal').eldersOnly, true);
});

test('an editor is not shown the tools they cannot use', () => {
    // ⚠ THE EARLIER BUILD LISTED THEM WITH A WARNING, AND THAT WAS WRONG.
    // What an editor reads on this page is what their assistant can do FOR
    // THEM; a group they will be refused is noise dressed as information.
    //
    // This is the PAGE, not the protocol. The server still offers every tool
    // to every caller and refuses by rank on the call — a tool an assistant
    // cannot see answers "unknown tool", which reads as a broken server.
    assert.deepStrictEqual(page('editor').toolGroups.map(g => g.key), ['oos']);
    assert.deepStrictEqual(
        page('elder').toolGroups.map(g => g.key), ['oos', 'shep', 'cal']);

    assert.strictEqual(page('editor').isElder, false);
    assert.strictEqual(page('super_admin').isElder, true);
    assert.strictEqual(page('admin').isElder, false, 'admin is not a pastoral tier');
});

test('a partly locked group shows an editor only its open half', () => {
    const m = page('editor');
    m.capabilities.tools.push({
        name: 'oos_secret', writes: false, group: 'oos', eldersOnly: true,
    });
    const oos = m.toolGroups.find(g => g.key === 'oos');
    assert.ok(!oos.tools.some(t => t.name === 'oos_secret'), 'the locked one is out');
    assert.strictEqual(oos.tools.length, 2);
});

test('a tool name drops whichever prefix it has, not just the first one written', () => {
    const m = page('elder');
    assert.strictEqual(m.prettyToolName('oos_update_liturgy'), 'Update liturgy');
    assert.strictEqual(m.prettyToolName('shep_add_person_panel'), 'Add person panel');
    assert.strictEqual(m.prettyToolName('cal_list_events'), 'List events');
});

test('the page renders the groups rather than two flat columns', () => {
    assert.match(html, /x-for="g in toolGroups"/);
    // The old copy claimed every write changed a Sunday. Most of them now
    // change a person.
    assert.ok(!/Can change a Sunday/.test(html));
    // The warning copy went with the design that needed it.
    assert.ok(!/will be\s*\n?\s*refused/.test(html));
    assert.ok(!/mcp-cols/.test(html), 'the two-column layout and its CSS are gone');
});

test('the manifest carries what the page groups on', () => {
    // Derived from the tool name in describeCapabilities, so a new group needs
    // no second list anywhere.
    const server = fs.readFileSync(
        path.join(ROOT, 'functions', 'mcp-server.js'), 'utf8');
    assert.match(server, /group: String\(t\.name\)\.split\("_"\)\[0\]/);
    assert.match(server, /eldersOnly: String\(t\.name\)\.split\("_"\)\[0\] !== "oos"/);
});

// ── Locking a guidance file to elders (MS-278) ─────────────────────────────
//
// Guidance is instructions an assistant FOLLOWS, so an elder-only file can name
// people and say how to handle them. The lock therefore has to be real in three
// places, and a lock in only two of them is not a lock.

test('the lock is a written field, not an absent one', () => {
    // ⚠ An absent field matches no equality, and a non-elder's browser has to
    // query `where('eldersOnly', '==', false)` to satisfy the rules. A file
    // saved without the field would vanish for every editor.
    const Core = require('../public/mcp-guidance-core.js');
    const plain = Core.normalize({title: 't', slug: 's', summary: 'x', body: 'b'});
    assert.strictEqual(plain.eldersOnly, false);
    assert.ok('eldersOnly' in plain, 'it must be written even when false');

    const locked = Core.normalize({title: 't', slug: 's', eldersOnly: true});
    assert.strictEqual(locked.eldersOnly, true);
});

test('the two flags default opposite ways and are read through one place', () => {
    const Core = require('../public/mcp-guidance-core.js');
    assert.strictEqual(Core.readFlag('enabled', {}), true, 'on unless said otherwise');
    assert.strictEqual(Core.readFlag('eldersOnly', {}), false, 'open unless locked');
});

test('changing the lock is kept in the file history', () => {
    // It is a fact about the file, and the history exists so a bad change can
    // be spotted and rewound.
    const Core = require('../public/mcp-guidance-core.js');
    assert.ok(Core.VERSIONED_FIELDS.includes('eldersOnly'));
    assert.strictEqual(
        Core.sameContent({eldersOnly: false}, {eldersOnly: true}), false);
});

test('a non-elder constrains its own query, or the rules error it', () => {
    const js = fs.readFileSync(path.join(ROOT, 'public', 'mcp-manager.js'), 'utf8');
    assert.match(js, /where\('eldersOnly', '==', false\)/);
    assert.match(js, /this\.isElder[\s\S]{0,80}all\.get\(\)/);
});

test('only an elder is offered the lock', () => {
    // A lock an editor could lift is not a lock, and an editor never sees a
    // locked file anyway.
    assert.match(html, /<div class="mcp-switchrow" x-show="isElder">/);
    assert.match(html, /x-model="draft\.eldersOnly"/);
    assert.match(html, /Elders only/);
});

test('the rules close a locked file rather than merely hiding it', () => {
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    assert.match(rules, /function guidanceLocked/);
    assert.match(rules, /allow read: if isElder\(\) \|\| \(isEditor\(\) && !guidanceLocked/);
    // An editor must not be able to lift one either.
    assert.match(rules, /allow update: if isElder\(\)[\s\S]{0,200}request\.resource\.data/);
});
