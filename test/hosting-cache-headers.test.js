// What the browser is allowed to keep, and the ordering trap in saying so.
//
// The app's own files must keep no-cache: nothing here is content-hashed —
// calendar.js is always calendar.js — so a cached one can run under a newly
// deployed page and render blank rather than error.
//
// Third-party code is the opposite: alpine-3.15.12.min.js carries its version,
// and the Firebase files only move when somebody vendors a new SDK. Leaving
// them on no-cache cost a full re-download of ~128KB on every single page
// visit, because Firebase Hosting answers a conditional request for a no-cache
// file with the whole body rather than "nothing changed".
//
// ⚠ THE ORDER OF THE BLOCKS IS THE WHOLE THING. The LAST matching block wins,
// so the vendor exemption has to sit BELOW the no-cache rule. Put it above —
// which reads more naturally, and is what this was written as first — and it is
// silently ignored: every vendor file goes back to no-cache and nothing
// anywhere says so. That is what this file is guarding.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8'));
const headers = config.hosting.headers;

const cacheControlOf = block =>
    (block.headers.find(h => h.key === 'Cache-Control') || {}).value;

// What a file actually ends up with: every matching block applies, last wins.
const indexOfSource = source => headers.findIndex(b => b.source === source);

test('the app\'s own files are still never cached', () => {
    const block = headers.find(b => b.source === '**/*.@(html|js|css)');
    assert.ok(block, 'the no-cache rule is gone — a stale script can now run under a new page');
    assert.strictEqual(cacheControlOf(block), 'no-cache');
});

test('third-party code is kept rather than fetched again every visit', () => {
    const block = headers.find(b => b.source === 'vendor/**');
    assert.ok(block, 'vendor/ is back on no-cache, which re-downloads ~128KB per page visit');
    assert.match(cacheControlOf(block), /max-age=\d{5,}/,
        'vendor/ is cached for so short a time it may as well not be');
});

test('the vendor exemption sits below the rule it exempts', () => {
    // The trap: Firebase Hosting takes the LAST matching block, so listing this
    // first looks right and does nothing. Verified against the hosting emulator.
    const noCache = indexOfSource('**/*.@(html|js|css)');
    const vendor = indexOfSource('vendor/**');
    assert.ok(vendor > noCache,
        'the vendor block is above the no-cache block, so it never applies — ' +
        'vendor/*.js matches both and the last one wins');
});

test('fonts and images are untouched by any of this', () => {
    const block = headers.find(b => /woff2/.test(b.source));
    assert.ok(block, 'the long cache on fonts and images has gone');
    assert.match(cacheControlOf(block), /max-age=\d{5,}/);
});
