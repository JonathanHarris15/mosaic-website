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
        pathname: '/a/123456789ABCDEFGHJK',
        search: '',
        href: 'https://x/a/123456789ABCDEFGHJK',
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
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'answer-link-page-core.js'), 'utf8'), sandbox);
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
    assert.strictEqual(calls[0].token, '123456789ABCDEFGHJK');
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

test('an invalid or expired token shows the invalid screen, not a retry', async () => {
    for (const code of ['not-found', 'failed-precondition']) {
        const { page } = loadPage({ ok: false, code });
        await page.load();
        assert.strictEqual(page.state, 'invalid');
        assert.strictEqual(page.problem, '');
    }
});

test('a malformed short token never offers try again', async () => {
    const { page, calls } = loadPage({ ok: true, view: OPEN_VIEW }, {
        pathname: '/a/example',
        href: 'https://x/a/example',
    });
    await page.load();
    assert.strictEqual(page.state, 'invalid');
    assert.strictEqual(calls.length, 0);
});

test('a callable rejection for a bad link maps to invalid', async () => {
    const err = Object.assign(new Error('not found'), { code: 'functions/not-found' });
    const { page } = loadPage(err);
    await page.load();
    assert.strictEqual(page.state, 'invalid');
});

test('a real network failure still offers try again', async () => {
    const err = Object.assign(new Error('network down'), { code: 'functions/unavailable' });
    const { page } = loadPage(err);
    await page.load();
    assert.strictEqual(page.state, 'error');
    assert.match(page.problem, /connection/i);
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
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'answer-link-page-core.js'), 'utf8'), sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'prayer-answer.js'), 'utf8'), sandbox);
    return { page: sandbox.prayerAnswerPage(), calls };
}

test('profile prayer card helper builds a shell-aware href', () => {
    const profileJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'profile.js'), 'utf8');
    assert.match(profileJs, /loadPrayerAskCard/);
    assert.match(profileJs, /answerLink/);
    assert.match(profileJs, /prayer-answer\.html/);
});

// MS-249: the same link page opens a Trade invitation.
const TRADE_VIEW = {
    status: 'waiting', holderFirstName: 'Bob', eventName: 'Sunday Service',
    roleName: 'Sound', dateLabel: 'Sunday 20 September', canAnswer: ['take', 'refuse'],
};

test('a Trade invitation link shows the ask, under its own title', async () => {
    const { page } = loadPage({ ok: true, purpose: 'trade_invitation', thing: 't1', view: TRADE_VIEW });
    await page.load();
    assert.strictEqual(page.state, 'trade-waiting');
    assert.strictEqual(page.pageTitle, 'Can you take this?');
    assert.strictEqual(page.trade.holderFirstName, 'Bob');
});

test('Yes sends take through the link and shows that they are down for it', async () => {
    const { page, calls } = loadPage((payload) => (payload.op === 'read'
        ? { ok: true, purpose: 'trade_invitation', view: TRADE_VIEW }
        : { ok: true, purpose: 'trade_invitation', view: Object.assign({}, TRADE_VIEW, { status: 'took', canAnswer: [] }) }));
    await page.load();
    await page.answerTrade('take');
    assert.strictEqual(JSON.stringify(calls[1]), JSON.stringify({ op: 'answer', token: '123456789ABCDEFGHJK', answer: 'take' }));
    assert.strictEqual(page.state, 'trade-took');
});

test('a refusal from the server stays on the ask with its words', async () => {
    const { page } = loadPage((payload) => (payload.op === 'read'
        ? { ok: true, purpose: 'trade_invitation', view: TRADE_VIEW }
        : { ok: false, code: 'refused', message: 'That swap would put somebody in a place the Role does not allow.' }));
    await page.load();
    await page.answerTrade('take');
    assert.strictEqual(page.state, 'trade-waiting');
    assert.match(page.problem, /Role does not allow/);
});

test('an ended ask reads as ended and offers no buttons', async () => {
    const { page } = loadPage({ ok: true, purpose: 'trade_invitation', view: Object.assign({}, TRADE_VIEW, { status: 'ended', canAnswer: [] }) });
    await page.load();
    assert.strictEqual(page.state, 'trade-ended');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'prayer-answer.html'), 'utf8');
    const ended = html.slice(html.indexOf("state === 'trade-ended'"));
    assert.ok(!/answerTrade/.test(ended.slice(0, ended.indexOf('</div>\n\n'))));
});
