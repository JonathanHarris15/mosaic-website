const {test} = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Device tokens (MS-252). Like the other rules tests, this pins the SHAPE.
// Live enforcement needs the emulator or a real project; CI does not start
// one, and the prior art (firestore-trade-rules, firestore-membership-track)
// is the same kind of read.

const rules = fs.readFileSync(
    path.join(__dirname, '..', 'firestore.rules'), 'utf8');

const tokenBlock = () => {
    const m = rules.match(
        /match \/push_tokens\/\{tokenId\}\s*\{([\s\S]*?)\n {6}\}/);
    assert.ok(m, 'users/{userId}/push_tokens/{tokenId} is missing');
    return m[1];
};

test('a signed-in user may read, write, and delete only their own tokens', () => {
    const block = tokenBlock();
    assert.match(block, /allow read: if isSignedIn\(\) && request\.auth\.uid == userId;/);
    assert.match(block, /allow create, update: if isSignedIn\(\)/);
    assert.match(block, /request\.auth\.uid == userId/);
    assert.match(block, /allow delete: if isSignedIn\(\) && request\.auth\.uid == userId;/);
});

test('writing a token under another user is not granted', () => {
    const block = tokenBlock();
    assert.doesNotMatch(block, /allow (read|create|update|delete|write)[^;]*isAdmin\(\)/);
    assert.doesNotMatch(block, /allow (read|create|update|delete|write)[^;]*isEditor\(\)/);
    assert.doesNotMatch(block, /allow write/);
    // The only uid comparison is the owner. There is no rule that names a
    // different user.
    const grants = block.match(/allow [\s\S]*?;/g) || [];
    for (const grant of grants) {
        assert.match(grant, /request\.auth\.uid == userId/);
    }
});

test('anonymous sign-in is refused', () => {
    const block = tokenBlock();
    assert.match(block, /isSignedIn\(\)/);
    assert.doesNotMatch(block, /request\.auth != null/);
});

test('a token document must carry a token string, and delete is per document', () => {
    const block = tokenBlock();
    assert.match(block, /request\.resource\.data\.token is string/);
    assert.match(block, /token\.size\(\) > 0/);
    // The path is {tokenId}, so one user can hold several and deleting one
    // names that id. Nothing here collapses them onto the user document.
    assert.match(rules, /match \/users\/\{userId\}[\s\S]*match \/push_tokens\/\{tokenId\}/);
    assert.doesNotMatch(block, /hasOnly\(\[/);
});
