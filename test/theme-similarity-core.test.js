const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/theme-similarity-core.js');

// docs/plans/theme-similarity.md Phase 1. Fixture vectors are hand-built, not
// real embeddings — small enough to reason about by hand, shaped to exercise
// the two traps the plan names: raw cosine ranking on the wrong axis, and
// uniqueness crammed into a narrow band if calibrated against the wrong
// distribution.

// ── Vector basics ────────────────────────────────────────────────────────

test('cosine of identical vectors is 1', () => {
    assert.ok(Math.abs(Core.cosine([3, 4], [3, 4]) - 1) < 1e-9);
});

test('cosine of orthogonal vectors is 0', () => {
    assert.strictEqual(Core.cosine([1, 0], [0, 1]), 0);
});

test('unit() produces a vector of length 1, and does not divide by zero', () => {
    const u = Core.unit([3, 4]);
    assert.ok(Math.abs(Core.norm(u) - 1) < 1e-9);
    assert.deepStrictEqual(Core.unit([0, 0]), [0, 0]);
});

// ── Centering changes the ranking (Trap 1) ──────────────────────────────
//
// A, B share a dominant axis (like every Mosaic theme sharing "about God")
// plus a small lean in a second axis. C shares much less of that dominant
// axis but leans hard on a third axis the candidate also leans on. Raw
// cosine — dominated by the shared axis — ranks A above C. Centering
// removes the shared axis and correctly puts C first.

const DOMINANT_AXIS_CORPUS = [
    { text: 'A', dates: ['2020-01-01'], vector: [10, 1, 0] },
    { text: 'B', dates: ['2020-02-01'], vector: [10, -1, 0] },
    { text: 'C', dates: ['2020-03-01'], vector: [1, 0, 3] },
];
const DOMINANT_AXIS_CANDIDATE = [10, 0.02, 5];

test('raw cosine ranks on the shared axis, not the topical one', () => {
    const byRawCosine = DOMINANT_AXIS_CORPUS
        .map(t => ({ text: t.text, sim: Core.cosine(DOMINANT_AXIS_CANDIDATE, t.vector) }))
        .sort((a, b) => b.sim - a.sim);
    assert.strictEqual(byRawCosine[0].text, 'A',
        'the fixture should demonstrate the trap: raw cosine prefers A');
});

test('centering flips the ranking to the topically closer theme', () => {
    const { matches } = Core.scoreCandidate(DOMINANT_AXIS_CANDIDATE, DOMINANT_AXIS_CORPUS);
    assert.strictEqual(matches[0].text, 'C',
        'once the shared axis is removed, C is the actual nearest match');
    assert.ok(matches[0].similarity > matches[1].similarity);
});

// ── <10 themes: no uniqueness ────────────────────────────────────────────

test('fewer than 10 distinct themes returns uniqueness: null, not a misleading number', () => {
    const { uniqueness } = Core.scoreCandidate(DOMINANT_AXIS_CANDIDATE, DOMINANT_AXIS_CORPUS);
    assert.strictEqual(DOMINANT_AXIS_CORPUS.length < Core.MIN_CORPUS_FOR_UNIQUENESS, true);
    assert.strictEqual(uniqueness, null);
});

test('empty corpus does not throw, and reports nothing', () => {
    assert.deepStrictEqual(Core.scoreCandidate([1, 2, 3], []), { uniqueness: null, matches: [] });
    assert.deepStrictEqual(Core.scoreCandidate([1, 2, 3], null), { uniqueness: null, matches: [] });
});

// ── Identical text scores ~1.0 ───────────────────────────────────────────

test('a candidate identical to a corpus theme scores essentially 1.0 against it', () => {
    const corpus = [
        { text: 'Exact Match', dates: ['2021-06-01'], vector: [4, -2, 7] },
        { text: 'Something Else', dates: ['2021-07-01'], vector: [1, 9, -3] },
    ];
    const { matches } = Core.scoreCandidate([4, -2, 7], corpus);
    assert.strictEqual(matches[0].text, 'Exact Match');
    assert.ok(matches[0].similarity > 0.999999, matches[0].similarity);
});

// ── Percentile calibration spans the full range (Trap 2) ────────────────
//
// Nine near-duplicate vectors (a well-worn theme, repeated with tiny jitter)
// plus one genuine outlier. A candidate like the well-worn cluster should
// read as unoriginal; a candidate like nothing in the corpus should read as
// highly unique. If calibration were done against all-pairs similarity
// instead of each theme's own top-3, both would land in a narrow high band
// — this is the exact failure the plan's Trap 2 describes.

function basisVector(dims, axis) {
    const v = new Array(dims).fill(0);
    v[axis] = 10;
    return v;
}
function jitter(v, seed) {
    return v.map((x, i) => x + (((seed * 7 + i * 13) % 5) - 2) * 0.05);
}

const WELL_WORN_DIMS = 6;
const WELL_WORN_CORPUS = [
    ...Array.from({ length: 9 }, (_, seed) => ({
        text: 'Well-worn theme ' + seed,
        dates: ['2020-0' + (1 + (seed % 9)) + '-01'],
        vector: jitter(basisVector(WELL_WORN_DIMS, 0), seed),
    })),
    { text: 'The One Outlier', dates: ['2022-05-01'], vector: basisVector(WELL_WORN_DIMS, 3) },
];

test('a theme like the well-worn cluster scores low uniqueness', () => {
    const candidate = jitter(basisVector(WELL_WORN_DIMS, 0), 20);
    const { uniqueness } = Core.scoreCandidate(candidate, WELL_WORN_CORPUS);
    assert.ok(uniqueness <= 20, `expected low uniqueness, got ${uniqueness}`);
});

test('a theme unlike anything in the corpus scores high uniqueness', () => {
    const candidate = basisVector(WELL_WORN_DIMS, 4); // a direction nothing in the corpus leans on
    const { uniqueness } = Core.scoreCandidate(candidate, WELL_WORN_CORPUS);
    assert.ok(uniqueness >= 80, `expected high uniqueness, got ${uniqueness}`);
});

test('uniqueness spans a wide range across this corpus, not a narrow band', () => {
    const wornScore = Core.scoreCandidate(jitter(basisVector(WELL_WORN_DIMS, 0), 20), WELL_WORN_CORPUS).uniqueness;
    const outlierScore = Core.scoreCandidate(basisVector(WELL_WORN_DIMS, 4), WELL_WORN_CORPUS).uniqueness;
    assert.ok(outlierScore - wornScore >= 60,
        `expected a wide spread, got ${wornScore} vs ${outlierScore}`);
});

// ── Normalization ─────────────────────────────────────────────────────────

test('normalizeThemeText straightens smart quotes, collapses whitespace, trims trailing punctuation', () => {
    assert.strictEqual(
        Core.normalizeThemeText('  The  God’s  “Mercy”.,;: '),
        'The God\'s "Mercy"');
});

test('themeKey lowercases the normalized text, so casing does not split one theme in two', () => {
    assert.strictEqual(Core.themeKey('The God Who Rescues'), 'the god who rescues');
    assert.strictEqual(Core.themeKey('the god who rescues.'), 'the god who rescues');
});

test('themeKey is null for blank text', () => {
    assert.strictEqual(Core.themeKey(''), null);
    assert.strictEqual(Core.themeKey('   '), null);
    assert.strictEqual(Core.themeKey(null), null);
});
