const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The phone login accepted the password and then put you back on the same
// screen. Signing in went to Home while the profile was still null; the
// signed-out redirect saw that null and sent you to login. Second submit
// worked because the profile had landed in between.
//
// next() is the only decision. `undefined` is still loading. `null` is signed
// out. An object is signed in.

const ROOT = path.join(__dirname, '..');
const Route = require(path.join(ROOT, 'public', 'phone-session-route.js'));

const signedIn = { uid: 'u1' };

test('a session still restoring is left where it is', () => {
    assert.equal(Route.next(undefined, 'home', false), 'home');
    assert.equal(Route.next(undefined, 'login', false), 'login');
});

test('signed out on home is sent to login', () => {
    assert.equal(Route.next(null, 'home', false), 'login');
});

test('signed out on login stays on login', () => {
    assert.equal(Route.next(null, 'login', false), 'login');
});

test('a guest who chose home is left on home', () => {
    assert.equal(Route.next(null, 'home', true), 'home');
});

test('signed in on login goes to home', () => {
    // THE BUG. Leaving login before the profile arrives is what bounced
    // you. Leaving it *because* the profile arrived is the way out.
    assert.equal(Route.next(signedIn, 'login', false), 'home');
});

test('signed in on home stays on home', () => {
    assert.equal(Route.next(signedIn, 'home', false), 'home');
});

test('the phone app uses this decision, and signing in does not race it', () => {
    const app = fs.readFileSync(path.join(ROOT, 'public', 'mobile', 'app.js'), 'utf8');
    const page = fs.readFileSync(path.join(ROOT, 'public', 'mobile.html'), 'utf8');
    assert.match(page, /phone-session-route\.js/,
        'mobile.html does not load the session rule');
    assert.ok(page.indexOf('phone-session-route.js') < page.indexOf('mobile/app.js'),
        'the rule loads after the app that reads it');
    assert.match(app, /PhoneSessionRoute\.next/,
        'the app decides the bounce for itself again');

    const login = (app.match(/function LoginScreen\(props\)[\s\S]*?\n  \}\n/) || [])[0];
    assert.ok(login, 'LoginScreen has gone missing');
    // Guest still walks to home on purpose. Signing in must not — that is
    // the race. The profile arriving is what leaves this screen.
    assert.doesNotMatch(login, /data\.signIn[\s\S]{0,200}nav\("home"/,
        'signing in still goes to home before the profile has landed');
    assert.doesNotMatch(login, /data\.signUp[\s\S]{0,200}nav\("home"/,
        'creating an account still goes to home before the profile has landed');
});
