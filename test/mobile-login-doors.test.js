const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The phone's sign-in screen had one door and no keys beside it.
//
// The web login page has had three things since MS-241: sign in, make an
// account, and get back into one you're locked out of. The phone had only the
// first, so anybody who lives in the app was sent to find a desktop to do the
// other two — and somebody locked out could not sign in to be told where to go.
//
// These pin the two additions, and the one rule that comes with them: what we
// say about a reset must not reveal whether that address has an account. The
// wording is account-recovery-core.js's to decide, on the phone as on the web.

const ROOT = path.join(__dirname, '..');
// Normalised: these files check out with CRLF on Windows, and the shapes below
// are matched across line breaks.
const read = (...p) => fs.readFileSync(path.join(ROOT, 'public', ...p), 'utf8').replace(/\r\n/g, '\n');

const APP = read('mobile', 'app.js');
const DATA = read('mobile', 'data.js');
const PAGE = read('mobile.html');

// The login screen, on its own — so "Sign up" appearing somewhere else in the
// app can't stand in for it appearing here.
const LOGIN = (APP.match(/function LoginScreen\(props\)[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(LOGIN, 'LoginScreen has gone missing from the mobile app');

test('the phone offers a way to make an account', () => {
    assert.match(LOGIN, /Sign up/, 'no sign-up door on the phone login screen');
    assert.match(LOGIN, /Confirm Password/, 'sign-up takes a password without confirming it');
    assert.match(LOGIN, /data\.signUp/, 'the sign-up door is not wired to anything');
});

test('the phone offers a way back into a locked-out account', () => {
    assert.match(LOGIN, /Forgot password\?/, 'no way back in from the phone');
    assert.match(LOGIN, /data\.sendPasswordReset/, 'Forgot password is not wired to anything');
});

test('a new phone account starts as a viewer, and its password is never stored', () => {
    const signUp = (DATA.match(/function signUp\([\s\S]*?\n  \}\n/) || [])[0];
    assert.ok(signUp, 'data.signUp has gone missing');
    assert.match(signUp, /permissionLevel: "viewer"/, 'a self-made phone account starts above viewer');
    // MS-241: Firebase Auth holds the hashed copy and that is the only one.
    // A readable second copy here is a list of the congregation's passwords.
    assert.doesNotMatch(signUp, /password:/, 'the phone writes the password into the user document');
});

test('what we say about a reset is account-recovery-core\'s to decide', () => {
    // ⚠ A registered and an unregistered address must answer identically — see
    // account-recovery-core.js. Sentences typed here would drift from that.
    assert.match(LOGIN, /Recovery\.resetOutcome/, 'the phone writes its own reset wording');
    assert.doesNotMatch(LOGIN, /no account|not registered|isn't registered/i,
        'the phone tells a stranger which addresses belong to this church');

    const recovery = PAGE.indexOf('account-recovery-core.js');
    assert.ok(recovery !== -1, 'mobile.html does not load account-recovery-core.js');
    assert.ok(recovery < PAGE.indexOf('mobile/app.js'), 'it loads after the app that reads it');
});

test('signing in does not leave the sign-in screen in the back stack', () => {
    // Pushed rather than replaced, one back gesture after signing in put you in
    // front of the sign-in screen again, signed in.
    assert.match(APP, /nav\("login", null, \{ replace: true \}\)/,
        'the signed-out redirect pushes a history entry');
    assert.match(LOGIN, /props\.nav\("home", null, \{ replace: true \}\)/,
        'signing in pushes home on top of login instead of replacing it');
});
