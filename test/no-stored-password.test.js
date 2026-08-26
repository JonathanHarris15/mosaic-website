const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ── The contract this file keeps (MS-241) ────────────────────────────────────
//
// Mosaic used to write every member's password, in plain text, into their own
// `users/{uid}` document — on sign-up, when an admin created them, and both
// times a password was changed. An admin screen then displayed it with a reveal
// button and a copy button.
//
// It was not carelessness. There was no password reset in the whole app, so an
// admin reading somebody their password was the only way back into a locked-out
// account. The fix had to build the replacement before removing the field.
//
// ⚠ WHY THESE ARE SOURCE TESTS AND NOT BEHAVIOURAL ONES.
//
// The suite here is `node --test` over pure logic — there is no browser and no
// Firebase in it, so nothing can observe what a page writes to Firestore. The
// precedent for testing wiring by parsing source is page-script-deps.test.js,
// written for a browser-only fault that 2220 green tests missed. This is the
// same shape, guarding something with a longer blast radius: if the field comes
// back, it comes back silently, and the next person to notice is whoever
// breaches the database.

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// Strip line and block comments so a comment ABOUT the old behaviour — this
// file's own subject matter — is never mistaken for the behaviour returning.
function codeOnly(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Every file that could plausibly write a user document.
function sourceFiles() {
    const out = [];
    const walk = (dir, rel) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (['node_modules', 'vendor', '.git', 'build'].includes(entry.name)) continue;
            const abs = path.join(dir, entry.name);
            const relPath = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(abs, relPath);
            else if (/\.(js|mjs|html)$/.test(entry.name)) out.push({ path: relPath, abs });
        }
    };
    walk(path.join(ROOT, 'public'), 'public');
    walk(path.join(ROOT, 'functions'), 'functions');
    return out;
}

// ── Getting back in ──────────────────────────────────────────────────────────

test('the login page offers a way back into a locked-out account', () => {
    const html = read('public', 'login.html');

    assert.match(html, /Forgot password/i,
        'the login page has no Forgot password control — that is the only account-recovery route there is');
    assert.match(codeOnly(html), /sendPasswordResetEmail/,
        'the login page does not actually ask Firebase to send a reset email');
});

test('the login page routes its reset wording through the shared core', () => {
    const html = read('public', 'login.html');
    const code = codeOnly(html);

    assert.match(html, /<script[^>]+src="account-recovery-core\.js"/,
        'login.html reaches for AccountRecoveryCore but never loads it — the browser would get undefined');
    assert.match(code, /AccountRecoveryCore\.resetOutcome/,
        'the reset outcome is being worded inline rather than through the core that pins the no-enumeration rule');
});

// ⚠ The security property, guarded at the wiring level too. The core keeps the
// two answers identical; this keeps the page from reintroducing a branch of its
// own on the way past.
test('the login page does not branch its own message on whether an account exists', () => {
    const code = codeOnly(read('public', 'login.html'));

    assert.ok(!/user-not-found/.test(code),
        'login.html mentions user-not-found — a distinct answer for an unregistered address ' +
        'turns the login page into a way to find out who attends this church');
});

// ── Proving your current password ────────────────────────────────────────────

test('changing your own password proves it to Firebase, not to Firestore', () => {
    const code = codeOnly(read('public', 'profile.js'));

    assert.match(code, /reauthenticateWithCredential/,
        'the self password change does not re-authenticate — the only other way to check a ' +
        'current password is to compare it against a stored copy, which is the bug');
    assert.match(code, /updatePassword/,
        'nothing calls updatePassword, so the change is still going through a server that ' +
        'needs to know the plaintext');
    assert.ok(!/updateUserPasswordSelf/.test(code),
        'profile.js still calls updateUserPasswordSelf, the callable that authenticates by ' +
        'string-comparing a stored plaintext password');
});

test('profile.html loads the core its script reaches for', () => {
    const html = read('public', 'profile.html');
    const code = codeOnly(read('public', 'profile.js'));

    if (/AccountRecoveryCore/.test(code)) {
        assert.match(html, /<script[^>]+src="account-recovery-core\.js"/,
            'profile.js uses AccountRecoveryCore but profile.html never loads it — the browser ' +
            'would get undefined and the page would throw on first use');
    }
});

// The server-side half of the same thing.
test('no cloud function authenticates anybody by comparing a stored password', () => {
    const code = codeOnly(read('functions', 'index.js'));

    assert.ok(!/userData\.password/.test(code),
        'a cloud function still reads a stored password off the user document to check it');
    assert.ok(!/exports\.updateUserPasswordSelf/.test(code),
        'updateUserPasswordSelf is still deployed — it exists only to compare a stored ' +
        'plaintext password, and its own comment says so');
});
