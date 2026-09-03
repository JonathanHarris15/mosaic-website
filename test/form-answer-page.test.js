const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// MS-371 — the page a stranger answers a form on.
//
// It is loaded in a sandbox with a stub Firebase, so the component is exercised
// against the same code it ships with and none of the network. What is being
// pinned here is mostly REFUSAL behaviour: what the page shows when it is not
// allowed to show the form, and — the one that matters most — that a failed
// send never clears what somebody typed.

function loadPage(reply, locationOver) {
    let authCb = null;
    const calls = [];

    const sandbox = {
        console, Promise, Date, Object, Array, Math, String, Number, JSON,
        Set, Map, encodeURIComponent, URLSearchParams, setTimeout, clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.location = Object.assign({ pathname: '/form-answer.html', search: '', href: 'https://x/' }, locationOver || {});
    sandbox.navigator = { share: null };
    sandbox.FormsCore = require('../public/forms-core.js');

    // Enough browser for the module to install its fatal handler. The page owes
    // a stranger a message when it cannot start, and that is not something to
    // weaken so a sandbox can load it — so the sandbox grows instead.
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
                onAuthStateChanged(cb) { authCb = cb; return () => {}; },
            };
        },
    };

    const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'form-answer.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);

    const page = sandbox.answerPage();
    return { page, calls, signIn: (u) => authCb && authCb(u || null) };
}

const OPEN_FORM = {
    ok: true,
    view: {
        title: 'Inductive Bible Study — Spring sign-up',
        description: 'The book is $18. Sign up by 21 September.',
        questions: [
            { id: 'q1', type: 'short_text', text: 'Your name', required: true, hint: '', placeholder: 'First and last' },
            { id: 'q2', type: 'paragraph', text: 'Anything we should know?', required: false, hint: '', placeholder: '' },
        ],
        rung: 'public',
        attribution: false,
    },
};

// ── Finding the form ─────────────────────────────────────────────────────────

test('the token is read off a pretty /f/ link', async () => {
    const { page, calls, signIn } = loadPage(OPEN_FORM, { pathname: '/f/7bQm2xK9vRt4Lp8sYw3NcF' });
    const p = page.load(); signIn(null); await p;
    assert.strictEqual(calls[0].formId, '7bQm2xK9vRt4Lp8sYw3NcF');
    assert.strictEqual(page.state, 'open');
});

test('a copied ?f= link still works', async () => {
    const { page, calls, signIn } = loadPage(OPEN_FORM, { search: '?f=7bQm2xK9vRt4Lp8sYw3NcF' });
    const p = page.load(); signIn(null); await p;
    assert.strictEqual(calls[0].formId, '7bQm2xK9vRt4Lp8sYw3NcF');
});

test('no token at all asks the server nothing', async () => {
    const { page, calls, signIn } = loadPage(OPEN_FORM, {});
    const p = page.load(); signIn(null); await p;
    assert.strictEqual(page.state, 'notfound');
    assert.strictEqual(calls.length, 0, 'a bare URL should not become a lookup');
});

// ── Refusals ─────────────────────────────────────────────────────────────────

test('a members-only form asks a signed-out visitor to sign in, and comes back', async () => {
    const { page, signIn } = loadPage({ ok: false, code: 'sign-in-required' }, { pathname: '/f/abc123def456ghi789', search: '' });
    const p = page.load(); signIn(null); await p;
    assert.strictEqual(page.state, 'signin');
    assert.match(page.signInHref, /login\.html\?next=/);
    assert.match(decodeURIComponent(page.signInHref), /\/f\/abc123def456ghi789/);
});

test('a closed form names itself and its date, and never reads as broken', async () => {
    const { page, signIn } = loadPage({
        ok: false, code: 'closed', title: 'Volunteer waiver — Fall work day', closedOn: '2026-08-30',
    }, { pathname: '/f/abc123def456ghi789' });
    const p = page.load(); signIn(null); await p;
    assert.strictEqual(page.state, 'closed');
    assert.strictEqual(page.closedTitle, 'Volunteer waiver — Fall work day');
    // Order is the reader's locale, not ours — this church reads "August 30".
    assert.match(page.closedLine, /August/);
    assert.match(page.closedLine, /30/);
});

test('a form that is not there says so plainly', async () => {
    const { page, signIn } = loadPage({ ok: false, code: 'not-found' }, { pathname: '/f/abc123def456ghi789' });
    const p = page.load(); signIn(null); await p;
    assert.strictEqual(page.state, 'notfound');
});

// ── Answering ────────────────────────────────────────────────────────────────

test('a missing required answer marks the question, and keeps what was typed', async () => {
    let stage = 0;
    const { page, signIn } = loadPage((payload) => {
        stage++;
        if (payload.op === 'fetch') return OPEN_FORM;
        return { ok: false, code: 'incomplete', message: 'One question still needs an answer.', missing: [{ id: 'q1', text: 'Your name' }] };
    }, { pathname: '/f/abc123def456ghi789' });

    const p = page.load(); signIn(null); await p;
    page.answers.q2 = 'We will be late';
    await page.submit();

    assert.deepStrictEqual(page.missingIds, ['q1'], 'the question itself is marked, not only a banner');
    assert.strictEqual(page.answers.q2, 'We will be late', 'what they typed was cleared');
    assert.strictEqual(page.state, 'open', 'a refusal is not a new page');
});

test('a successful send shows the afterword and no tally', async () => {
    const { page, signIn } = loadPage((payload) => payload.op === 'fetch' ?
        OPEN_FORM : { ok: true, afterword: 'Nathan will text you before 21 September.' },
    { pathname: '/f/abc123def456ghi789' });

    const p = page.load(); signIn(null); await p;
    page.answers.q1 = 'Ruth Alvarez';
    await page.submit();

    assert.strictEqual(page.state, 'submitted');
    assert.strictEqual(page.afterword, 'Nathan will text you before 21 September.');
    assert.strictEqual(page.thanks, 'Thank you.', 'a public form does not know who answered');
});

test('a send that fails keeps every answer on the screen', async () => {
    // The one moment somebody has already done the work. A page that clears
    // itself here is a page they do not come back to.
    const { page, signIn } = loadPage((payload) => payload.op === 'fetch' ?
        OPEN_FORM : new Error('network down'),
    { pathname: '/f/abc123def456ghi789' });

    const p = page.load(); signIn(null); await p;
    page.answers.q1 = 'Ruth Alvarez';
    page.answers.q2 = 'Childcare needed';
    await page.submit();

    assert.strictEqual(page.state, 'open', 'still on the form');
    assert.match(page.problem, /Nothing has been lost/);
    assert.strictEqual(page.answers.q1, 'Ruth Alvarez');
    assert.strictEqual(page.answers.q2, 'Childcare needed');
    assert.strictEqual(page.sending, false, 'the button unlocks so they can try again');
});

// ── The ballot ───────────────────────────────────────────────────────────────

test('a ballot says what it is on its own send button', async () => {
    const ballot = { ok: true, view: Object.assign({}, OPEN_FORM.view, { ballot: true, promise: 'We record that you answered. We do not record what you said.', rung: 'member' }) };
    const { page, signIn } = loadPage(ballot, { pathname: '/f/abc123def456ghi789' });
    const p = page.load(); signIn({ displayName: 'Ruth Alvarez' }); await p;
    assert.strictEqual(page.sendLabel, 'Send my answers anonymously');
    assert.strictEqual(page.form.promise, 'We record that you answered. We do not record what you said.');
});

test('answering a ballot twice is explained, not just refused', async () => {
    const ballot = { ok: true, view: Object.assign({}, OPEN_FORM.view, { ballot: true, rung: 'member' }) };
    const { page, signIn } = loadPage((payload) => payload.op === 'fetch' ? ballot : {
        ok: false, code: 'already-answered',
        message: 'You have already answered this one. Because it is a secret ballot, nothing here knows which answer was yours — so it cannot be found and changed.',
    }, { pathname: '/f/abc123def456ghi789' });

    const p = page.load(); signIn({ displayName: 'Ruth' }); await p;
    page.answers.q1 = 'Chili';
    await page.submit();

    assert.match(page.problem, /secret ballot/);
    assert.strictEqual(page.state, 'open');
});

// ── The small print ──────────────────────────────────────────────────────────

test('the count line states facts and guesses no duration', async () => {
    const { page, signIn } = loadPage(OPEN_FORM, { pathname: '/f/abc123def456ghi789' });
    const p = page.load(); signIn(null); await p;
    assert.strictEqual(page.countLine, '2 questions · 1 needed');
    assert.doesNotMatch(page.countLine, /minute/i, 'an invented time estimate is a fact we do not have');
});

test('a signed-in member with a name gets thanked by it', async () => {
    const { page, signIn } = loadPage((payload) => payload.op === 'fetch' ? OPEN_FORM : { ok: true }, { pathname: '/f/abc123def456ghi789' });
    const p = page.load(); signIn({ displayName: 'Ruth Alvarez' }); await p;
    page.answers.q1 = 'x';
    await page.submit();
    assert.strictEqual(page.thanks, 'Thank you, Ruth Alvarez.');
});
