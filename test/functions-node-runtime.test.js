const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-683 — the runtime the functions ship on, the runtime CI tests on, and
// the runtimes Firebase still accepts, held to the same number.
//
// This exists because Node 20 got away from us. Firebase deprecated it on
// 2026-04-30 and set it to be decommissioned on 2026-10-30, and the only
// thing that ever said so was a line in a deploy log nobody re-reads. A
// decommissioned runtime does not degrade — `firebase deploy` refuses, so
// every function in docs/ops/ms-545-functions-deploy-set.md becomes
// unshippable on the same morning, including whatever fix you were trying
// to ship. The warning needs to arrive somewhere that blocks.
//
// Three things have to agree, and each one is a different kind of wrong
// when it does not:
//
//   engines.node vs. Firebase's runtime table
//       → deploys fail (decommissioned) or are on the clock (deprecated).
//   engines.node vs. the workflows' node-version
//       → CI is green against a major that is not the one running in
//         production. That is worse than no CI, because it reads as proof.
//   engines.node vs. a `runtime` key in firebase.json
//       → firebase.json silently wins and package.json is decoration.
//
// The runtime table is firebase-tools' own, so it stays right as the CLI is
// upgraded rather than needing a date copied in here by hand.

const ROOT = path.join(__dirname, '..');

// Deep into firebase-tools on purpose: this table is the CLI's actual
// source of truth for what it will and will not deploy, and there is no
// public export of it. If the path moves, this test must shout rather than
// quietly stop watching — so the require is not wrapped in a try.
const { RUNTIMES } = require(
    'firebase-tools/lib/deploy/functions/runtimes/supported/types.js');

// How much warning we want before a deploy-blocking date. Long enough to
// plan an upgrade ticket, short enough that it is never noise.
const RUNWAY_DAYS = 90;

function functionsEngine() {
    const pkg = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'functions/package.json'), 'utf8'));
    const node = pkg.engines && pkg.engines.node;
    assert.ok(node, 'functions/package.json has no engines.node. The Firebase ' +
        'CLI reads the runtime from there, and refuses the deploy without it.');
    return String(node);
}

function workflowNodeVersions() {
    const dir = path.join(ROOT, '.github/workflows');
    const found = [];
    for (const name of fs.readdirSync(dir).sort()) {
        if (!/\.ya?ml$/.test(name)) continue;
        const src = fs.readFileSync(path.join(dir, name), 'utf8');
        for (const m of src.matchAll(/^\s*node-version:\s*"?([\d.]+)"?\s*$/gm)) {
            found.push({ file: name, version: m[1] });
        }
    }
    return found;
}

test('the functions runtime is one Firebase will still deploy', () => {
    const engine = functionsEngine();
    const runtime = `nodejs${engine}`;
    const spec = RUNTIMES[runtime];

    assert.ok(spec, `functions/package.json asks for node ${engine}, which the ` +
        `installed firebase-tools does not know as "${runtime}". Valid node ` +
        'runtimes: ' + Object.keys(RUNTIMES)
            .filter((r) => r.startsWith('nodejs'))
            .map((r) => r.slice('nodejs'.length))
            .join(', '));

    assert.notStrictEqual(spec.status, 'decommissioned',
        `${spec.friendly} is decommissioned. Deploys are already failing — ` +
        'every function in docs/ops/ms-545-functions-deploy-set.md is stuck. ' +
        'Raise engines.node and the workflows together.');
});

test('the functions runtime has runway left before it blocks deploys', () => {
    const engine = functionsEngine();
    const spec = RUNTIMES[`nodejs${engine}`];
    const decommission = Date.parse(spec.decommissionDate + 'T00:00:00Z');
    assert.ok(Number.isFinite(decommission),
        `firebase-tools gives nodejs${engine} no readable decommissionDate ` +
        `(${spec.decommissionDate}), so this check cannot see the cliff.`);

    const daysLeft = Math.floor((decommission - Date.now()) / 86400000);
    assert.ok(daysLeft > RUNWAY_DAYS,
        `${spec.friendly} stops accepting deploys on ${spec.decommissionDate} ` +
        `— ${daysLeft} days away. This is the warning, not the outage: pick ` +
        'the next runtime, raise engines.node and every workflow node-version ' +
        'to it, and re-run the two CI commands. ' +
        'MS-683 is the worked example of that move.');
});

test('CI tests on the runtime that ships', () => {
    const engine = functionsEngine();
    const versions = workflowNodeVersions();

    assert.ok(versions.length,
        'no workflow under .github/workflows pins a node-version. Either ' +
        'setup-node was dropped or the key was renamed, and this check is ' +
        'now watching nothing.');

    for (const { file, version } of versions) {
        assert.strictEqual(version, engine,
            `.github/workflows/${file} runs node ${version} but the functions ` +
            `deploy on node ${engine} (functions/package.json engines.node). ` +
            'CI green on a different major is not evidence the deploy works.');
    }

    for (const required of ['pr-ci.yml', 'firebase-deploy.yml']) {
        assert.ok(versions.some((v) => v.file === required),
            `.github/workflows/${required} no longer pins a node-version, so ` +
            'nothing holds it to the shipped runtime.');
    }
});

test('firebase.json does not quietly override engines.node', () => {
    const config = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'firebase.json'), 'utf8'));
    const blocks = Array.isArray(config.functions) ?
        config.functions :
        [config.functions];

    for (const block of blocks) {
        if (!block || block.runtime === undefined) continue;
        assert.strictEqual(block.runtime, `nodejs${functionsEngine()}`,
            'firebase.json sets a functions `runtime` that disagrees with ' +
            'functions/package.json engines.node. The CLI takes ' +
            'firebase.json first and never mentions the one it ignored, so ' +
            'the deploy would land on a runtime nothing else in the repo names.');
    }
});
