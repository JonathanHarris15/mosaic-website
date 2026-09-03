const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

// MS-371 — the answering page, opened in a REAL BROWSER.
//
// ⚠ WHY THIS TEST EXISTS, AND WHY IT COSTS A WHOLE BROWSER TO RUN.
//
// The page shipped broken three times running, and the unit tests passed every
// time — because every one of those bugs lived in the gap between the code and
// the browser, which a stubbed test cannot see:
//
//   1. Relative asset paths, which the /f/** rewrite answered with the page
//      itself. Every script silently failed.
//   2. [hidden] losing to display:flex, so the error banner was always on.
//   3. And the one this file is named for: App Check's reCAPTCHA provider
//      appends its container to document.body. form-answer.js was a blocking
//      script in <head>, so document.body was null and it threw — AFTER App
//      Check had already stored an "attestation is starting" promise. That
//      promise never resolved, so the callable waited for a token that was
//      never coming. No error. No rejection. A spinner, for ever.
//
// The third one is the reason for the rule below. It was not a crash, it was a
// WAIT, and a wait is invisible to every kind of test that does not actually
// run the page. From the outside it was a blank screen, and it survived days
// of diagnosis-by-screenshot precisely because nothing had gone "wrong".
//
// So this test pins one invariant, and it is the only one that really matters:
//
//      THE PAGE ALWAYS ARRIVES SOMEWHERE IT CAN TELL SOMEBODY ABOUT.
//
// The form, or a refusal, or an apology with a Try again button. Never the
// spinner. Whatever breaks next will break differently — it will not break
// silently.
//
// ⚠ HERMETIC ON PURPOSE. Every hostname outside 127.0.0.1 fails to resolve, so
// the browser reaches no part of the internet: reCAPTCHA, Firebase Auth and the
// Cloud Function all fail at once instead of hanging the test on somebody
// else's outage. What is being tested is that the page COPES, not that Google
// is up — and coping with a dead network is the case that matters most, since
// it is what the church's worst connection looks like.
//
// Skips when Chrome is not installed, so a machine without one still runs the
// rest of the suite. It is not optional on a machine that has one.

const PUBLIC = path.join(__dirname, '..', 'public');

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ].filter(Boolean);
    return candidates.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
}

const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
    '.json': 'application/json', '.ico': 'image/x-icon',
};

function serve() {
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        // The hosting rewrite, reproduced: /f/<token> is this page. Without it
        // the test would not exercise the one URL shape that is actually used.
        const rel = /^\/f\//.test(url) ? '/form-answer.html' : url;
        const file = path.join(PUBLIC, rel.replace(/^\/+/, ''));
        if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('no'); return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Chrome leaves grandchildren holding the pipes open, so spawnSync's own
// timeout can fail to end it. Kill the whole tree by hand instead.
function runChrome(chrome, args, ms) {
    return new Promise(resolve => {
        const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '', done = false;
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { err += d; });
        const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve({ out, err }); } };
        const timer = setTimeout(() => {
            if (process.platform === 'win32') {
                spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
            } else { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { child.kill('SIGKILL'); } }
            finish();
        }, ms);
        child.on('close', finish);
        child.on('error', finish);
    });
}

test('the answering page boots and never sits on the spinner', async (t) => {
    const chrome = findChrome();
    if (!chrome) return t.skip('no Chrome on this machine');

    const server = await serve();
    const port = server.address().port;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-chrome-'));

    try {
        const { out: dom, err: log } = await runChrome(chrome, [
            '--headless=new', '--disable-gpu', '--no-sandbox',
            '--user-data-dir=' + profile,
            '--no-first-run', '--disable-extensions', '--disable-sync',
            '--disable-background-networking', '--disable-component-update',
            // Nothing leaves this machine: every hostname fails to resolve, at
            // once, so reCAPTCHA and the Cloud Function fail fast instead of
            // stalling. See the note at the top.
            "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
            '--enable-logging=stderr', '--log-level=0',
            // ⚠ Must comfortably outlast CALL_TIMEOUT in form-answer.js, or the DOM
            // is dumped in the same instant the page gives up and the test reads a
            // spinner that was about to become a message.
            '--virtual-time-budget=45000',
            '--dump-dom',
            `http://127.0.0.1:${port}/f/testtoken1234567890abcd`,
        ], 90000);

        assert.ok(dom.includes('id="answer-main"'),
            'the browser did not render the page at all');

        // ── Alpine got as far as running ─────────────────────────────────────
        const bodyTag = (dom.match(/<body[^>]*>/) || [''])[0];
        assert.doesNotMatch(bodyTag, /x-cloak/,
            'x-cloak is still on <body>, so Alpine never started and the whole ' +
            'page is invisible: ' + bodyTag);

        // ── ⚠ THE ONE THAT BIT: it must not still be loading ─────────────────
        //
        // Read from data-state, NOT from whether the spinner got display:none.
        // Alpine defers x-show to requestAnimationFrame, and rAF does not run
        // in headless dump mode — so the spinner's inline style is never a
        // reliable signal here, however true it looks.
        const state = (bodyTag.match(/(?<!:)data-state="([a-z]*)"/) || [])[1];
        assert.ok(state,
            'the body has no data-state, so Alpine never bound it. Either the ' +
            'binding was removed from form-answer.html or the component never ' +
            'started: ' + bodyTag);
        assert.notStrictEqual(state, 'loading',
            'the page is STILL ON THE SPINNER after a full time budget. ' +
            'Something it is waiting for never answered and never failed ' +
            'either — which is the exact shape of the App Check hang. Whatever ' +
            'it is waiting for needs a timeout, because a wait with no end ' +
            'cannot be reported to anybody.');

        // With no network the honest destination is the apology. Getting any
        // other settled state would mean the page invented an answer.
        assert.strictEqual(state, 'error',
            'with every host unreachable the page should end on the "This did ' +
            'not load" screen, and it ended on: ' + state);

        // ── App Check has to actually start ──────────────────────────────────
        // The hang above was downstream of this warning, and this is the line
        // that names the cause rather than the symptom.
        assert.doesNotMatch(log, /App Check did not start/,
            'App Check threw while starting. It leaves behind a promise that ' +
            'never resolves, so every call hangs. Usually this means the ' +
            'script moved back into <head>, where document.body is null.');
        assert.doesNotMatch(log, /ran before <body> existed/,
            'form-answer.js is loading before <body> exists again — it belongs ' +
            'at the end of <body>, not in <head>.');
    } finally {
        server.close();
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* leave it */ }
    }
});
