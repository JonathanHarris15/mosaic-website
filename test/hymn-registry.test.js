// MS-245 — one way of searching the hymn index.
//
// Two surfaces pick hymns now: the Order of Service editor and the Planning
// view on the Service Calendar. They must offer the same five hymns for the
// same typing, or somebody ends up insisting a hymn is missing on one screen
// and present on the other, and nobody can reproduce it.
//
// The ranking rule worth pinning is that an exact id match goes first. People
// type "H128" as often as they type a title, and fuzzy search on its own
// buries the hymn actually called H128 under every title containing those
// letters.

const { test } = require('node:test');
const assert = require('node:assert');

const HymnRegistry = require('../public/hymn-registry.js');

const HYMNS = [
    { id: 'H12',  hymn_name: 'Holy Holy Holy' },
    { id: 'H128', hymn_name: 'It Is Well' },
    { id: 'H45',  hymn_name: 'Come Thou Fount' },
    { id: 'H77',  hymn_name: 'Be Thou My Vision' },
    { id: 'H90',  hymn_name: 'Abide With Me' },
    { id: 'H91',  hymn_name: 'Rock of Ages' },
];

// A Fuse stand-in: substring match, in list order. Enough to test the ranking
// rules that wrap it, which is what this file is about.
function fakeFuse(hymns) {
    return {
        search(q) {
            const needle = q.toLowerCase();
            const has = (v) => typeof v === 'string' && v.toLowerCase().includes(needle);
            return hymns
                .filter(h => has(h.hymn_name) || has(h.id))
                .map(item => ({ item }));
        }
    };
}

function index(hymns = HYMNS) {
    return { hymns, fuse: fakeFuse(hymns) };
}

// ── Ranking ────────────────────────────────────────────────────────────────

test('an exact hymn number comes first', () => {
    const results = HymnRegistry.search(index(), 'H128');
    assert.strictEqual(results[0].id, 'H128');
    assert.strictEqual(results[0].hymn_name, 'It Is Well');
});

test('the exact match is not then repeated below itself', () => {
    const results = HymnRegistry.search(index(), 'H12');
    const ids = results.map(r => r.id);
    assert.strictEqual(ids.filter(id => id === 'H12').length, 1);
    assert.strictEqual(ids[0], 'H12', 'and it still leads');
});

test('a hymn number typed in lower case still matches exactly', () => {
    assert.strictEqual(HymnRegistry.search(index(), 'h128')[0].id, 'H128');
});

test('typing a title searches titles', () => {
    const results = HymnRegistry.search(index(), 'Fount');
    assert.strictEqual(results[0].hymn_name, 'Come Thou Fount');
});

test('an empty box offers a starting handful rather than nothing', () => {
    // The picker opens before anything is typed; an empty list reads as a
    // broken screen rather than an invitation.
    assert.strictEqual(HymnRegistry.search(index(), '').length, 5);
    assert.strictEqual(HymnRegistry.search(index(), '   ').length, 5);
});

test('the list is capped so the dropdown cannot run off the page', () => {
    assert.strictEqual(HymnRegistry.search(index(), 'H').length, 5);
    assert.strictEqual(HymnRegistry.search(index(), 'H', 2).length, 2);
});

test('with no index built, nothing is offered rather than a crash', () => {
    assert.deepStrictEqual(HymnRegistry.search({ hymns: HYMNS, fuse: null }, 'Holy'), []);
    assert.deepStrictEqual(HymnRegistry.search(null, 'Holy'), []);
});

test('a hymn with no id does not break an exact-match search', () => {
    const odd = [{ hymn_name: 'Nameless' }, ...HYMNS];
    assert.doesNotThrow(() => HymnRegistry.search(index(odd), 'h12'));
});

// ── Loading ────────────────────────────────────────────────────────────────

function FuseStub(items) { this.items = items; this.search = () => []; }

test('the prepared index is used when the callable answers', async () => {
    const out = await HymnRegistry.load({
        getHymnIndex: async () => ({ data: HYMNS }),
        db: null,
        Fuse: FuseStub,
    });

    assert.strictEqual(out.hymns.length, 6);
    assert.ok(out.fuse, 'an index should be built');
});

test('a failed callable falls back to the collection rather than giving up', () => {
    // A hymn picker that cannot offer hymns is a dead screen, so the fallback
    // matters more than it looks.
    return HymnRegistry.load({
        getHymnIndex: async () => { throw new Error('unavailable'); },
        db: {
            collection: () => ({
                get: async () => ({
                    docs: [{ id: 'H12', data: () => ({ hymn_name: 'Holy Holy Holy', versions: [1, 2] }) }]
                })
            })
        },
        Fuse: FuseStub,
    }).then(out => {
        assert.strictEqual(out.hymns.length, 1);
        assert.strictEqual(out.hymns[0].hymn_name, 'Holy Holy Holy');
        assert.strictEqual(out.hymns[0].variations, 2);
    });
});

test('both sources failing leaves an empty index, not an exception', async () => {
    const out = await HymnRegistry.load({
        getHymnIndex: async () => { throw new Error('unavailable'); },
        db: { collection: () => ({ get: async () => { throw new Error('denied'); } }) },
        Fuse: FuseStub,
    });

    assert.deepStrictEqual(out.hymns, []);
    assert.strictEqual(out.fuse, null);
});

test('a hymn document missing its fields still reads as a hymn', () => {
    const h = HymnRegistry.fromDoc('H5', {});
    assert.strictEqual(h.id, 'H5');
    assert.strictEqual(h.hymn_name, 'Unknown');
    assert.strictEqual(h.variations, 0);
    assert.deepStrictEqual(h.tags, []);
});
