// MS-262 — the rules for a guidance file: the written instructions an
// assistant pulls down through the MCP.
//
// ⚠ THE SLUG IS AN ADDRESS, AND ADDRESSES ARE PROMISES. It is what the
// resource URI is built from, so an assistant told to read
// `oos://guidance/hymn-selection` is naming a slug, not a title. Renaming a
// title is free; moving a slug silently breaks whatever named the old one.
// That is why the page locks it once a file exists, and why these tests care
// so much about a shape that looks cosmetic.

const {test} = require('node:test');
const assert = require('node:assert');

const Core = require('../public/mcp-guidance-core.js');

// ── Slugs ────────────────────────────────────────────────────────────────

test('a title becomes a readable address', () => {
    assert.strictEqual(Core.slugify('Choosing Hymns'), 'choosing-hymns');
    assert.strictEqual(Core.slugify('Themes & Repetition'), 'themes-repetition');
    assert.strictEqual(Core.slugify('  Spaced  Out  '), 'spaced-out');
});

test('an address never ends up with stray or doubled hyphens', () => {
    ['--leading', 'trailing--', 'a  b', '!!!weird!!!'].forEach((input) => {
        const slug = Core.slugify(input);
        assert.ok(!/^-|-$|--/.test(slug), `${input} -> ${slug}`);
    });
});

test('an address that would need escaping in a URI is refused', () => {
    ['Has Spaces', 'UPPER', 'has/slash', 'has?query', 'has#hash', 'trailing-',
        '-leading', 'double--hyphen', ''].forEach((slug) => {
        assert.strictEqual(Core.isValidSlug(slug), false, slug);
    });
});

test('an ordinary address is accepted', () => {
    ['hymn-selection', 'themes', 'a1', 'notes-house-style'].forEach((slug) => {
        assert.strictEqual(Core.isValidSlug(slug), true, slug);
    });
});

test('a title of nothing but punctuation produces no address, rather than a bad one', () => {
    // The page must then refuse to save, which validate() below enforces —
    // better than inventing an address nobody chose.
    assert.strictEqual(Core.slugify('!!!'), '');
    assert.strictEqual(Core.isValidSlug(Core.slugify('!!!')), false);
});

// ── URIs ─────────────────────────────────────────────────────────────────

test('a URI is built from the address, and reads back to the same address', () => {
    const uri = Core.uriFor('hymn-selection');
    assert.strictEqual(uri, 'oos://guidance/hymn-selection');
    assert.strictEqual(Core.slugFromUri(uri), 'hymn-selection');
});

test('⚠ a URI that is not ours reads back as nothing, not as a guess', () => {
    // Answering for someone else's URI would be inventing a guidance file.
    ['https://example.com/guidance/x', 'oos://services/2026-08-17',
        'oos://guidance/', 'oos://guidance/Bad Slug', 'nonsense',
        ''].forEach((uri) => {
        assert.strictEqual(Core.slugFromUri(uri), null, uri);
    });
});

test('the scheme is not http, so no client can fetch one directly', () => {
    // A guidance file is served through the MCP, behind its access checks.
    // An http: URI would invite a client to go round them.
    assert.ok(!/^https?:/.test(Core.uriFor('anything')));
});

// ── Validation ───────────────────────────────────────────────────────────

const good = {
    title: 'Choosing hymns',
    slug: 'hymn-selection',
    summary: 'How we pick hymns for a Sunday.',
    body: 'Prefer something not sung in the last eight weeks.',
    enabled: true,
};

test('a complete file has nothing wrong with it', () => {
    assert.deepStrictEqual(Core.validate(good), []);
});

test('every missing piece is reported, in words an editor can act on', () => {
    const problems = Core.validate({});
    assert.strictEqual(problems.length, 4, problems.join(' | '));
    problems.forEach((p) => {
        assert.ok(/^[A-Z]/.test(p), `not a sentence: ${p}`);
        assert.ok(!/undefined|null|\[object/.test(p), `leaks internals: ${p}`);
    });
});

test('a file with no summary is refused, because that is how the assistant chooses', () => {
    const problems = Core.validate(Object.assign({}, good, {summary: ''}));
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0], /summary/i);
});

test('an empty file is refused rather than published as blank guidance', () => {
    const problems = Core.validate(Object.assign({}, good, {body: '   '}));
    assert.match(problems.join(' '), /empty/i);
});

test('an over-long file is told to split, not to trim', () => {
    const problems = Core.validate(
        Object.assign({}, good, {body: 'x'.repeat(Core.MAX_BODY + 1)}));
    assert.match(problems.join(' '), /split it into two/i);
});

test('a bad address is refused with an example rather than a rule', () => {
    const problems = Core.validate(Object.assign({}, good, {slug: 'Bad Slug'}));
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0], /hymn-selection/);
});

// ── Normalising ──────────────────────────────────────────────────────────

test('saving trims the edges but leaves the writing alone', () => {
    const clean = Core.normalize({
        title: '  Choosing hymns  ',
        slug: 'hymn-selection',
        summary: '  How we pick.  ',
        body: '  Line one\n\nLine two  ',
        enabled: true,
    });
    assert.strictEqual(clean.title, 'Choosing hymns');
    assert.strictEqual(clean.summary, 'How we pick.');
    assert.strictEqual(clean.body, 'Line one\n\nLine two',
        'the blank line inside the writing must survive');
});

test('enabled defaults to on, and only an explicit false turns it off', () => {
    assert.strictEqual(Core.normalize({}).enabled, true);
    assert.strictEqual(Core.normalize({enabled: undefined}).enabled, true);
    assert.strictEqual(Core.normalize({enabled: false}).enabled, false);
});

// ── Versioning: what the history trigger decides ─────────────────────────
//
// ⚠ THIS IS WHAT KEEPS THE HISTORY WORTH READING. A save that changed no
// words still writes the document, and filing a version for every write
// would bury three real edits under two hundred identical ones — which is
// the same as having no history at all.

test('identical content files no new version', () => {
    const a = {title: 'T', slug: 's', summary: 'x', body: 'b', enabled: true};
    assert.strictEqual(Core.sameContent(a, Object.assign({}, a)), true);
});

test('a change to any versioned field is a change', () => {
    const base = {title: 'T', slug: 's', summary: 'x', body: 'b', enabled: true};
    Core.VERSIONED_FIELDS.forEach((field) => {
        const changed = Object.assign({}, base);
        changed[field] = field === 'enabled' ? false : 'different';
        assert.strictEqual(Core.sameContent(base, changed), false, field);
    });
});

test('a moved timestamp alone is not a change', () => {
    // The exact case: saving without editing anything.
    const a = {title: 'T', slug: 's', summary: 'x', body: 'b', enabled: true,
        updatedAt: 1, updatedByName: 'Alice'};
    const b = {title: 'T', slug: 's', summary: 'x', body: 'b', enabled: true,
        updatedAt: 2, updatedByName: 'Bob'};
    assert.strictEqual(Core.sameContent(a, b), true);
});

test('a first write has nothing to compare against, so it always files', () => {
    assert.strictEqual(Core.sameContent(null, {title: 'T'}), false);
});

test('enabled compares as a real toggle, not as whatever was stored', () => {
    const on = {enabled: true}, missing = {}, off = {enabled: false};
    assert.strictEqual(Core.sameContent(on, missing), true, 'absent means on');
    assert.strictEqual(Core.sameContent(on, off), false);
});

test('a snapshot captures every versioned field and nothing else', () => {
    const snap = Core.snapshotOf({
        title: 'T', slug: 's', summary: 'x', body: 'b', enabled: true,
        updatedByUid: 'uid-1', secret: 'should not travel',
    });
    assert.deepStrictEqual(Object.keys(snap).sort(),
        Core.VERSIONED_FIELDS.slice().sort());
    assert.strictEqual(snap.secret, undefined);
});

test('a snapshot round-trips, so restoring returns exactly what was filed', () => {
    const original = {title: 'T', slug: 's', summary: 'x', body: 'b\n\nc',
        enabled: false};
    const snap = Core.snapshotOf(original);
    assert.strictEqual(Core.sameContent(snap, original), true);
});

test('the sources are the three doors a change can come through', () => {
    assert.deepStrictEqual(Core.SOURCES.slice().sort(),
        ['assistant', 'page', 'restore']);
});
