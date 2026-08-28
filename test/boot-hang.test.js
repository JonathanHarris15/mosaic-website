const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// "Every once in a while on a navigation it takes you to the next page and then
// just keeps loading for a really long time."
//
// It was not slow, it was stuck. Fifteen pages boot like this:
//
//     auth.onAuthStateChanged(async (user) => {
//         const userData = await getUserData(user.uid);   // ← no try
//         …
//         this.loading = false;                           // ← last line, no finally
//     });
//
// If that read rejects, the callback throws, the flag is never cleared, and the
// spinner runs until the app is force-quit. No error, no retry, nothing to
// press. Navigation is when it bites because every shell page is a NEW document
// that must fetch /users/{uid} before it can do anything, and a request in
// flight while the WebView swaps documents is exactly what fails transiently.

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (...p) => fs.readFileSync(path.join(PUBLIC, ...p), 'utf8');
const AUTH = read('auth.js');

test('a transient failure to read who you are is retried, not surfaced', () => {
    assert.match(AUTH, /for \(let attempt = 0; attempt < 3; attempt\+\+\)/,
        'getUserData no longer retries, so one dropped request is a stuck page');
    assert.match(AUTH, /await new Promise\(r => setTimeout\(r, 300 \* \(attempt \+ 1\)\)\)/,
        'the retries have no backoff, so all three fail in the same instant');
});

test('only the failures a retry could fix are retried', () => {
    const list = AUTH.match(/const RETRYABLE = \[([^\]]+)\]/);
    assert.ok(list, 'the retryable list is gone');
    // These mean the same on the third attempt as the first. Retrying them just
    // makes being refused three times slower.
    assert.ok(!/permission-denied|not-found|unauthenticated/.test(list[1]),
        'a permanent refusal is being retried');
    assert.match(list[1], /unavailable/, 'the commonest transient failure is not retried');
});

test('failing to read who you are never quietly downgrades you', () => {
    // Every caller turns a null into 'viewer'. Swallowing the error would show
    // somebody a smaller church than they belong to and say nothing — worse
    // than the stuck spinner, because it looks like it worked.
    //
    // The read itself is `fetchUserData`; `getUserData` is the answer a page
    // waits on, which is now the remembered one when there is one.
    const body = AUTH.match(/async function fetchUserData\(uid\)[\s\S]*?\n\}/)[0];
    assert.match(body, /throw lastError;/,
        'the read swallows a failure, which every caller reads as "viewer"');
    assert.ok(!/return null;[\s\S]*throw lastError/.test(body),
        'a failed read returns null instead of throwing');
});

test('a page with nothing remembered still waits for a real answer', () => {
    // The first visit on a device has no cache, so nothing is being traded away
    // there: it must still be the live read, and it must still be able to throw.
    const body = AUTH.match(/async function getUserData\(uid\)[\s\S]*?\n\}/)[0];
    assert.match(body, /if \(!known\) \{\s*\n\s*const fresh = await fetchUserData\(uid\);/,
        'a cache miss no longer waits for the real answer');
});

test('a remembered rank that has moved does not stay on screen', () => {
    // The whole trade for skipping the round trip is that the answer can be one
    // page load stale. That is only acceptable because the refresh notices.
    const body = AUTH.match(/async function getUserData\(uid\)[\s\S]*?\n\}/)[0];
    assert.match(body, /identityMoved\(known, fresh\)/,
        'nothing compares the remembered identity with the refreshed one');
    assert.match(body, /identityMoved\(known, fresh\)\) window\.location\.reload\(\)/,
        'a moved rank is noticed and then left on screen anyway');
    // A failed refresh must hand back what the caller already had. Returning
    // null here would be the exact quiet downgrade the test above forbids.
    assert.match(body, /\.catch\(\(\) => \{[\s\S]*?return known;/,
        'a failed background refresh downgrades the answer to null');
});

test('signing out forgets who you were', () => {
    // Otherwise the next person to sign in on a shared device starts their
    // first page holding the last person's rank.
    assert.match(AUTH, /function logout\(\) \{[\s\S]*?forgetUserDoc\(\);/,
        'logging out leaves the remembered identity on the device');
    assert.match(AUTH, /const known = rememberedUserDoc\(uid\)/,
        'the remembered identity is not looked up by uid');
    assert.match(AUTH, /saved\.uid === uid \? saved\.data : null/,
        'a remembered identity is handed to whoever asks, not only to its owner');
});

test('a page whose boot throws says so instead of spinning forever', () => {
    // One guard rather than fifteen edits: every one of those throws arrives
    // here as an unhandled rejection, and rewriting fifteen boot control flows
    // is where the risk of breaking something actually lives.
    assert.match(AUTH, /addEventListener\('unhandledrejection'/,
        'nothing catches a boot that throws, so the spinner is forever');
    assert.match(AUTH, /window\.location\.reload\(\)/,
        'the guard reports the failure but offers no way out of it');
    assert.match(AUTH, /let shown = false;/,
        'a page failing repeatedly would stack a banner per rejection');
    assert.match(AUTH, /role', 'alert'|setAttribute\('role', 'alert'\)/,
        'the failure is not announced to a screen reader');
});

test('the pages that boot unguarded are known, and the count only goes down', () => {
    // Not a defect list to fix blindly — the guard above already stops the
    // spinner. It is here so the number cannot quietly grow: each of these is a
    // page that still needs its own error state to recover in place rather than
    // by reloading.
    // auth.js is where getUserData is DEFINED, and the comment above it quotes
    // the very pattern being counted.
    const pages = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.js') && f !== 'auth.js');
    const unguarded = pages.filter(f => {
        const src = read(f);
        const at = src.indexOf('await getUserData');
        if (at < 0) return false;
        return !/try\s*\{/.test(src.slice(Math.max(0, at - 400), at));
    });
    assert.ok(unguarded.length <= 15,
        `${unguarded.length} pages boot without guarding the read of who you are ` +
        `(was 15): ${unguarded.join(', ')}`);
});
