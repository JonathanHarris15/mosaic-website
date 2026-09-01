const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-287 — the Event Attachment boundary, in the file where the BYTES live.
//
// The Firestore rule on `event_occurrences/{id}/attachments` decided who may
// read the RECORD, and got that right from the start. For a while it was the
// only gate, and the bytes it pointed at sat behind "is anybody signed in" —
// so an elder-only Event's floor plan was a plain file any member could fetch
// by path. The promise on the ticket is one sentence: whoever may see the
// Event may see what is attached to it. This file is what keeps that sentence
// true in `storage.rules` and not only in `firestore.rules`.
//
// These rules cannot be exercised from here — that needs a live project, the
// same limit firestore-event-visibility-rules.test.js works within. What CAN
// be pinned is the shape, and the shape is where this fails: `allow read: if
// request.auth != null` is a line nobody reads twice, and it is exactly the
// line that gives the file away.
//
// Normalised to LF — the block patterns close on a newline plus spaces, which
// never matches a CRLF checkout, leaving the shape they pin unchecked.
const storageRules = fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8')
    .replace(/\r\n/g, '\n');
const firestoreRules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

const attachmentBlock = () => {
    const m = /match \/event_attachments\/\{occurrenceId\}\/\{attachmentId\}\/\{fileName\}\s*\{([\s\S]*?)\n    \}/
        .exec(storageRules);
    assert.ok(m, 'the Event Attachments Storage rule has moved or been renamed');
    return m[1];
};

const storageFn = name => {
    const m = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n    \\}').exec(storageRules);
    assert.ok(m, 'storage.rules no longer defines ' + name + '()');
    return m[1];
};

// Every rung name a rules file mentions in a permission-level list, in the
// order it mentions them. Comparing these across the two files is the only way
// to notice that one of them learned about a new level and the other did not.
const levelLists = text => (text.match(/\[[^\]]*'(?:member|editor|admin|elder|super_admin)'[^\]]*\]/g) || [])
    .map(list => list.match(/'[a-z_]+'/g).join(','));

// ── Read is the Event's visibility, not "signed in" ───────────────────────────

test('reading an attachment is not granted to anyone merely signed in', () => {
    const block = attachmentBlock();
    assert.doesNotMatch(
        block,
        /allow read: if request\.auth != null;/,
        'this is the exact line that made the elders\' meeting floor plan public — ' +
        'read must be answered against the occurrence, not against having an account');
});

test('reading an attachment asks the occurrence who may see it', () => {
    const block = attachmentBlock();
    assert.match(block, /allow read: if canSeeOccurrence\(occurrenceId\);/,
        'the read gate must be the occurrence\'s own visibility');

    assert.match(
        storageFn('canSeeOccurrence'),
        /firestore\.get\(\/databases\/\(default\)\/documents\/event_occurrences\/\$\(occurrenceId\)\)/,
        'the visibility has to be READ from the occurrence — there is nowhere else it lives');
});

test('an occurrence that never got stamped is invisible, not public', () => {
    assert.match(
        storageFn('stampedVisibility'),
        /\('visibility' in occ\) \? occ\.visibility : 'none'/,
        'an unstamped occurrence must fall to a rung nothing matches, the way firestore.rules does it');
});

test('the participant rung is answered against the occurrence, not against rank', () => {
    const fn = storageFn('rankOrParticipantSees');
    assert.match(fn, /u\.personId in occ\.participantIds/,
        'participant visibility is decided by Person id, and rank alone cannot answer it');
});

// ── The two engines must agree about the ladder ───────────────────────────────

test('storage.rules and firestore.rules name the same permission levels', () => {
    const inStorage = new Set(levelLists(storageRules));
    const inFirestore = new Set(levelLists(firestoreRules));

    for (const list of inStorage) {
        assert.ok(inFirestore.has(list),
            'storage.rules grants a rung combination firestore.rules does not know about: [' +
            list + '] — one of the two files has drifted');
    }
});

test('storage.rules reads permissionLevel with the same legacy fallback', () => {
    assert.match(
        storageFn('levelOf'),
        /\('permissionLevel' in u\) \? u\.permissionLevel : u\.role/,
        'while MS-119 has both fields live, reading only one of them locks somebody out');
});

test('anonymous sign-in is not "signed in" here either', () => {
    assert.match(
        storageFn('isSignedIn'),
        /sign_in_provider != 'anonymous'/,
        'anonymous sign-in is enabled on this project: request.auth != null is open to the internet');
});

// ── Only an editor may put bytes there ────────────────────────────────────────

test('uploading an attachment needs an editor, not just an account', () => {
    const block = attachmentBlock();
    assert.match(block, /allow write: if isEditorAccount\(\)/,
        'a member could otherwise park files under any occurrence id they could guess');
});

test('no client deletes the bytes', () => {
    assert.match(attachmentBlock(), /allow delete: if false;/,
        'the record is the truth; cleanUpDeletedAttachment removes the blob after it');
});

// ── The half of the boundary that is not a rule ───────────────────────────────
//
// A perfect rule is worth nothing if the app hands out a link that walks past
// it. `getDownloadURL()` mints exactly that: a token that serves the file to
// anyone holding it, signed out, forever, and it cannot be recalled. So the
// page must never call it on an attachment, and the function that strips the
// token Storage mints on its own must stay wired up.

// Comments are stripped first. The page CARRIES a warning that names the call,
// and a test which cannot tell a warning from the thing it warns about is one
// that goes red for the wrong reason and gets deleted.
const codeOnly = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8')
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

test('nothing on the Event page mints a permanent download link', () => {
    assert.doesNotMatch(codeOnly('calendar-event.js'), /getDownloadURL/,
        'one getDownloadURL() on this page undoes every rule above, permanently');
});

test('the file is fetched with the reader\'s own credentials', () => {
    const page = codeOnly('calendar-event.js');
    assert.match(page, /Authorization: 'Firebase ' \+ token/,
        'without the reader\'s token on the request, storage.rules cannot tell who is asking');
});

test('the token Storage mints at upload is stripped again', () => {
    const functions = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
    assert.match(functions, /exports\.sealEventAttachment = onObjectFinalized\(/,
        'without this, a file dropped in from the Firebase console keeps a public link');
    assert.match(functions, /firebaseStorageDownloadTokens: null/,
        'setting the key to null is how the token is actually removed');
});

// Not a style point. `onObjectFinalized` throws AT LOAD when it cannot find a
// bucket, and FIREBASE_CONFIG carries none during deploy analysis — so an
// inferred bucket does not fail this one function, it fails the whole
// codebase with "Cannot determine backend specification" and nothing deploys.
test('the storage trigger names its bucket rather than inferring one', () => {
    const functions = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
    const block = /exports\.sealEventAttachment = onObjectFinalized\(\s*\{([^}]*)\}/.exec(functions);
    assert.ok(block, 'sealEventAttachment has moved or been renamed');
    assert.match(block[1], /bucket: "[^"]+"/,
        'without a named bucket the whole functions codebase fails to deploy');
});
