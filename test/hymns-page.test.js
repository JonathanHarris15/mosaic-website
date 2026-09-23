const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HymnsPage = require('../public/hymns-page.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (name) => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

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
