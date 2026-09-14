// MS-491 — the wiring that makes the profile's editors boxes.
//
// No DOM harness, so this reads the source, like the other wiring tests. What
// it pins are the shapes that would silently undo the lock:
//
//   - an editor that opens without claiming its box first;
//   - a Save that writes when the record moved under it;
//   - a box named after the page instead of the record, which would let a Task
//     held on a profile open on the Tasks page;
//   - presence started where a throw could take editing down with it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

function between(src, from, to) {
    const a = src.indexOf(from);
    assert.ok(a !== -1, 'not found: ' + from);
    const b = src.indexOf(to, a + from.length);
    return src.slice(a, b === -1 ? a + 1500 : b);
}

function loadsBefore(html, first, second) {
    const a = html.indexOf('src="' + first + '"');
    const b = html.indexOf('src="' + second + '"');
    return a !== -1 && b !== -1 && a < b;
}

test('every page that locks loads the shared presence store before using it', () => {
    const profile = read('shepherding-profile.html');
    assert.ok(loadsBefore(profile, 'presence-core.js', 'shepherding-presence.js'));
    assert.ok(loadsBefore(profile, 'shepherding-presence.js', 'shepherding-tasks.js'));
    assert.ok(loadsBefore(profile, 'shepherding-presence.js', 'shepherding-profile.js'));

    const tasks = read('shepherding-tasks.html');
    assert.ok(loadsBefore(tasks, 'shepherding-core.js', 'shepherding-tasks.js'),
        'the Task editor asks ShepherdingCore whether its Task moved');
    assert.ok(loadsBefore(tasks, 'shepherding-presence.js', 'shepherding-tasks.js'));

    assert.ok(loadsBefore(read('mobile.html'), 'shepherding-presence.js', 'mobile/data.js'));
});

// ── The web profile ──────────────────────────────────────────────────────────

test('a note editor claims its box before it opens', () => {
    const open = between(read('shepherding-profile.js'), 'openEditNote(note) {', 'closeEditor() {');
    assert.ok(open.indexOf('claimBox(') !== -1 && open.indexOf('claimBox(') < open.indexOf('this.editingNote = note'),
        'the note must be claimed before the editor opens');
    assert.match(open, /box\.note\(this\.personId, note\.id\)/);
});

test('the details editor claims its box before it opens', () => {
    const open = between(read('shepherding-profile.js'), 'openEditProfile() {', 'closeEditProfile() {');
    assert.ok(open.indexOf('claimBox(') < open.indexOf('this.selectedPerson ='));
    assert.match(open, /box\.details\(this\.personId\)/);
});

test('closing either editor lets its box go', () => {
    const src = read('shepherding-profile.js');
    assert.match(between(src, 'closeEditor() {', 'handleNoteTypeChange()'), /ShepherdingPresence\.release\(\)/);
    assert.match(between(src, 'closeEditProfile() {', 'async saveProfile()'), /ShepherdingPresence\.release\(\)/);
});

test('a Save is refused when the record moved under the editor', () => {
    const src = read('shepherding-profile.js');
    assert.match(between(src, 'async saveNote() {', 'async deleteNote('), /if \(this\.noteSaveBlocked\) return;/);
    assert.match(between(src, 'async saveProfile() {', 'openDeletePerson()'), /if \(this\.detailsSaveBlocked\) return;/);
    const html = read('shepherding-profile.html');
    assert.match(html, /@click="saveNote\(\)" :disabled="noteSaveBlocked"/);
    assert.match(html, /:disabled="isSubmitting \|\| detailsSaveBlocked"/);
});

test('typing in an open editor tells the store', () => {
    const src = read('shepherding-profile.js');
    assert.match(src, /onUpdate\(\) \{ self\.touchNote\(\); \}/);
    const html = read('shepherding-profile.html');
    assert.match(html, /x-model="noteForm\.subject"\s*\n\s*@input="touchNote\(\)"/);
    assert.match(html, /@input="touchDetails\(\)"/);
});

test('presence starts after the profile has loaded and cannot throw at its handler', () => {
    const src = read('shepherding-profile.js');
    const boot = between(src, 'await this.watchProfile();', 'watchProfile() {');
    assert.ok(boot.indexOf('this.loading = false;') < boot.indexOf('this.startPresence(user);'));
    assert.match(between(src, 'startPresence(user) {', 'heldBy(box) {'), /try \{[\s\S]*\} catch \(e\)/);
});

test('a held note and held details show a face instead of their way in', () => {
    const html = read('shepherding-profile.html');
    assert.match(html, /x-show="!entry\.isCareList && !noteHolder\(entry\)"/);
    assert.match(html, /<button x-show="!detailsHolder" @click="openEditProfile\(\)"/);
    assert.match(html, /x-for="p in othersHere"/);
});

// ── The Task editor ──────────────────────────────────────────────────────────

test('a Task editor claims the Task, not the page', () => {
    const src = read('shepherding-tasks.js');
    const open = between(src, 'openEdit(task) {', 'async mountEditor(');
    assert.ok(open.indexOf('claimBox(this.taskBox(task))') !== -1);
    assert.ok(open.indexOf('claimBox(') < open.indexOf('this.showModal = true'));
    assert.match(between(src, 'taskBox(task) {', 'taskHolder(task) {'),
        /box\.task\(task\.seriesId \|\| task\.id\)/);
});

test('the Tasks tab on a profile listens to the page\'s presence rather than starting its own', () => {
    const start = between(read('shepherding-tasks.js'), 'startPresence(user) {', 'taskBox(task) {');
    assert.ok(start.indexOf('if (this.embedded) return;') < start.indexOf('ShepherdingPresence.start('),
        'two stores on one page overwrite each other\'s claim');
});

test('a Task Save is refused when the Task moved under the editor, in both places it is mounted', () => {
    assert.match(between(read('shepherding-tasks.js'), 'async save() {', 'async tick('), /if \(this\.taskSaveBlocked\) return;/);
    ['shepherding-tasks.html', 'shepherding-profile.html'].forEach(page => {
        const html = read(page);
        assert.match(html, /:disabled="saving \|\| taskSaveBlocked/, page);
        assert.match(html, /@input="touchTask\(\)" @change="touchTask\(\)"/, page);
        assert.strictEqual((html.match(/x-if="taskHolder\(task\)"/g) || []).length, 3, page + ' rows show their holder');
    });
});

// ── The phone ────────────────────────────────────────────────────────────────

test('the phone profile claims the same boxes as the web', () => {
    const src = read('mobile/screens-shepherd.js');
    assert.match(between(src, 'function openNoteEditor(e) {', 'function closeNoteEditor()'),
        /box\.note\(pid, e\.id\)/);
    assert.match(between(src, 'function openDetailsEditor() {', 'function closeDetailsEditor()'),
        /box\.details\(pid\)/);
    assert.match(src, /surface: "shepherding-profile",\s*\n\s*pageKey: pid,/);
});

test('the phone profile lets go of presence when the screen goes', () => {
    const src = read('mobile/screens-shepherd.js');
    assert.match(src, /SP\.leave\(\); SP\.stop\(\);/);
});

test('the phone refuses a Save when the record moved under it', () => {
    const src = read('mobile/screens-shepherd.js');
    assert.match(between(src, 'function saveNote() {', 'function deleteNote('), /noteState\(\)\.state !== "unchanged"\) return;/);
    assert.match(between(src, 'function saveProfileDetails() {', '// ── Quick-assign'), /detailsState\(\)\.state !== "unchanged"\) return;/);
});
