const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-371 — the lock and the key ship together, or not at all.
//
// ⚠ APP CHECK IS TWO SWITCHES IN TWO DIFFERENT DEPLOYMENTS, and they are not
// deployed by the same command. The browser decides whether to collect a token
// (`enabled` in public/app-check-config.js, shipped by `firebase deploy
// --only hosting`). The server decides whether to demand one (`enforceAppCheck`
// on publicForm, shipped by `--only functions`). Neither file mentions the
// other, and one can be deployed without the other.
//
// Both ways of disagreeing are bad, and only one of them is loud:
//
//   enforced, not enabled  → EVERY form refuses EVERYBODY. This shipped, and
//                            it is most of why nobody could answer a form.
//   enabled, not enforced  → the browser does the work and the server ignores
//                            it. Nothing breaks, so nobody notices, and the
//                            door has been open the whole time.
//
// The second is the one worth a test. A broken form gets reported within a
// day; a lock that is not locked gets reported never.
//
// This reads both files as text on purpose. functions/index.js cannot be
// require()d here — it pulls in firebase-admin and expects a live project —
// and the point is only to compare two literals a human might change one of.

const ROOT = path.join(__dirname, '..');

function readFlag(file, re, what) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    // Comments in both files discuss the opposite setting at length, so match
    // only the real declaration and refuse to guess if it has moved.
    const m = src.match(re);
    assert.ok(m, `could not find ${what} in ${file} — it was renamed or moved, ` +
        'and this check is now watching nothing');
    return m[1] === 'true';
}

test('App Check is enabled in the browser exactly when the server enforces it', () => {
    const enabled = readFlag(
        'public/app-check-config.js',
        /^\s*enabled:\s*(true|false)\s*,/m,
        'enabled');

    const enforced = readFlag(
        'functions/index.js',
        /enforceAppCheck:\s*(true|false)/,
        'enforceAppCheck');

    assert.strictEqual(enabled, enforced,
        enforced ?
            'the server DEMANDS an App Check token and the answering page is ' +
            'not collecting one, so every public form refuses everybody. Turn ' +
            'on `enabled` in public/app-check-config.js and deploy hosting.' :
            'the answering page is collecting App Check tokens and the server ' +
            'is ignoring them, so the door is open and nothing will look ' +
            'wrong. Turn on enforceAppCheck in functions/index.js and deploy ' +
            'functions, or turn off `enabled` and deploy hosting.');
});

test('turning App Check on means deploying both halves', () => {
    // A reminder in the place somebody will be standing when they turn it on:
    // the two switches live in two bundles and `firebase deploy --only hosting`
    // moves one of them.
    const cfg = fs.readFileSync(path.join(ROOT, 'public/app-check-config.js'), 'utf8');
    assert.match(cfg, /enforceAppCheck/,
        'app-check-config.js no longer points at the server switch it has to ' +
        'agree with, so the next person changes one and ships half a change');
});
