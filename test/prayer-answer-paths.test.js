const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-516 — the prayer Answer page is served from a rewritten /a/<token> url.
// Same asset-path trap as form-answer (MS-371).

const PUBLIC = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'prayer-answer.html'), 'utf8');
const js = fs.readFileSync(path.join(PUBLIC, 'prayer-answer.js'), 'utf8');

const literalRefs = () => {
    const out = [];
    const re = /(?<!:)\b(?:href|src)="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out;
};

test('every asset the prayer answer page loads is root-absolute', () => {
    const relative = literalRefs().filter(u =>
        !u.startsWith('/') &&
        !u.startsWith('#') &&
        !/^[a-z]+:/i.test(u));
    assert.deepStrictEqual(relative, [],
        'these resolve under /a/<token> and the rewrite answers them with HTML: ' +
        relative.join(', '));
});

test('the page loads what it needs and never loads Firestore', () => {
    for (const needed of ['/mosaic.css', '/fonts.css', '/prayer-answer.js', '/firebase-config.js', '/vendor/alpine-3.15.12.min.js']) {
        assert.ok(html.includes('"' + needed + '"'), 'prayer-answer.html no longer loads ' + needed);
    }
    assert.ok(!html.includes('firebase-firestore-compat'),
        'the page must not load a Firestore client (same guard as form-answer)');
});

test('every path it asks for exists on disk', () => {
    const missing = literalRefs()
        .filter(u => u.startsWith('/'))
        .map(u => u.split('?')[0])
        .filter(u => !fs.existsSync(path.join(PUBLIC, u.slice(1))));
    assert.deepStrictEqual(missing, [], 'absolute but not there: ' + missing.join(', '));
});

test('the /a/** hosting rewrite is present', () => {
    const firebaseJson = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8'));
    const site = firebaseJson.hosting.find(h => h.target === 'church');
    const rewrite = (site.rewrites || []).find(r => r.source === '/a/**');
    assert.ok(rewrite, 'the /a/** rewrite is missing');
    assert.strictEqual(rewrite.destination, '/prayer-answer.html');
});

test('every state the page can be in has something to draw', () => {
    const set = new Set();
    for (const m of js.matchAll(/state\s*=\s*'([a-z]+)'/g)) set.add(m[1]);
    for (const m of js.matchAll(/state:\s*'([a-z]+)'/g)) set.add(m[1]);

    const drawn = new Set();
    for (const m of html.matchAll(/state === '([a-z]+)'/g)) drawn.add(m[1]);

    const undrawn = [...set].filter(s => !drawn.has(s));
    assert.deepStrictEqual(undrawn, [],
        'these states can be reached and render nothing: ' + undrawn.join(', '));
});

test('a failure before Alpine can still say something', () => {
    assert.match(html, /id="fatal"/, 'nothing renders when the script throws');
    assert.match(js, /addEventListener\('error'/, 'a thrown error goes unreported');
    assert.match(js, /removeAttribute\('x-cloak'\)/,
        'the fatal block must escape x-cloak');
});

test('the page publishes its state on the body', () => {
    assert.match(html, /:data-state="state"/,
        'the body must publish state for diagnostics');
});

test('the header carries a back control, not a drawer menu', () => {
    assert.match(html, /class="m-back"/, 'MS-697: back arrow in header');
    assert.doesNotMatch(html, /desktop-drawer\.js/,
        'this page is not drawer-linked');
});
