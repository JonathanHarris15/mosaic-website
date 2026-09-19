const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// MS-540 / MS-570 — leftover Shepherd *web* decision chrome must ask
// AccessCore.canDecide so a Pastoral Assistant never gets a click → toast.

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

function between(src, from, to) {
    const a = src.indexOf(from);
    assert.ok(a !== -1, 'not found: ' + from);
    const b = src.indexOf(to, a + from.length);
    return src.slice(a, b === -1 ? a + 2000 : b);
}

test('the profile hides add-tag chips and Create tag unless canDecide', () => {
    const html = read('shepherding-profile.html');
    const add = between(html, '<!-- Add tags', '<!-- Create new tag');
    assert.match(add, /x-show="canDecide"/);
    assert.match(add, /toggleTag\(tag\.id\)/);
    const create = between(html, '<!-- Create new tag', '<!-- Relationships Panel');
    assert.match(create, /x-show="canDecide"/);
    assert.match(create, /createTag\(\)/);
});

test('the profile hides Assign an elder unless canDecide', () => {
    const html = read('shepherding-profile.html');
    const empty = between(html, '<!-- No assignment yet', '<!-- Picker');
    assert.match(empty, /Assign an elder/);
    assert.match(empty, /x-show="canDecide"/);
    assert.match(empty, /x-show="!canDecide"/);
});

test('the profile hides explanation edit unless canDecide', () => {
    const html = read('shepherding-profile.html');
    const buttons = html.match(/startEditExplanation\([^)]+\)/g) || [];
    assert.equal(buttons.length, 2, 'status + tag explanation editors');
    for (const call of buttons) {
        const at = html.indexOf(call);
        const window = html.slice(Math.max(0, at - 80), at);
        assert.match(window, /x-show="canDecide"/, call + ' is still clickable without canDecide');
    }
});

test('profile write methods refuse without canDecide before they toast', () => {
    const src = read('shepherding-profile.js');
    for (const name of ['async toggleTag', 'async createTag', 'async setAssignedElder', 'startEditExplanation', 'async saveExplanation']) {
        const start = src.indexOf(name);
        assert.ok(start !== -1, name + ' is gone');
        const open = src.indexOf('{', start);
        const head = src.slice(open, open + 80);
        assert.match(head, /if\s*\(\s*!this\.canDecide\s*\)\s*return/, name + ' can still run for a PA');
    }
});

test('the Care List trigger extension is handed canDecide', () => {
    const src = read('shepherding-care-list.js');
    const ext = between(src, '_makeTriggerExt(person)', '_mountCellEditor');
    assert.match(ext, /canDecide:\s*!!self\.canDecide/);
    assert.match(ext, /createInlineTriggersExtension\(/);
});

test('inline triggers stay silent when canDecide is false', () => {
    const src = read('shepherding-inline-triggers.js');
    const factory = between(src, 'function createInlineTriggersExtension', 'function onChipDeleted');
    assert.match(factory, /canDecide/);
    assert.match(factory, /config\.canDecide !== false/);
    const input = between(src, 'handleTextInput(v, from, to, text)', 'if (text === \'#\')');
    assert.match(input, /if\s*\(\s*!triggersEnabled\s*\)\s*return false/);
    const undo = between(src, 'function onChipDeleted(attrs)', 'if (attrs.chipKind === \'tag\')');
    assert.match(undo, /if\s*\(\s*!triggersEnabled\s*\)\s*return/);
});
