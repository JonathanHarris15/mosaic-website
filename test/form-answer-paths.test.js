const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-371 — the one page served from a REWRITTEN url, and the one page whose
// asset paths therefore cannot be relative.
//
// form-answer.html is served at /f/<token> by the hosting rewrite in
// firebase.json. A relative `mosaic.css` on that page resolves to
// /f/mosaic.css — which the SAME rewrite answers with the page itself: HTTP
// 200, content-type text/html. The browser asks for a stylesheet, is handed an
// HTML document, and drops it without a word. Every script does likewise, so
// Alpine never runs and the page renders as naked serif text with every one of
// its states visible at once.
//
// It looks exactly like a broken app and is entirely a broken URL, which is why
// it survived a smoke test: curling /f/<token> returns 200 and the right HTML.
// The page is fine. Everything it asks for afterwards is not.
//
// Shipped once, on 2026-09-02, and found by a non-member trying to answer a
// form. This is the guard.

const PUBLIC = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'form-answer.html'), 'utf8');
const js = fs.readFileSync(path.join(PUBLIC, 'form-answer.js'), 'utf8');

// href="…" / src="…" with a literal value. Alpine's :href bindings are skipped:
// they are expressions, and what they resolve to is the JS file's problem.
const literalRefs = () => {
    const out = [];
    const re = /(?<!:)\b(?:href|src)="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out;
};

test('every asset the answering page loads is root-absolute', () => {
    const relative = literalRefs().filter(u =>
        !u.startsWith('/') &&
        !u.startsWith('#') &&
        !/^[a-z]+:/i.test(u));           // http:, https:, data:, mailto:

    assert.deepStrictEqual(relative, [],
        'these resolve under /f/<token> and the rewrite answers them with the ' +
        'page itself, so the browser silently gets HTML where it wanted CSS or ' +
        'JS: ' + relative.join(', '));
});

test('the page actually loads the things it needs to work at all', () => {
    // A path can be absolute and still missing. These four are the difference
    // between a styled page and the serif wall.
    for (const needed of ['/mosaic.css', '/fonts.css', '/form-answer.js', '/vendor/alpine-3.15.12.min.js']) {
        assert.ok(html.includes('"' + needed + '"'), 'form-answer.html no longer loads ' + needed);
    }
});

test('every path it asks for exists on disk', () => {
    const missing = literalRefs()
        .filter(u => u.startsWith('/'))
        .map(u => u.split('?')[0])
        .filter(u => !fs.existsSync(path.join(PUBLIC, u.slice(1))));
    assert.deepStrictEqual(missing, [], 'absolute but not there: ' + missing.join(', '));
});

test('the sign-in link is absolute too', () => {
    // Same trap, one layer down: a relative login.html from /f/<token> goes to
    // /f/login.html and comes back as this page again — so the members-only
    // door leads in a circle.
    assert.match(js, /return '\/login\.html\?next='/,
        'the sign-in link is relative, so it loops back to the form page');
});

test('the rewrite this all depends on is still there', () => {
    const firebaseJson = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8'));
    const site = firebaseJson.hosting.find(h => h.site === 'mosaic-hymn-database');
    const rewrite = (site.rewrites || []).find(r => r.source === '/f/**');
    assert.ok(rewrite, 'the /f/** rewrite is gone, so form links 404');
    assert.strictEqual(rewrite.destination, '/form-answer.html');
});
