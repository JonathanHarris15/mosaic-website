'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const storageRules = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8');

test('storage.rules does not use if statements inside functions', () => {
    const fnBlocks = storageRules.match(/function [^{]+\{[\s\S]*?\n    \}/g) || [];
    for (const block of fnBlocks) {
        assert.doesNotMatch(block, /\n\s+if\s*\(/,
            'if inside a rules function does not compile: ' + block.split('\n')[0]);
    }
});

test('check:rules compiles firestore.rules and storage.rules', () => {
    const r = spawnSync('npm', ['run', 'check:rules'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120000,
    });
    if (r.status !== 0) {
        assert.fail((r.stdout || '') + (r.stderr || ''));
    }
});
