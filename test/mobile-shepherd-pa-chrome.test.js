const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// MS-541 / MS-575 / MS-576 — phone Shepherd decision chrome asks
// AccessCore.canDecide so a Pastoral Assistant never gets a click → toast.
// Screen entry stays canReadElder (a PA still opens Shepherd).

const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'mobile', 'screens-shepherd.js'),
    'utf8'
);

function between(src, from, to) {
    const a = src.indexOf(from);
    assert.ok(a !== -1, 'not found: ' + from);
    const b = src.indexOf(to, a + from.length);
    return src.slice(a, b === -1 ? a + 2000 : b);
}

function headOf(name) {
    const start = SRC.indexOf(name);
    assert.ok(start !== -1, name + ' is gone');
    const open = SRC.indexOf('{', start);
    return SRC.slice(open, open + 80);
}

test('phone Shepherd no longer aliases isElder = canReadElder', () => {
    assert.doesNotMatch(SRC, /isElder\s*=\s*canReadElder/);
    assert.doesNotMatch(SRC, /\bisElder\b/);
});

test('screen entry is canReadElder — a PA still opens Shepherd', () => {
    assert.match(SRC, /: !canReadElder \? html`<div style=\$\{\{ padding: "60px 24px"/);
    assert.match(SRC, /if \(!canReadElder\) \{\n      return html`<\$\{Screen\}>/);
});

test('New View and dashboard view write/delete are canDecide', () => {
    const header = between(SRC, '>Filtered Views</span>', '</div>');
    assert.match(header, /New View/);
    assert.match(header, /canDecide \? html`<button onClick=\$\{openNewView\}/);
    const card = between(SRC, 'canDecide ? html`<div style=${{ display: "flex", gap: 4', 'vp.length === 0');
    assert.match(card, /openEditView\(v\)/);
    assert.match(card, /deleteView\(v\.id\)/);
    assert.match(card, /aria-label="Edit view"/);
    assert.match(card, /aria-label="Delete view"/);
    for (const name of ['function openNewView', 'function openEditView', 'function saveView', 'function deleteView']) {
        assert.match(headOf(name), /if\s*\(\s*!canDecide\s*\)\s*return/, name + ' can still run for a PA');
    }
});

test('People saved-view write/delete are canDecide; load stays open', () => {
    const saved = between(SRC, '>Saved Views</span>', '>Filter by Tags</span>');
    assert.match(saved, /canDecide \? html`<button onClick=\$\{function \(\) \{ showSaveS\[1\]/);
    assert.match(saved, /showSaveS\[0\] && canDecide/);
    assert.match(saved, /aria-label="Delete saved view"/);
    assert.match(saved, /canDecide \? html`<button onClick=\$\{function \(\) \{ if \(!canDecide\) return;/);
    assert.match(saved, /loadView\(v\)/);
});

test('profile hides tag add / create / remove unless canDecide', () => {
    const tags = between(SRC, '>Shepherding Tags</h2>', '>Membership Track</h2>');
    assert.match(tags, /canDecide && addableTags\.length/);
    assert.match(tags, /\$\{canDecide \? html`<div style=\$\{\{ marginTop: 14/);
    assert.match(tags, /createTag\(\)/);
    assert.match(tags, /mt \|\| !canDecide \? null : html`<button onClick=\$\{function \(\) \{ toggleTag\(t\); \}/);
});

test('profile Pastoral Status and Membership Track writes are canDecide', () => {
    const status = between(SRC, '>Pastoral Status</h2>', 'drawerS[0] ? html');
    assert.match(status, /disabled=\$\{!canDecide\}/);
    assert.match(status, /canDecide \? html`<button onClick=\$\{function \(\) \{ setStatus\(/);
    const track = between(SRC, '>Membership Track</h2>', '>Pastoral Status</h2>');
    assert.match(track, /\$\{canDecide \? html`<\$\{Fragment\}>/);
    assert.match(track, /setMembershipStage\(/);
    assert.match(track, /toggleInactive/);
});

test('profile explanation edit is canDecide; Add Note is not', () => {
    assert.match(SRC, /canDecide \? html`<button onClick=\$\{function \(\) \{ var n = Object\.assign\(\{\}, explEditS\[0\]\)/);
    assert.match(SRC, /\$\{e\.explanation \? "Edit" : "Add"\} explanation/);
    const record = between(SRC, '>Pastoral Record</h2>', 'visible.length === 0');
    assert.match(record, /Add Note/);
    assert.doesNotMatch(record, /canDecide/);
});

test('profile write methods refuse without canDecide before they toast', () => {
    for (const name of ['function setStatus', 'function commitMembership', 'function toggleTag', 'function createTag', 'function saveExpl']) {
        assert.match(headOf(name), /if\s*\(\s*!canDecide\s*\)\s*return/, name + ' can still run for a PA');
    }
});
