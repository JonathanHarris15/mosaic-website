const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPage(reply, locationOver) {
    const calls = [];
    const sandbox = {
        console, Promise, Date, Object, Array, Math, String, Number, JSON,
        Set, Map, encodeURIComponent, URLSearchParams, setTimeout, clearTimeout,
        sessionStorage: { getItem: () => null, setItem: () => {} },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.MOSAIC_SHELL = 'web';
    sandbox.location = Object.assign({
        pathname: '/a/testtoken123',
        search: '',
        href: 'https://x/a/testtoken123',
        hostname: 'x',
        origin: 'https://x',
        protocol: 'https:',
    }, locationOver || {});

    const listeners = {};
    sandbox.addEventListener = (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); };
    sandbox.document = {
        body: { removeAttribute() {} },
        getElementById: () => null,
    };

    sandbox.firebase = {
        apps: [],
        initializeApp() { sandbox.firebase.apps.push({}); },
        app() {
            return {
                functions() {
                    return {
                        httpsCallable() {
                            return async (payload) => {
                                calls.push(payload);
                                const r = typeof reply === 'function' ? reply(payload, calls.length) : reply;
                                if (r instanceof Error) throw r;
                                return { data: r };
                            };
                        },
                    };
                },
            };
        },
        auth() {
            return {
                onAuthStateChanged(cb) {
                    cb(null);
                    return () => {};
                },
            };
        },
    };

    const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'prayer-answer.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'firebase-config.js'), 'utf8'), sandbox);
    vm.runInContext(code, sandbox);

    const page = sandbox.prayerAnswerPage();
    return { page, calls };
}

const OPEN_VIEW = {
    firstName: 'Jane',
    serviceDateLabel: 'Sunday, June 28, 2026',
    privacyLine: 'What you write is private and only shared with Elders.',
    showAnswerBox: true,
    eldersAlreadyHaveIt: false,
    existingAnswer: null,
};

test('read with a token opens the answer box', async () => {
    const { page, calls } = loadPage({
        ok: true,
        purpose: 'prayer_request',
        thing: '2026-06-28',
        view: OPEN_VIEW,
    });
    await page.load();
    assert.strictEqual(calls[0].op, 'read');
    assert.strictEqual(calls[0].token, 'testtoken123');
    assert.strictEqual(page.state, 'open');
    assert.strictEqual(page.view.firstName, 'Jane');
});

test('prefills an earlier reply', async () => {
    const { page } = loadPage({
        ok: true,
        purpose: 'prayer_request',
        thing: '2026-06-28',
        view: Object.assign({}, OPEN_VIEW, {
            existingAnswer: 'Please pray for travel.',
        }),
    });
    await page.load();
    assert.strictEqual(page.answerText, 'Please pray for travel.');
});

test('elders already have it never shows the box', async () => {
    const { page } = loadPage({
        ok: true,
        purpose: 'prayer_request',
        thing: '2026-06-28',
        view: Object.assign({}, OPEN_VIEW, {
            eldersAlreadyHaveIt: true,
            showAnswerBox: false,
        }),
    });
    await page.load();
    assert.strictEqual(page.state, 'elders');
});

test('closed and rate-limited each get their own screen', async () => {
    const closed = loadPage({ ok: false, code: 'closed' });
    await closed.page.load();
    assert.strictEqual(closed.page.state, 'closed');

    const limited = loadPage({ ok: false, code: 'rate-limited' });
    await limited.page.load();
    assert.strictEqual(limited.page.state, 'limited');
});

test('save moves to thanks and keeps the text on failure', async () => {
    let n = 0;
    const { page } = loadPage((payload) => {
        n += 1;
        if (payload.op === 'read') {
            return { ok: true, purpose: 'prayer_request', thing: '2026-06-28', view: OPEN_VIEW };
        }
        if (n === 2) return { ok: true, view: Object.assign({}, OPEN_VIEW, { existingAnswer: 'Safe travels.' }) };
        return { ok: false, message: 'nope' };
    });
    await page.load();
    page.answerText = 'Safe travels.';
    await page.save();
    assert.strictEqual(page.state, 'thanks');
    page.answerText = 'Still here';
    await page.save();
    assert.strictEqual(page.answerText, 'Still here');
    assert.ok(page.problem);
});

test('signed-in read without a token uses items', async () => {
    const { page, calls } = loadPageWithUser({
        ok: true,
        items: [{ purpose: 'prayer_request', thing: '2026-06-28', view: OPEN_VIEW }],
    });
    await page.load();
    assert.strictEqual(calls[0].op, 'read');
    assert.strictEqual(calls[0].token, undefined);
    assert.strictEqual(page.state, 'open');
});

function loadPageWithUser(reply) {
    const calls = [];
    const sandbox = {
        console, Promise, Date, Object, Array, Math, String, Number, JSON,
        URLSearchParams, setTimeout, clearTimeout,
        sessionStorage: { getItem: () => null },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.MOSAIC_SHELL = 'web';
    sandbox.location = {
        pathname: '/prayer-answer.html',
        search: '?thing=2026-06-28',
        href: 'https://x/prayer-answer.html?thing=2026-06-28',
        hostname: 'x',
        origin: 'https://x',
    };
    sandbox.document = { body: { removeAttribute() {} }, getElementById: () => null };
    sandbox.addEventListener = () => {};
    sandbox.firebase = {
        apps: [],
        initializeApp() { sandbox.firebase.apps.push({}); },
        app() {
            return {
                functions() {
                    return {
                        httpsCallable() {
                            return async (payload) => {
                                calls.push(payload);
                                return { data: reply };
                            };
                        },
                    };
                },
            };
        },
        auth() {
            return {
                onAuthStateChanged(cb) {
                    cb({ uid: 'u1', isAnonymous: false });
                    return () => {};
                },
            };
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'firebase-config.js'), 'utf8'), sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'prayer-answer.js'), 'utf8'), sandbox);
    return { page: sandbox.prayerAnswerPage(), calls };
}

test('profile prayer card helper builds a shell-aware href', () => {
    const profileJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'profile.js'), 'utf8');
    assert.match(profileJs, /loadPrayerAskCard/);
    assert.match(profileJs, /answerLink/);
    assert.match(profileJs, /prayer-answer\.html/);
});
