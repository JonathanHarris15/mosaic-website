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

test('every state the page can be in has something to draw', () => {
    // ⚠ THE ONE THAT BIT. `state` was set to 'error' on a failed fetch and no
    // block matched it, so the page rendered the church's header and then
    // nothing — a blank screen, which reads as the app being dead rather than
    // as something you could try again. A state with no markup is not a quiet
    // failure, it is an invisible one.
    const set = new Set();
    for (const m of js.matchAll(/state\s*=\s*'([a-z]+)'/g)) set.add(m[1]);
    for (const m of js.matchAll(/state:\s*'([a-z]+)'/g)) set.add(m[1]);

    const drawn = new Set();
    for (const m of html.matchAll(/state === '([a-z]+)'/g)) drawn.add(m[1]);

    const undrawn = [...set].filter(s => !drawn.has(s));
    assert.deepStrictEqual(undrawn, [],
        'these states can be reached and render nothing: ' + undrawn.join(', '));
});

test('the App Check provider is named rather than inferred', () => {
    // appCheck().activate() given a bare string quietly builds a
    // ReCaptchaV3Provider. Ours is an Enterprise key, which the v3 flow cannot
    // attest — and the symptom is not an error mentioning reCAPTCHA, it is
    // every submission refused and a form that will not load.
    assert.match(js, /ReCaptchaEnterpriseProvider/,
        'nothing selects the Enterprise provider, so a bare string will pick v3');
    assert.doesNotMatch(js, /activate\(\s*appCheckKey/,
        'the raw site key is passed to activate(), which silently means v3');

    const cfg = fs.readFileSync(path.join(PUBLIC, 'app-check-config.js'), 'utf8');
    assert.match(cfg, /provider:\s*'(enterprise|v3)'/,
        'the config does not say which kind of reCAPTCHA key it holds');
});

test('x-cloak is actually defined on the one page that uses it standalone', () => {
    // ⚠ x-cloak is an attribute that styles NOTHING unless the page says so.
    // Every other page in this app carries the rule inline; this one did not,
    // so the raw markup painted with every state visible at once and then
    // Alpine hid them. The flash was not a slow page — it was the page before
    // anything was deciding what to show.
    assert.match(html, /\[x-cloak\]\s*\{\s*display:\s*none/,
        'the page uses x-cloak but never defines it, so it will flash');
});

test('a failure before Alpine can still say something', () => {
    // The worst failure this page has is a blank one: it tells the stranger
    // nothing and whoever is debugging it less. This block owes nothing to
    // Alpine and takes x-cloak off the body so it can be seen at all.
    assert.match(html, /id="fatal"/, 'nothing renders when the script throws');
    assert.match(js, /addEventListener\('error'/, 'a thrown error goes unreported');
    assert.match(js, /addEventListener\('unhandledrejection'/, 'a rejected promise goes unreported');
    assert.match(js, /removeAttribute\('x-cloak'\)/,
        'the fatal block is hidden by the very x-cloak it needs to escape');
});
