const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-389 — the boundary around a file somebody sent with a form answer.
//
// These are the two tests whose failure is a leak rather than a bug, so they
// live on their own rather than among the feature's other tests.
//
// ⚠ WRITE IS FALSE FOR EVERYBODY. Somebody answering a public form has no
// account, and every rule in storage.rules requires one. There is no rule that
// could let them upload without opening the bucket, so the bytes go through the
// publicForm Cloud Function under admin credentials (ADR-0051) and no client
// writes here at all. `if false` needs no reasoning about who is asking and
// cannot be loosened by accident.
//
// ⚠ AND NOTHING CALLS getDownloadURL() ON THIS PATH. It mints a token that
// bypasses every rule and never expires (ADR-0046), so one forwarded link would
// undo the whole thing permanently.
//
// Like the other rules tests here, this pins the SHAPE. Live enforcement needs
// a real project and stays a human verification step — the emulator drives
// Storage through the Admin SDK, which bypasses rules entirely.

const ROOT = path.join(__dirname, '..');
const rules = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8').replace(/\r\n/g, '\n');
const firestoreRules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');

const uploadBlock = () => {
    const m = rules.match(/match \/form_uploads\/\{formId\}\/\{responseId\}\/\{fileName\} \{([\s\S]*?)\n    \}/);
    assert.ok(m, 'there is no rule for the form upload path at all');
    return m[1].split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
};

test('no client may write a form upload — not even a signed-in one', () => {
    const block = uploadBlock();
    assert.match(block, /allow write: if false;/,
        'a client can write to the upload path; only the Cloud Function should');
    assert.doesNotMatch(block, /allow write: if request\.auth/,
        'write was loosened to "signed in", which a public answerer is not anyway');
    assert.doesNotMatch(block, /allow read, write/,
        'read and write were granted together, which grants write');
});

test('a form upload is readable by editors and above, and by nobody else', () => {
    const block = uploadBlock();
    assert.match(block, /allow read: if isEditorAccount\(\);/,
        'read should restate the isEditor() ladder, as event_attachments does');
    assert.doesNotMatch(block, /if true/,
        'a waiver photo readable by the world is the thing this path exists to prevent');
    assert.doesNotMatch(block, /allow read: if request\.auth != null/,
        'request.auth != null accepts an anonymous token anybody can mint');
});

test('no client deletes the bytes either — the record is the truth', () => {
    assert.match(uploadBlock(), /allow delete: if false;/,
        'a client can delete an upload directly; the cleanUpFormUploads trigger should');
});

test('the read rule matches the Firestore rule it restates', () => {
    // Two engines, one sentence: whoever may read a Response may read what came
    // with it. `isEditorAccount()` here is `isEditor()` there, and this fails if
    // somebody tightens one and forgets the other.
    assert.match(firestoreRules, /match \/form_responses\/\{responseId\} \{\s*\n\s*allow read: if isEditor\(\);/,
        'the Firestore rule on form_responses has changed shape');
    assert.match(rules, /function isEditorAccount\(\)[\s\S]*?'editor', 'admin', 'elder', 'super_admin'/,
        'isEditorAccount no longer lists the same ranks as isEditor');
});

// ── The one call that would undo all of the above ────────────────────────────

test('nothing anywhere mints a download URL for a form upload', () => {
    // getDownloadURL() returns a link that works for anybody, for ever, with no
    // rule checked. It is the single call that would make every rule above
    // decorative — so it is banned outright rather than reasoned about.
    const suspects = [
        ['public', 'form-answer.js'],
        ['public', 'form.js'],
        ['public', 'forms.js'],
        ['public', 'forms-store.js'],
        ['public', 'forms-core.js'],
        ['public', 'form-question-markup.js'],
        ['public', 'shepherding-form-document.js'],
        ['functions', 'forms-public.js'],
    ];
    suspects.forEach(parts => {
        const file = path.join(ROOT, ...parts);
        if (!fs.existsSync(file)) return;
        // Comments stripped first. Several of these files EXPLAIN why the call
        // is banned, and a test that failed on the explanation would teach
        // people to delete the warning rather than obey it.
        const src = fs.readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
        assert.ok(!src.includes('getDownloadURL'),
            parts.join('/') + ' calls getDownloadURL — one forwarded link undoes the boundary');
    });
});

test('the upload is written with its download token emptied', () => {
    // Storage mints a token on upload unless told otherwise. Leaving it there
    // would mean the link exists whether or not anybody asks for it.
    const index = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
    const block = index.match(/const storedFiles = \{\};[\s\S]*?\n      \}/);
    assert.ok(block, 'the upload write has gone missing from publicForm');
    assert.match(block[0], /firebaseStorageDownloadTokens: ""/,
        'the upload keeps the token Storage mints, so a link exists for it');
});

test('a response stores where its file is, never how to fetch it', () => {
    const FormsCore = require('../public/forms-core.js');
    const answer = FormsCore.buildUploadAnswer({
        name: 'waiver.pdf', size: 10, storagePath: 'form_uploads/f/r/q.pdf',
        url: 'https://example/token', downloadURL: 'https://example/token',
    });
    assert.strictEqual(JSON.stringify(answer).includes('http'), false,
        'something URL-shaped survived onto a stored upload');
});
