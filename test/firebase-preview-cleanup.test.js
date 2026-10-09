// MS-726 — Preview channels are given back when a PR closes, and a manual prune clears
// the backlog. Only `pr-<digits>` channels are ever candidates.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', f), 'utf8');
const CLEAN = read('firebase-preview-cleanup.yml');
const PREVIEW = read('firebase-preview.yml');

test('cleanup runs on PR close and on manual dispatch', () => {
    assert.match(CLEAN, /pull_request:\s*\n\s*types: \[closed\]/);
    assert.match(CLEAN, /workflow_dispatch:/);
});

test('only pr-<digits> channels are touched; live never is', () => {
    assert.match(CLEAN, /\^pr-\(\[0-9\]\+\)\$/);
    assert.match(CLEAN, /CHANNEL="pr-\$\{\{ github\.event\.pull_request\.number \}\}"/);
    assert.ok(!/channel:delete "?live/.test(CLEAN));
});

test('prune deletes only channels whose PR is closed', () => {
    assert.match(CLEAN, /if \[ "\$\{state\}" != "closed" \]; then[\s\S]*?continue/);
});

test('neither workflow deploys the live site', () => {
    for (const s of [CLEAN, PREVIEW]) assert.ok(!/firebase deploy\b/.test(s.replace(/#.*$/gm, '')));
});

test('a failed preview deploy prints what Firebase said', () => {
    assert.match(PREVIEW, /2> "\$\{RUNNER_TEMP\}\/channel\.err"/);
    assert.match(PREVIEW, /cat "\$\{RUNNER_TEMP\}\/channel\.err"/);
});
