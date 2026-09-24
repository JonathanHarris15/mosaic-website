const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// MS-601 — restore editor Membership Track after MS-573 collapsed the
// Shepherding Profile slider to canDecide alone. Locked gate:
//   canDecide || canEditMembership
// where canEditMembership is the editor write ladder (AccessCore.writesAsEditor /
// pageFlags.canWriteEditor), not another alias of canDecide.

const Access = require('../public/access-core.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

function between(src, from, to) {
    const a = src.indexOf(from);
    assert.ok(a !== -1, 'not found: ' + from);
    const b = src.indexOf(to, a + from.length);
    return src.slice(a, b === -1 ? a + 2000 : b);
}

function flagsOf(permissionLevel, pastoralAssistant) {
    return Access.pageFlags({ permissionLevel, pastoralAssistant: !!pastoralAssistant });
}

// The Track surface: decide (elder / PA) OR editor write. Never grant the
// editor canDecide.
function canUseTrack(account) {
    const flags = Access.pageFlags(account);
    return !!(flags.canDecide || flags.canWriteEditor);
}

const EDITOR = { permissionLevel: 'editor', pastoralAssistant: false };
const MEMBER = { permissionLevel: 'member', pastoralAssistant: false };
const PA = { permissionLevel: 'member', pastoralAssistant: true };
const ELDER = { permissionLevel: 'elder', pastoralAssistant: false };

test('AccessCore: editor writes as editor and does not decide', () => {
    const editor = flagsOf('editor', false);
    assert.equal(editor.canWriteEditor, true);
    assert.equal(editor.canDecide, false);
    assert.equal(editor.canReadElder, false);
    assert.equal(Access.writesAsEditor(EDITOR), true);
    assert.equal(Access.canDecide(EDITOR), false);
});

test('AccessCore: member has neither Track flag', () => {
    const member = flagsOf('member', false);
    assert.equal(member.canWriteEditor, false);
    assert.equal(member.canDecide, false);
});

test('AccessCore: PA decides and still does not write as editor', () => {
    const pa = flagsOf('member', true);
    assert.equal(pa.canDecide, true);
    assert.equal(pa.canWriteEditor, false);
    assert.equal(Access.isAnElder(PA), false);
});

test('AccessCore: elder decides and writes as editor', () => {
    const elder = flagsOf('elder', false);
    assert.equal(elder.canDecide, true);
    assert.equal(elder.canWriteEditor, true);
    assert.equal(Access.isAnElder(ELDER), true);
});

test('locked Track gate: editor and PA and elder yes; plain member no', () => {
    assert.equal(canUseTrack(EDITOR), true, 'editor lost the Track');
    assert.equal(canUseTrack(MEMBER), false, 'a plain member can walk the Track');
    assert.equal(canUseTrack(PA), true, 'PA lost the Track (MS-594)');
    assert.equal(canUseTrack(ELDER), true, 'elder lost the Track');
    // The editor is not being handed canDecide to get there.
    assert.equal(Access.canDecide(EDITOR), false);
});

test('profile canEditMembership is canWriteEditor, not canDecide', () => {
    const src = read('shepherding-profile.js');
    const getter = src.slice(src.indexOf('get canEditMembership'), src.indexOf('get canEditMembership') + 160);
    assert.match(getter, /return !!this\.canWriteEditor/);
    assert.doesNotMatch(getter, /return this\.canDecide/);
    assert.doesNotMatch(getter, /return this\.canDecide\s*\|\|/);
});

test('profile Track show + commit use canDecide || canEditMembership', () => {
    const html = read('shepherding-profile.html');
    const track = between(html, '<!-- Membership Track', '<!-- Shepherding Tags Panel');
    assert.match(track, /x-show="canDecide \|\| canEditMembership"/);
    assert.doesNotMatch(track, /canWriteEditor/);
    const src = read('shepherding-profile.js');
    const commit = src.slice(src.indexOf('async commitMembership'), src.indexOf('async commitMembership') + 160);
    assert.match(commit, /if\s*\(\s*!\s*\(\s*this\.canDecide\s*\|\|\s*this\.canEditMembership\s*\)\s*\)\s*return/);
});

test('profile decision chrome stayed canDecide (assignment, tags, status)', () => {
    const html = read('shepherding-profile.html');
    const src = read('shepherding-profile.js');

    const assign = between(html, '<!-- No assignment yet', '<!-- Picker');
    assert.match(assign, /x-show="canDecide"/);
    assert.doesNotMatch(assign, /canEditMembership/);

    const add = between(html, '<!-- Add tags', '<!-- Create new tag');
    assert.match(add, /x-show="canDecide"/);
    assert.doesNotMatch(add, /canEditMembership/);

    const create = between(html, '<!-- Create new tag', '<!-- Relationships Panel');
    assert.match(create, /x-show="canDecide"/);
    assert.doesNotMatch(create, /canEditMembership/);

    for (const name of ['async setAssignedElder', 'async toggleTag', 'async createTag']) {
        const start = src.indexOf(name);
        assert.ok(start !== -1, name + ' is gone');
        const head = src.slice(src.indexOf('{', start), src.indexOf('{', start) + 80);
        assert.match(head, /if\s*\(\s*!this\.canDecide\s*\)\s*return/, name + ' was widened to editors');
        assert.doesNotMatch(head, /canEditMembership/, name + ' now asks the Track flag');
    }
});

test('People list Track stays on canEdit (writesAsEditor); hide chrome stays canDecide', () => {
    const js = read('peoples-page.js');
    const html = read('peoples-page.html');

    const canEdit = js.slice(js.indexOf('get canEdit()'), js.indexOf('get canEdit()') + 160);
    assert.match(canEdit, /AccessCore\.writesAsEditor/);
    assert.doesNotMatch(canEdit, /canDecide/);

    const modal = between(html, '<!-- Membership Track (ADR-0012): stage slider', '<!-- Family');
    assert.match(modal, /x-show="canEdit"/);
    assert.doesNotMatch(modal, /canDecide/);

    const card = between(html, '<!-- Membership Track (ADR-0012) — the same stage slider', '<!-- Tag Management');
    assert.match(card, /x-show="editMode"/);
    assert.match(html, /x-show="canEdit" @click="toggleEditMode\(\)"/);

    const commit = js.slice(js.indexOf('async commitMembership'), js.indexOf('async commitMembership') + 160);
    assert.doesNotMatch(commit, /canDecide/, 'People list Track was collapsed to canDecide');

    const hide = between(html, 'Hide-vocabulary controls', 'togglePeopleVisibility(tag)');
    assert.match(hide, /x-show="canDecide"/);
});

test('Relations Viewer Track stayed canDecide (elder graph; not an editor power)', () => {
    const src = read('relations-viewer.js');
    const start = src.indexOf('prototype.commitMembership');
    assert.ok(start !== -1, 'Relations Viewer commitMembership is gone');
    const head = src.slice(start, start + 280);
    assert.match(head, /!this\.canDecide/);
    assert.doesNotMatch(head, /canWriteEditor/);
    assert.doesNotMatch(head, /canEditMembership/);
});

test('phone Shepherd Track stayed canDecide (canReadElder entry, not an editor surface)', () => {
    const src = read('mobile/screens-shepherd.js');
    const commit = src.slice(src.indexOf('function commitMembership'), src.indexOf('function commitMembership') + 120);
    assert.match(commit, /if\s*\(\s*!canDecide\s*\)\s*return/);
    const track = between(src, '>Membership Track</h2>', '>Pastoral Status</h2>');
    assert.match(track, /\$\{canDecide \? html`<\$\{Fragment\}>/);
    assert.doesNotMatch(track, /canWriteEditor/);
    assert.doesNotMatch(track, /canEditMembership/);
});
