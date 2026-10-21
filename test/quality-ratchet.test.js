const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
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

test('knip counts the per-issue shape and refuses a report with no issues array', async () => {
    const ratchet = await ratchetP;
    assert.throws(
        () => ratchet.knipCounts({ files: [{ name: 'public/dead.js' }] }),
        /issues array/);
});

test('a baseline above the base ref fails even when the new count sits under it', async () => {
    const ratchet = await ratchetP;
    const previous = {
        tsc: 10, eslint: 10, knipFiles: 1, knipExports: 1,
        knipDependencies: 1, knipUnlisted: 1,
    };
    const baseline = Object.assign({}, previous, { tsc: 12 });
    const actual = Object.assign({}, previous, { tsc: 11 });
    const gate = ratchet.gateDecision(actual, baseline, previous);
    assert.equal(gate.ok, false);
    assert.equal(gate.raised.length, 0);
    assert.equal(gate.ceiling.length, 1);
    assert.equal(gate.ceiling[0].key, 'tsc');
    const open = ratchet.gateDecision(previous, previous, null);
    assert.equal(open.ok, true);
});

test('a missing baseline file is absent and a bad ref is an error', async () => {
    const ratchet = await ratchetP;
    assert.equal(ratchet.baselineRefStatus(0, ''), 'ok');
    assert.equal(
        ratchet.baselineRefStatus(128, "fatal: path 'quality-baseline.json' does not exist in 'origin/main'\n"),
        'absent');
    assert.equal(
        ratchet.baselineRefStatus(128, "fatal: path 'quality-baseline.json' exists on disk, but not in 'origin/main'\n"),
        'absent');
    assert.equal(
        ratchet.baselineRefStatus(128, "fatal: invalid object name 'origin/nope'.\n"),
        'error');
});

test('tsc with no diagnostic on a failing status is an error', async () => {
    const ratchet = await ratchetP;
    assert.equal(ratchet.tscOutcome(2, 'public/a.js(1,1): error TS7006: Parameter'), 1);
    assert.equal(ratchet.tscOutcome(0, ''), 0);
    assert.throws(() => ratchet.tscOutcome(1, 'crash without a diagnostic'), /no diagnostics/);
});

test('the ceiling exit, the bad ref, and the tsc failure are the path main runs', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'quality-ratchet.mjs'), 'utf8');
    assert.match(src, /const previous = baselineOnRef\(baselineRef\)/);
    assert.match(src, /const decision = gateDecision\(actual, counts, previous, keys\)/);
    assert.match(src, /report\('baseline file went up', decision\.ceiling\);\n\s*process\.exit\(1\)/);
    assert.match(src, /tscOutcome\(result\.status,/);
    assert.match(src, /baselineRefStatus\(result\.status, result\.stderr/);
    assert.match(src, /could not read quality-baseline\.json/);
});

test('a bad baseline ref fails the process before the tools run', () => {
    const result = spawnSync(process.execPath, [
        path.join(ROOT, 'scripts', 'quality-ratchet.mjs'),
        '--only', 'tsc',
        '--baseline-ref', 'origin/no-such-quality-ref',
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}`, /could not read quality-baseline\.json/);
    assert.doesNotMatch(`${result.stdout}`, /tsc /);
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
    assert.match(wf, /--baseline-ref origin\/\$\{\{ github\.base_ref \}\}/);
    assert.match(wf, /node-version: "22"/);
});

test('functions lint stays on eslintrc when the root flat config exists', () => {
    const pkg = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'functions', 'package.json'), 'utf8'));
    assert.match(pkg.scripts.lint, /ESLINT_USE_FLAT_CONFIG=false eslint \./);
});

