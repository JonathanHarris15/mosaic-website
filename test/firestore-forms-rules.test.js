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
    assert.match(block, /allow read: if isEditor\(\)/,
        'the floor for reading a form is isEditor()');
    assert.doesNotMatch(block, /if true/,
        'a form is readable by the world — this is how the directory leaked');
    assert.doesNotMatch(block, /request\.auth != null/,
        'request.auth != null accepts an anonymous token anybody can mint; isSignedIn() is the floor');
});

// ── Shut to elders (MS-404) ──────────────────────────────────────────────────
//
// A second, narrower thing than the Answering rung: the rung says who may
// ANSWER, this says who may SEE the form at all. Only an elder may set it, and
// — the half that is easy to leave out — only an elder may clear it, or an
// editor could unset somebody else's and read the lot.

test('a form shut to elders is closed to every editor who is not one', () => {
    const block = code(formsBlock());
    assert.match(block, /allow read: if isEditor\(\) && \(isElder\(\) \|\| !shutToElders\(resource\.data\)\)/,
        'an ordinary editor can still read an elder-only form');
    assert.match(block, /allow delete: if isEditor\(\) && \(isElder\(\) \|\| !shutToElders\(resource\.data\)\)/,
        'an ordinary editor can still delete an elder-only form');
});

test('an editor can neither set the flag nor clear one somebody else set', () => {
    const block = code(formsBlock());
    const update = block.split('allow update:')[1] || '';
    assert.ok(update.includes('shutToElders(resource.data)'),
        'an editor could edit a form that is already elder-only');
    assert.ok(update.includes('shutToElders(request.resource.data)'),
        'an editor could shut a form to elders — and then not be able to open it');
    const create = block.split('allow create:')[1].split('allow update:')[0];
    assert.ok(create.includes('request.resource.data'),
        'an editor could create a form already shut to elders');
});

test('a missing flag is an ordinary form, because that is what every form was', () => {
    // The whole collection pre-dates the flag. A rule that read an absent field
    // as "shut" would have closed the library on the day it deployed.
    assert.match(rules, /function shutToElders\(data\) \{[^}]*'elderOnly' in data[^}]*\}/,
        'shutToElders should ask whether the field is there before believing it');
});

test('a Response is read by editors and written by nobody with a browser', () => {
    const block = code(responsesBlock());
    assert.match(block, /allow read: if isEditor\(\)/);
    assert.match(block, /allow write: if false;/,
        'responses are written server-side, because validation cannot live in a browser we do not control');
    assert.doesNotMatch(block, /if true/);
    assert.doesNotMatch(block, /request\.auth != null/);
});

test('the answers to an elder-only form are shut too, off a stamp on the answer itself', () => {
    // A rule cannot afford to read the form once per answer (ADR-0018 §5, the
    // same reason Event visibility is stamped onto every occurrence), so the
    // flag rides on the answer and the function writes it there.
    const block = code(responsesBlock());
    assert.match(block, /allow read: if isEditor\(\) && \(isElder\(\) \|\| !shutToElders\(resource\.data\)\)/,
        'an ordinary editor can still read the answers to an elder-only form');
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

// ── Where a form is filed (MS-375) ───────────────────────────────────────────

const foldersBlock = () => blockFor(/match \/form_folders\/\{folderId\}\s*\{([\s\S]*?)\n    \}/);

test('a Form Folder is editor-and-above, like the forms it holds', () => {
    const block = code(foldersBlock());
    assert.match(block, /allow read, write: if isEditor\(\);/,
        'the folder collection should be plain isEditor()');
    assert.doesNotMatch(block, /if true/,
        'folder names would list the whole library to the world');
    assert.doesNotMatch(block, /request\.auth != null/,
        'request.auth != null accepts an anonymous token anybody can mint; isSignedIn() is the floor');
});

test('filing a form is not a second way to reach one', () => {
    // A folder carries a name and its parent, and no list of what is inside it.
    // If it ever grew one, this collection would become a weaker second route
    // to the library's contents — and ADR-0054 is the decision that it is not.
    const block = code(foldersBlock());
    assert.doesNotMatch(block, /form_responses|form_ledger/,
        'the folder rules should say nothing about answers');
});

// ── Deleting a form, and the answers with it (MS-406) ────────────────────────
//
// The rule above is the reason this exists. `form_responses` is
// `allow write: if false` for every client, and delete is a write — so the
// browser's delete-in-a-batch could not work, and a form that had ever been
// answered could not be deleted at all. The page asked, was told yes, and then
// said "that did not delete".

const fs2 = require('node:fs');
const path2 = require('node:path');
const src2 = (dir, name) => fs2.readFileSync(path2.join(__dirname, '..', dir, name), 'utf8').replace(/\r\n/g, '\n');

test('the browser no longer tries to delete an answer it may not write', () => {
    const store = src2('public', 'forms-store.js');
    const del = store.match(/async function deleteForm\([\s\S]*?\n    \}/);
    assert.ok(del, 'deleteForm has gone missing');
    assert.ok(!/batch\.delete/.test(del[0]),
        'deleteForm still batches deletes a client is refused');
    assert.match(del[0], /httpsCallable\('deleteFormTemplate'\)/,
        'deleteForm does not go through the function that can');
});

test('the door checks the rank itself, and an elder-only form needs an elder', () => {
    const fn = src2('functions', 'index.js');
    const block = fn.match(/exports\.deleteFormTemplate = onCall\([\s\S]*?\n\);/);
    assert.ok(block, 'there is no deleteFormTemplate function');
    assert.match(block[0], /EDITOR_RANKS\.includes\(rank\)/,
        'anybody signed in can delete a form');
    assert.match(block[0], /isElderOnly\(form\) && !ELDER_RANKS\.includes\(rank\)/,
        'an ordinary editor can delete a form shut to elders');
    assert.match(block[0], /form_ledger/,
        'the ballot ledger is left behind by the one door that could tidy it');
});

test('an admin is not an elder in the function either', () => {
    const fn = src2('functions', 'index.js');
    assert.match(fn, /const ELDER_RANKS = \["elder", "super_admin"\];/,
        'ELDER_RANKS no longer matches isElder()');
});
