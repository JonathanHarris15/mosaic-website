#!/usr/bin/env node
// Compile firestore.rules and storage.rules the way deploy does — no auth,
// no live project. Fails when the Storage/Firestore rules runtimes reject syntax
// (e.g. `if` inside a function).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'demo-mosaic-rules-compile';

const result = spawnSync(
    'npx',
    [
        'firebase', 'emulators:exec',
        '--only', 'firestore,storage',
        '--project', PROJECT,
        'true',
        '--non-interactive',
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
);

const combined = `${result.stdout || ''}${result.stderr || ''}`;
const syntaxErrors = combined.match(/Unexpected '[^']+' in .*\.rules:\d+/g);
if (syntaxErrors && syntaxErrors.length) {
    console.error('Security rules failed to compile:\n');
    for (const line of syntaxErrors) console.error(`  ${line}`);
    process.exit(1);
}
if (result.status !== 0) {
    console.error(combined);
    process.exit(result.status || 1);
}
console.log('firestore.rules and storage.rules compiled successfully.');
