const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ── The contract this file keeps (MS-241) ────────────────────────────────────
//
// Mosaic used to write every user's password, in plain text, into their own
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
    walk(path.join(ROOT, 'scripts'), 'scripts');
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

// ── Nothing writes it, anywhere ──────────────────────────────────────────────
//
// ⚠ THE MOST VALUABLE TEST IN THIS FILE.
//
// The field was written in four places, and three of them were added by somebody
// copying the first. This is what stops the fourth copy being made a year from
// now, when the reason it was removed has been forgotten and `password: password`
// looks like an ordinary field on an ordinary document.
//
// Deliberately NOT scoped to Firestore calls. An earlier version of this test
// read the object literal handed to each .set()/.update(), and review found three
// holes in it: brace counting a `}` inside a string could fool, quoted keys
// (`"password":` — exactly the style functions/ is written in), and `.set(payload)`
// where the object is built on an earlier line, which is the shape a relapse would
// most likely actually take.
//
// So this does not try to be clever about dataflow. It finds EVERY password key
// in the source and checks it against a list of the ones that are meant to be
// there. A new one fails until somebody adds it with a reason — which is the
// point: putting this field back should be a conscious act, not a copy-paste.

const PASSWORD_KEY = /(^|[\s{,[(])["']?password["']?\s*:/;

// Blank out the CONTENTS of string literals, so prose like
// `alert('Error updating password: ' + e)` is not read as a field named
// password. A quoted string immediately followed by a colon is left alone,
// because that is a quoted KEY — `{ "password": pw }` is the exact relapse
// shape this has to keep catching, and stripping it would hide it.
function stripStringValues(line) {
    return line.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1(?!\s*:)/g, '$1$1');
}

// The occurrences that are legitimate, and why. Keep this list short — every
// entry is a place somebody must think about if this ticket regresses.
const ALLOWED = [
    {
        file: 'public/login.html',
        line: "password: ''",
        why: 'Alpine component state — the login form field, never written to Firestore',
    },
    {
        file: 'functions/index.js',
        line: 'password: password,',
        why: 'handed to admin.auth().createUser — Firebase Auth is what a password is FOR',
    },
    {
        file: 'functions/index.js',
        line: 'password: newPassword,',
        why: 'handed to admin.auth().updateUser — an admin setting a password, which they may still do',
    },
    {
        file: 'scripts/strip-stored-passwords.js',
        line: 'return { password: deleteSentinel };',
        why: 'the cleanup patch that DELETES the field',
    },
];

function passwordKeyOccurrences() {
    const found = [];
    for (const file of sourceFiles()) {
        const code = codeOnly(fs.readFileSync(file.abs, 'utf8'));
        code.split('\n').forEach((text, i) => {
            if (PASSWORD_KEY.test(stripStringValues(text))) {
                found.push({ file: file.path, line: i + 1, text: text.trim() });
            }
        });
    }
    return found;
}

test('every password key in the source is one somebody justified', () => {
    const unexplained = passwordKeyOccurrences().filter(occurrence =>
        !ALLOWED.some(a => a.file === occurrence.file && occurrence.text.includes(a.line)));

    const listed = unexplained.map(o => `  ${o.file}:${o.line}  ${o.text}`).join('\n');

    assert.deepStrictEqual(unexplained, [],
        'a password key appeared somewhere nobody has vouched for:\n' + listed +
        '\n\nIf it is handed to Firebase Auth, that is fine — add it to ALLOWED with a reason.\n' +
        'If it is written to Firestore, that is MS-241 coming back: Firebase Auth already holds\n' +
        'a hashed copy, and a readable second one is a list of this congregation\'s passwords,\n' +
        'which is a list of their email accounts and their banking.');
});

// The guard is only worth having if it catches the thing coming back in every
// shape it could come back in. Each of these fooled the previous version.
test('the guard catches a relapse however it is written', () => {
    const relapses = [
        "db.collection('users').doc(uid).set({ email: e, password: this.password });",
        'db.collection("users").doc(uid).set({ "password": password });',
        "await ref.update({ 'password': newPassword });",
        '    password: password,',
        'const payload = { email, password: pw };',
        "ref.set({ note: 'a } brace in a string', password: p });",
    ];

    for (const relapse of relapses) {
        assert.ok(PASSWORD_KEY.test(stripStringValues(relapse)),
            `this relapse would slip past the guard: ${relapse}`);
    }
});

// ...and does not fire on code that merely mentions the word. A test that cries
// wolf about correct code gets deleted by the next person, which is worse than
// no test at all.
test('the guard stays quiet on things that are not a password key', () => {
    const innocent = [
        "alert('Error updating password: ' + error.message);",
        "case 'auth/wrong-password':",
        'log(`Error updating user password: ${error.message}`);',
        'await auth.signInWithEmailAndPassword(email, password);',
        'const credential = firebase.auth.EmailAuthProvider.credential(user.email, oldPassword);',
        '<input type="password" id="password" x-model="password" />',
    ];

    for (const line of innocent) {
        assert.ok(!PASSWORD_KEY.test(stripStringValues(line)), `the guard cries wolf on: ${line}`);
    }
});

// The list has to stay honest too — an entry left behind after its line is gone
// would quietly re-permit that shape elsewhere in the same file.
test('every allowed exception still exists', () => {
    const occurrences = passwordKeyOccurrences();

    for (const allowed of ALLOWED) {
        const still = occurrences.some(o => o.file === allowed.file && o.text.includes(allowed.line));
        assert.ok(still,
            `ALLOWED lists ${allowed.file} "${allowed.line}" (${allowed.why}) but it is no longer ` +
            'there — remove the entry rather than leaving it to permit something else');
    }
});

// The sweep above is generic. This one names the exact line the bug lived on, so
// a failure points straight at it.
test('sign-up creates an account without filing the password', () => {
    const code = codeOnly(read('public', 'login.html'));

    const write = code.match(/collection\(['"]users['"]\)[\s\S]{0,600}?\.set\s*\(\s*\{/);
    assert.ok(write,
        'could not find the sign-up write to the users collection. If sign-up was restructured, ' +
        'this test needs updating — do not read this as "the field is gone", check by hand.');

    const payload = code.slice(write.index + write[0].length - 1, write.index + write[0].length + 400);
    assert.ok(!PASSWORD_KEY.test(payload),
        `sign-up still writes the password into the user document:\n${payload}`);
    assert.match(payload, /email/, 'sanity: this should be the user document write');
});

// The admin path deserves naming rather than riding on the generic sweep.
test('an admin setting a password writes it to Firebase Auth and nowhere else', () => {
    const code = codeOnly(read('functions', 'index.js'));

    const fn = code.match(/exports\.updateUserPasswordAdmin[\s\S]*?\n\}\);/);
    assert.ok(fn, 'updateUserPasswordAdmin is gone — an admin must still be able to SET a password');

    assert.match(fn[0], /admin\.auth\(\)\.updateUser/,
        'the admin password change no longer reaches Firebase Auth, so it sets nothing');
    assert.ok(!/collection\(["']users["']\)[\s\S]*?\.update\s*\(/.test(fn[0]),
        'the admin password change still writes to the users document alongside Firebase Auth');
});

// ── And nothing shows it ─────────────────────────────────────────────────────

test('no admin screen offers to reveal or copy a stored password', () => {
    const code = codeOnly(read('public', 'profile.js'));

    assert.ok(!/Password Visibility/i.test(code),
        'the Password Visibility panel is still on the admin screen');
    assert.ok(!/togglePasswordVisibility/.test(code),
        'the reveal toggle is still wired up');
    assert.ok(!/data\.password/.test(code),
        'the admin user list still reads a stored password off the user document');
});

test('an admin can still set a password even though they cannot read one', () => {
    const code = codeOnly(read('public', 'profile.js'));

    assert.match(code, /updateUserPasswordAdmin/,
        'the admin password-set control was removed too — admins lose the ability to READ a ' +
        'password, not the ability to set one for somebody who is locked out');
});
