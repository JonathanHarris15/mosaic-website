const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const ratchetP = import(pathToFileURL(path.join(ROOT, 'scripts/quality-ratchet.mjs')).href);

test('tsc counts diagnostic lines and not the summary prose', async () => {
    const ratchet = await ratchetP;
    const output = [
        'public/a.js(1,1): error TS7006: Parameter implicitly has an any type.',
        'public/a.js(2,1): error TS2339: Property x does not exist.',
        'Found 2 errors in the same file.',
    ].join('\n');
    assert.equal(ratchet.tscCount(output), 2);
});

test('eslint counts errors across files', async () => {
    const ratchet = await ratchetP;
    assert.equal(ratchet.eslintCount([
        { errorCount: 2, messages: [] },
        { errorCount: 0, messages: [] },
        { errorCount: 1, messages: [] },
    ]), 3);
});

test('knip sums dead files, exports, deps, and unlisted imports', async () => {
    const ratchet = await ratchetP;
    const counts = ratchet.knipCounts({
        issues: [{
            file: 'public/a.js',
            files: [{ name: 'public/dead.js' }],
            exports: [{ name: 'old' }, { name: 'older' }],
            types: [{ name: 'T' }],
            dependencies: [{ name: 'left-pad' }],
            devDependencies: [{ name: 'jsdoc' }],
            unlisted: [{ name: 'express' }],
            unresolved: [{ name: 'missing' }],
        }],
    });
    assert.deepEqual(counts, {
        knipFiles: 1,
        knipExports: 3,
        knipDependencies: 2,
        knipUnlisted: 2,
    });
});

test('a higher count fails and a lower count is a ceiling to edit down', async () => {
    const ratchet = await ratchetP;
    const baseline = {
        tsc: 10, eslint: 10, knipFiles: 1, knipExports: 1,
        knipDependencies: 1, knipUnlisted: 1,
    };
    const actual = Object.assign({}, baseline, { eslint: 11, knipFiles: 0 });
    const diff = ratchet.compareCounts(actual, baseline);
    assert.deepEqual(diff.raised.map(
        /** @param {{ key: string }} row */ (row) => row.key), ['eslint']);
    assert.deepEqual(diff.lowerable.map(
        /** @param {{ key: string }} row */ (row) => row.key), ['knipFiles']);
});

test('--only knip is the four knip counts', async () => {
    const ratchet = await ratchetP;
    const parsed = ratchet.parseArgs(['--only', 'knip']);
    assert.deepEqual(parsed.keys, [
        'knipFiles', 'knipExports', 'knipDependencies', 'knipUnlisted',
    ]);
});

test('the committed baseline is the ratchet shape', async () => {
    const ratchet = await ratchetP;
    const baseline = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'quality-baseline.json'), 'utf8'));
    for (const key of ratchet.KEYS) {
        assert.equal(Number.isInteger(baseline[key]), true, key);
        assert.ok(baseline[key] >= 0, key);
    }
});

test('PR CI keeps the existing jobs and requires the ratchet', () => {
    const wf = fs.readFileSync(
        path.join(ROOT, '.github', 'workflows', 'pr-ci.yml'), 'utf8');
    for (const name of ['unit:', 'lint:', 'rules-compile:', 'typecheck:', 'lint-correctness:', 'dead-code:']) {
        assert.match(wf, new RegExp(`^  ${name}`, 'm'));
    }
    assert.match(wf, /npm test/);
    assert.match(wf, /npm run lint --prefix functions/);
    assert.match(wf, /npm run check:rules/);
    assert.match(wf, /quality-ratchet\.mjs --only tsc/);
    assert.match(wf, /quality-ratchet\.mjs --only eslint/);
    assert.match(wf, /--only knipFiles/);
    assert.match(wf, /node-version: "22"/);
});

test('functions lint stays on eslintrc when the root flat config exists', () => {
    const pkg = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'functions', 'package.json'), 'utf8'));
    assert.match(pkg.scripts.lint, /ESLINT_USE_FLAT_CONFIG=false eslint \./);
});

