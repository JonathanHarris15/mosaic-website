const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-360 — the forms boundary.
//
// A public form is answerable by somebody with NO ACCOUNT. The obvious way to
// build that is to mark public forms readable in firestore.rules, and it is the
// exact shape of MS-197: the whole directory shipped open to the internet
// because a rule said `request.auth != null` where isSignedIn() was meant, and
// anonymous sign-in is enabled on this project. ADR-0051 puts the public path
// in one Cloud Function instead, running past these rules with admin
// credentials.
//
// So this file tests an ABSENCE, which is unusual and is the point: there is no
// public access in firestore.rules, and a future edit that adds some has broken
// the decision rather than extended it.
//
// Like the other rules tests here, this pins the SHAPE rather than exercising
// it — live enforcement needs a real project and stays a human verification
// step. The emulator harness drives Firestore through the Admin SDK, which
// bypasses rules entirely and so cannot stand in.
//
// Follows the pattern of firestore-people-directory-rules.test.js.

// Normalised to LF — the block patterns close on `\n    }`, which never matches
// a CRLF checkout, leaving the shape they pin unchecked.
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

const blockFor = pattern => {
    const m = rules.match(pattern);
    assert.ok(m, 'no rule block matching ' + pattern);
    return m[1];
};

const formsBlock = () => blockFor(/match \/forms\/\{formId\}\s*\{([\s\S]*?)\n    \}/);
const responsesBlock = () => blockFor(/match \/form_responses\/\{responseId\}\s*\{([\s\S]*?)\n    \}/);
const ledgerBlock = () => blockFor(/match \/form_ledger\/\{entryId\}\s*\{([\s\S]*?)\n    \}/);

// Strip comments — a block explaining why it does NOT say `if true` would
// otherwise fail a test looking for `if true`.
const code = block => block
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');

test('a Form Template is editor-and-above, and nothing below', () => {
    const block = code(formsBlock());
    assert.match(block, /allow read, write: if isEditor\(\);/,
        'the forms collection should be plain isEditor()');
    assert.doesNotMatch(block, /if true/,
        'a form is readable by the world — this is how the directory leaked');
    assert.doesNotMatch(block, /request\.auth != null/,
        'request.auth != null accepts an anonymous token anybody can mint; isSignedIn() is the floor');
});

test('a Response is read by editors and written by nobody with a browser', () => {
    const block = code(responsesBlock());
    assert.match(block, /allow read: if isEditor\(\);/);
    assert.match(block, /allow write: if false;/,
        'responses are written server-side, because validation cannot live in a browser we do not control');
    assert.doesNotMatch(block, /if true/);
    assert.doesNotMatch(block, /request\.auth != null/);
});

test('the ballot ledger is readable by nobody at all — not even an elder', () => {
    // The load-bearing one. ADR-0052 says the answers and the ledger may never
    // be joined; an editor who can read both can join them by hand, and then
    // the ballot is secret by good manners rather than by construction.
    const block = code(ledgerBlock());
    assert.match(block, /allow read, write: if false;/,
        'the ledger exists only so the server can refuse a second answer');
    assert.doesNotMatch(block, /isEditor|isElder|isAdmin|isMember|isSignedIn/,
        'no permission level may read the ledger — that is the whole decision');
});

test('no forms rule grants anything to the public', () => {
    // Belt and braces across all three at once, so a fourth forms collection
    // added later without its own test still trips this.
    const wholeFile = rules.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const formsRegion = wholeFile.slice(wholeFile.indexOf('match /forms/{formId}'));
    assert.ok(formsRegion.length > 0, 'the forms rules should exist');
    assert.doesNotMatch(formsRegion, /allow (read|write|get|list|create|update|delete)[^;]*: if true/,
        'the public path is a Cloud Function, never a rule — see ADR-0051');
});
