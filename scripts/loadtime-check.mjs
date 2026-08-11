// loadtime-check.mjs — how long each page actually takes to become usable.
//
// WHY THIS EXISTS. "The calendar takes ages" is a feeling, and a feeling cannot
// tell you whether the wait is the network, the number of reads, or one read
// that is slow. This drives a real Chrome at the real site, opens each page
// several times, and records two things per visit:
//
//   • READY — the moment the page stops saying "Loading…". Not `load`, not
//     DOMContentLoaded: those fire while the spinner is still up, because every
//     page here fetches its data AFTER the document is parsed. Ready is the
//     number the person waiting actually experiences.
//   • EVERY FIRESTORE READ it made on the way, named by collection, with how
//     long each took. That is what turns "slow" into "forty reads of `roster`".
//
// It needs a signed-in session, so the first run opens a browser window and
// waits for you to log in. The profile is kept between runs, so you do that
// once.
//
// Usage:
//   node scripts/loadtime-check.mjs                 # default pages, 3 runs each
//   node scripts/loadtime-check.mjs --runs 5
//   node scripts/loadtime-check.mjs --pages calendar.html,profile.html
//   node scripts/loadtime-check.mjs --base http://localhost:5005
//   node scripts/loadtime-check.mjs --json out.json

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';

// ── Options ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function opt(name, fallback) {
    const i = argv.indexOf('--' + name);
    return i === -1 ? fallback : argv[i + 1];
}

const BASE = (opt('base', 'https://mosaic-hymn-database.web.app')).replace(/\/$/, '');
const RUNS = Number(opt('runs', 3));
const JSON_OUT = opt('json', null);
const PORT = Number(opt('port', 9333));
const READY_TIMEOUT_MS = Number(opt('timeout', 45000));
const PROFILE_DIR = opt('profile', path.join(os.tmpdir(), 'mosaic-loadtime-chrome'));
const EMAIL = opt('email', process.env.MOSAIC_EMAIL || '');
const PASSWORD = opt('password', process.env.MOSAIC_PASSWORD || '');
const TRACE = argv.includes('--trace');
const COLD = argv.includes('--cold');
const AS_PERSON = opt('as-person', '');

// A desktop on the church wifi is not where this hurts. These are the two
// conditions worth checking beside it: a phone on a good mobile signal, and one
// on a bad one. Numbers are Chrome's own presets.
const NETWORKS = {
    none: null,
    '4g': { latency: 70, downloadThroughput: 4_000_000 / 8, uploadThroughput: 3_000_000 / 8 },
    '3g': { latency: 300, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 },
};
const NETWORK = opt('network', 'none');
if (!(NETWORK in NETWORKS)) {
    console.error(`--network must be one of: ${Object.keys(NETWORKS).join(', ')}`);
    process.exit(1);
}

// The pages worth timing, and how each one says it has finished.
//
// A ready probe is per-page on purpose. Every page here decides "I am done" in
// its own way — most flip an Alpine `loading` flag, the profile page reveals a
// panel — and guessing from the outside (waiting for the network to go quiet)
// measures the last background read rather than the wait somebody sits through.
const SPINNER_GONE = `(() => {
    const s = document.querySelector('[x-show="loading"]');
    if (!s) return null;
    return getComputedStyle(s).display === 'none';
})()`;

const PAGES = [
    { path: 'calendar.html', name: 'Calendar', ready: SPINNER_GONE },
    { path: 'commitments.html', name: 'Commitments', ready: SPINNER_GONE },
    {
        path: 'profile.html', name: 'Profile', ready: `(() => {
            const shown = id => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); };
            return shown('my-info-panel') || shown('link-request-panel');
        })()`,
    },
    { path: 'cover.html', name: 'Cover', ready: SPINNER_GONE },
    { path: 'away.html', name: 'Away', ready: SPINNER_GONE },
    // These two have no `loading` flag.
    //
    // ⚠ THE PEOPLE LIST CANNOT BE JUDGED BY WHETHER ITS <main> IS SHOWING.
    // `x-cloak` is on the <body>, and the computed display of a child inside a
    // hidden parent is still its own — so the main looks visible before Alpine
    // has even started, and the page appeared to be ready in 190ms while its
    // reads ran on for another 700. Asked of Alpine's own state instead.
    {
        path: 'peoples-page.html', name: 'People', ready: `(() => {
            if (!window.Alpine) return false;
            try {
                const d = Alpine.$data(document.querySelector('body[x-data]'));
                return !!(d && d.authorized === true && d.people && d.people.length > 0);
            } catch (e) { return false; }
        })()`,
    },
    // The list is injected over its spinner, so the spinner is gone rather than
    // hidden — and the table view is a different container entirely.
    {
        path: 'service-calendar.html', name: 'Service calendar', ready: `(() => {
            if (!document.getElementById('list-view')) return false;
            const spinner = document.getElementById('calendar-list-loading');
            const table = document.getElementById('calendar-table-container');
            return !spinner || !!(table && table.children.length);
        })()`,
    },
    { path: 'roles-manager.html', name: 'Roles manager', ready: SPINNER_GONE },
];

const wanted = opt('pages', null);
const pages = wanted
    ? wanted.split(',').map(p => PAGES.find(x => x.path === p.trim()) || { path: p.trim(), name: p.trim(), ready: SPINNER_GONE })
    : PAGES;

// ── Chrome ───────────────────────────────────────────────────────────────────

function chromeBinary() {
    const candidates = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        process.env.CHROME_PATH,
    ].filter(Boolean);
    for (const c of candidates) if (existsSync(c)) return c;
    throw new Error('No Chrome found. Set CHROME_PATH to the binary.');
}

async function launchChrome() {
    mkdirSync(PROFILE_DIR, { recursive: true });
    const child = spawn(chromeBinary(), [
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${PROFILE_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        'about:blank',
    ], { stdio: 'ignore', detached: false });

    // The port is not open the instant the process starts.
    for (let i = 0; i < 100; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
            if (res.ok) return { child, version: await res.json() };
        } catch { /* not up yet */ }
        await sleep(100);
    }
    throw new Error('Chrome never opened its debugging port.');
}

// ── The DevTools connection ──────────────────────────────────────────────────
//
// One socket to the browser, one attached session per tab. Commands carry the
// session id; so do the events, which is how a reply is matched to the tab that
// caused it.

class Devtools {
    constructor(ws) {
        this.ws = ws;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = [];
        ws.addEventListener('message', ev => {
            const msg = JSON.parse(ev.data);
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
                return;
            }
            if (msg.method) this.listeners.forEach(fn => fn(msg));
        });
    }

    static async connect(url) {
        const ws = new WebSocket(url);
        await new Promise((resolve, reject) => {
            ws.addEventListener('open', resolve, { once: true });
            ws.addEventListener('error', () => reject(new Error('Could not connect to Chrome.')), { once: true });
        });
        return new Devtools(ws);
    }

    send(method, params = {}, sessionId) {
        const id = this.nextId++;
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        this.ws.send(JSON.stringify(payload));
        return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    }

    on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(f => f !== fn); }; }
}

// ── Naming a read, from inside the page ──────────────────────────────────────
//
// ⚠ THE NETWORK CANNOT ANSWER THIS. This SDK sends every read down ONE
// long-lived WebChannel: each `.get()` is an `addTarget` POST that returns
// immediately, and the data comes back on a separate streaming request. So the
// requests are all the same URL, they all appear to take about 60ms, and none
// of them carries the answer. Timing them measures the postbox, not the post.
//
// So the timing is taken where the read actually is — around `.get()` itself,
// wrapped before any of the page's own scripts run. That gives the collection,
// the wait, and WHEN it started, which is the part that shows a chain of reads
// waiting on each other rather than running side by side.
const INSTRUMENT = `
(() => {
    window.__mosaicReads = [];
    function pathOf(ref) {
        try {
            if (typeof ref.path === 'string') return ref.path;
            const d = ref._delegate || ref;
            if (typeof d.path === 'string') return d.path;
            const q = d._query || ref._query;
            if (q && q.path) return q.path.canonicalString ? q.path.canonicalString() : String(q.path);
        } catch (e) {}
        return '(unknown)';
    }
    // A subcollection read names a document id that is different every time.
    // Folded to {id} so forty reads of the same shape count as forty.
    function label(ref) {
        return pathOf(ref).split('/').map((seg, i) => (i % 2 === 1 ? '{id}' : seg)).join('/');
    }
    function wrap(proto) {
        if (!proto || !Object.prototype.hasOwnProperty.call(proto, 'get')) return false;
        if (proto.get.__mosaicTimed) return false;
        const original = proto.get;
        function timed() {
            const entry = { label: label(this), start: Math.round(performance.now()), ms: null, docs: null, failed: false };
            window.__mosaicReads.push(entry);
            const args = arguments;
            return original.apply(this, args).then(snap => {
                entry.ms = Math.round(performance.now()) - entry.start;
                entry.docs = snap && (snap.size !== undefined ? snap.size : (snap.exists ? 1 : 0));
                return snap;
            }, err => {
                entry.ms = Math.round(performance.now()) - entry.start;
                entry.failed = true;
                throw err;
            });
        }
        timed.__mosaicTimed = true;
        proto.get = timed;
        return true;
    }
    // ── Measuring as somebody who is actually on the rota ────────────────────
    //
    // Half these pages do nothing at all for an account with no linked Person:
    // the Commitments page reads who you are, finds no Person, and stops. Timing
    // that measures an empty page. So the identity answer can be given a
    // personId, which makes every page take its real path. Read-only — it
    // changes what this browser ASKS FOR, never what is stored.
    const AS_PERSON = __AS_PERSON__;
    let tries = 0;
    const timer = setInterval(() => {
        const ns = window.firebase && window.firebase.firestore;
        let done = 0;
        if (ns) {
            ['Query', 'CollectionReference', 'DocumentReference'].forEach(n => {
                if (ns[n] && wrap(ns[n].prototype)) done++;
            });
        }
        if (AS_PERSON && typeof window.getUserData === 'function' && !window.getUserData.__mosaicAs) {
            const original = window.getUserData;
            const as = async function (uid) {
                const data = await original.call(this, uid);
                return Object.assign({}, data || {}, { personId: AS_PERSON });
            };
            as.__mosaicAs = true;
            window.getUserData = as;
        }
        const patchedIdentity = !AS_PERSON || (window.getUserData && window.getUserData.__mosaicAs);
        if (done && patchedIdentity) { clearInterval(timer); return; }
        if (++tries > 2000) clearInterval(timer);
    }, 1);
})();
`;

// ── One visit ────────────────────────────────────────────────────────────────

async function visit(dt, sessionId, page, url) {
    let bytes = 0;
    const off = dt.on(msg => {
        if (msg.sessionId !== sessionId) return;
        if (msg.method === 'Network.loadingFinished') bytes += msg.params.encodedDataLength || 0;
    });

    const t0 = performance.now();
    await dt.send('Page.navigate', { url }, sessionId);

    // The probe is asked in the page's OWN clock, so the answer lines up with
    // the read timings taken there. Driver-side elapsed would include the round
    // trip of every poll.
    const probe = `(() => {
        if (window.__mosaicReadyAt) return window.__mosaicReadyAt;
        const done = ${page.ready};
        if (done === true) { window.__mosaicReadyAt = Math.round(performance.now()); return window.__mosaicReadyAt; }
        return done === false ? false : null;
    })()`;

    let ready = null;
    let probeAnswered = false;
    while (performance.now() - t0 < READY_TIMEOUT_MS) {
        await sleep(40);
        let value;
        try {
            const r = await dt.send('Runtime.evaluate', { expression: probe, returnByValue: true }, sessionId);
            value = r.result && r.result.value;
        } catch { continue; }          // mid-navigation; the document is being swapped
        if (typeof value === 'number') { ready = value; probeAnswered = true; break; }
        if (value === false) probeAnswered = true;
    }

    // Let the last reads settle so the tally is not cut off mid-flight.
    await sleep(600);
    off();

    const page_ = await dt.send('Runtime.evaluate', {
        expression: `(() => {
            const n = performance.getEntriesByType('navigation')[0];
            const res = performance.getEntriesByType('resource');
            // A file the browser already had but had to ask about anyway: it came
            // back with a body it did not need to send, or with no body at all
            // after a full round trip. Both are a wait bought for nothing.
            const revalidated = res.filter(r =>
                (r.initiatorType === 'script' || r.initiatorType === 'link' || r.initiatorType === 'css') &&
                r.transferSize > 0 && r.transferSize < 1000 && r.decodedBodySize > 1000);
            return {
                dcl: n ? Math.round(n.domContentLoadedEventEnd) : null,
                load: n ? Math.round(n.loadEventEnd) : null,
                assets: res.length,
                assetMs: Math.round(Math.max(0, ...res.map(r => r.responseEnd))),
                revalidated: revalidated.length,
                revalidatedMs: Math.round(revalidated.reduce((a, r) => a + r.duration, 0)),
                transferKB: Math.round(res.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024),
                reads: (window.__mosaicReads || []).map(r => ({...r})),
            };
        })()`,
        returnByValue: true,
    }, sessionId).then(r => r.result.value).catch(() => ({ reads: [] }));

    if (TRACE) {
        for (const r of page_.reads) {
            console.log(`      · ${padL(r.start + 'ms', 7)} +${padL((r.ms ?? '?') + 'ms', 6)}  ${pad(r.label, 34)} ${r.docs === null ? '' : r.docs + ' docs'}${r.failed ? ' FAILED' : ''}`);
        }
    }

    return {
        ready,
        timedOut: ready === null,
        probeAnswered,
        dcl: page_.dcl,
        load: page_.load,
        assets: page_.assets,
        assetMs: page_.assetMs,
        revalidated: page_.revalidated,
        revalidatedMs: page_.revalidatedMs,
        transferKB: page_.transferKB,
        bytes,
        reads: page_.reads || [],
    };
}

// ── Reporting ────────────────────────────────────────────────────────────────

const median = xs => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
function padL(s, n) { s = String(s); return ' '.repeat(Math.max(0, n - s.length)) + s; }

function report(results) {
    console.log('\n═══ How long each page takes to stop saying "Loading…" ═══\n');
    console.log(pad('Page', 20) + padL('median', 9) + padL('min', 8) + padL('max', 8) + padL('reads', 8) + padL('KB', 8));
    console.log('─'.repeat(61));

    const ranked = [...results].sort((a, b) => (median(b.readyTimes) ?? 1e9) - (median(a.readyTimes) ?? 1e9));
    for (const r of ranked) {
        const m = median(r.readyTimes);
        console.log(
            pad(r.name, 20) +
            padL(m === null ? 'never' : m + 'ms', 9) +
            padL(r.readyTimes.length ? Math.min(...r.readyTimes) + 'ms' : '—', 8) +
            padL(r.readyTimes.length ? Math.max(...r.readyTimes) + 'ms' : '—', 8) +
            padL(median(r.readCounts) ?? '—', 8) +
            padL(median(r.kilobytes) ?? '—', 8)
        );
    }

    console.log('\n═══ Where each page spends it ═══');
    for (const r of ranked) {
        console.log(`\n── ${r.name} (${r.path}) ──`);
        if (!r.readyTimes.length) console.log('   never finished loading within the timeout');

        const byLabel = new Map();
        for (const read of r.allReads) {
            const e = byLabel.get(read.label) || { label: read.label, n: 0, wait: 0, slowest: 0, docs: 0, first: Infinity, last: 0, failed: 0 };
            e.n++;
            e.wait += read.ms || 0;
            e.slowest = Math.max(e.slowest, read.ms || 0);
            e.docs += read.docs || 0;
            e.first = Math.min(e.first, read.start);
            e.last = Math.max(e.last, read.start + (read.ms || 0));
            if (read.failed) e.failed++;
            byLabel.set(read.label, e);
        }
        const rows = [...byLabel.values()].sort((a, b) => a.first - b.first);
        if (!rows.length) { console.log('   no Firestore reads seen'); continue; }

        // Ordered by when each read STARTS, because that is what shows a chain:
        // a read whose start is another read's finish was waiting on it.
        console.log('   ' + pad('read', 32) + padL('per visit', 10) + padL('starts', 8) + padL('slowest', 9) + padL('docs', 7));
        for (const row of rows) {
            console.log('   ' + pad(row.label, 32) +
                padL((row.n / r.runs).toFixed(1) + '×', 10) +
                padL(row.first + 'ms', 8) +
                padL(row.slowest + 'ms', 9) +
                padL(Math.round(row.docs / r.runs), 7) +
                (row.failed ? `  (${row.failed} failed)` : ''));
        }
        const firstRead = Math.min(...rows.map(x => x.first));
        const lastFinish = Math.max(...rows.map(x => x.last));
        const m = median(r.readyTimes);
        const v = r.visits[0] || {};
        console.log(`   before the first read: ${firstRead}ms — ${v.assets} files, ${v.transferKB}KB, ` +
            `${v.revalidated} of them re-checked with the server for ${v.revalidatedMs}ms`);
        if (m !== null) {
            console.log(`   last read finishes at ${lastFinish}ms; page is ready at ${m}ms` +
                (m - lastFinish > 250 ? `  ← ${m - lastFinish}ms of that is not waiting on Firestore` : ''));
        }
    }
    console.log('');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`Measuring ${BASE} — ${pages.length} pages × ${RUNS} runs.`);
    const { child, version } = await launchChrome();
    const dt = await Devtools.connect(version.webSocketDebuggerUrl);

    const { targetId } = await dt.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await dt.send('Target.attachToTarget', { targetId, flatten: true });

    await dt.send('Page.enable', {}, sessionId);
    await dt.send('Runtime.enable', {}, sessionId);
    // maxPostDataSize so the query body arrives with the event — otherwise
    // naming a read costs an extra round trip per request and skews the timing.
    await dt.send('Network.enable', {}, sessionId);
    // Before any of the page's own scripts — that is the only moment early
    // enough to get in front of the first read.
    await dt.send('Page.addScriptToEvaluateOnNewDocument', {
        source: INSTRUMENT.replace('__AS_PERSON__', JSON.stringify(AS_PERSON || null)),
    }, sessionId);

    // ── Sign in, once ────────────────────────────────────────────────────────
    //
    // Straight through the SDK rather than by typing into the form: the form is
    // Alpine-bound, so a synthetic keystroke has to win a race with the binding
    // before it counts, and none of that is what we are here to measure.
    // Credentials come from the command line or the environment — never from
    // this file, which is checked in.
    await dt.send('Page.navigate', { url: `${BASE}/login.html` }, sessionId);
    const signedIn = async () => {
        try {
            const r = await dt.send('Runtime.evaluate', {
                expression: `!!(window.firebase && firebase.auth().currentUser && !firebase.auth().currentUser.isAnonymous)`,
                returnByValue: true,
            }, sessionId);
            return r.result.value === true;
        } catch { return false; }
    };

    await sleep(2500);
    if (!await signedIn()) {
        if (EMAIL && PASSWORD) {
            const r = await dt.send('Runtime.evaluate', {
                expression: `firebase.auth().signInWithEmailAndPassword(${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})
                    .then(() => 'ok').catch(e => 'failed: ' + e.code)`,
                awaitPromise: true, returnByValue: true,
            }, sessionId).catch(e => ({ result: { value: 'failed: ' + e.message } }));
            if (r.result.value !== 'ok') {
                console.error(`Could not sign in as ${EMAIL} — ${r.result.value}`);
                child.kill();
                process.exit(1);
            }
        } else {
            console.log('\n⚠  Not signed in, and no --email/--password given.');
            console.log('   A Chrome window is open — log in there. Waiting (up to 5 minutes)…\n');
            const deadline = Date.now() + 5 * 60_000;
            while (Date.now() < deadline) {
                await sleep(2000);
                if (await signedIn()) break;
            }
        }
        // Signing in navigates away from login.html, and an evaluate that lands
        // mid-navigation answers nothing. So confirm by polling, not once.
        let confirmed = false;
        for (let i = 0; i < 40 && !confirmed; i++) {
            await sleep(500);
            confirmed = await signedIn();
        }
        if (!confirmed) {
            console.error('Still signed out — nothing to measure. Stopping.');
            child.kill();
            process.exit(1);
        }
    }
    const who = await dt.send('Runtime.evaluate', {
        expression: `firebase.auth().currentUser.email`, returnByValue: true,
    }, sessionId).then(r => r.result.value).catch(() => '?');
    // Throttling goes on AFTER signing in, so the login round trip is not part
    // of what is being measured.
    if (NETWORKS[NETWORK]) {
        await dt.send('Network.emulateNetworkConditions', {
            offline: false, ...NETWORKS[NETWORK],
        }, sessionId);
    }
    console.log(`Signed in as ${who}. Network: ${NETWORK}${COLD ? ', cold cache each visit' : ''}. Starting.\n`);

    const results = [];
    for (const page of pages) {
        const url = `${BASE}/${page.path}`;
        const r = { name: page.name, path: page.path, runs: RUNS, readyTimes: [], readCounts: [], kilobytes: [], allReads: [], visits: [] };
        for (let i = 0; i < RUNS; i++) {
            // Blank between visits so each run is a real navigation into the
            // page rather than a no-op on the URL it is already showing.
            await dt.send('Page.navigate', { url: 'about:blank' }, sessionId);
            await sleep(250);
            // A cold visit is the first one of the day, before anything is on
            // the device. The session is kept — only the file cache goes.
            if (COLD) await dt.send('Network.clearBrowserCache', {}, sessionId);
            const v = await visit(dt, sessionId, page, url);
            if (v.ready !== null) r.readyTimes.push(v.ready);
            r.readCounts.push(v.reads.length);
            r.kilobytes.push(Math.round(v.bytes / 1024));
            r.allReads.push(...v.reads);
            r.visits.push(v);
            process.stdout.write(`  ${pad(page.name, 18)} run ${i + 1}/${RUNS}: ${v.ready === null ? 'TIMED OUT' : v.ready + 'ms'}  (${v.reads.length} reads)\n`);
        }
        results.push(r);
    }

    report(results);
    if (JSON_OUT) {
        writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, runs: RUNS, at: new Date().toISOString(), results }, null, 2));
        console.log(`Raw numbers written to ${JSON_OUT}`);
    }

    child.kill();
}

main().catch(e => { console.error(e); process.exit(1); });
