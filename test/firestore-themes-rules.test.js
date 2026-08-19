const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Service Theme similarity (docs/plans/theme-similarity.md) — every distinct
// theme's embedding vector, maintained by onServiceThemeWritten
// (functions/index.js) reacting to services/{date} writes. Like the other
// rules tests here, this cannot EXERCISE the rules — that needs a live
// project — it pins the SHAPE, so a refactor can't quietly widen write
// access or narrow read access without a test going red.

const rules = fs.readFileSync(
    path.join(__dirname, '..', 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');

const themesBlock = () => {
    const m = rules.match(/match \/themes\/\{themeKey\}\s*\{([\s\S]*?)\n    \}/);
    assert.ok(m, 'no /themes rule block found');
    return m[1];
};

test('themes are readable member+, not to the public', () => {
    const block = themesBlock();
    assert.match(block, /allow read: if isMember\(\)/);
    assert.doesNotMatch(block, /allow read: if true/,
        'vectors cost money to produce; do not hand them to an unauthenticated client');
});

test('no client may create, edit or delete a theme vector — editors included', () => {
    const block = themesBlock();
    assert.match(block, /allow create, update, delete: if false/);
    assert.doesNotMatch(block, /allow (create|update|delete)[^\n]*isEditor\(\)/,
        'a client-chosen model/vector would silently break comparability with the rest of the corpus');
    assert.doesNotMatch(block, /allow write/);
});
