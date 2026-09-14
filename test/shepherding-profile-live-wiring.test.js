// MS-490 — the wiring that makes the Shepherding Profile live.
//
// There is no DOM harness in this suite, so like profile-tasks-tab-wiring.test.js
// this reads the source. It cannot prove the page updates; it can prove the
// shapes that would quietly stop it updating are gone:
//
//   - a page that reads once again (a `.get()` where a watch should be);
//   - a reload after a save, the old way of hearing about anything, which also
//     re-reads the whole feed on every click;
//   - a watch that is never stopped, which on the phone keeps re-reading in
//     the background after the screen has gone;
//   - the web and the phone building the feed two different ways.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

function loadsBefore(html, first, second) {
    const a = html.indexOf('src="' + first + '"');
    const b = html.indexOf('src="' + second + '"');
    return a !== -1 && b !== -1 && a < b;
}

test('every page and screen that watches loads the live-read helper first', () => {
    assert.ok(loadsBefore(read('shepherding-profile.html'), 'live-read.js', 'shepherding-profile.js'));
    assert.ok(loadsBefore(read('shepherding-tasks.html'), 'live-read.js', 'shepherding-tasks.js'));
    assert.ok(loadsBefore(read('mobile.html'), 'live-read.js', 'mobile/data.js'));
});

// ── The web profile ──────────────────────────────────────────────────────────

test('the web profile watches what it draws instead of reading it once', () => {
    const src = read('shepherding-profile.js');
    const watching = src.slice(src.indexOf('watchProfile() {'), src.indexOf('async fillSourceTitles()'));
    assert.ok(watching.length > 0, 'watchProfile was not found');
    [
        "collection('people').doc(this.personId)",
        "collection('shepherding_notes')",
        "collection('shepherding_activity')",
        "where('docType', '==', 'care-list')",
        "collection('people_tags')",
        "collection('relationships')",
        "collection('relationship_types')",
        "collection('relationship_groups')",
        "collection('families')",
        "collection('people').orderBy('name')",
    ].forEach(read => assert.ok(watching.includes(read), 'not watched: ' + read));
    assert.ok(!/\.get\(\)/.test(watching), 'a watch was turned back into a one-off read');
});

test('nothing on the web profile reloads after a save', () => {
    const src = read('shepherding-profile.js');
    assert.ok(!/loadActivity|loadNotes\(|loadPerson\(|loadTags\(|loadRelationships\(/.test(src),
        'a reload-after-save is back');
});

test('the web profile stops watching when the page goes', () => {
    const src = read('shepherding-profile.js');
    assert.match(src, /addEventListener\('pagehide', stopProfileWatches\)/);
});

test('the web profile builds its feed with the shared combine function', () => {
    const src = read('shepherding-profile.js');
    assert.match(src, /ShepherdingCore\.combineProfile\(/);
    assert.ok(!/assemblePastoralRecord\(/.test(src), 'the page assembles its own feed again');
});

// ── The Tasks component (the page, and the profile's Tasks tab) ──────────────

test('the Tasks component watches, and stops when a tab is taken down', () => {
    const src = read('shepherding-tasks.js');
    assert.match(src, /watchTasks\(\)/);
    assert.match(src, /destroy\(\)\s*\{\s*stopTaskWatches\(\);/);
    assert.match(src, /addEventListener\('pagehide', stopTaskWatches\)/);
});

test('a tick\'s celebration is not cut short by its own write arriving', () => {
    const src = read('shepherding-tasks.js');
    const apply = src.slice(src.indexOf('applyTasks() {'), src.indexOf('applyTasks() {') + 300);
    assert.match(apply, /Object\.keys\(this\.finishing\)\.length/,
        'arrivals must be held while a card is folding up');
});

// ── The phone ────────────────────────────────────────────────────────────────

test('the phone data layer offers a watch for everything the profile draws', () => {
    const src = read('mobile/data.js');
    ['watchPerson', 'watchShepherdingNotes', 'watchShepherdingActivity', 'watchShepherdingTags',
        'watchPeople', 'watchFamilies', 'watchRelationships', 'watchRelationshipTypes',
        'watchRelationshipGroups', 'watchPersonTasks'].forEach(name => {
        assert.match(src, new RegExp('function ' + name + '\\('), name + ' is not defined');
        assert.match(src, new RegExp(name + ': ' + name + ','), name + ' is not exported');
    });
});

test('the phone profile screen watches, and stops every watch when it goes', () => {
    const src = read('mobile/screens-shepherd.js');
    const screen = src.slice(src.indexOf('function ShepherdProfileScreen'), src.indexOf('function setStatus('));
    assert.match(screen, /data\.watchPerson\(pid/);
    assert.match(screen, /return function \(\) \{ stops\.forEach\(function \(stop\) \{ stop\(\); \}\); \};/);
    assert.ok(!/data\.getShepherdingNotes|data\.getShepherdingActivity|data\.getPerson\(/.test(screen),
        'the phone profile reads once again');
    assert.ok(!/reloadActivity|reloadNotes/.test(src), 'a reload-after-save is back on the phone');
});

test('the phone builds its feed with the same combine function as the web', () => {
    const src = read('mobile/screens-shepherd.js');
    assert.match(src, /Core\.combineProfile\(\{ personId: pid/);
});

test('the phone Tasks tab watches', () => {
    const src = read('mobile/screens-shepherd.js');
    const tab = src.slice(src.indexOf('function ProfileTasks'), src.indexOf('function ProfileDocuments'));
    assert.match(tab, /return data\.watchPersonTasks\(pid/);
});
