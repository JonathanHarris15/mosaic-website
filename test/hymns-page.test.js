const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HymnsPage = require('../public/hymns-page.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (name) => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

// ── The page's own component, run for real ───────────────────────────────────
//
// ⚠ READING hymns.js IS NOT ENOUGH. Every other test in this file matches the
// source text, and MS-675 walked straight through all of them: a helper that
// called itself, spelled perfectly. Only running it says whether a tap works.
//
// So load hymns.js the way the browser does — it listens for `alpine:init` and
// registers a factory — and build the component. Firestore and Storage are not
// reached by the view-switching methods, so the sandbox stops at the edges.
function hymnsComponent(search) {
    const sandbox = {
        console, Promise, Date, Object, Array, Math, String, Number, JSON,
        Set, Map, setTimeout, clearTimeout, encodeURIComponent, URLSearchParams,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.HymnsPage = HymnsPage;
    sandbox.location = { search: search || '' };
    sandbox.auth = { onAuthStateChanged() { return () => {}; } };
    sandbox.getUserData = async () => ({});
    sandbox.firebase = { firestore: { FieldValue: {} } };
    sandbox.navigator = { userAgent: '' };

    let onInit = null;
    sandbox.document = {
        addEventListener(name, fn) { if (name === 'alpine:init') onInit = fn; },
    };

    let factory = null;
    sandbox.Alpine = { data(name, fn) { if (name === 'hymnsPage') factory = fn; } };

    vm.createContext(sandbox);
    vm.runInContext(read('hymns.js'), sandbox, { filename: 'hymns.js' });
    assert.ok(onInit, 'hymns.js never registered an alpine:init listener');
    onInit();
    assert.strictEqual(typeof factory, 'function', 'hymns.js never defined the hymnsPage component');
    return factory();
}

const A_HYMN = {
    id: 'tis-so-sweet',
    hymn_name: "'Tis So Sweet to Trust in Jesus",
    lyrics_writer: 'Louisa M. R. Stead',
    music_writer: 'William J. Kirkpatrick',
    attribution: "'Tis So Sweet to Trust in Jesus, words by Louisa M. R. Stead, Public Domain",
    tags: ['Trust'],
    versions: [{ name: 'Default', default: true, pages: ['sheet.png'] }],
};

test('a member may read the hymn book and may not change it', () => {
    ['member', 'viewer', 'guest'].forEach(function (level) {
        assert.equal(HymnsPage.canEditHymnBook({ permissionLevel: level }), false, level);
    });
    assert.equal(HymnsPage.canEditHymnBook(null), false);
    // A Pastoral Assistant can open the old manager. The rules still refuse the write.
    assert.equal(HymnsPage.canEditHymnBook({
        permissionLevel: 'member', pastoralAssistant: true,
    }), false);
    ['editor', 'admin', 'elder', 'super_admin'].forEach(function (level) {
        assert.equal(HymnsPage.canEditHymnBook({ permissionLevel: level }), true, level);
    });
});

test('a tag menu offers the tags that are not already filtering the book', () => {
    assert.deepEqual(
        HymnsPage.tagChoices(['Advent', 'Grace', 'Salvation'], ['Grace']),
        ['Advent', 'Salvation']);
    assert.deepEqual(HymnsPage.tagChoices(['Grace', 'Advent'], []), ['Grace', 'Advent']);
    assert.deepEqual(HymnsPage.tagChoices(null, ['Grace']), []);
    assert.deepEqual(HymnsPage.chooseTag(['Grace'], 'Salvation'), ['Grace', 'Salvation']);
    assert.deepEqual(HymnsPage.chooseTag(['Grace'], 'Grace'), ['Grace']);
    assert.deepEqual(HymnsPage.chooseTag(['Grace'], ''), ['Grace']);
    assert.deepEqual(HymnsPage.chooseTag(null, 'Grace'), ['Grace']);
});

test('search matches the title, both writers, the attribution, and the tags', () => {
    const hymn = {
        hymn_name: 'Amazing Grace',
        music_writer: 'New Britain',
        lyrics_writer: 'John Newton',
        attribution: 'Public Domain',
        tags: ['Grace', 'Salvation'],
    };
    assert.equal(HymnsPage.hymnMatches(hymn, 'newton', []), true);
    assert.equal(HymnsPage.hymnMatches(hymn, 'britain', []), true);
    assert.equal(HymnsPage.hymnMatches(hymn, 'public', []), true);
    assert.equal(HymnsPage.hymnMatches(hymn, 'grace', ['Salvation']), true);
    assert.equal(HymnsPage.hymnMatches(hymn, '', ['Grace', 'Salvation']), true);
    assert.equal(HymnsPage.hymnMatches(hymn, '', ['Grace', 'Advent']), false);
    assert.equal(HymnsPage.hymnMatches(hymn, 'psalm', []), false);
    assert.equal(HymnsPage.hymnMatches({ hymn_name: 'Untitled' }, 'title', []), true);
});

test('old hymn pages open this one, and a shell link stays in the shell', () => {
    assert.equal(HymnsPage.legacyHref('hymn-directory.html', ''), 'hymns.html');
    assert.equal(
        HymnsPage.legacyHref('/hymn-directory.html', '?shell=mobile'),
        'hymns.html?shell=mobile');
    assert.equal(
        HymnsPage.legacyHref('hymn-details.html', '?id=abc'),
        'hymns.html?hymn=abc');
    assert.equal(
        HymnsPage.legacyHref('manager.html', '?edit=abc&shell=mobile'),
        'hymns.html?shell=mobile&edit=abc');
    assert.equal(HymnsPage.legacyHref('manager.html', '?new=1'), 'hymns.html?new=1');
    assert.equal(
        HymnsPage.legacyHref('manager.html', '?name=Amazing%20Grace'),
        'hymns.html?new=1&name=Amazing+Grace');
});

test('a link says which view to open, and the form is not the list', () => {
    assert.deepEqual(HymnsPage.openState(''), { view: 'list', creating: false, hymnId: null, name: '' });
    assert.equal(HymnsPage.openState('?hymn=abc').view, 'hymn');
    assert.equal(HymnsPage.openState('?id=abc').hymnId, 'abc');
    const created = HymnsPage.openState('?new=1&name=Thine');
    assert.equal(created.view, 'form');
    assert.equal(created.creating, true);
    assert.equal(created.name, 'Thine');
    assert.equal(HymnsPage.openState('?edit=abc').creating, false);
});

test('the phone opens the same page, including an old details or manager link', () => {
    assert.equal(HymnsPage.phoneShellHref('hymnDirectory'), 'hymns.html?shell=mobile');
    assert.equal(
        HymnsPage.phoneShellHref('hymnDetails', { hymn: { id: 'abc' } }),
        'hymns.html?hymn=abc&shell=mobile');
    assert.equal(
        HymnsPage.phoneShellHref('hymnManager', { edit: 'abc' }),
        'hymns.html?edit=abc&shell=mobile');
    assert.equal(HymnsPage.phoneShellHref('hymnManager', { new: true }), 'hymns.html?new=1&shell=mobile');
    assert.equal(HymnsPage.homeHref('mobile'), 'mobile.html#/home');
    assert.equal(HymnsPage.homeHref('web'), 'index.html');
});

test('a new hymn is a draft until save, and the first version is the one that prints', () => {
    const draft = HymnsPage.blankDraft('Thine Be the Glory');
    assert.equal(draft.hymn_name, 'Thine Be the Glory');
    assert.deepEqual(HymnsPage.catalogVersions(draft.versions), []);
    const withOne = HymnsPage.addFormVersion(draft.versions, { id: 'v1', name: 'SATB', pages: [] });
    assert.equal(withOne[0].default, true);
    assert.equal(withOne[0].id, 'v1');
    const withTwo = HymnsPage.addFormVersion(withOne, { id: 'v2', name: 'Unison', pages: [] });
    assert.equal(withTwo[1].default, undefined);
    assert.equal(withTwo[0].name, 'SATB');
    const starred = HymnsPage.starVersions(withTwo, 1);
    assert.equal(starred[1].default, true);
    assert.equal(starred[0].default, undefined);
    assert.equal(starred[0].name, 'SATB');
    assert.equal(withTwo[1].default, undefined);
});

test('saving a hymn that was never starred marks the first version and drops an unsaved crop', () => {
    const draft = HymnsPage.draftFromHymn({
        hymn_name: 'Amazing Grace',
        versions: [
            { name: 'Old', pages: ['old.png'] },
            { name: 'New', pages: ['new.png'], default: true },
        ],
    });
    draft.versions[0].pages.push({ id: 'crop', url: 'blob:preview', file: { name: 'cropped.jpg' } });
    assert.equal(HymnsPage.unsavedSheetPages(draft).length, 1);
    const stored = HymnsPage.catalogVersions(draft.versions);
    assert.deepEqual(stored[0].pages, ['old.png']);
    assert.equal(stored[1].default, true);
    assert.equal(stored[0].default, undefined);
    const cancelled = HymnsPage.blankDraft('');
    assert.equal(HymnsPage.unsavedSheetPages(cancelled).length, 0);
});

test('deleting the default version promotes the one that follows, including on a draft', () => {
    const versions = [
        { name: 'Old', pages: ['a.png'] },
        { name: 'Middle', pages: ['b.png'], default: true },
        { name: 'Descant', pages: ['c.png'] },
    ];
    const next = HymnsPage.removeFormVersion(versions, 1);
    assert.equal(next[1].name, 'Descant');
    assert.equal(next[1].default, true);
    assert.equal(versions[1].default, true);
});

test('a duplicate title is refused when creating and kept when renaming', () => {
    const book = [{ id: '1', hymn_name: 'Amazing Grace' }];
    assert.equal(HymnsPage.duplicateTitle(book, 'Amazing Grace', true), true);
    assert.equal(HymnsPage.duplicateTitle(book, 'Amazing Grace', false), false);
    assert.equal(HymnsPage.duplicateTitle(book, 'Thine Be the Glory', true), false);
});

test('the version that prints is the starred one, or the first when nobody has starred', () => {
    const starred = { versions: [{ name: 'Old' }, { name: 'New', default: true }] };
    assert.equal(HymnsPage.versionPrints(starred, 0), false);
    assert.equal(HymnsPage.versionPrints(starred, 1), true);
    const plain = { versions: [{ name: 'Only', pages: ['a.png', '', 'b.png'] }] };
    assert.equal(HymnsPage.versionPrints(plain, 0), true);
    assert.deepEqual(HymnsPage.sheetPages(plain.versions[0]), ['a.png', 'b.png']);
    assert.equal(HymnsPage.sheetFileName('Amazing Grace', 'SATB', 2), 'amazing_grace_satb_page_2.png');
});

test('on a phone the hymn list filters by a tag menu instead of a pill cloud', () => {
    const page = read('hymns.html');
    const filterAt = page.indexOf('<div class="hymn-tag-filter"');
    const cloudAt = page.indexOf('<div class="hymn-tag-cloud');
    assert.ok(filterAt !== -1, 'phone tag menu');
    assert.ok(cloudAt !== -1, 'desktop tag cloud');
    const filter = page.slice(filterAt, cloudAt);
    const cloud = page.slice(cloudAt, page.indexOf('filteredHymns.length', cloudAt));
    assert.match(filter, /aria-label="Filter by tag"/);
    assert.match(filter, /<select/);
    assert.match(filter, /tagChoices/);
    assert.match(filter, /chooseTag/);
    assert.match(filter, /x-for="tag in selectedTags"/);
    assert.match(cloud, /x-for="tag in allTags"/);
    assert.match(cloud, /toggleTag\(tag\)/);
    assert.match(page, /Search by title, writer, attribution, or tag/);
    assert.match(page, /html\.shell-mobile \.hymn-tag-cloud/);
    assert.match(page, /max-width:\s*767px/);
    assert.match(page, /\.hymn-tag-cloud\s*\{[^}]*display:\s*none\s*!important/);
    assert.match(page, /\.hymn-tag-filter\s*\{[^}]*display:\s*flex/);
});

test('the computer has one Hymns page and the old doors open it', () => {
    const page = read('hymns.html');
    const js = read('hymns.js');
    assert.match(page, /<title>Hymns/);
    assert.match(page, /hymn-versions\.js/);
    assert.match(page, /hymns-page\.js/);
    assert.match(js, /canEditHymnBook/);
    assert.doesNotMatch(js, /canReadEditor/);
    assert.match(page, /x-show="canEdit"/);
    assert.match(page, />Crop</);
    assert.match(page, /Print this version/);
    assert.doesNotMatch(page, /group-hover:opacity-0/);
    assert.match(read('hymn-directory.html'), /HymnsPage\.legacyHref/);
    assert.match(read('hymn-details.html'), /HymnsPage\.legacyHref/);
    assert.match(read('manager.html'), /HymnsPage\.legacyHref/);

    const home = read('index.html');
    assert.match(home, /data-card-key="hymn-directory"/);
    assert.match(home, /href="hymns\.html"/);
    assert.match(home, />Hymns</);
    assert.doesNotMatch(home, /Hymn Directory/);
    assert.doesNotMatch(home, /hymn-manager-card/);
    assert.doesNotMatch(home, /Hymn Manager/);
    assert.match(read('service-builder.html'), /hymns\.html\?new=1&name=/);
    assert.doesNotMatch(read('service-builder.html'), /manager\.html\?name=/);
});

test('opening a hymn from the list keeps that hymn, including an older sheet page', () => {
    const page = read('hymns.html');
    // The open hymn is `hymn`. A row of the same name makes Alpine write
    // the click onto the row, and the detail is blank on the phone and the desktop.
    assert.doesNotMatch(page, /x-for="hymn in filteredHymns"/);
    assert.match(page, /x-for="listedHymn in filteredHymns"/);
    assert.match(page, /showHymn\(listedHymn\)/);
    assert.match(page, /x-text="listedHymn\.hymn_name"/);
    assert.match(page, /x-text="headerTitle"/);
    assert.deepEqual(HymnsPage.sheetPages({
        name: 'SATB',
        pages: [{ url: 'sheet.png' }, 'plain.png', { src: 'legacy.png' }, ''],
    }), ['sheet.png', 'plain.png', 'legacy.png']);
});

test('the phone shell names the open hymn and carries the one way back', () => {
    const page = read('hymns.html');
    const js = read('hymns.js');
    const shell = read('mobile-shell-header.js');

    assert.match(js, /setMobileHeaderTitle/);

    // The bar's own button, handed to the page while a hymn or the form is
    // open and handed back on the list — not a second chevron in the content.
    assert.match(shell, /window\.setMobileHeaderBack = function/);
    assert.match(js, /setMobileHeaderBack\(/);
    assert.match(js, /this\.view === 'list' \? null : \(\) => this\.leaveView\(\)/);
    assert.match(js, /\$watch\('view'/);

    // ⚠ The content's own back went WITH that. Two controls saying the same
    // thing is what MS-674 found on the phone, and the one in the content is
    // the one nobody looks for.
    assert.doesNotMatch(page, /hymn-shell-back/);
});

test('a phone hymn gets the width of the phone', () => {
    const page = read('hymns.html');

    // 16 on a phone, the page margin from `md` up — the same responsive gutter
    // the other shell pages use. A flat 32 spent a sixth of a 390px screen on
    // empty parchment.
    assert.match(page, /<main class="[^"]*\bpx-4 md:px-margin\b/);
    assert.doesNotMatch(page, /<main class="[^"]* px-margin /);
    assert.match(page, /html\.shell-mobile main \{ padding-left: 1rem; padding-right: 1rem; \}/);

    // The boxes between the gutter and the staves. The version card keeps a
    // smaller padding; the frame around the sheet page goes, because the sheet
    // already has a border of its own.
    assert.match(page, /class="hymn-version /);
    assert.match(page, /class="hymn-sheet /);
    assert.match(page, /\.hymn-version \{ padding: var\(--space-sm\); \}/);
    assert.match(page, /\.hymn-sheet \{ border: 0; padding: 0; \}/);
});

test('a confirmation is said at the foot and goes away', () => {
    const page = read('hymns.html');
    const js = read('hymns.js');

    // ⚠ "Attribution copied." used to be a bare grey line at the TOP of `main`,
    // and nothing ever cleared it. On the phone it sat under the shell's title
    // reading like the hymn's own subtitle for the rest of the visit, and shoved
    // the hymn down to make room (MS-674). It is the app's Toast now, which is
    // what every other page already says this sort of thing with.
    assert.doesNotMatch(page, /x-show="notice" x-text="notice"/);
    assert.match(page, /class="m-toast/);
    assert.match(page, /noticeIsBad \? 'm-toast--error' : ''/);
    assert.match(page, /role="status"/);

    // Said, not written down: every one of them goes through say/warn, which
    // starts the timer that takes it away again.
    assert.doesNotMatch(js, /this\.notice = '[^']/);
    assert.match(js, /this\.say\('Attribution copied\.'\)/);
    assert.match(js, /this\.warn\('Could not copy the attribution\.'\)/);
    assert.match(js, /setTimeout\(\(\) => \{ this\.notice = ''; \}/);

    // A Toast is fixed to the viewport, so the shell's body padding cannot lift
    // it off the home indicator.
    assert.match(read('mobile-shell.css'), /html\.shell-mobile \.m-toast \{/);
});

test('hushing the toast takes the words away instead of calling itself', () => {
    // ⚠ THE BUG MS-675 WAS. `hush()` was written `this.hush()`, so it recursed
    // until the stack blew. It looks like nothing on its own — nobody taps
    // "hush" — but startEdit() and startCreate() hush the toast on their way to
    // the form, and the throw took the whole journey with it.
    const page = hymnsComponent();
    page.say('Attribution copied.');
    assert.equal(page.notice, 'Attribution copied.');

    page.hush();
    assert.equal(page.notice, '');
    assert.equal(page.noticeIsBad, false);

    // Said badly, then hushed: the error styling goes with the words.
    page.warn('Could not copy the attribution.');
    assert.equal(page.noticeIsBad, true);
    page.hush();
    assert.equal(page.noticeIsBad, false);
});

test('Edit on an open hymn opens the editor for that hymn', () => {
    // ⚠ The whole of MS-675: tapping Edit on the hymn did NOTHING. No editor,
    // no navigation, no error — the draft was built and then `view` was never
    // set, so the detail just sat there. Phone and desktop both; there is one
    // control path and this is it.
    const page = hymnsComponent();
    page.canEdit = true;

    page.showHymn(A_HYMN);
    assert.equal(page.view, 'hymn');
    assert.equal(page.headerTitle, A_HYMN.hymn_name);

    // A toast can be on screen when Edit is tapped — that is the state the bug
    // needed, because Edit hushes it on the way out.
    page.say('Attribution copied.');
    page.startEdit(page.hymn);

    assert.equal(page.view, 'form', 'Edit left the hymn detail on screen');
    assert.equal(page.creating, false);
    assert.ok(page.form, 'Edit switched the view with no draft to show');
    assert.equal(page.form.hymn_name, A_HYMN.hymn_name, 'the editor opened on the wrong hymn');
    assert.equal(page.form.lyrics_writer, A_HYMN.lyrics_writer);
    assert.equal(page.form.versions.length, 1);
    assert.equal(page.headerTitle, 'Edit hymn');
    assert.equal(page.notice, '');

    // Cancel goes back to the hymn it was editing, not out to the list.
    page.cancelForm();
    assert.equal(page.view, 'hymn');
    assert.equal(page.hymn.id, A_HYMN.id);
});

test('Add hymn opens an empty editor, and a reader is offered neither', () => {
    // startCreate() hushed the toast on the same line as startEdit(), so it went
    // down with it.
    const page = hymnsComponent();
    page.canEdit = true;
    page.startCreate('Thine Be the Glory');
    assert.equal(page.view, 'form');
    assert.equal(page.creating, true);
    assert.equal(page.form.hymn_name, 'Thine Be the Glory');
    assert.equal(page.headerTitle, 'New hymn');

    // The role gate is the one MS-674 and MS-675 must not have loosened: a
    // reader never reaches the form, whichever door is knocked on.
    const reader = hymnsComponent();
    reader.canEdit = false;
    reader.showHymn(A_HYMN);
    reader.startEdit(reader.hymn);
    assert.equal(reader.view, 'hymn', 'a reader was let into the editor');
    assert.equal(reader.form, null);
    reader.startCreate('Anything');
    assert.equal(reader.view, 'hymn');
    assert.equal(reader.form, null);
});

test('a link straight to the editor opens it rather than apologising', () => {
    // hymns.html?edit=<id> reaches startEdit() through applyOpenState(), which
    // init() runs inside a promise chain — so the same throw came back out as
    // "Could not open the hymn book." on a link that was perfectly good.
    const page = hymnsComponent('?edit=' + A_HYMN.id);
    page.canEdit = true;
    page.hymns = [A_HYMN];
    page.applyOpenState();
    assert.equal(page.view, 'form');
    assert.equal(page.creating, false);
    assert.equal(page.form.hymn_name, A_HYMN.hymn_name);

    // ?new=1 is the other door into the same form.
    const fresh = hymnsComponent('?new=1&name=Thine+Be+the+Glory');
    fresh.canEdit = true;
    fresh.hymns = [];
    fresh.applyOpenState();
    assert.equal(fresh.view, 'form');
    assert.equal(fresh.creating, true);
    assert.equal(fresh.form.hymn_name, 'Thine Be the Glory');

    // And a reader following an edit link lands on the list, as before.
    const reader = hymnsComponent('?edit=' + A_HYMN.id);
    reader.canEdit = false;
    reader.hymns = [A_HYMN];
    reader.applyOpenState();
    assert.equal(reader.view, 'list');
    assert.equal(reader.form, null);
});

test('a button under 640px still says what it does', () => {
    // ⚠ WHAT THIS EXISTS TO STOP COMING BACK (MS-674). `.m-btn__label` and
    // `.m-back__label` are slots any Button or BackLink carries, anywhere on
    // the page. The header's phone metrics hid them bare inside
    // `@media (max-width: 640px)`, so every button in the document under that
    // width lost its word — the hymn's Copy attribution, Edit, Delete and
    // Download all drew as blank tan pills with nothing in them at all.
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'mosaic.css'), 'utf8');
    const phone = css.match(/@media \(max-width:640px\)\{\.m-header\{.*?\}\}/s);
    assert.ok(phone, 'the phone header block is gone from mosaic.css');

    const block = phone[0];
    assert.ok(/\.m-header \.m-btn__label/.test(block),
        'the phone header no longer hides its own button labels');
    assert.ok(!/(^|[,{])\s*\.m-btn__label/.test(block),
        'the phone header hides EVERY button label on the page again');
    assert.ok(!/(^|[,{])\s*\.m-back__label/.test(block),
        'the phone header hides EVERY back label on the page again');
    assert.ok(!/(^|[,{])\s*\.m-back[,{ ]/.test(block),
        'the phone header squares up every BackLink on the page again');
});

test('the phone opens the Hymns page and keeps the stored home key', () => {
    const destinations = require('../public/mobile/destinations.js');
    const hymn = destinations.DESTINATIONS.find((item) => item.key === 'hymn-directory');
    assert.equal(hymn.label, 'Hymns');
    assert.equal(hymn.route, 'hymnDirectory');
    assert.equal(destinations.SHELL_PAGES.hymnDirectory, 'hymns.html');
    assert.equal(destinations.routeHref('hymnDirectory'), 'hymns.html?shell=mobile');

    const app = read('mobile/app.js');
    const screens = read('mobile/screens-content.js');
    assert.match(app, /label: "Hymns", route: "hymnDirectory"/);
    assert.doesNotMatch(app, /Hymn Directory/);
    assert.match(app, /if \(route === "hymnManager"\) \{\s*\n\s*if \(data\.forget\) data\.forget\("hymns"\);/);
    assert.match(app, /HymnsPage\.phoneShellHref/);
    assert.doesNotMatch(app, /manager\.html/);
    assert.match(app, /redirectOldHymnRoute/);
    assert.doesNotMatch(screens, /HymnDirectoryScreen/);
    assert.doesNotMatch(screens, /HymnDetailsScreen/);
    assert.doesNotMatch(screens, /Hymn Directory/);
    assert.match(read('mobile.html'), /hymns-page\.js/);
    assert.match(read('index.html'), /data-card-key="hymn-directory"/);
});
