const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SignInReturn = require('../public/sign-in-return-core.js');

// MS-371 — coming back to where you were after signing in.
//
// The answering page tells a member "Sign in and you will come straight back
// here." It said that for a while before it was true: login.html sent everybody
// to whatever page their account normally lands on, so somebody following a
// form link ended up on the church's home page with no idea what happened to
// the thing they had been asked to fill in.
//
// Making it true means honouring `?next=`, and `?next=` is a value that
// arrives from outside — which is what the first half of this file is about.

const BACKSLASH = String.fromCharCode(92);
const TAB = String.fromCharCode(9);

// ── A return address is a path on this site, or it is nothing ────────────────

test('a path on this site is kept', () => {
    assert.strictEqual(SignInReturn.safeReturn('/f/7bQm2xK9vRt4Lp8sYw3NcF'), '/f/7bQm2xK9vRt4Lp8sYw3NcF');
    assert.strictEqual(SignInReturn.safeReturn('/forms.html?id=abc'), '/forms.html?id=abc');
    assert.strictEqual(SignInReturn.safeReturn('/f/abc#top'), '/f/abc#top');
});

test('somewhere else entirely is refused', () => {
    // ⚠ THE ONE THAT MATTERS. Our own sign-in page, carrying a link to a copy
    // of our own sign-in page, handed to somebody the moment after they typed
    // their password. The people most likely to follow a link they were sent
    // are exactly the people it would work on.
    for (const bad of [
        'https://not-the-church.example/sign-in',
        'http://not-the-church.example',
        '//not-the-church.example',
        'javascript:alert(1)',
        'data:text/html,<script>x</script>',
        '/' + BACKSLASH + 'not-the-church.example',
        'forms.html',
    ]) {
        assert.strictEqual(SignInReturn.safeReturn(bad), '',
            'this would send a member who has just signed in off the site: ' + bad);
    }
});

test('an invisible character does not smuggle one past', () => {
    // Browsers strip tabs and newlines out of a URL before following it, so
    // "/<tab>/elsewhere" fails the check as written and passes it as the
    // browser reads it. Both have to be looking at the same string.
    assert.strictEqual(SignInReturn.safeReturn('/' + TAB + '/not-the-church.example'), '');
    assert.strictEqual(SignInReturn.safeReturn('/' + '\n' + '/not-the-church.example'), '');
});

test('nothing at all is nothing, not a crash', () => {
    for (const empty of ['', null, undefined]) {
        assert.strictEqual(SignInReturn.safeReturn(empty), '');
    }
});

// ── And the sign-in page actually uses it ────────────────────────────────────

test('login.html sends people back, and does it on both ways in', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'login.html'), 'utf8');

    assert.match(html, /src="sign-in-return-core\.js"/,
        'login.html does not load the module that decides where next goes');

    // ⚠ TWO REDIRECTS, AND MISSING EITHER HALF-FIXES IT. One fires when the
    // page opens already signed in, the other after a password is typed. The
    // first is the one a "Not you?" round trip hits.
    const direct = html.match(/window\.location\.href = landingPageFor\(/g) || [];
    assert.deepStrictEqual(direct, [],
        'a redirect still goes straight to landingPageFor, so ?next= is ' +
        'ignored on that path and the form is lost');

    const viaNext = html.match(/window\.location\.href = afterSignIn\(/g) || [];
    assert.strictEqual(viaNext.length, 2,
        'both sign-in paths should return people to where they were asked to ' +
        'come back to, and ' + viaNext.length + ' of 2 do');

    assert.match(html, /isKioskAccount\(data\)\) return landingPageFor\(data\)/,
        'a kiosk account is a shared device by the door and belongs on the ' +
        'kiosk screen whatever link opened it');
});

test('the answering page promises the return trip it now makes', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'form-answer.html'), 'utf8');
    assert.match(html, /you will come straight back here/,
        'the sign-in screen no longer promises to come back — if that was ' +
        'removed because it was untrue, it is true now');
});
