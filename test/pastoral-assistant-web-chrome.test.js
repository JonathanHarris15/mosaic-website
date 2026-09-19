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

// ── MS-571 — tags / dashboard / relations / service-builder ────────────────

test('the tags page hides create / rename / merge / delete / hide unless canDecide', () => {
    const html = read('shepherding-tags.html');
    const create = between(html, '<!-- Create new tag', '<!-- Tag list');
    assert.match(create, /x-show="canDecide"/);
    assert.match(html, /x-show="canDecide && !tag\.locked"/);
    assert.match(html, /x-show="canDecide && mergingTagId === tag\.id"/);
    const src = read('shepherding-tags.js');
    for (const name of ['async addTag', 'startRenameTag', 'async renameTag', 'startMergeTag', 'async mergeTagInto', 'async deleteTag', 'async toggleTagFlag']) {
        const start = src.indexOf(name);
        assert.ok(start !== -1, name + ' is gone');
        const open = src.indexOf('{', start);
        const head = src.slice(open, open + 120);
        assert.match(head, /if\s*\(\s*!this\.canDecide\s*\)/, name + ' can still run for a PA');
    }
});

test('the dashboard hides Filtered View delete unless canDecide', () => {
    const html = read('shepherding-dashboard.html');
    const header = between(html, '<!-- View Header', '<!-- People Table');
    assert.match(header, /deleteView\(view\.id\)/);
    assert.match(header, /x-show="canDecide"/);
    const src = read('shepherding-dashboard.js');
    const del = src.slice(src.indexOf('async deleteView'), src.indexOf('async deleteView') + 120);
    assert.match(del, /if\s*\(\s*!this\.canDecide\s*\)\s*return/);
});

test('Relations Viewer asks AccessCore and gates detail-panel editors on canDecide', () => {
    const src = read('relations-viewer.js');
    assert.match(src, /AccessCore\.pageFlags/);
    assert.match(src, /if\s*\(\s*!flags\.canReadElder\s*\)/);
    assert.match(src, /view\.canDecide = !!flags\.canDecide/);
    assert.doesNotMatch(src, /\[.elder.,\s*.super_admin.\]/);
    for (const name of ['prototype.commitMembership', 'prototype.setStatus', 'prototype.toggleTag', 'prototype.createTag']) {
        const start = src.indexOf(name);
        assert.ok(start !== -1, name + ' is gone');
        const open = src.indexOf('{', start);
        const head = src.slice(open, open + 220);
        assert.match(head, /!this\.canDecide/, name + ' can still write for a PA');
    }
    assert.match(src, /data-act="setStage"/);
    assert.match(src, /!decide \? ' disabled'/);
    assert.match(src, /decide \? 'button' : 'div'/);
    assert.match(src, /data-act="createTag"/);
    assert.match(src, /var addBlock = decide/);
});

test('Service Builder Send prayer now is a canDecide write, not canReadElder', () => {
    const js = read('service-builder.js');
    assert.match(js, /this\.isShepherd = this\.canReadElder/);
    const send = js.slice(js.indexOf('async sendPrayerRequestNow'), js.indexOf('async sendPrayerRequestNow') + 160);
    assert.match(send, /if\s*\(\s*!this\.canDecide\s*\)\s*return/);
    const canSend = js.slice(js.indexOf('canSendPrayerText(which)'), js.indexOf('canSendPrayerText(which)') + 120);
    assert.match(canSend, /if\s*\(\s*!this\.canDecide\s*\)\s*return false/);
    const html = read('service-builder.html');
    const sendBtn = html.indexOf('sendPrayerRequestNow(which)');
    assert.ok(sendBtn !== -1);
    assert.match(html.slice(Math.max(0, sendBtn - 400), sendBtn), /x-show="canDecide"/);
});

// ── MS-572 / MS-573 / MS-574 — leftover chrome after MS-540 ────────────────
// Additive. Do not reopen the MS-540 pins above.

test('the profile hides Undo unless canDecide', () => {
    const html = read('shepherding-profile.html');
    const btn = html.indexOf('undoStatusChange(entry)');
    assert.ok(btn !== -1, 'Undo is gone');
    assert.match(
        html.slice(Math.max(0, btn - 80), btn),
        /x-show="canDecide && canUndoStatusChange\(entry\)"/
    );
    const src = read('shepherding-profile.js');
    const can = src.slice(src.indexOf('canUndoStatusChange(entry)'), src.indexOf('canUndoStatusChange(entry)') + 180);
    assert.match(can, /this\.canDecide/, 'canUndoStatusChange no longer asks canDecide');
    const undo = src.slice(src.indexOf('async undoStatusChange'), src.indexOf('async undoStatusChange') + 140);
    assert.match(undo, /if\s*\(\s*!this\.canDecide/, 'undoStatusChange can still run for a PA');
});

test('the profile Membership Track is canDecide, not canWriteEditor', () => {
    const html = read('shepherding-profile.html');
    const track = between(html, '<!-- Membership Track', '<!-- Shepherding Tags Panel');
    assert.match(track, /x-show="canDecide"/);
    assert.doesNotMatch(track, /canWriteEditor/);
    const src = read('shepherding-profile.js');
    const getter = src.slice(src.indexOf('get canEditMembership'), src.indexOf('get canEditMembership') + 90);
    assert.match(getter, /return this\.canDecide/);
    assert.doesNotMatch(getter, /canWriteEditor/);
    const commit = src.slice(src.indexOf('async commitMembership'), src.indexOf('async commitMembership') + 90);
    assert.match(commit, /if\s*\(\s*!this\.canDecide\s*\)\s*return/);
});

test('the Relationships tab hides type New / Edit / Delete unless canDecide', () => {
    const html = read('shepherding-tags.html');
    const types = between(html, '<!-- ═══ LEFT: the vocabulary', '<!-- kind + priority');
    assert.match(types, /startNewType\(\)/);
    assert.match(types, /x-show="canDecide"/);
    assert.match(types, /startEditType\(type\)/);
    assert.match(types, /deleteType\(type\)/);
    const src = read('shepherding-relationships.js');
    for (const name of ['startNewType', 'startEditType', 'async saveType', 'async deleteType']) {
        const start = src.indexOf(name);
        assert.ok(start !== -1, name + ' is gone');
        const open = src.indexOf('{', start);
        const head = src.slice(open, open + 80);
        assert.match(head, /if\s*\(\s*!this\.canDecide\s*\)\s*return/, name + ' can still run for a PA');
    }
});

test('the Elder Document person-panel trigger extension is handed canDecide', () => {
    const src = read('shepherding-document.js');
    const ext = between(src, 'const trigExt = createInlineTriggersExtension', 'onStatusUndo');
    assert.match(ext, /canDecide:\s*!!_canDecide/);
    assert.match(src, /_canDecide\s*=\s*!!this\.canDecide/);
});
