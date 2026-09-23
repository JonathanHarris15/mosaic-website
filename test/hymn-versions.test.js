const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HymnVersions = require('../public/hymn-versions.js');

function hymn(versions) {
    return { hymn_name: 'Amazing Grace', versions: versions };
}

test('a hymn nobody has starred prints its first version', () => {
    const pages = HymnVersions.defaultPages(hymn([
        { name: 'Traditional', pages: ['trad-1.png', 'trad-2.png'] },
        { name: 'New tune', pages: ['new.png'] },
    ]));
    assert.deepEqual(pages, ['trad-1.png', 'trad-2.png']);
});

test('a starred later version prints, and the list stays in the order it was arranged', () => {
    const versions = [
        { name: 'Traditional', pages: ['trad.png'] },
        { name: 'New tune', pages: ['new.png'] },
    ];
    const starred = HymnVersions.star(versions, 1);
    assert.deepEqual(starred.map(v => v.name), ['Traditional', 'New tune']);
    assert.equal(starred[0].default, undefined);
    assert.equal(starred[1].default, true);
    assert.equal(versions[1].default, undefined, 'starring does not rewrite the list it was given');
    assert.deepEqual(HymnVersions.defaultPages(hymn(starred)), ['new.png']);
});

test('a hymn with no versions prints no pages', () => {
    assert.equal(HymnVersions.defaultVersion(hymn([])), null);
    assert.deepEqual(HymnVersions.defaultPages(hymn([])), []);
    assert.deepEqual(HymnVersions.defaultPages(null), []);
    assert.deepEqual(HymnVersions.defaultPages({}), []);
});

test('the first version of a new hymn is the default, and one added later is not', () => {
    const first = HymnVersions.addVersion([], { name: 'Traditional', pages: ['trad.png'] });
    assert.equal(first[0].default, true);
    const second = HymnVersions.addVersion(first, { name: 'New tune', pages: ['new.png'] });
    assert.deepEqual(second.map(v => v.name), ['Traditional', 'New tune']);
    assert.equal(second[0].default, true);
    assert.equal(second[1].default, undefined);
    assert.deepEqual(HymnVersions.defaultPages(hymn(second)), ['trad.png']);
});

test('deleting the default makes the following version the default', () => {
    const versions = HymnVersions.star([
        { name: 'Traditional', pages: ['trad.png'] },
        { name: 'New tune', pages: ['new.png'] },
        { name: 'Descant', pages: ['descant.png'] },
    ], 1);
    const next = HymnVersions.removeVersion(versions, 1);
    assert.deepEqual(next.map(v => v.name), ['Traditional', 'Descant']);
    assert.equal(next[1].name, 'Descant');
    assert.equal(next[1].default, true);
    assert.equal(next[0].default, undefined);
});

test('deleting the last version, when it was the default, leaves the first of what remains', () => {
    const versions = HymnVersions.star([
        { name: 'Traditional', pages: ['trad.png'] },
        { name: 'New tune', pages: ['new.png'] },
    ], 1);
    const next = HymnVersions.removeVersion(versions, 1);
    assert.equal(next.length, 1);
    assert.equal(next[0].name, 'Traditional');
    assert.equal(next[0].default, true);
});

test('deleting the only version leaves a hymn that prints nothing', () => {
    const only = HymnVersions.addVersion([], { name: 'Traditional', pages: ['trad.png'] });
    assert.deepEqual(HymnVersions.removeVersion(only, 0), []);
});

test('removing a version that does not print leaves the star where it was', () => {
    const versions = HymnVersions.star([
        { name: 'Traditional', pages: ['trad.png'] },
        { name: 'New tune', pages: ['new.png'] },
    ], 1);
    const next = HymnVersions.removeVersion(versions, 0);
    assert.deepEqual(next.map(v => v.name), ['New tune']);
    assert.equal(next[0].default, true);
});

test('saving a hymn that was never starred marks its first version and does not reorder', () => {
    const marked = HymnVersions.ensureDefault([
        { name: 'Traditional', pages: ['trad.png'] },
        { name: 'New tune', pages: ['new.png'] },
    ]);
    assert.deepEqual(marked.map(v => v.name), ['Traditional', 'New tune']);
    assert.equal(marked[0].default, true);
    assert.equal(marked[1].default, undefined);
    const already = HymnVersions.ensureDefault(HymnVersions.star(marked, 1));
    assert.equal(already[1].default, true);
    assert.equal(already[0].default, undefined);
});

test('a blank page slot is not a page that prints', () => {
    const pages = HymnVersions.defaultPages({
        versions: [{ name: 'Only', default: true, pages: ['a.png', '', '  ', null, { url: 'b.png' }] }],
    });
    assert.deepEqual(pages, ['a.png', 'b.png']);
    assert.deepEqual(HymnVersions.defaultPages({ versions: [{ pages: ['', null] }] }), []);
});

test('every reader that prints a hymn asks this rule and not the first version', () => {
    const readers = [
        'public/printable-data-core.js',
        'public/guide-store.js',
        'public/service-guide.js',
        'public/service-builder.js',
        'scripts/export-service-guide.js',
    ];
    readers.forEach(file => {
        const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(src, /HymnVersions\.defaultPages/, file + ' still chooses a version on its own');
        assert.doesNotMatch(src, /versions(?:\?\.|\.)\[0\]/, file + ' still prints the first version');
    });
});
