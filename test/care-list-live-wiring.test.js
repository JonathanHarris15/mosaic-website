// MS-439 / MS-443 / MS-445 / MS-448 — the wiring that makes a Care List live
// and one person per cell, on the web page and the phone screen.
//
// No DOM harness, so this reads the source, like the other wiring tests. The
// rules themselves are tested in care-list-core.test.js and against a real
// database in test/emulator/care-list-writes.test.js. What this pins are the
// shapes that would quietly undo them:
//
//   - a save that writes the whole cell map or column list again;
//   - somebody else's cell put into an editor in a way that counts as an edit,
//     so it is saved straight back;
//   - a hold let go before that cell's pending save has gone;
//   - web and phone naming the list or its boxes differently, so a cell held on
//     one is open on the other.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const WEB = read('shepherding-care-list.js');
const PHONE = read('mobile/screens-carelist.js');
const DATA = read('mobile/data.js');

function loadsBefore(html, first, second) {
    const a = html.indexOf('src="' + first + '"');
    const b = html.indexOf('src="' + second + '"');
    return a !== -1 && b !== -1 && a < b;
}

function between(src, from, to) {
    const a = src.indexOf(from);
    assert.ok(a !== -1, 'not found: ' + from);
    const b = src.indexOf(to, a + from.length);
    return src.slice(a, b === -1 ? a + 2000 : b);
}

test('both surfaces load the shared Care List rules and the presence store first', () => {
    const web = read('shepherding-care-list.html');
    for (const script of ['live-read.js', 'presence-core.js', 'shepherding-presence.js', 'care-list-core.js', 'mosaic-identity.js', 'person-photo-core.js']) {
        assert.ok(loadsBefore(web, script, 'shepherding-care-list.js'), script + ' before the page script');
    }
    const phone = read('mobile.html');
    assert.ok(loadsBefore(phone, 'shepherding-presence.js', 'care-list-core.js'));
    assert.ok(loadsBefore(phone, 'care-list-core.js', 'mobile/screens-carelist.js'));
});

test('nothing writes the whole cell map or the whole column list any more', () => {
    for (const [name, src] of [['web', WEB], ['phone', PHONE], ['phone data', DATA]]) {
        assert.doesNotMatch(src, /\.update\(\s*\{[\s\S]{0,400}careListData\s*:/, name + ' writes careListData wholesale');
        assert.doesNotMatch(src, /\.update\(\s*\{[\s\S]{0,400}careListColumns\s*:/, name + ' writes careListColumns wholesale');
    }
    assert.match(WEB, /CareListCore\.saveEdits\(/);
    assert.match(DATA, /CareListCore\.saveEdits\(/);
    assert.match(WEB, /CareListCore\.changeColumn\(/);
    assert.match(DATA, /CareListCore\.changeColumn\(/);
});

test('a save is what the session says was typed into, and a failure hands it back', () => {
    for (const src of [WEB, PHONE]) {
        assert.match(src, /\.takeSave\(/);
        assert.match(src, /\.saveFailed\(/);
        assert.match(src, /oldShape:\s*session\.oldShape\(\)/, 'an old-shaped list is normalised by the save');
    }
});

test('an edit is reported to the session; an arrival is not an edit', () => {
    for (const src of [WEB, PHONE]) {
        assert.match(src, /session\.edited\(/);
        assert.match(src, /setContent\([^)]*,\s*false\)/, 'setContent must not emit an update');
        assert.match(src, /setEditable\([^)]*,\s*false\)/, 'setEditable must not emit an update');
        assert.doesNotMatch(src, /setContent\([^,)]*\)/, 'a setContent without emitUpdate=false would save the arrival back');
    }
});

test('both follow the list and adopt with where the cursor is', () => {
    assert.match(WEB, /CareListCore\.watch\(/);
    assert.match(DATA, /CareListCore\.watch\(/);
    for (const src of [WEB, PHONE]) {
        assert.match(src, /\.adopt\([^)]*inCell:[^)]*inTitle:/);
        assert.match(src, /\.catchUpCell\(/);
        assert.match(src, /\.catchUpTitle\(/);
    }
});

test('rows follow the people records and the Filtered View', () => {
    assert.match(between(WEB, 'watchCareList() {', 'adoptRemote(data) {'), /collection\('people'\)/);
    assert.match(between(WEB, 'watchCareList() {', 'adoptRemote(data) {'), /shepherding_views/);
    assert.match(PHONE, /watchShepherdingPeople\(/);
    assert.match(PHONE, /watchShepherdingView\(/);
});

test('a cell and the title are boxes named by the shared rules, on the same list surface', () => {
    for (const src of [WEB, PHONE]) {
        assert.match(src, /box\.cell\(/);
        assert.match(src, /box\.title\(/);
        assert.match(src, /surface:\s*['"]shepherding-care-list['"]/);
        assert.match(src, /columnHolder\(/, 'removing a column checks nobody is writing in it');
    }
});

test('a hold is let go only after that cell\'s pending save', () => {
    const web = between(WEB, 'async leaveCell(', 'enterTitle(');
    assert.ok(web.indexOf('await this.save()') !== -1 && web.indexOf('await this.save()') < web.indexOf('release()'));
    const phone = between(PHONE, 'function leaveCell(', 'function enterTitle(');
    assert.ok(phone.indexOf('doSave()') !== -1 && phone.indexOf('doSave()') < phone.indexOf('release()'));
});

test('a keystroke in a box somebody took is thrown back, not saved', () => {
    for (const src of [WEB, PHONE]) {
        assert.match(src, /\.touch\(\)/);
        assert.match(src, /\.discard\(/);
    }
});

test('presence starts after editing is granted, and cannot take the page down', () => {
    const init = between(WEB, 'async init()', 'async loadDoc()');
    assert.ok(init.indexOf('this.loading = false') < init.indexOf('this.startPresence(user)'));
    assert.match(between(WEB, 'startPresence(user)', 'heldBy(box)'), /try\s*\{/);
    assert.match(between(PHONE, '// ── Presence (MS-445)', 'function holderOf('), /try\s*\{/);
});
